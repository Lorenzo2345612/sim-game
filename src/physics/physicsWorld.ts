import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, GRAVITY } from '../core/constants';
import type { TrackDataV2 } from '../core/types';
import { addTrackColliders, PHASE0_GROUND_HALF_EXTENTS, SURFACE_COLLISION_GROUPS } from './trackColliders';

let initPromise: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  if (initPromise === null) {
    initPromise = RAPIER.init();
  }
  return initPromise;
}

export function createPhysicsWorld(track?: TrackDataV2): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  if (track === undefined) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        PHASE0_GROUND_HALF_EXTENTS.x,
        PHASE0_GROUND_HALF_EXTENTS.y,
        PHASE0_GROUND_HALF_EXTENTS.z,
      ).setTranslation(0, -PHASE0_GROUND_HALF_EXTENTS.y, 0)
        .setCollisionGroups(SURFACE_COLLISION_GROUPS),
    );
  } else {
    addTrackColliders(world, track);
  }
  return world;
}

export { RAPIER };
