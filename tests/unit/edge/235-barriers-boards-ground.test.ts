import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, Board, Terrain, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';
import { terrainHeightAt } from '../../../src/track/ground';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { createBarrierObject, FOAM_HEIGHT } from '../../../src/render/barrierRenderer';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import { FENCE_OFFSET, wBeamProfile } from '../../../src/render/barrierProfiles';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../../../src/track/trackStyle';

// Task 235 BarrierVertex gains ground; mirrored so this file type-checks before the change.
interface BarrierVertex235 {
  index: number;
  x: number;
  z: number;
  y: number;
  ground: number;
  type: BarrierSegment['type'];
}

// Closed 2 km loop: outbound z = 0, return z = 100, 10 m spacing.
const CENTERLINE: [number, number][] = [
  ...Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  ...Array.from({ length: 100 }, (_, k): [number, number] => [990 - k * 10, 100]),
];
const N = CENTERLINE.length;
const BOARD_100: Board = { index: 50, side: 'right', offset: 8, label: 100 };
const WALL_BOTTOM = -0.3;
const WALL_TOP = 1.0;
const WALL_BAND_LOW = 0.35;
const WALL_BAND_HEIGHT = 0.3;
const FOOTING_HEX = 0x8a8a8a;

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const rightNormal = (points: [number, number][], i: number): [number, number] => {
  const n = points.length;
  const prev = points[wrap(i - 1, n)];
  const next = points[wrap(i + 1, n)];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, -1] : [-dz / len, dx / len];
};

function gridTerrain(heightAt: (col: number, row: number) => number): Terrain {
  return {
    originX: 495,
    originZ: 50,
    sizeX: 1100,
    sizeZ: 400,
    cols: 20,
    rows: 10,
    heights: Array.from({ length: 21 * 11 }, (_, k) => heightAt(Math.floor(k / 11), k % 11)),
  };
}

// ground(x) = (x - 450) * 0.02: below the track plane west of x = 450, above east of it.
const rampTerrain = (): Terrain => gridTerrain((col) => (-55 + 55 * col - 450) * 0.02);
const flatTerrain = (h: number): Terrain => gridTerrain(() => h);
// ground(z) = z / 2, so the board line at z = 8 sits at ground 4.
const slopeZTerrain = (): Terrain => gridTerrain((_, row) => row * 20 - 75);
const nanTerrain = (): Terrain => gridTerrain(() => NaN);

function track(barriers: BarrierSegment[], terrain: Terrain, boards?: Board[]): TrackDataV2 {
  return {
    version: 2,
    id: 'edge-235',
    name: 'Edge 235',
    widthMeters: 12,
    lengthMeters: 2088,
    officialLengthMeters: 2088,
    centerline: CENTERLINE,
    sectors: [0, 66, 132],
    elevation: Array.from({ length: N }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
    boards,
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
    terrain,
  };
}

const barrier = (type: BarrierSegment['type']): BarrierSegment => ({
  start: 0,
  end: N - 1,
  side: 'right',
  type,
  offsetMeters: 8,
});

const runsOf = (t: TrackDataV2): BarrierVertex235[][] =>
  barrierRuns(t, 'right') as unknown as BarrierVertex235[][];

function meshByName(group: THREE.Group, name: string): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  group.traverse((o) => {
    if (o.name === name && o instanceof THREE.Mesh) found = o;
  });
  if (!found) throw new Error(`missing mesh ${name}`);
  return found;
}

function instancedByName(group: THREE.Group, name: string): THREE.InstancedMesh {
  const mesh = meshByName(group, name);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`${name} is not instanced`);
  return mesh;
}

function positionsOf(mesh: THREE.Mesh): number[] {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  return Array.from(attr.array);
}

function instances(mesh: THREE.InstancedMesh): { x: number; y: number; z: number; scaleY: number }[] {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out: { x: number; y: number; z: number; scaleY: number }[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    out.push({ x: p.x, y: p.y, z: p.z, scaleY: s.y });
  }
  return out;
}

// Y values of a position array within `reach` metres of a barrier vertex in XZ.
function ysNear(positions: number[], v: { x: number; z: number }, reach: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < positions.length; k += 3) {
    if (Math.hypot(positions[k] - v.x, positions[k + 2] - v.z) <= reach) out.push(positions[k + 1]);
  }
  return out;
}

function footingBoxY(group: THREE.Group): { min: number; max: number } | null {
  const target = new THREE.Color(FOOTING_HEX);
  const box = new THREE.Box3();
  let any = false;
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => (m as THREE.MeshStandardMaterial).color?.getHex() === FOOTING_HEX)) return;
    expect((mats[0] as THREE.MeshStandardMaterial).color.equals(target)).toBe(true);
    const b = new THREE.Box3().setFromObject(o);
    if (any) box.union(b);
    else box.copy(b);
    any = true;
  });
  return any ? { min: box.min.y, max: box.max.y } : null;
}

describe('235 barriers and boards reach the ground edge', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: collider wall quads take bottom and top from each vertex own min/max when the terrain crosses the track plane', () => {
    const t = track([barrier('wall')], rampTerrain());
    const vertices = runsOf(t).flat();
    expect(vertices).toHaveLength(N);
    const groundOf = (v: BarrierVertex235) => terrainHeightAt(t.terrain!, v.x, v.z);
    expect(vertices.filter((v) => groundOf(v) < v.y - 1e-9).length).toBeGreaterThan(0);
    expect(vertices.filter((v) => groundOf(v) > v.y + 1e-9).length).toBeGreaterThan(0);
    const world = createPhysicsWorld(t);
    const samples: { x: number; y: number; z: number }[] = [];
    world.forEachCollider((c) => {
      if (surfaceOf(c) !== null) return;
      const v = c.vertices();
      if (v === null) return;
      for (let k = 0; k < v.length; k += 3) samples.push({ x: v[k], y: v[k + 1], z: v[k + 2] });
    });
    world.free();
    expect(samples.length).toBeGreaterThan(0);
    for (const v of vertices) {
      const g = groundOf(v);
      const lo = Math.min(v.y, g);
      const hi = Math.max(v.y, g);
      const at = samples.filter((s) => Math.hypot(s.x - v.x, s.z - v.z) <= 0.5);
      expect(at.length, `collider verts at vertex ${v.index}`).toBeGreaterThan(0);
      const ys = at.map((s) => s.y);
      expect(Math.min(...ys), `bottom at vertex ${v.index}`).toBeCloseTo(lo + WALL_BOTTOM, 3);
      expect(Math.max(...ys), `top at vertex ${v.index}`).toBeCloseTo(hi + WALL_TOP, 3);
    }
  });

  it('EDGE2: the wall mesh spans min(y, ground) to max(y, ground) + 1 at every path point of a terrain that crosses the plane', () => {
    const t = track([barrier('wall')], rampTerrain());
    const { group, dispose } = createBarrierObject(t);
    const positions = positionsOf(meshByName(group, 'wall'));
    for (const v of runsOf(t).flat()) {
      const g = terrainHeightAt(t.terrain!, v.x, v.z);
      const lo = Math.min(v.y, g);
      const hi = Math.max(v.y, g);
      const ys = ysNear(positions, v, 0.5);
      expect(ys.length, `wall verts at vertex ${v.index}`).toBe(4);
      expect(Math.min(...ys), `wall bottom at vertex ${v.index}`).toBeCloseTo(lo, 3);
      expect(Math.max(...ys), `wall top at vertex ${v.index}`).toBeCloseTo(hi + 1, 3);
    }
    dispose();
  });

  it('EDGE3: the painted wall band sits at max(y, ground) + 0.35 and rises with terrain above the plane', () => {
    const t = track([barrier('wall')], rampTerrain());
    const style: ResolvedTrackStyle = {
      ...DEFAULT_TRACK_STYLE,
      barriers: {
        ...DEFAULT_TRACK_STYLE.barriers,
        concrete: { ...DEFAULT_TRACK_STYLE.barriers.concrete, bandColor: '#123456' },
      },
    };
    const { group, dispose } = createBarrierObject(t, undefined, style);
    const positions = positionsOf(meshByName(group, 'wallBand'));
    const vertices = runsOf(t).flat();
    const lifted = vertices.filter((v) => terrainHeightAt(t.terrain!, v.x, v.z) > 0);
    const sunken = vertices.filter((v) => terrainHeightAt(t.terrain!, v.x, v.z) < -1);
    expect(lifted.length).toBeGreaterThan(0);
    expect(sunken.length).toBeGreaterThan(0);
    for (const v of lifted) {
      const hi = terrainHeightAt(t.terrain!, v.x, v.z);
      const ys = ysNear(positions, v, 0.5);
      expect(ys.length, `band verts at vertex ${v.index}`).toBe(2);
      expect(Math.min(...ys), `band low at vertex ${v.index}`).toBeCloseTo(hi + WALL_BAND_LOW, 3);
      expect(Math.max(...ys), `band high at vertex ${v.index}`).toBeCloseTo(
        hi + WALL_BAND_LOW + WALL_BAND_HEIGHT,
        3,
      );
    }
    for (const v of sunken) {
      const hi = Math.max(v.y, terrainHeightAt(t.terrain!, v.x, v.z));
      const ys = ysNear(positions, v, 0.5);
      expect(ys.length, `band verts at vertex ${v.index}`).toBe(2);
      expect(Math.min(...ys), `band stays at hi, not lo, vertex ${v.index}`).toBeCloseTo(
        hi + WALL_BAND_LOW,
        3,
      );
    }
    dispose();
  });

  it('EDGE4: catch fence quads span min(y, ground) to max(y, ground) + the fence height', () => {
    const t = track([barrier('armco')], rampTerrain());
    const fenceH = DEFAULT_TRACK_STYLE.barriers.fence.heightMeters;
    const { group, dispose } = createBarrierObject(t);
    const positions = positionsOf(meshByName(group, 'fence'));
    for (const v of runsOf(t).flat()) {
      const g = terrainHeightAt(t.terrain!, v.x, v.z);
      const lo = Math.min(v.y, g);
      const hi = Math.max(v.y, g);
      const ys = ysNear(positions, v, 1 + FENCE_OFFSET);
      expect(ys.length, `fence verts at vertex ${v.index}`).toBeGreaterThan(0);
      expect(Math.min(...ys), `fence bottom at vertex ${v.index}`).toBeCloseTo(lo, 3);
      expect(Math.max(...ys), `fence top at vertex ${v.index}`).toBeCloseTo(hi + fenceH, 3);
    }
    dispose();
  });

  it('EDGE5: the armco rail stays at max(y, ground) + its profile when the ground drops below the plane', () => {
    const t = track([barrier('armco')], rampTerrain());
    const profile = wBeamProfile();
    const railLo = Math.min(...profile.map((p) => p[1]));
    const railHi = Math.max(...profile.map((p) => p[1]));
    const { group, dispose } = createBarrierObject(t);
    const positions = positionsOf(meshByName(group, 'armco'));
    for (const v of runsOf(t).flat()) {
      const hi = Math.max(v.y, terrainHeightAt(t.terrain!, v.x, v.z));
      const ys = ysNear(positions, v, 0.2);
      expect(ys.length, `rail verts at vertex ${v.index}`).toBe(profile.length);
      expect(Math.min(...ys), `rail low at vertex ${v.index}`).toBeCloseTo(hi + railLo, 3);
      expect(Math.max(...ys), `rail high at vertex ${v.index}`).toBeCloseTo(hi + railHi, 3);
    }
    dispose();
  });

  it('EDGE6: armco posts extend down to min(y, ground) and keep their top at max(y, ground) + post height', () => {
    const t = track([barrier('armco')], rampTerrain());
    const { group, dispose } = createBarrierObject(t);
    const mesh = instancedByName(group, 'armcoPosts');
    const postH = (mesh.geometry as THREE.BoxGeometry).parameters.height;
    const vertices = runsOf(t).flat();
    let matched = 0;
    for (const p of instances(mesh)) {
      const near = vertices
        .map((v) => ({ v, d: Math.hypot(v.x - p.x, v.z - p.z) }))
        .reduce((a, b) => (b.d < a.d ? b : a));
      if (near.d > 1.5) continue;
      matched += 1;
      const g = terrainHeightAt(t.terrain!, near.v.x, near.v.z);
      const lo = Math.min(near.v.y, g);
      const hi = Math.max(near.v.y, g);
      expect(p.y - (p.scaleY * postH) / 2, `post bottom at vertex ${near.v.index}`).toBeCloseTo(lo, 3);
      expect(p.y + (p.scaleY * postH) / 2, `post top at vertex ${near.v.index}`).toBeCloseTo(
        hi + postH,
        3,
      );
    }
    expect(matched).toBeGreaterThanOrEqual(N);
    dispose();
  });

  it('EDGE7: tyre rows ride max(y, ground) when the terrain rises above the plane', () => {
    const t = track([barrier('tyres')], flatTerrain(0.5));
    const { group, dispose } = createBarrierObject(t);
    const tyres = instances(instancedByName(group, 'tyres'));
    expect(tyres.length).toBeGreaterThan(0);
    const hi = 0.5;
    for (const p of tyres) {
      const row = Math.round((p.y - hi - 0.125) / 0.25);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(4);
      expect(p.y, `tyre row ${row}`).toBeCloseTo(hi + row * 0.25 + 0.125, 6);
    }
    dispose();
  });

  it('EDGE8: foam blocks sit at max(y, ground) and gain a #8a8a8a footing from min to base only when max - min > 0.1', () => {
    const gap = track([barrier('foam')], flatTerrain(-0.3));
    const a = createBarrierObject(gap);
    let blocks = 0;
    a.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name.startsWith('foam')) blocks += o.count;
    });
    expect(blocks).toBeGreaterThan(0);
    a.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('foam')) return;
      for (const p of instances(o)) expect(p.y).toBeCloseTo(0 + FOAM_HEIGHT / 2, 3);
    });
    const footing = footingBoxY(a.group);
    expect(footing, 'footing exists when max - min = 0.3').not.toBeNull();
    expect(footing!.min).toBeCloseTo(-0.3, 3);
    expect(footing!.max).toBeCloseTo(0, 3);
    a.dispose();

    const exact = track([barrier('foam')], flatTerrain(-0.1));
    const b = createBarrierObject(exact);
    expect(footingBoxY(b.group), 'no footing when max - min = 0.1').toBeNull();
    b.dispose();

    const raised = track([barrier('foam')], flatTerrain(0.4));
    const c = createBarrierObject(raised);
    let lifted = 0;
    c.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('foam')) return;
      for (const p of instances(o)) {
        expect(p.y).toBeCloseTo(0.4 + FOAM_HEIGHT / 2, 3);
        lifted += 1;
      }
    });
    expect(lifted).toBeGreaterThan(0);
    c.dispose();
  });

  it('EDGE9: the board face and post use the ground sampled at the board position, post spanning min to max + face height', () => {
    const t = track([], slopeZTerrain(), [BOARD_100]);
    const [nx, nz] = rightNormal(CENTERLINE, BOARD_100.index);
    const px = CENTERLINE[BOARD_100.index][0] + nx * BOARD_100.offset;
    const pz = CENTERLINE[BOARD_100.index][1] + nz * BOARD_100.offset;
    const g = terrainHeightAt(t.terrain!, px, pz);
    const y = 0;
    expect(g).toBeCloseTo(4, 9);
    const lo = Math.min(y, g);
    const hi = Math.max(y, g);
    const boards = createDistanceBoards(t);
    let face: THREE.InstancedMesh | undefined;
    let post: THREE.InstancedMesh | undefined;
    boards.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh)) return;
      if (o.geometry.type === 'BoxGeometry') post = o;
      else face = o;
    });
    if (!face || !post) throw new Error('expected one face and one post mesh');
    const postH = (post.geometry as THREE.BoxGeometry).parameters.height;
    const matrix = new THREE.Matrix4();
    face.getMatrixAt(0, matrix);
    expect(matrix.elements[13], 'face rides the ground above the board plane').toBeCloseTo(
      hi + postH,
      5,
    );
    post.getMatrixAt(0, matrix);
    const e = matrix.elements;
    const scaleY = Math.hypot(e[4], e[5], e[6]);
    const half = (scaleY * postH) / 2;
    expect(e[13] - half, 'post bottom reaches the ground below the board plane').toBeCloseTo(lo, 5);
    expect(e[13] + half, 'post top meets the face').toBeCloseTo(hi + postH, 5);
    boards.dispose();
  });

  it('EDGE10: barrierRuns ground falls back to the track plane when the terrain sample is not finite', () => {
    const t = track([barrier('wall')], nanTerrain());
    const vertices = runsOf(t).flat();
    expect(vertices.length).toBe(N);
    for (const v of vertices) {
      expect(Number.isFinite(v.ground), `vertex ${v.index} ground finite`).toBe(true);
      expect(v.ground, `vertex ${v.index} ground on the plane`).toBeCloseTo(v.y, 9);
    }
  });
});
