import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, Board, Terrain, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { createBarrierObject, FOAM_DEPTH, FOAM_WIDTH } from '../../../src/render/barrierRenderer';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import { TYRE_OUTER_RADIUS, TYRE_PITCH } from '../../../src/render/barrierProfiles';

const CENTERLINE: [number, number][] = Array.from({ length: 200 }, (_, i): [number, number] =>
  i < 100 ? [i * 10, 0] : [(199 - i) * 10, 100],
);
const N = CENTERLINE.length;
const BOARD_100: Board = { index: 50, side: 'right', offset: 8, label: 100 };
const FOOTING_GAP = 0.1;

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
const flatTerrain = (h: number): Terrain => gridTerrain(() => h);
// ground(x) = (x - 450) * 0.02: below the plane west of x = 450, above east of it.
const rampTerrain = (): Terrain => gridTerrain((col) => (-55 + 55 * col - 450) * 0.02);
const nanTerrain = (): Terrain => gridTerrain(() => NaN);

function track(barriers: BarrierSegment[], terrain?: Terrain, boards?: Board[]): TrackDataV2 {
  const t: TrackDataV2 = {
    version: 2,
    id: 'gap-235',
    name: 'Gap 235',
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
    terrain: terrain as Terrain,
  };
  return t;
}

const barrier = (type: BarrierSegment['type']): BarrierSegment => ({
  start: 0,
  end: N - 1,
  side: 'right',
  type,
  offsetMeters: 8,
});

interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

function instances(mesh: THREE.InstancedMesh): Inst[] {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out: Inst[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    out.push({ x: p.x, y: p.y, z: p.z, sx: s.x, sy: s.y, sz: s.z });
  }
  return out;
}

function footingOf(group: THREE.Group): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name === 'footing') found = o;
  });
  return found;
}

const nearXZ = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

const span = (start: number, end: number): BarrierSegment => ({
  start,
  end,
  side: 'right',
  type: 'tyres',
  offsetMeters: 8,
});

// Rows 0/2 share s = k·PITCH (the "even" columns that take footings); rows 1/3
// sit half a pitch later. On the outbound straight s = x - s0.
function evenColumns(tyres: Inst[], s0: number): Inst[] {
  const columns = new Map<string, Inst>();
  for (const t of tyres) {
    const frac = ((((t.x - s0) / TYRE_PITCH) % 1) + 1) % 1;
    if (frac > 0.05 && frac < 0.95) continue;
    columns.set(`${t.x.toFixed(5)},${t.z.toFixed(5)}`, t);
  }
  return [...columns.values()];
}

describe('235 barrier footings and scaled instances gap', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAP1: tyre stacks over sunken ground gain one footing per bottom-row column, spanning lo..hi with the tyre footprint', () => {
    const t = track([span(5, 25)], flatTerrain(-0.4));
    const { group, dispose } = createBarrierObject(t);
    const columns = evenColumns(
      instances(group.getObjectByName('tyres') as THREE.InstancedMesh),
      50,
    );
    expect(columns.length).toBe(Math.floor(200 / TYRE_PITCH) + 1);
    const footing = footingOf(group);
    expect(footing, 'footing exists when max - min = 0.4').toBeDefined();
    expect(footing!.count).toBe(columns.length);
    const spots = instances(footing!);
    for (const column of columns) {
      const f = spots.find((s) => nearXZ(s, column));
      expect(f, `footing at column x=${column.x}`).toBeDefined();
      expect(f!.y).toBeCloseTo(-0.2, 5);
      expect(f!.sy).toBeCloseTo(0.4, 5);
      expect(f!.sx).toBeCloseTo(2 * TYRE_OUTER_RADIUS, 5);
      expect(f!.sz).toBeCloseTo(2 * TYRE_OUTER_RADIUS, 5);
    }
    dispose();
  });

  it('GAP2: tyre footings follow the 0.1 m gap rule on both sides of the plane', () => {
    const exact = track([span(5, 25)], flatTerrain(-0.1));
    const a = createBarrierObject(exact);
    expect(footingOf(a.group), 'no footing when max - min = 0.1').toBeUndefined();
    a.dispose();

    const raised = track([span(5, 25)], flatTerrain(0.4));
    const b = createBarrierObject(raised);
    const spots = instances(footingOf(b.group)!);
    expect(spots.length).toBeGreaterThan(0);
    for (const f of spots) {
      expect(f.y, 'footing fills plane up to the lifted stack').toBeCloseTo(0.2, 5);
      expect(f.sy).toBeCloseTo(0.4, 5);
    }
    b.dispose();
  });

  it('GAP3: on a ramp only the columns whose own vertex gap exceeds 0.1 m get a footing', () => {
    const t = track([span(40, 50)], rampTerrain());
    const { group, dispose } = createBarrierObject(t);
    const vertices = barrierRuns(t, 'right').flat();
    const columns = evenColumns(
      instances(group.getObjectByName('tyres') as THREE.InstancedMesh),
      400,
    );
    const spots = instances(footingOf(group)!);
    let withGap = 0;
    for (const column of columns) {
      const near = vertices
        .map((v) => ({ v, d: Math.hypot(v.x - column.x, v.z - column.z) }))
        .reduce((a, b) => (b.d < a.d ? b : a));
      const lo = Math.min(near.v.y, near.v.ground);
      const hi = Math.max(near.v.y, near.v.ground);
      const f = spots.find((s) => nearXZ(s, column));
      if (hi - lo > FOOTING_GAP + 1e-9) {
        withGap += 1;
        expect(f, `footing at column x=${column.x}`).toBeDefined();
        expect(f!.y).toBeCloseTo((lo + hi) / 2, 5);
      } else {
        expect(f, `no footing at column x=${column.x} (gap ${hi - lo})`).toBeUndefined();
      }
    }
    expect(withGap).toBeGreaterThan(0);
    expect(withGap).toBeLessThan(columns.length);
    dispose();
  });

  it('GAP4: foam blocks over raised ground keep a footing from the plane up to their base', () => {
    const t = track([barrier('foam')], flatTerrain(0.4));
    const { group, dispose } = createBarrierObject(t);
    let blocks = 0;
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name.startsWith('foam')) blocks += o.count;
    });
    expect(blocks).toBeGreaterThan(0);
    const spots = instances(footingOf(group)!);
    expect(spots.length).toBe(blocks);
    for (const f of spots) {
      expect(f.y).toBeCloseTo(0.2, 6);
      expect(f.sy).toBeCloseTo(0.4, 6);
      expect(f.sx).toBeCloseTo(FOAM_WIDTH, 6);
      expect(f.sz).toBeCloseTo(FOAM_DEPTH, 6);
    }
    dispose();
  });

  it('GAP5: boards over non-finite terrain fall back to the plane exactly as with no terrain', () => {
    const atlas = (): THREE.Texture => new THREE.Texture();
    const boards = [BOARD_100];
    const nan = createDistanceBoards(track([], nanTerrain(), boards), atlas);
    const plain = createDistanceBoards(track([], undefined, boards), atlas);
    const read = (g: THREE.Group) => {
      let face: THREE.InstancedMesh | undefined;
      let post: THREE.InstancedMesh | undefined;
      g.traverse((o) => {
        if (!(o instanceof THREE.InstancedMesh)) return;
        if (o.geometry.type === 'BoxGeometry') post = o;
        else face = o;
      });
      if (!face || !post) throw new Error('expected one face and one post');
      return { face: instances(face), post: instances(post) };
    };
    const a = read(nan.group);
    const b = read(plain.group);
    // Instance matrices are float32, so compare at 1e-5.
    expect(a.face[0].y).toBeCloseTo(1.2, 5);
    expect(a.post[0].y).toBeCloseTo(0.6, 5);
    expect(a.post[0].sy).toBe(1);
    expect(a.face[0].y).toBeCloseTo(b.face[0].y, 5);
    expect(a.post[0].y).toBeCloseTo(b.post[0].y, 5);
    expect(a.post[0].sy).toBe(b.post[0].sy);
    nan.dispose();
    plain.dispose();
  });

  it('GAP6: barrierRuns, createBarrierObject and createDistanceBoards leave a terrain track unchanged', () => {
    const t = track(
      [barrier('wall'), barrier('armco'), barrier('tyres'), barrier('foam')],
      rampTerrain(),
      [BOARD_100],
    );
    const before = structuredClone(t);
    barrierRuns(t, 'left');
    barrierRuns(t, 'right');
    createBarrierObject(t).dispose();
    createDistanceBoards(t).dispose();
    expect(t).toEqual(before);
  });

  it('GAP7: without terrain armco posts and board posts keep unit scale at the path plane', () => {
    const t = track([barrier('armco')], undefined, [BOARD_100]);
    const { group, dispose } = createBarrierObject(t);
    const posts = instances(group.getObjectByName('armcoPosts') as THREE.InstancedMesh);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.sy).toBe(1);
      expect(p.y).toBeCloseTo(0.375, 5);
    }
    dispose();
    const boards = createDistanceBoards(t);
    let post: THREE.InstancedMesh | undefined;
    boards.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.geometry.type === 'BoxGeometry') post = o;
    });
    const p = instances(post!)[0];
    expect(p.sy).toBe(1);
    expect(p.y).toBeCloseTo(0.6, 5);
    boards.dispose();
  });
});
