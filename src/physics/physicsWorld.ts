import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT, GRAVITY } from '../core/constants';

let initPromise: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  if (initPromise === null) {
    initPromise = RAPIER.init();
  }
  return initPromise;
}

export function createPhysicsWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0),
  );
  return world;
}

export { RAPIER };
