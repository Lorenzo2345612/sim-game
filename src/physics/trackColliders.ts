import RAPIER from '@dimforge/rapier3d-compat';
import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
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

/** Right normal of the ring at point i: d = normalize(P[i+1] - P[i-1]), right = (-d.z, d.x). */
function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

/**
 * One trimesh for all barrier segments. Wall quads between consecutive points,
 * wound so the triangle normals face the track (Rapier raycasts are one-sided).
 */
function addBarrierWalls(world: RAPIER.World, track: TrackDataV2): void {
  const cx = track.centerline;
  const n = cx.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const seg of track.barriers) {
    const sign = seg.side === 'right' ? 1 : -1;
    const points = (((seg.end - seg.start) % n) + n) % n + 1;
    let px = 0;
    let pz = 0;
    let pBottom = 0;
    let pTop = 0;
    for (let j = 0; j < points; j++) {
      const i = (((seg.start + j) % n) + n) % n;
      const [rx, rz] = rightNormalAt(cx, i);
      const x = cx[i][0] + sign * seg.offsetMeters * rx;
      const z = cx[i][1] + sign * seg.offsetMeters * rz;
      const e = track.elevation[i] ?? 0;
      if (j > 0) {
        const base = positions.length / 3;
        positions.push(px, pBottom, pz, px, pTop, pz, x, e + WALL_TOP, z, x, e + WALL_BOTTOM, z);
        if (sign > 0) {
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        } else {
          indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
      px = x;
      pz = z;
      pBottom = e + WALL_BOTTOM;
      pTop = e + WALL_TOP;
    }
  }
  if (indices.length > 0) {
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices)),
    );
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
  surfaceByHandle.set(terrain.handle, 'grass');
  for (const strip of strips) {
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(strip.positions, strip.indices),
    );
    surfaceByHandle.set(collider.handle, strip.surface);
  }
  addBarrierWalls(world, track);
}

export function surfaceOf(collider: RAPIER.Collider): Surface | null {
  return surfaceByHandle.get(collider.handle) ?? null;
}
