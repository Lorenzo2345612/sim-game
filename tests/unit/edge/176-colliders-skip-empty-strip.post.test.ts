import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { addTrackColliders } from '../../../src/physics/trackColliders';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

const CENTERLINE: [number, number][] = Array.from(
  { length: 20 },
  (_, i): [number, number] => [0, -2 * i],
);
const track: TrackDataV2 = {
  ...fixture,
  centerline: CENTERLINE,
  lengthMeters: 40,
  elevation: CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  escapeRoads: [],
};

const EMPTY: SurfaceStrip = {
  surface: 'runoff',
  positions: new Float32Array(0),
  indices: new Uint32Array(0),
  uvs: new Float32Array(0),
};

function colliderCount(world: World): number {
  let count = 0;
  world.forEachCollider(() => count++);
  return count;
}

describe('176 colliders skip empty strips post-coder gaps', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('POST1: a strip with zero indices creates no collider and does not throw', () => {
    const strips = buildTrackSurfaces(track);
    world = createPhysicsWorld();
    expect(() => addTrackColliders(world!, track, strips)).not.toThrow();
    const base = colliderCount(world);
    world.free();
    world = createPhysicsWorld();
    expect(() => addTrackColliders(world!, track, [...strips, EMPTY])).not.toThrow();
    expect(colliderCount(world)).toBe(base);
  });
});
