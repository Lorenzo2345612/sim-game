import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Side, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import * as surfacesModule from '../../../src/track/surfaces';
import { buildTrackSurfaces, KERB_Y } from '../../../src/track/surfaces';
import { parseTrackStyle } from '../../../src/track/trackStyle';
import { createKerbOuterStrips } from '../../../src/render/kerbOuterStrip';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const HALF = 6;
const KERB_V = 1.5; // KERB_UV_V in surfaces.ts

function stadium(R: number, kerbs?: TrackSegment[]): TrackDataV2 {
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
  const lengthMeters = Math.round(400 + Math.PI * R);
  return {
    ...fixture,
    id: `stadium-r${R}`,
    name: `Stadium R${R}`,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    lengthMeters,
    officialLengthMeters: lengthMeters,
    elevation: new Array<number>(n).fill(0),
    kerbs: kerbs ?? [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
  };
}

// Regular polygon of radius R: every cornerCurvature is { side: 'right', radius: R }.
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

function kerbStrips(track: TrackDataV2): SurfaceStrip[] {
  return buildTrackSurfaces(track).filter((s) => s.surface === 'kerb');
}

function vertsOf(strip: SurfaceStrip): Array<{ x: number; z: number; y: number }> {
  const out: Array<{ x: number; z: number; y: number }> = [];
  for (let i = 0; i < strip.positions.length; i += 3) {
    out.push({ x: strip.positions[i], y: strip.positions[i + 1], z: strip.positions[i + 2] });
  }
  return out;
}

function distTo(v: { x: number; z: number }, cx: number, cz: number): number {
  return Math.hypot(v.x - cx, v.z - cz);
}

function cumS(centerline: [number, number][], upto: number): number {
  let s = 0;
  for (let i = 1; i <= upto; i++) {
    s += Math.hypot(centerline[i][0] - centerline[i - 1][0], centerline[i][1] - centerline[i - 1][1]);
  }
  return s;
}

function nearestIndex(track: TrackDataV2, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  track.centerline.forEach((p, i) => {
    const d = Math.hypot(x - p[0], z - p[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

type Corner = { side: Side; radius: number } | null;
const cornerCurvature = (
  surfacesModule as { cornerCurvature?: (cx: [number, number][], i: number) => Corner }
).cornerCurvature;

function outerStyle(n: number): ReturnType<typeof parseTrackStyle>['style'] {
  return parseTrackStyle({ version: 1, kerbs: { outerStrip: '#2e8b57' } }, n).style;
}

interface OuterMeshData {
  verts: Array<{ x: number; z: number }>;
  tris: Array<{ a: { x: number; z: number }; b: { x: number; z: number }; c: { x: number; z: number } }>;
}

function outerStripData(track: TrackDataV2): OuterMeshData | null {
  const result = createKerbOuterStrips(track, outerStyle(track.centerline.length));
  if (result === null) return null;
  const verts: OuterMeshData['verts'] = [];
  const tris: OuterMeshData['tris'] = [];
  for (const child of result.group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const pos = child.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = child.geometry.getIndex();
    const at = (i: number): { x: number; z: number } => ({ x: pos.getX(i), z: pos.getZ(i) });
    for (let i = 0; i < pos.count; i++) verts.push(at(i));
    if (index) {
      for (let t = 0; t + 2 < index.count; t += 3) {
        tris.push({ a: at(index.getX(t)), b: at(index.getX(t + 1)), c: at(index.getX(t + 2)) });
      }
    }
  }
  result.dispose();
  return { verts, tris };
}

describe('245 kerb no-fold edge cases', () => {
  it('EDGE1: inner kerb rows drop when 0.9R - half < 0.4 and keep clamped at >= 0.4', () => {
    const dropped = circle(7.1);
    const droppedStrips = kerbStrips(dropped);
    expect(droppedStrips).toHaveLength(1);
    expect(droppedStrips[0].segment).toEqual({ kind: 'kerb', index: 0 });
    for (const v of vertsOf(droppedStrips[0])) {
      expect(distTo(v, 0, 0)).toBeGreaterThanOrEqual(13.1 - 1e-4);
    }

    const kept = circle(7.2);
    const keptStrips = kerbStrips(kept);
    expect(keptStrips).toHaveLength(2);
    const left = keptStrips.find((s) => s.segment?.index === 0)!;
    for (const v of vertsOf(left)) {
      expect(distTo(v, 0, 0)).toBeGreaterThanOrEqual(13.2 - 1e-4);
    }
    const right = keptStrips.find((s) => s.segment?.index === 1)!;
    const rightVerts = vertsOf(right);
    expect(rightVerts).toHaveLength(2 * kept.centerline.length);
    let clamped = 0;
    for (const v of rightVerts) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0.72 - 1e-4);
      expect(d).toBeLessThanOrEqual(1.2 + 1e-4);
      if (Math.abs(d - 0.72) < 1e-4) clamped++;
    }
    expect(clamped).toBeGreaterThan(0);
  });

  it('EDGE2: dropped inner rows split the stadium(7) left kerb into two strips keeping unsplit v', () => {
    const track = stadium(7);
    const strips = kerbStrips(track);
    const left = strips.filter((s) => s.segment?.index === 0);
    const right = strips.filter((s) => s.segment?.index === 1);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(1);
    for (const s of [...left, ...right]) {
      expect(s.indices.length).toBeGreaterThan(0);
      expect(s.segment).toEqual({ kind: 'kerb', index: s.segment!.index });
    }
    expect(vertsOf(left[0])).toHaveLength(202);
    expect(vertsOf(left[1])).toHaveLength(202);
    expect(vertsOf(right[0])).toHaveLength(2 * track.centerline.length);

    expect(left[0].uvs[1]).toBeCloseTo(0, 4);
    const first = vertsOf(left[1])[0];
    const idx = nearestIndex(track, first.x, first.z);
    expect(idx).toBeGreaterThan(100);
    expect(left[1].uvs[1]).toBeCloseTo(cumS(track.centerline, idx) / KERB_V, 3);
    expect(left[1].uvs[1]).toBeGreaterThan(0);
  });

  it('EDGE3: kerb rows and extension rows inside a too-tight arc are dropped together', () => {
    const track = stadium(7, [{ start: 0, end: 105, side: 'left' }]);
    const strips = kerbStrips(track);
    expect(strips).toHaveLength(1);
    expect(strips[0].segment).toEqual({ kind: 'kerb', index: 0 });
    const verts = vertsOf(strips[0]);
    expect(verts).toHaveLength(202);
    let minX = Infinity;
    for (const v of verts) minX = Math.min(minX, v.x);
    expect(minX).toBeGreaterThan(-0.5);
  });

  it('EDGE4: a kerb segment fully inside a too-tight arc emits no strip', () => {
    const track = circle(7, {
      kerbs: [
        { start: 5, end: 20, side: 'right' },
        { start: 5, end: 20, side: 'left' },
      ],
    });
    const strips = kerbStrips(track);
    expect(strips).toHaveLength(1);
    expect(strips[0].segment).toEqual({ kind: 'kerb', index: 1 });
    expect(vertsOf(strips[0])).toHaveLength(2 * 18);
  });

  it('EDGE5: the inner clamp uses the per-index half-width, not widthMeters / 2', () => {
    const n = Math.max(12, Math.ceil(2 * Math.PI * 5));
    const track = circle(5, { halfWidthRight: new Array<number>(n).fill(4) });
    const strips = kerbStrips(track);
    const right = strips.find((s) => s.segment?.index === 1)!;
    expect(right).toBeDefined();
    let atOuter = 0;
    for (const v of vertsOf(right)) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0.5 - 1e-4);
      expect(d).toBeLessThanOrEqual(1.0 + 1e-4);
      if (Math.abs(d - 0.5) < 1e-4) atOuter++;
    }
    expect(atOuter).toBeGreaterThan(0);
    const left = strips.find((s) => s.segment?.index === 0)!;
    for (const v of vertsOf(left)) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(11 - 1e-4);
      expect(d).toBeLessThanOrEqual(12.2 + 1e-4);
    }
  });

  it('EDGE6: cornerCurvature is exported and returns side and radius per index', () => {
    expect(typeof cornerCurvature).toBe('function');
    const cc = cornerCurvature!;
    const ring = circle(7.5).centerline;
    for (let i = 0; i < ring.length; i++) {
      const c = cc(ring, i);
      expect(c).not.toBeNull();
      expect(c!.side).toBe('right');
      expect(c!.radius).toBeCloseTo(7.5, 9);
    }
    const track = stadium(30);
    expect(cc(track.centerline, 50)).toBeNull();
    const bend = cc(track.centerline, 147);
    expect(bend).not.toBeNull();
    expect(bend!.side).toBe('left');
    expect(bend!.radius).toBeCloseTo(30, 6);
  });

  it('EDGE7: kerb outer strip clamps its outer edge to 0.9R and drops rows with width < 0.1', () => {
    const rightOnly = (R: number): TrackDataV2 => {
      const t = circle(R);
      return { ...t, kerbs: [{ start: 0, end: t.centerline.length - 1, side: 'right' }] };
    };
    const r9 = outerStripData(rightOnly(9));
    expect(r9).not.toBeNull();
    let atClamp = 0;
    for (const v of r9!.verts) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0.9 - 1e-4);
      // End rows use segment normals, so allow the half-step tilt up to 1.9.
      expect(d).toBeLessThanOrEqual(1.9);
      if (Math.abs(d - 0.9) < 1e-4) atClamp++;
    }
    expect(atClamp).toBeGreaterThan(0);

    const r82 = outerStripData(rightOnly(8.2));
    expect(r82).not.toBeNull();
    let at82 = 0;
    for (const v of r82!.verts) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0.82 - 1e-4);
      if (Math.abs(d - 0.82) < 1e-4) at82++;
    }
    expect(at82).toBeGreaterThan(0);

    expect(outerStripData(rightOnly(8.1))).toBeNull();
    expect(outerStripData(rightOnly(7.5))).toBeNull();

    const both = outerStripData(circle(7.5));
    expect(both).not.toBeNull();
    let outerSide = 0;
    for (const v of both!.verts) {
      const d = distTo(v, 0, 0);
      expect(d).toBeGreaterThanOrEqual(15.3 - 1e-4);
      if (Math.abs(d - 15.3) < 1e-4) outerSide++;
    }
    expect(outerSide).toBeGreaterThan(0);
  });

  it('EDGE8: outer-strip triangle centroids keep clearance halfNear - 0.3 and never stitch across drops', () => {
    const tracks = [circle(30), circle(9), circle(8.2), stadium(8)];
    for (const track of tracks) {
      const data = outerStripData(track);
      expect(data, track.id).not.toBeNull();
      expect(data!.tris.length).toBeGreaterThan(0);
      for (const t of data!.tris) {
        const cx = (t.a.x + t.b.x + t.c.x) / 3;
        const cz = (t.a.z + t.b.z + t.c.z) / 3;
        let d = Infinity;
        for (const p of track.centerline) d = Math.min(d, Math.hypot(cx - p[0], cz - p[1]));
        expect(d, `${track.id} centroid (${cx}, ${cz})`).toBeGreaterThanOrEqual(5.7);
        const e = Math.max(
          Math.hypot(t.a.x - t.b.x, t.a.z - t.b.z),
          Math.hypot(t.b.x - t.c.x, t.b.z - t.c.z),
          Math.hypot(t.c.x - t.a.x, t.c.z - t.a.z),
        );
        expect(e, `${track.id} triangle edge`).toBeLessThan(10);
      }
    }
  });

  it('EDGE9: buildTrackSurfaces does not mutate its input', () => {
    const base = circle(7.2);
    const n = base.centerline.length;
    const track: TrackDataV2 = {
      ...base,
      bank: new Array<number>(n).fill(-0.05),
      halfWidthRight: new Array<number>(n).fill(5.5),
    };
    const before = JSON.stringify(track);
    buildTrackSurfaces(track);
    expect(JSON.stringify(track)).toBe(before);
  });

  it('EDGE10: banked inner-kerb vertices use the clamped lateral for y', () => {
    const bank = -0.08;
    const n = Math.max(12, Math.ceil(2 * Math.PI * 7.5));
    const track = circle(7.5, { bank: new Array<number>(n).fill(bank) });
    const strips = kerbStrips(track);
    const right = strips.find((s) => s.segment?.index === 1)!;
    const tanB = Math.tan(bank);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of vertsOf(right)) {
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    expect(maxY).toBeCloseTo(KERB_Y + HALF * tanB, 4);
    expect(minY).toBeCloseTo(KERB_Y + 6.75 * tanB, 4);
  });
});
