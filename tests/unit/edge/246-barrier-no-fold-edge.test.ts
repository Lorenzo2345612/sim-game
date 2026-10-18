import { describe, expect, it } from 'vitest';
import type { BarrierSegment, Side, TrackDataV2 } from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';
import { barrierRuns, rightNormalAt, type BarrierVertex } from '../../../src/track/barrierPath';

const WIDTH = 12;
const THRESHOLD = WIDTH / 2 + KERB_WIDTH + 0.5;

/** Circumradius of P[i-1], P[i], P[i+1] and the side its centre lies on (surfaces.cornerCurvature). */
function cornerAt(cx: [number, number][], i: number): { side: Side; radius: number } | null {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const v1x = cx[i][0] - prev[0];
  const v1z = cx[i][1] - prev[1];
  const v2x = next[0] - cx[i][0];
  const v2z = next[1] - cx[i][1];
  const cross = v1x * v2z - v1z * v2x;
  const a = Math.hypot(v1x, v1z);
  const b = Math.hypot(v2x, v2z);
  const c = Math.hypot(v1x + v2x, v1z + v2z);
  if (cross === 0 || a === 0 || b === 0 || c === 0) return null;
  return { side: cross > 0 ? 'right' : 'left', radius: (a * b * c) / (2 * Math.abs(cross)) };
}

interface StadiumOpts {
  sides?: Side[];
  offsetMeters?: number;
  type?: BarrierSegment['type'];
  mirror?: boolean;
  bank?: number;
  halfLeft?: number;
  halfRight?: number;
}

function stadiumCenterline(r: number): [number, number][] {
  const pts: [number, number][] = [];
  const m = Math.max(12, Math.ceil(Math.PI * r));
  for (let k = 0; k * 2 < 200; k++) pts.push([k * 2, 0]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([200 + r * Math.sin(t), -r + r * Math.cos(t)]);
  }
  for (let k = 0; k * 2 < 200; k++) pts.push([200 - k * 2, -2 * r]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([-r * Math.sin(t), -r - r * Math.cos(t)]);
  }
  return pts;
}

function stadiumTrack(r: number, opts: StadiumOpts = {}): TrackDataV2 {
  const {
    sides = ['left'],
    offsetMeters = 12,
    type = 'armco',
    mirror = false,
    bank = 0,
    halfLeft,
    halfRight,
  } = opts;
  const base = stadiumCenterline(r);
  const centerline: [number, number][] = mirror ? base.map(([x, z]) => [-x, z]) : base;
  const n = centerline.length;
  return {
    version: 2,
    id: 'stadium',
    name: 'Stadium',
    widthMeters: WIDTH,
    lengthMeters: 1000,
    officialLengthMeters: 1000,
    centerline,
    sectors: [0, 100, 200],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: sides.map((side) => ({ start: 0, end: n - 1, side, type, offsetMeters })),
    halfWidthLeft: halfLeft === undefined ? undefined : centerline.map(() => halfLeft),
    halfWidthRight: halfRight === undefined ? undefined : centerline.map(() => halfRight),
    bank: bank === 0 ? undefined : centerline.map(() => bank),
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' as const },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  } as unknown as TrackDataV2;
}

function offsetAt(cx: [number, number][], v: BarrierVertex): number {
  const [rx, rz] = rightNormalAt(cx, v.index);
  return Math.abs((v.x - cx[v.index][0]) * rx + (v.z - cx[v.index][1]) * rz);
}

function clearanceTo(cx: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (const [px, pz] of cx) best = Math.min(best, Math.hypot(px - x, pz - z));
  return best;
}

function innerBendVertices(
  track: TrackDataV2,
  side: Side,
  offsetMeters: number,
  runs: BarrierVertex[],
): Array<{ v: BarrierVertex; radius: number }> {
  const out: Array<{ v: BarrierVertex; radius: number }> = [];
  for (const v of runs) {
    const cur = cornerAt(track.centerline, v.index);
    if (cur !== null && cur.side === side && 0.8 * cur.radius < offsetMeters) {
      out.push({ v, radius: cur.radius });
    }
  }
  return out;
}

describe('246 barrier no-fold edge cases', () => {
  it('EDGE1: bank lift at clamped inner bend vertices uses the effective offset, straights keep the full offset', () => {
    const bank = 0.1;
    const track = stadiumTrack(30, { sides: ['left'], offsetMeters: 27, bank });
    const runs = barrierRuns(track, 'left').flat();
    const tanB = Math.tan(bank);
    let clamped = 0;
    let full = 0;
    for (const v of runs) {
      const cur = cornerAt(track.centerline, v.index);
      const eff =
        cur !== null && cur.side === 'left' ? Math.min(27, 0.8 * cur.radius) : 27;
      expect(Math.abs(v.y + eff * tanB), `vertex ${v.index} y`).toBeLessThanOrEqual(1e-6);
      if (eff < 27) clamped++;
      else full++;
    }
    expect(clamped, 'clamped bend vertices').toBeGreaterThan(0);
    expect(full, 'unclamped vertices').toBeGreaterThan(0);
  });

  it('EDGE3: a vertex that clears its own centerline is still dropped inside another index kerb band', () => {
    const track = stadiumTrack(7.5, { sides: ['left'], offsetMeters: 8 });
    expect(barrierRuns(track, 'left').flat().length, 'kept vertices').toBe(0);
  });

  it('EDGE4: the clearance threshold uses the narrower half-width at the nearest index', () => {
    const track = stadiumTrack(30, {
      sides: ['right'],
      offsetMeters: 6.5,
      halfLeft: 2,
      halfRight: 6,
    });
    const runs = barrierRuns(track, 'right').flat();
    expect(runs.length, 'kept vertices').toBe(track.centerline.length);
  });

  it('EDGE5: outer-side bend vertices are not clamped', () => {
    const track = stadiumTrack(30, { sides: ['right'], offsetMeters: 27 });
    const bends = innerBendVertices(track, 'left', 27, barrierRuns(track, 'right').flat());
    expect(bends.length, 'outer bend vertices').toBeGreaterThan(0);
    for (const { v } of bends) {
      expect(Math.abs(offsetAt(track.centerline, v) - 27), `vertex ${v.index} offset`).toBeLessThanOrEqual(1e-6);
    }
  });

  it('EDGE6: a right-turning corner clamps the right side the same way', () => {
    const track = stadiumTrack(30, { sides: ['right'], offsetMeters: 27, mirror: true });
    const bends = innerBendVertices(track, 'right', 27, barrierRuns(track, 'right').flat());
    expect(bends.length, 'clamped bend vertices').toBeGreaterThan(0);
    for (const { v, radius } of bends) {
      const eff = Math.min(27, 0.8 * radius);
      expect(Math.abs(offsetAt(track.centerline, v) - eff), `vertex ${v.index} offset`).toBeLessThanOrEqual(1e-6);
    }
  });

  it('EDGE7: a wall that is not a median wall is clamped like any other barrier type', () => {
    const track = stadiumTrack(30, { sides: ['left'], offsetMeters: 27, type: 'wall' });
    const bends = innerBendVertices(track, 'left', 27, barrierRuns(track, 'left').flat());
    expect(bends.length, 'clamped bend vertices').toBeGreaterThan(0);
    for (const { v, radius } of bends) {
      const eff = Math.min(27, 0.8 * radius);
      expect(Math.abs(offsetAt(track.centerline, v) - eff), `vertex ${v.index} offset`).toBeLessThanOrEqual(1e-6);
    }
  });

  it('EDGE8: median walls skip both new rules and stay inside the kerb band unclamped', () => {
    const track = stadiumTrack(30, { sides: ['left'], offsetMeters: 3, type: 'wall' });
    const runs = barrierRuns(track, 'left').flat();
    expect(runs.length, 'kept vertices').toBe(track.centerline.length);
    let insideBand = 0;
    for (const v of runs) {
      expect(Math.abs(offsetAt(track.centerline, v) - 3), `vertex ${v.index} offset`).toBeLessThanOrEqual(1e-6);
      if (clearanceTo(track.centerline, v.x, v.z) < THRESHOLD) insideBand++;
    }
    expect(insideBand, 'vertices inside the kerb band').toBeGreaterThan(0);
  });

  it('EDGE9: a vertex exactly at halfNear + KERB_WIDTH + 0.5 is kept because the drop test is strict', () => {
    const thinHalf = 0.3;
    const thinThreshold = thinHalf + KERB_WIDTH + 0.5;
    const track = stadiumTrack(30, {
      sides: ['left'],
      offsetMeters: thinThreshold,
      halfLeft: thinHalf,
      halfRight: thinHalf,
    });
    const kept = new Set(barrierRuns(track, 'left').flat().map((v) => v.index));
    for (let i = 10; i <= 90; i++) expect(kept.has(i), `straight vertex ${i} kept`).toBe(true);
  });

  it('EDGE10: barrierRuns does not mutate the track', () => {
    const track = stadiumTrack(30, { sides: ['left', 'right'], offsetMeters: 27, bank: 0.1 });
    const before = JSON.stringify(track);
    barrierRuns(track, 'left');
    barrierRuns(track, 'right');
    expect(JSON.stringify(track)).toBe(before);
  });
});
