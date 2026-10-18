import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { halfWidthAt } from '../../../src/track/surfaces';
import { parseTrackStyle } from '../../../src/track/trackStyle';
import { createKerbOuterStrips } from '../../../src/render/kerbOuterStrip';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

function stadium(R: number): TrackDataV2 {
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
    kerbs: [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
  };
}

interface Triangle {
  a: { x: number; z: number };
  b: { x: number; z: number };
  c: { x: number; z: number };
}

function outerStripTriangles(track: TrackDataV2): Triangle[] | null {
  const style = parseTrackStyle(
    { version: 1, kerbs: { outerStrip: '#2e8b57' } },
    track.centerline.length,
  ).style;
  const result = createKerbOuterStrips(track, style);
  if (result === null) return null;
  const tris: Triangle[] = [];
  for (const child of result.group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const pos = child.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = child.geometry.getIndex();
    if (!index) continue;
    const at = (i: number): { x: number; z: number } => ({ x: pos.getX(i), z: pos.getZ(i) });
    for (let t = 0; t + 2 < index.count; t += 3) {
      tris.push({ a: at(index.getX(t)), b: at(index.getX(t + 1)), c: at(index.getX(t + 2)) });
    }
  }
  result.dispose();
  return tris;
}

function centroid(t: Triangle): { x: number; z: number } {
  return { x: (t.a.x + t.b.x + t.c.x) / 3, z: (t.a.z + t.b.z + t.c.z) / 3 };
}

function maxEdge(t: Triangle): number {
  return Math.max(
    Math.hypot(t.a.x - t.b.x, t.a.z - t.b.z),
    Math.hypot(t.b.x - t.c.x, t.b.z - t.c.z),
    Math.hypot(t.c.x - t.a.x, t.c.z - t.a.z),
  );
}

function clearance(track: TrackDataV2, p: { x: number; z: number }): { d: number; i: number } {
  let d = Infinity;
  let i = -1;
  track.centerline.forEach((q, k) => {
    const dist = Math.hypot(p.x - q[0], p.z - q[1]);
    if (dist < d) {
      d = dist;
      i = k;
    }
  });
  return { d, i };
}

describe('kerb outer strip clearance (AT4/AT5 extended to outer-strip triangles)', () => {
  it('stadium outer-strip centroids keep clearance 6 m and never bridge a dropped run', () => {
    for (const R of [30, 7.5, 7]) {
      const track = stadium(R);
      const tris = outerStripTriangles(track);
      expect(tris, `R=${R}`).not.toBeNull();
      for (const t of tris!) {
        const { d } = clearance(track, centroid(t));
        expect(d, `R=${R} centroid (${centroid(t).x}, ${centroid(t).z})`).toBeGreaterThanOrEqual(6 - 1e-6);
        expect(maxEdge(t), `R=${R} edge`).toBeLessThan(10);
      }
    }
  });

  it('tightly curved circle outer strips keep clearance halfNear - 0.3 m', () => {
    for (const R of [30, 9, 8.2]) {
      const n = Math.max(12, Math.ceil(2 * Math.PI * R));
      const centerline: [number, number][] = [];
      for (let j = 0; j < n; j++) {
        const t = (2 * Math.PI * j) / n;
        centerline.push([R * Math.cos(t), R * Math.sin(t)]);
      }
      const track: TrackDataV2 = {
        ...fixture,
        id: `circle-r${R}`,
        name: `Circle R${R}`,
        centerline,
        sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
        lengthMeters: Math.round(2 * Math.PI * R),
        officialLengthMeters: Math.round(2 * Math.PI * R),
        elevation: new Array<number>(n).fill(0),
        kerbs: [
          { start: 0, end: n - 1, side: 'left' },
          { start: 0, end: n - 1, side: 'right' },
        ],
        runoffs: [],
        barriers: [],
      };
      const tris = outerStripTriangles(track);
      expect(tris, `R=${R}`).not.toBeNull();
      for (const t of tris!) {
        const { d, i } = clearance(track, centroid(t));
        const halfNear = Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i));
        expect(d, `R=${R} centroid (${centroid(t).x}, ${centroid(t).z})`).toBeGreaterThanOrEqual(
          halfNear - 0.3,
        );
        expect(maxEdge(t), `R=${R} edge`).toBeLessThan(10);
      }
    }
  });
});
