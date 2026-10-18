import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import {
  buildTrackSurfaces,
  cornerCurvature,
  innerCornerRadii,
  INNER_CURVE_CLAMP,
  KERB_MIN_WIDTH,
} from '../../../src/track/surfaces';
import { KERB_WIDTH } from '../../../src/core/constants';
import { parseTrackStyle } from '../../../src/track/trackStyle';
import { createKerbOuterStrips } from '../../../src/render/kerbOuterStrip';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

function stadium(R: number, kerbs?: TrackDataV2['kerbs']): TrackDataV2 {
  const m = Math.max(12, Math.ceil(Math.PI * R));
  const centerline: [number, number][] = [];
  for (let i = 0; i < 100; i++) centerline.push([2 * i, 0]);
  for (let j = 0; j < m; j++) {
    const phi = Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([200 + R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  for (let i = 0; i < 100; i++) centerline.push([200 - 2 * i, -2 * R]);
  for (let j = 0; j < m; j++) {
    const phi = -Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  const n = centerline.length;
  return {
    ...fixture,
    id: `stadium-r${R}`,
    name: `Stadium R${R}`,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    lengthMeters: Math.round(400 + Math.PI * R),
    officialLengthMeters: Math.round(400 + Math.PI * R),
    elevation: new Array<number>(n).fill(0),
    kerbs: kerbs ?? [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
  };
}

function circle(R: number, extras?: Partial<TrackDataV2>): TrackDataV2 {
  const m = Math.max(12, Math.ceil(2 * Math.PI * R));
  const centerline: [number, number][] = [];
  for (let j = 0; j < m; j++) {
    const t = (2 * Math.PI * j) / m;
    centerline.push([R * Math.cos(t), R * Math.sin(t)]);
  }
  return {
    ...fixture,
    id: `circle-r${R}`,
    name: `Circle R${R}`,
    centerline,
    sectors: [0, Math.floor(m / 3), Math.floor((2 * m) / 3)],
    lengthMeters: Math.round(2 * Math.PI * R),
    officialLengthMeters: Math.round(2 * Math.PI * R),
    elevation: new Array<number>(m).fill(0),
    kerbs: [
      { start: 0, end: m - 1, side: 'left' },
      { start: 0, end: m - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
    ...extras,
  };
}

/** Closed loop along +X every 2 m with two left bumps (peaks R 4.25 and R 20.05). */
function bumpLine(): TrackDataV2 {
  const centerline: [number, number][] = [];
  for (let i = 0; i < 21; i++) centerline.push([2 * i, 0]);
  centerline[5] = [10, 0.5];
  centerline[10] = [20, 0.1];
  const n = centerline.length;
  return {
    ...fixture,
    id: 'bump-line',
    name: 'Bump Line',
    centerline,
    sectors: [0, 7, 14],
    lengthMeters: 80,
    officialLengthMeters: 80,
    elevation: new Array<number>(n).fill(0),
    kerbs: [],
    runoffs: [],
    barriers: [],
  };
}

function kerbStrips(track: TrackDataV2) {
  return buildTrackSurfaces(track).filter((s) => s.surface === 'kerb');
}

function outerStripData(track: TrackDataV2): { vertexCount: number } | null {
  const style = parseTrackStyle(
    { version: 1, kerbs: { outerStrip: '#2e8b57' } },
    track.centerline.length,
  ).style;
  const result = createKerbOuterStrips(track, style);
  if (result === null) return null;
  let vertexCount = 0;
  for (const child of result.group.children) {
    if (child instanceof THREE.Mesh) {
      vertexCount += (child.geometry.getAttribute('position') as THREE.BufferAttribute).count;
    }
  }
  result.dispose();
  return { vertexCount };
}

function lateralOf(track: TrackDataV2, x: number, z: number): number {
  let d = Infinity;
  for (const p of track.centerline) d = Math.min(d, Math.hypot(x - p[0], z - p[1]));
  return d;
}

describe('245 kerb no-fold post-code gaps', () => {
  it('POST1: innerCornerRadii is Infinity on straights and the bend radius on the inner side only', () => {
    const track = stadium(7);
    const n = track.centerline.length;
    const { left, right } = innerCornerRadii(track.centerline);
    expect(left).toHaveLength(n);
    expect(right).toHaveLength(n);
    // Mid straight A: >10 m from both bends.
    expect(left[50]).toBe(Infinity);
    expect(right[50]).toBe(Infinity);
    // Bend 1 apex-ish row: left (inside) inherits R, right stays untouched.
    expect(left[110]).toBeCloseTo(7, 6);
    expect(right[110]).toBe(Infinity);
  });

  it('POST2: innerCornerRadii wraps the 10 m window across the closed-loop seam', () => {
    const track = stadium(7);
    const { left, right } = innerCornerRadii(track.centerline);
    // Bend 2 ends next to index 0; without wrap the seam row would stay Infinity.
    expect(left[0]).toBeCloseTo(7, 6);
    expect(right[0]).toBe(Infinity);
  });

  it('POST3: innerCornerRadii keeps the minimum radius of corners whose windows overlap', () => {
    const cx = bumpLine().centerline;
    const { left, right } = innerCornerRadii(cx);
    expect(left[5]).toBeCloseTo(4.25, 6);
    expect(left[10]).toBeCloseTo(20.05, 6);
    // Between both bumps the smaller corner radius wins, not the local one.
    expect(left[8]).toBeCloseTo(4.25, 6);
    // Only bump A in range: same as its peak.
    expect(left[3]).toBeCloseTo(4.25, 6);
    // Only bump B in range: its own (larger) radius.
    expect(left[13]).toBeCloseTo(20.05, 6);
    // Beyond every window.
    expect(left[18]).toBe(Infinity);
    // Bump flanks bend the other way (side right); the peak itself is not a right corner.
    expect(right[4]).toBeCloseTo(8.310385, 5);
    expect(right[5]).toBeCloseTo(8.310385, 5);
    expect(right[18]).toBe(Infinity);
  });

  it('POST4: empty and degenerate centerlines do not throw and report no inner corners', () => {
    const empty = innerCornerRadii([]);
    expect(empty.left).toHaveLength(0);
    expect(empty.right).toHaveLength(0);
    const single = innerCornerRadii([[0, 0]]);
    expect(single.left[0]).toBe(Infinity);
    expect(single.right[0]).toBe(Infinity);
    expect(cornerCurvature([[0, 0]], 0)).toBeNull();
    expect(cornerCurvature(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      1,
    )).toBeNull();
    // Duplicate consecutive points give a null corner, not a throw.
    expect(cornerCurvature(
      [
        [0, 0],
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      1,
    )).toBeNull();
    expect(buildTrackSurfaces({ ...stadium(30), centerline: [], kerbs: [] })).toEqual([]);
  });
});

describe('245 kerb no-fold numeric limits', () => {
  it('POST5: a row with clamped width exactly 0.4 is kept and 0.4 - 1e-9 is dropped', () => {
    const R = 10;
    const at = (delta: number): TrackDataV2 => {
      const t = circle(R, {
        kerbs: [{ start: 0, end: Math.max(12, Math.ceil(2 * Math.PI * R)) - 1, side: 'right' }],
      });
      const n = t.centerline.length;
      return { ...t, halfWidthRight: new Array<number>(n).fill(INNER_CURVE_CLAMP * R - KERB_MIN_WIDTH + delta) };
    };
    // Width 0.4 + 1e-9: kept; outer edge clamped to 0.9R (right side runs inward on a CCW circle).
    const kept = kerbStrips(at(-1e-9));
    expect(kept).toHaveLength(1);
    const half = INNER_CURVE_CLAMP * R - KERB_MIN_WIDTH - 1e-9;
    for (let i = 0; i < kept[0].positions.length; i += 3) {
      const lat = lateralOf(at(-1e-9), kept[0].positions[i], kept[0].positions[i + 2]);
      expect(Math.abs(lat - half) < 1e-4 || Math.abs(lat - INNER_CURVE_CLAMP * R) < 1e-4).toBe(true);
    }
    // Width 0.4 - 1e-9: dropped entirely.
    expect(kerbStrips(at(1e-9))).toHaveLength(0);
  });

  it('POST6: outer-strip remaining width 0.1 m + eps is kept and 0.1 - eps is dropped', () => {
    const R = 10;
    const n = Math.max(12, Math.ceil(2 * Math.PI * R));
    const at = (delta: number): TrackDataV2 => {
      const t = circle(R, { kerbs: [{ start: 0, end: n - 1, side: 'right' }] });
      // Use the same per-index Reff the renderer clamps against.
      const near = innerCornerRadii(t.centerline).right;
      return {
        ...t,
        halfWidthRight: Array.from(near, (r) => INNER_CURVE_CLAMP * r - KERB_WIDTH - 0.1 + delta),
      };
    };
    // remaining = 0.9*Reff - half - KERB_WIDTH = 0.1 + 1e-9 -> kept.
    expect(outerStripData(at(-1e-9))).not.toBeNull();
    // remaining 0.1 - 1e-9 -> dropped.
    expect(outerStripData(at(1e-9))).toBeNull();
  });

  it('POST7: a maximal run of a single kept row emits no strip', () => {
    const R = 10;
    const n = Math.max(12, Math.ceil(2 * Math.PI * R));
    const cap = INNER_CURVE_CLAMP * R; // 9
    const mk = (keptIdx: number[]): TrackDataV2 => {
      const t = circle(R, {
        kerbs: [{ start: 0, end: n - 1, side: 'right' }],
      });
      const half = new Array<number>(n).fill(cap - KERB_MIN_WIDTH + 1e-9); // dropped
      for (const i of keptIdx) half[i] = cap - KERB_MIN_WIDTH - 1e-9; // kept
      return { ...t, halfWidthRight: half };
    };
    // One kept row: run of 1 -> no strip at all.
    expect(kerbStrips(mk([7]))).toHaveLength(0);
    // Two kept rows: one strip with exactly 2 rows.
    const two = kerbStrips(mk([7, 8]));
    expect(two).toHaveLength(1);
    expect(two[0].positions.length / 3).toBe(4);
    // Two separate runs of 2 -> two strips sharing the segment index.
    const split = kerbStrips(mk([7, 8, 20, 21]));
    expect(split).toHaveLength(2);
    for (const s of split) expect(s.segment).toEqual({ kind: 'kerb', index: 0 });
    expect(split[0].indices.length).toBeGreaterThan(0);
    expect(split[1].indices.length).toBeGreaterThan(0);
  });

  it('POST8: a wrapping kerb segment splits its runs across the ring seam without stitching', () => {
    // Kept left rows near the seam: 209..217 (before bend-2 drop 218..243) and 5..21 (after 0..4).
    const track = stadium(7, [{ start: 210, end: 20, side: 'left' }]);
    const strips = kerbStrips(track);
    expect(strips.length).toBe(2);
    for (const s of strips) {
      expect(s.segment).toEqual({ kind: 'kerb', index: 0 });
      expect(s.indices.length).toBeGreaterThan(0);
    }
    // No triangle bridges the dropped bend-2 gap: every triangle edge stays under 10 m.
    for (const s of strips) {
      for (let t = 0; t + 2 < s.indices.length; t += 3) {
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ] as const) {
          const ia = 3 * s.indices[t + a];
          const ib = 3 * s.indices[t + b];
          const e = Math.hypot(s.positions[ia] - s.positions[ib], s.positions[ia + 2] - s.positions[ib + 2]);
          expect(e).toBeLessThan(10);
        }
      }
    }
  });
});

describe('245 kerb no-fold physics and degenerate widths', () => {
  it('POST9: kerb colliders follow the fold rule — no kerb hit over the tight bend interior', async () => {
    const { initPhysics, RAPIER } = await import('../../../src/physics/physicsWorld');
    const { addTrackColliders, surfaceOf } = await import('../../../src/physics/trackColliders');
    const { GRAVITY } = await import('../../../src/core/constants');
    await initPhysics();
    const track = stadium(7);
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    addTrackColliders(world, track);
    world.step();
    // Bend 1 centre (200, -7); the inner kerb is dropped, so nothing within 6.5 m is kerb
    // (the infield has no collider at all — a miss is fine).
    for (const [dx, dz] of [[0.5, 0], [0, -0.5], [-1, 1], [0.2, 0.2], [4, 0]] as Array<[number, number]>) {
      const hit = world.castRay(
        new RAPIER.Ray({ x: 200 + dx, y: 20, z: -7 + dz }, { x: 0, y: -1, z: 0 }),
        40,
        true,
      );
      if (hit !== null) {
        expect(surfaceOf(hit.collider), `surface at (${dx}, ${dz})`).not.toBe('kerb');
      }
    }
    // Outer side of the same bend still has kerb geometry (13 and 14.2 m from centre).
    let sawKerb = false;
    for (const r of [13, 14.2]) {
      const hit = world.castRay(
        new RAPIER.Ray({ x: 200 + r, y: 20, z: -7 }, { x: 0, y: -1, z: 0 }),
        40,
        true,
      );
      if (hit !== null && surfaceOf(hit.collider) === 'kerb') sawKerb = true;
    }
    expect(sawKerb).toBe(true);
    world.free();
  });

  it('POST10: zero and negative half-widths clamp or drop without folding over the centerline', () => {
    const R = 10;
    const n = Math.max(12, Math.ceil(2 * Math.PI * R));
    const build = (half: number): TrackDataV2 => {
      const t = circle(R, {
        kerbs: [
          { start: 0, end: n - 1, side: 'left' },
          { start: 0, end: n - 1, side: 'right' },
        ],
      });
      return {
        ...t,
        halfWidthLeft: new Array<number>(n).fill(half),
        halfWidthRight: new Array<number>(n).fill(half),
      };
    };
    for (const half of [0, -2]) {
      const strips = kerbStrips(build(half));
      for (const s of strips) {
        for (let i = 0; i < s.positions.length; i += 3) {
          const lat = lateralOf(build(half), s.positions[i], s.positions[i + 2]);
          // Lateral runs half..min(half+1.2, 0.9*Reff) from the centerline, never past 0.9R.
          expect(lat).toBeLessThanOrEqual(INNER_CURVE_CLAMP * R + 1e-4);
          expect(lat).toBeGreaterThanOrEqual(Math.min(half, 0) - 1e-4);
        }
      }
    }
    // half = 0 keeps a full-width kerb on both sides (width 1.2 < 0.9R cap).
    const zero = kerbStrips(build(0));
    expect(zero.length).toBeGreaterThanOrEqual(2);
  });
});
