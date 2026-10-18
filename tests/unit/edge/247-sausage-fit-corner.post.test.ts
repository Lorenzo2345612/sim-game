import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { Sausage, TrackDataV2 } from '../../../src/core/types';
import { sausagePieces } from '../../../src/track/sausages';
import { createSausageBodyGeometry } from '../../../src/render/sausageRenderer';
import { buildSausages } from '../../../tools/track-builder/sausages';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const HALF = 6;
const THRESHOLD = HALF + 1.2 + 0.1; // half width + KERB_WIDTH + AT4 margin

// Two parallel straights `gap` m apart joined by right semicircles of radius gap/2:
// both turns are right, so no chicane pair and no auto sausages.
function candyPoints(gap: number): Point2[] {
  const r = gap / 2;
  const pts: Point2[] = [];
  for (let x = 0; x < 200; x += 2) pts.push([x, 0]);
  const m = Math.max(8, Math.ceil(Math.PI * r));
  for (let j = 0; j < m; j++) {
    const a = -Math.PI / 2 + (Math.PI * j) / m;
    pts.push([200 + r * Math.cos(a), r + r * Math.sin(a)]);
  }
  for (let x = 200; x > 0; x -= 2) pts.push([x, gap]);
  for (let j = 0; j < m; j++) {
    const a = Math.PI / 2 + (Math.PI * j) / m;
    pts.push([r * Math.cos(a), r + r * Math.sin(a)]);
  }
  return pts;
}

function trackOf(centerline: [number, number][]): TrackDataV2 {
  return {
    ...fixture,
    centerline,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    sausages: [],
  };
}

describe('247 sausage fit corner post-code gaps', () => {
  it('POST1: an override offset below the AT4 clearance is raised by the worst deficit plus 0.05', () => {
    const pts = candyPoints(30);
    expect(buildSausages(pts, 12)).toEqual([]);
    const sausages = buildSausages(pts, 12, [{ atMeters: 100, side: 'right', offsetMeters: 5 }]);
    expect(sausages).toHaveLength(1);
    // worst sample at lateral offset - 0.25: deficit THRESHOLD - 4.75; offset acts as a minimum
    expect(sausages[0].offset).toBeCloseTo(5 + (THRESHOLD - 4.75) + 0.05, 6);
    expect(sausages[0].side).toBe('right');
    expect(sausages[0].length).toBe(6);
  });

  it('POST2: an override whose raised offset reaches 0.8 of the corner radius is dropped', () => {
    const pts = candyPoints(10);
    expect(buildSausages(pts, 12)).toEqual([]);
    const apexMeters = 200 + 2.5 * Math.PI; // apex of the R 5 semicircle
    const sausages = buildSausages(pts, 12, [
      { atMeters: apexMeters, side: 'right', offsetMeters: 2 },
    ]);
    expect(sausages).toEqual([]);
  });

  it('POST3: an override that still misses AT4 clearance after the single recheck is dropped', () => {
    const pts = candyPoints(10);
    expect(buildSausages(pts, 12)).toEqual([]);
    // the return leg 10 m away: raising the offset only moves the samples closer to it
    const sausages = buildSausages(pts, 12, [{ atMeters: 100, side: 'right', offsetMeters: 7.8 }]);
    expect(sausages).toEqual([]);
  });

  it('POST4: an override without offsetMeters keeps the width/2 default offset even with larger half-widths', () => {
    const pts = candyPoints(30);
    const left = pts.map(() => 10);
    const sausages = buildSausages(
      pts,
      12,
      [{ atMeters: 100, side: 'left' }],
      { left, right: [] },
    );
    expect(sausages).toHaveLength(1);
    expect(sausages[0].offset).toBeCloseTo(12 / 2 + 1.2 + 0.6, 9);
  });

  it('POST5: buildSausages yields nothing for centerlines with fewer than three points', () => {
    expect(buildSausages([], 12)).toEqual([]);
    expect(buildSausages([[0, 0]], 12)).toEqual([]);
    expect(buildSausages([[0, 0], [10, 0]], 12)).toEqual([]);
  });

  it('POST6: sausagePieces falls back to the (0, -1) direction on a zero-length centerline segment', () => {
    const track = trackOf([[0, 0], [10, 0], [10, 1e-10], [20, 20]]);
    for (const side of ['right', 'left'] as const) {
      const sign = side === 'right' ? 1 : -1;
      const pieces = sausagePieces(track, { index: 1, side, offset: 7.8, length: 1 });
      expect(pieces, `${side} piece count`).toHaveLength(1);
      expect(pieces[0].length, `${side} piece length`).toBeCloseTo(1, 9);
      expect(pieces[0].position.x, `${side} x`).toBeCloseTo(10 + sign * 7.8, 6);
      expect(pieces[0].position.y, `${side} y`).toBeCloseTo(0, 6);
      expect(pieces[0].position.z, `${side} z`).toBeCloseTo(0, 6);
      expect(Math.sin(pieces[0].yaw), `${side} yaw sin`).toBeCloseTo(0, 6);
      expect(Math.cos(pieces[0].yaw), `${side} yaw cos`).toBeCloseTo(-1, 6);
    }
  });

  it('POST7: sausagePieces wraps out-of-range and negative indices like the wrapped index', () => {
    const track = trackOf(Array.from({ length: 60 }, (_, i): [number, number] => [0, -2 * i]));
    const base: Omit<Sausage, 'index'> = { side: 'right', offset: 7.8, length: 2 };
    expect(sausagePieces(track, { index: 63, ...base })).toEqual(
      sausagePieces(track, { index: 3, ...base }),
    );
    expect(sausagePieces(track, { index: -57, ...base })).toEqual(
      sausagePieces(track, { index: 3, ...base }),
    );
  });

  it('POST8: createSausageBodyGeometry is a two-ring prism without cap rings', () => {
    const body = createSausageBodyGeometry();
    expect(body.getAttribute('position').count, 'two rings of four vertices').toBe(8);
    expect(body.getIndex()?.count, 'twelve triangles').toBe(36);
    body.dispose();
  });
});
