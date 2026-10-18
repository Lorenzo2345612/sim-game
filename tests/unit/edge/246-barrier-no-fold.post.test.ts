import { describe, expect, it } from 'vitest';
import type { BarrierSegment, Side, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns, rightNormalAt, type BarrierVertex } from '../../../src/track/barrierPath';

const WIDTH = 12;

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

interface StadiumOpts {
  sides?: Side[];
  offsetMeters?: number;
  type?: BarrierSegment['type'];
  halfLeft?: number[];
  halfRight?: number[];
}

function stadiumTrack(r: number, opts: StadiumOpts = {}): TrackDataV2 {
  const { sides = ['left'], offsetMeters = 12, type = 'armco', halfLeft, halfRight } = opts;
  const centerline = stadiumCenterline(r);
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
    halfWidthLeft: halfLeft,
    halfWidthRight: halfRight,
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

/** Thin fold-back loop; `extraReturn` adds a 27.5 sample so two consecutive chords graze. */
function grazeTrack(extraReturn = false, fullRing = false): TrackDataV2 {
  const pts: [number, number][] = [];
  for (let k = 0; k * 5 <= 100; k++) pts.push([k * 5, 0]);
  pts.push([102, 2]);
  const ret = [92.5, 82.5, 72.5, 62.5, 52.5, 42.5, 32.5, 27.5, 22.5, 12.5, 2.5];
  for (const x of ret) if (extraReturn || x !== 27.5) pts.push([x, 2]);
  pts.push([1, 1]);
  return {
    version: 2,
    id: 'graze',
    name: 'Graze',
    widthMeters: 1,
    lengthMeters: 400,
    officialLengthMeters: 400,
    centerline: pts,
    sectors: [0, 100, 200],
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [
      {
        start: 0,
        end: fullRing ? pts.length - 1 : 20,
        side: 'right' as const,
        type: 'armco' as const,
        offsetMeters: 2,
      },
    ],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' as const },
    source: { dataset: 'test', license: 'MIT', url: '', dem: '' },
  } as unknown as TrackDataV2;
}

describe('246 barrier no-fold post-coder gaps', () => {
  it('POST1: a median wall on an inner bend keeps its data offset instead of the 0.8R clamp', () => {
    const track = stadiumTrack(5, { sides: ['left'], offsetMeters: 5, type: 'wall' });
    const runs = barrierRuns(track, 'left');
    expect(runs, 'run count').toHaveLength(1);
    const flat = runs[0];
    expect(flat.length, 'kept vertices').toBe(track.centerline.length);
    for (const v of flat) {
      expect(offsetAt(track.centerline, v), `vertex ${v.index} offset`).toBeCloseTo(5, 9);
    }
  });

  it('POST2: a wall whose data offset is beyond the half-width is not a median wall even when the clamp pulls it inside', () => {
    const track = stadiumTrack(5, { sides: ['left'], offsetMeters: 7, type: 'wall' });
    expect(barrierRuns(track, 'left').flat().length, 'kept vertices').toBe(0);
  });

  it('POST3: an unclamped offset inside the kerb band is kept by the own-window exemption', () => {
    const track = stadiumTrack(30, { sides: ['left'], offsetMeters: 7 });
    const runs = barrierRuns(track, 'left');
    expect(runs, 'run count').toHaveLength(1);
    expect(runs[0].length, 'kept vertices').toBe(track.centerline.length);
    for (const v of runs[0]) {
      expect(offsetAt(track.centerline, v), `vertex ${v.index} offset`).toBeCloseTo(7, 9);
    }
  });

  it('POST4: a clamped vertex loses the own-window exemption and is dropped inside a wide window index', () => {
    // Mid-bend index 150 has R = 30, so 0.8R = 24: offset 27 clamps to 24, offset 23.9 does not.
    const wide = (track: TrackDataV2): void => {
      track.halfWidthLeft = track.centerline.map(() => WIDTH / 2);
      track.halfWidthRight = track.centerline.map(() => WIDTH / 2);
      track.halfWidthLeft![152] = 25;
      track.halfWidthRight![152] = 25;
    };
    const clampedTrack = stadiumTrack(30, { sides: ['left'], offsetMeters: 27 });
    wide(clampedTrack);
    const clamped = new Set(barrierRuns(clampedTrack, 'left').flat().map((v) => v.index));
    expect(clamped.has(150), 'clamped vertex 150 dropped').toBe(false);
    const freeTrack = stadiumTrack(30, { sides: ['left'], offsetMeters: 23.9 });
    wide(freeTrack);
    const kept = new Set(barrierRuns(freeTrack, 'left').flat().map((v) => v.index));
    expect(kept.has(150), 'unclamped vertex 150 kept').toBe(true);
  });

  it('POST5: a chord that grazes a distant centerline sample splits the run without dropping its endpoints', () => {
    const track = grazeTrack();
    const pts = track.centerline;
    const mid = [52.5, 2] as const;
    let grazed = false;
    for (let j = 0; j < pts.length; j++) {
      const dj = Math.min(Math.abs(j - 10), pts.length - Math.abs(j - 10));
      const dj2 = Math.min(Math.abs(j - 11), pts.length - Math.abs(j - 11));
      if (Math.max(dj, dj2) <= 5) continue;
      if (Math.hypot(pts[j][0] - mid[0], pts[j][1] - mid[1]) < 0.5 - 0.3) grazed = true;
    }
    expect(grazed, 'midpoint of vertices 10-11 grazes a far sample').toBe(true);
    const runs = barrierRuns(track, 'right');
    expect(runs.map((r) => r.map((v) => v.index))).toEqual([
      [0, 1, 2, 3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
      [11, 12],
      [13, 14],
      [15, 16],
      [17, 18, 19, 20],
    ]);
  });

  it('POST6: zero and negative offsets do not throw and keep the long straights', () => {
    for (const offsetMeters of [0, -3]) {
      const track = stadiumTrack(30, { sides: ['left'], offsetMeters });
      expect(() => barrierRuns(track, 'left'), `offset ${offsetMeters}`).not.toThrow();
      const kept = new Set(barrierRuns(track, 'left').flat().map((v) => v.index));
      for (let i = 20; i <= 80; i++) {
        expect(kept.has(i), `offset ${offsetMeters} vertex ${i}`).toBe(true);
      }
    }
  });

  it('POST7: rule 1 drops unclamped inner-bend vertices that the halfNear clearance would keep', () => {
    // R 8 => 0.8R = 6.4 < half(left) + 1.7 = 7.7 (drop) while offset 5 stays unclamped
    // and 5 > halfNear + 1.7 = 3.7 with halfRight 2, so only rule 1 can drop them.
    const r = 8;
    const m = Math.max(12, Math.ceil(Math.PI * r));
    const track = stadiumTrack(r, {
      sides: ['left'],
      offsetMeters: 5,
      halfRight: stadiumCenterline(r).map(() => 2),
    });
    const kept = new Set(barrierRuns(track, 'left').flat().map((v) => v.index));
    for (let j = 1; j < m; j++) {
      expect(kept.has(100 + j), `bend 1 vertex ${100 + j} dropped`).toBe(false);
      expect(kept.has(200 + m + j), `bend 2 vertex ${200 + m + j} dropped`).toBe(false);
    }
    for (let i = 20; i <= 80; i++) expect(kept.has(i), `straight vertex ${i} kept`).toBe(true);
  });

  it('POST8: rule 1 keeps inner-bend vertices while 0.8R stays over half(side) + KERB_WIDTH + 0.5', () => {
    // R 30 => 0.8R = 24; halfLeft 21 (threshold 22.7) keeps them, 23 (24.7) drops them.
    const r = 30;
    const m = Math.max(12, Math.ceil(Math.PI * r));
    const bend = (track: TrackDataV2): number => {
      const kept = new Set(barrierRuns(track, 'left').flat().map((v) => v.index));
      let inner = 0;
      for (let j = 1; j < m; j++) {
        if (kept.has(100 + j)) inner++;
        if (kept.has(200 + m + j)) inner++;
      }
      return inner;
    };
    const at = (halfLeft: number): TrackDataV2 =>
      stadiumTrack(r, {
        sides: ['left'],
        offsetMeters: 30,
        halfLeft: stadiumCenterline(r).map(() => halfLeft),
      });
    expect(bend(at(21)), 'bend vertices with threshold under 0.8R').toBe(2 * (m - 1));
    expect(bend(at(23)), 'bend vertices with threshold over 0.8R').toBe(0);
  });

  it('POST9: a grazing chord splits a fully covered ring without dropping any vertex', () => {
    const track = grazeTrack(false, true);
    const n = track.centerline.length;
    const runs = barrierRuns(track, 'right');
    expect(runs.flat().length, 'kept vertices').toBe(n);
    expect(runs.map((r) => r.map((v) => v.index))).toEqual([
      [5, 6],
      [7, 8],
      [9, 10],
      [11, 12],
      [13, 14],
      [15, 16],
      [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 0, 1, 2, 3, 4],
    ]);
  });

  it('POST10: a kept vertex whose neighbouring chords both graze vanishes instead of forming a one-vertex run', () => {
    const track = grazeTrack(true);
    const runs = barrierRuns(track, 'right');
    for (const r of runs) expect(r.length, 'run length').toBeGreaterThanOrEqual(2);
    expect(runs.map((r) => r.map((v) => v.index))).toEqual([
      [0, 1, 2, 3, 4],
      [7, 8],
      [9, 10],
      [11, 12],
      [13, 14],
      [15, 16],
      [17, 18, 19, 20],
    ]);
  });

  it('POST11: a wall at exactly the half-width is not a median wall and follows the new rules', () => {
    const kept = (offsetMeters: number): number =>
      barrierRuns(stadiumTrack(5, { sides: ['left'], offsetMeters, type: 'wall' }), 'left').flat()
        .length;
    expect(kept(5.9), 'wall inside the half-width').toBe(stadiumCenterline(5).length);
    expect(kept(6), 'wall at the half-width').toBe(0);
  });
});
