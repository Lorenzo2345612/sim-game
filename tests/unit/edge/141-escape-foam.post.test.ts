import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import {
  createBarrierObject,
  FOAM_DEPTH,
  FOAM_HEIGHT,
  FOAM_PITCH,
  FOAM_WIDTH,
} from '../../../src/render/barrierRenderer';
import { buildTrackSurfaces, escapeRoadStrips } from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

const zs = (n: number): [number, number][] => Array.from({ length: n }, (_, i): [number, number] => [0, -2 * i]);
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

function makeTrack(
  centerline: [number, number][],
  elevation: number[],
  barriers: BarrierSegment[],
  escapeRoads?: { points: [number, number][]; width: number }[],
): TrackDataV2 {
  return {
    ...fixture,
    centerline,
    lengthMeters: Math.hypot(
      centerline[centerline.length - 1][0] - centerline[0][0],
      centerline[centerline.length - 1][1] - centerline[0][1],
    ),
    elevation,
    kerbs: [],
    runoffs: [],
    barriers,
    escapeRoads,
  };
}

function stubTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
}

function foamMesh(group: THREE.Group, name: string): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) found = object;
  });
  return found;
}

interface BlockState {
  x: number;
  y: number;
  z: number;
  dzx: number;
  dzz: number;
}

function blockStates(mesh: THREE.InstancedMesh): BlockState[] {
  const m = new THREE.Matrix4();
  const out: BlockState[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const e = m.elements;
    out.push({ x: e[12], y: e[13], z: e[14], dzx: e[8], dzz: e[10] });
  }
  return out;
}

function polylinePoint(pts: [number, number][], s: number): [number, number] {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + len >= s) {
      const t = (s - acc) / len;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    acc += len;
  }
  return pts[pts.length - 1];
}

function equalStrip(a: SurfaceStrip, b: SurfaceStrip): boolean {
  return (
    a.surface === b.surface &&
    Array.from(a.positions).every((v, i) => v === b.positions[i]) &&
    Array.from(a.indices).every((v, i) => v === b.indices[i]) &&
    Array.from(a.uvs).every((v, i) => v === b.uvs[i])
  );
}

describe('141 escape road / foam post-coder gaps', () => {
  it('POST1: buildTrackSurfaces appends one runoff strip per escape road, identical to escapeRoadStrips', () => {
    const base = makeTrack(zs(30), zeros(30), []);
    const withRoads = makeTrack(zs(30), zeros(30), [], [
      { points: [[0, -4], [0, -10]], width: 6 },
      { points: [[4, -4], [8, -8], [8, -14]], width: 5 },
    ]);
    const stripsBase = buildTrackSurfaces(base);
    const stripsEsc = buildTrackSurfaces(withRoads);
    expect(stripsEsc.length).toBe(stripsBase.length + 2);
    const appended = stripsEsc.slice(stripsBase.length);
    expect(appended.every((s) => s.surface === 'runoff')).toBe(true);
    const own = escapeRoadStrips(withRoads);
    expect(own.length).toBe(2);
    expect(equalStrip(appended[0], own[0])).toBe(true);
    expect(equalStrip(appended[1], own[1])).toBe(true);
    expect(stripsBase.every((s) => s.surface !== 'runoff')).toBe(true);
  });

  it('POST2: roads with fewer than 2 points are skipped while valid roads still build strips', () => {
    const track = makeTrack(zs(30), zeros(30), [], [
      { points: [], width: 6 },
      { points: [[0, -4]], width: 6 },
      { points: [[0, -4], [0, -10]], width: 6 },
    ]);
    const strips = escapeRoadStrips(track);
    expect(strips).toHaveLength(1);
    expect(strips[0].positions.length).toBe(4 * 3);
  });

  it('POST3: the exported foam block constants match the spec dimensions', () => {
    expect(FOAM_PITCH).toBe(1.0);
    expect(FOAM_HEIGHT).toBe(1.0);
    expect(FOAM_DEPTH).toBe(0.6);
    expect(FOAM_WIDTH).toBeCloseTo(0.96, 12);
  });

  it('POST4: a foam span inside a mixed wall/armco run gets the foam branch, not the wall branch', () => {
    const track = makeTrack(zs(60), zeros(60), [
      { start: 5, end: 14, side: 'right', type: 'wall', offsetMeters: 10 },
      { start: 8, end: 10, side: 'right', type: 'foam', offsetMeters: 10 },
      { start: 11, end: 13, side: 'right', type: 'armco', offsetMeters: 10 },
    ]);
    const object = createBarrierObject(track, stubTexture);
    // Foam quads (verts 7..10) span 6 m -> 6 blocks; wall and armco meshes still exist.
    expect(object.foamBlocks).toBe(6);
    expect(object.group.getObjectByName('wall')).toBeDefined();
    expect(object.group.getObjectByName('armco')).toBeDefined();
    expect(object.group.getObjectByName('fence')).toBeDefined();
    let counted = 0;
    for (const name of ['foamBlue', 'foamRed', 'foamWhite']) counted += foamMesh(object.group, name)?.count ?? 0;
    expect(counted).toBe(6);
    object.dispose();
  });

  it('POST5: the colour counter continues from the right side into the left side of the same object', () => {
    const track = makeTrack(zs(60), zeros(60), [
      { start: 5, end: 6, side: 'right', type: 'foam', offsetMeters: 10 },
      { start: 5, end: 6, side: 'left', type: 'foam', offsetMeters: 10 },
    ]);
    const object = createBarrierObject(track, stubTexture);
    expect(object.foamBlocks).toBe(4);
    // Right blocks are blue, red; left blocks must continue with white, blue.
    expect(foamMesh(object.group, 'foamBlue')?.count).toBe(2);
    expect(foamMesh(object.group, 'foamRed')?.count).toBe(1);
    expect(foamMesh(object.group, 'foamWhite')?.count).toBe(1);
    object.dispose();
  });

  it('POST6: foam blocks yaw with the path around an L corner: segment-start outward normal shifts them 0.3 m and rotates their depth axis', () => {
    const centerline: [number, number][] = Array.from({ length: 30 }, (_, i) =>
      i <= 14 ? [0, -2 * i] : [2 * (i - 14), -28],
    );
    const track = makeTrack(centerline, zeros(30), [
      { start: 13, end: 15, side: 'right', type: 'foam', offsetMeters: 10 },
    ]);
    const object = createBarrierObject(track, stubTexture);
    const q = Math.SQRT1_2;
    const line: [number, number][] = [
      [10, -26],
      [10 * q, -28 + 10 * q],
      [2, -18],
    ];
    const seg0 = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]);
    const total = 2 * seg0;
    const count = Math.floor(total / FOAM_PITCH);
    expect(object.foamBlocks).toBe(count);
    const normals: [number, number][] = [
      [1, 0],
      [q, q],
    ];
    const seen: BlockState[] = [];
    const colors = ['foamBlue', 'foamRed', 'foamWhite'];
    for (let c = 0; c < 3; c++) {
      const mesh = foamMesh(object.group, colors[c]);
      if (!mesh) continue;
      const states = blockStates(mesh);
      for (let i = 0; i < states.length; i++) {
        seen.push(states[i]);
        const k = i * 3 + c;
        const s = (k + 0.5) * FOAM_PITCH;
        const seg = s <= seg0 ? 0 : 1;
        const [px, pz] = polylinePoint(seg === 0 ? line.slice(0, 2) : line.slice(1), s - (seg === 0 ? 0 : seg0));
        const [nx, nz] = normals[seg];
        expect(states[i].x, `block ${k} x`).toBeCloseTo(px + (FOAM_DEPTH / 2) * nx, 4);
        expect(states[i].z, `block ${k} z`).toBeCloseTo(pz + (FOAM_DEPTH / 2) * nz, 4);
        expect(states[i].y, `block ${k} centre height`).toBeCloseTo(FOAM_HEIGHT / 2, 6);
        expect(Math.hypot(states[i].dzx - nx, states[i].dzz - nz), `block ${k} depth axis`).toBeLessThan(1e-4);
      }
    }
    expect(seen.length).toBe(count);
    // Corner blocks really are yawed 45 deg, not left axis-aligned.
    const last = seen[seen.length - 1];
    expect(Math.abs(last.dzx)).toBeGreaterThan(0.5);
    expect(Math.abs(last.dzz)).toBeGreaterThan(0.5);
    object.dispose();
  });

  it('POST7: every shipped track has terrain clamped below its escape road strips (regeneration ran)', () => {
    const dir = join(ROOT, 'public', 'tracks');
    let sampled = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const track = JSON.parse(readFileSync(join(dir, file), 'utf8')) as TrackDataV2;
      const roads = track.escapeRoads ?? [];
      if (roads.length === 0 || !track.terrain) continue;
      const t = track.terrain;
      const x0 = t.originX - t.sizeX / 2;
      const z0 = t.originZ - t.sizeZ / 2;
      for (const road of roads) {
        for (const [x, z] of road.points) {
          let best = 0;
          let bestD2 = Infinity;
          for (let k = 0; k < track.centerline.length; k++) {
            const dx = track.centerline[k][0] - x;
            const dz = track.centerline[k][1] - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = k;
            }
          }
          const roadY = (track.elevation[best] ?? 0) + 0.01;
          if (x < x0 || x > x0 + t.sizeX || z < z0 || z > z0 + t.sizeZ) continue;
          const j = Math.min(t.cols, Math.max(0, Math.round(((x - x0) / t.sizeX) * t.cols)));
          const i = Math.min(t.rows, Math.max(0, Math.round(((z - z0) / t.sizeZ) * t.rows)));
          const h = t.heights[j * (t.rows + 1) + i];
          expect(h, `${file}: terrain under escape road point (${x}, ${z})`).toBeLessThanOrEqual(roadY - 0.13);
          sampled++;
        }
      }
    }
    expect(sampled, 'escape road points sampled across tracks').toBeGreaterThan(0);
  });
});
