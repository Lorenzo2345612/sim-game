import RAPIER from '@dimforge/rapier3d-compat';
import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
import { barrierRuns } from '../track/barrierPath';
import { sausageColliderPoints, sausagePieces, type SausagePiece } from '../track/sausages';
import { buildTrackSurfaces } from '../track/surfaces';

const WALL_BOTTOM = -0.3;
const WALL_TOP = 1.0;

/** Half extents of the Phase 0 flat ground (physicsWorld creates it; addTrackColliders removes it). */
export const PHASE0_GROUND_HALF_EXTENTS = { x: 5000, y: 0.5, z: 5000 } as const;

// One track world at a time; cleared at the start of every addTrackColliders call.
const surfaceByHandle = new Map<number, Surface>();

// A world with a terrain heightfield must not keep the flat ground beneath it.
function removePhase0Ground(world: RAPIER.World): void {
  const doomed: RAPIER.Collider[] = [];
  world.forEachCollider((c) => {
    const he = c.halfExtents();
    if (
      he !== null &&
      he.x === PHASE0_GROUND_HALF_EXTENTS.x &&
      he.y === PHASE0_GROUND_HALF_EXTENTS.y &&
      he.z === PHASE0_GROUND_HALF_EXTENTS.z
    ) {
      doomed.push(c);
    }
  });
  for (const c of doomed) world.removeCollider(c, false);
}

/**
 * One trimesh for all barrier runs. Wall quads between consecutive vertices of
 * a run (including last-to-first when the run is closed), wound so the triangle
 * normals face the track (Rapier raycasts are one-sided).
 */
function addBarrierWalls(world: RAPIER.World, track: TrackDataV2): void {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const side of ['right', 'left'] as const) {
    const sign = side === 'right' ? 1 : -1;
    for (const run of barrierRuns(track, side)) {
      if (run.length < 2) continue;
      const closed = run.length === track.centerline.length;
      const steps = closed ? run.length : run.length - 1;
      for (let k = 0; k < steps; k++) {
        const a = run[k];
        const b = run[(k + 1) % run.length];
        const base = positions.length / 3;
        positions.push(
          a.x, Math.min(a.y, a.ground) + WALL_BOTTOM, a.z,
          a.x, Math.max(a.y, a.ground) + WALL_TOP, a.z,
          b.x, Math.max(b.y, b.ground) + WALL_TOP, b.z,
          b.x, Math.min(b.y, b.ground) + WALL_BOTTOM, b.z,
        );
        if (sign > 0) {
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
          indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
    }
  }
  if (indices.length > 0) {
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)),
    );
  }
}

const SEAT_RAY_ABOVE = 5;
// Ray time-of-impact is float32; keep the analytic piece y when the ray agrees within that noise.
const SEAT_SNAP = 1e-5;

/** Base y of the topmost fixed surface under the piece centre (strips or terrain); piece y when nothing is under it. */
function seatOnStrips(world: RAPIER.World, piece: SausagePiece): number {
  const oy = piece.position.y + SEAT_RAY_ABOVE;
  const hit = world.castRay(
    new RAPIER.Ray({ x: piece.position.x, y: oy, z: piece.position.z }, { x: 0, y: -1, z: 0 }),
    2 * SEAT_RAY_ABOVE,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    (c) => surfaceOf(c) !== 'kerb' || c.shape.type !== RAPIER.ShapeType.ConvexPolyhedron,
  );
  if (hit === null) return piece.position.y;
  const y = oy - hit.timeOfImpact;
  return Math.abs(y - piece.position.y) < SEAT_SNAP ? piece.position.y : y;
}

/** One convex hull per sausage piece, kerb surface and default friction like the kerb strips. */
function addSausageColliders(world: RAPIER.World, track: TrackDataV2): void {
  const sausages = track.sausages ?? [];
  if (sausages.length === 0) return;
  // Fresh colliders are invisible to castRay until a step refreshes the queries.
  world.step();
  for (const s of sausages) {
    for (const piece of sausagePieces(track, s)) {
      const desc = RAPIER.ColliderDesc.convexHull(sausageColliderPoints(piece.length));
      if (desc === null) continue;
      desc
        .setTranslation(piece.position.x, seatOnStrips(world, piece), piece.position.z)
        .setRotation({ x: 0, y: Math.sin(piece.yaw / 2), z: 0, w: Math.cos(piece.yaw / 2) });
      registerSurface(world.createCollider(desc), 'kerb');
    }
  }
}

export function addTrackColliders(
  world: RAPIER.World,
  track: TrackDataV2,
  strips: SurfaceStrip[] = buildTrackSurfaces(track),
): void {
  surfaceByHandle.clear();
  removePhase0Ground(world);
  const t = track.terrain;
  const terrain = world.createCollider(
    RAPIER.ColliderDesc.heightfield(t.rows, t.cols, new Float32Array(t.heights), {
      x: t.sizeX,
      y: 1,
      z: t.sizeZ,
    }).setTranslation(t.originX, 0, t.originZ),
  );
  registerSurface(terrain, 'grass');
  for (const strip of strips) {
    if (strip.indices.length === 0) continue;
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(strip.positions, strip.indices),
    );
    registerSurface(collider, strip.surface);
  }
  addSausageColliders(world, track);
  addBarrierWalls(world, track);
}

export function registerSurface(collider: RAPIER.Collider, surface: Surface): void {
  surfaceByHandle.set(collider.handle, surface);
}

export function surfaceOf(collider: RAPIER.Collider): Surface | null {
  return surfaceByHandle.get(collider.handle) ?? null;
}
