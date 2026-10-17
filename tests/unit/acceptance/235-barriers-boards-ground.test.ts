import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, Board, Side, Terrain, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';
import { terrainHeightAt } from '../../../src/track/ground';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createDistanceBoards } from '../../../src/render/distanceBoards';

const ROOT = join(__dirname, '..', '..', '..');

// Task 235 BarrierVertex gains ground; mirrored so this file type-checks before the change.
interface BarrierVertex235 {
  index: number;
  x: number;
  z: number;
  y: number;
  ground: number;
  type: BarrierSegment['type'];
}

const CENTERLINE: [number, number][] = Array.from(
  { length: 100 },
  (_, i): [number, number] => [i * 10, 0],
);
const WALL: BarrierSegment = { start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8 };
const BOARD_100: Board = { index: 50, side: 'right', offset: 8, label: 100 };

// STRAIGHT fixture: no terrain; terrain is attached by walled().
function straight(): Omit<TrackDataV2, 'terrain'> {
  return {
    version: 2,
    id: 'straight',
    name: 'Straight',
    widthMeters: 12,
    lengthMeters: 990,
    officialLengthMeters: 990,
    centerline: CENTERLINE,
    sectors: [0, 33, 66],
    elevation: Array.from({ length: 100 }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
}

// WALLed terrain: FLAT(h) re-centred on the track.
function terrain(h: number): Terrain {
  return {
    originX: 495,
    originZ: 0,
    sizeX: 1100,
    sizeZ: 200,
    cols: 20,
    rows: 10,
    heights: Array.from({ length: 21 * 11 }, () => h),
  };
}

function walled(h: number): TrackDataV2 {
  return { ...straight(), barriers: [WALL], boards: [BOARD_100], terrain: terrain(h) };
}

const runsOf = (track: TrackDataV2, side: Side): BarrierVertex235[][] =>
  barrierRuns(track, side) as unknown as BarrierVertex235[][];

// Min/max y over the wall quads: only the barrier-wall trimesh has no registered surface.
function colliderWallY(track: TrackDataV2): { min: number; max: number } {
  const world = createPhysicsWorld(track);
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  world.forEachCollider((c) => {
    if (surfaceOf(c) !== null) return;
    found = true;
    const v = c.vertices();
    for (let k = 0; k < v.length; k += 3) {
      if (v[k + 1] < min) min = v[k + 1];
      if (v[k + 1] > max) max = v[k + 1];
    }
  });
  world.free();
  if (!found) throw new Error('no barrier wall collider');
  return { min, max };
}

function barrierBoxY(track: TrackDataV2): { min: number; max: number } {
  const { group, dispose } = createBarrierObject(track);
  const box = new THREE.Box3().setFromObject(group);
  dispose();
  return { min: box.min.y, max: box.max.y };
}

function splitMeshes(group: THREE.Group): {
  post: THREE.InstancedMesh | undefined;
  faces: THREE.InstancedMesh[];
} {
  let post: THREE.InstancedMesh | undefined;
  const faces: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    if (o.geometry.type === 'BoxGeometry') post = o;
    else faces.push(o);
  });
  return { post, faces };
}

function boardY(track: TrackDataV2): { faceY: number; postBottom: number } {
  const boards = createDistanceBoards(track);
  const { post, faces } = splitMeshes(boards.group);
  if (!post || faces.length !== 1) throw new Error('expected one post and one face mesh');
  const matrix = new THREE.Matrix4();
  faces[0].getMatrixAt(0, matrix);
  const faceY = matrix.elements[13];
  post.getMatrixAt(0, matrix);
  const e = matrix.elements;
  const scaleY = Math.hypot(e[4], e[5], e[6]);
  const half = (scaleY * (post.geometry as THREE.BoxGeometry).parameters.height) / 2;
  boards.dispose();
  return { faceY, postBottom: e[13] - half };
}

function loadTerrainTracks(): TrackDataV2[] {
  const dir = join(ROOT, 'public', 'tracks');
  const out: TrackDataV2[] = [];
  for (const name of readdirSync(dir)) {
    if (
      !name.endsWith('.json') ||
      name === 'index.json' ||
      name.endsWith('-env.json') ||
      name.endsWith('.style.json')
    )
      continue;
    const track = JSON.parse(readFileSync(join(dir, name), 'utf8')) as TrackDataV2;
    if (track.version === 2 && track.terrain) out.push(track);
  }
  return out;
}

describe('235 barriers and boards reach the ground acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: every WALLed(-3) right-side barrier vertex has y 0 and ground -3', () => {
    const vertices = runsOf(walled(-3), 'right').flat();
    expect(vertices.length).toBeGreaterThan(0);
    for (const v of vertices) {
      expect(v.y).toBeCloseTo(0, 9);
      expect(v.ground).toBeCloseTo(-3, 9);
    }
  });

  it('AT2: the same barriers without terrain have ground === y at every vertex', () => {
    const vertices = runsOf({ ...straight(), barriers: [WALL] } as TrackDataV2, 'right').flat();
    expect(vertices.length).toBeGreaterThan(0);
    for (const v of vertices) expect(v.ground).toBe(v.y);
  });

  it('AT3: collider wall quads drop to b0 - 3 on WALLed(-3) and rise to t0 + 2 on WALLed(2)', () => {
    const b0 = colliderWallY(walled(0));
    const low = colliderWallY(walled(-3));
    const high = colliderWallY(walled(2));
    expect(low.min).toBeCloseTo(b0.min - 3, 5);
    expect(low.max).toBeCloseTo(b0.max, 5);
    expect(high.min).toBeCloseTo(b0.min, 5);
    expect(high.max).toBeCloseTo(b0.max + 2, 5);
  });

  it('AT4: createBarrierObject world bbox y drops 3 m on WALLed(-3) and rises 2 m on WALLed(2)', () => {
    const b0 = barrierBoxY(walled(0));
    const low = barrierBoxY(walled(-3));
    const high = barrierBoxY(walled(2));
    expect(low.min).toBeCloseTo(b0.min - 3, 4);
    expect(low.max).toBeCloseTo(b0.max, 4);
    expect(high.min).toBeCloseTo(b0.min, 4);
    expect(high.max).toBeCloseTo(b0.max + 2, 4);
  });

  it('AT5: board face instance y stays at the baseline while the post spans down to min(0, h)', () => {
    const b0 = boardY(walled(0));
    const low = boardY(walled(-3));
    const high = boardY(walled(2));
    expect(low.faceY).toBeCloseTo(b0.faceY, 5);
    expect(high.faceY).toBeCloseTo(b0.faceY + 2, 5);
    expect(low.postBottom).toBeCloseTo(Math.min(0, -3), 5);
    expect(b0.postBottom).toBeCloseTo(Math.min(0, 0), 5);
    expect(high.postBottom).toBeCloseTo(Math.min(0, 2), 5);
  });

  it('AT6: every shipped terrain track has ground = terrainHeightAt at each barrier vertex', () => {
    let seen = 0;
    for (const track of loadTerrainTracks()) {
      for (const side of ['right', 'left'] as const) {
        for (const run of runsOf(track, side)) {
          for (const v of run) {
            seen += 1;
            expect(v.ground, `${track.id} ${side} vertex ${v.index}`).toBeCloseTo(
              terrainHeightAt(track.terrain, v.x, v.z),
              9,
            );
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 60000);
});
