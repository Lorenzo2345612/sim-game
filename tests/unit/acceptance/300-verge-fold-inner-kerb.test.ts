import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { Side, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { buildTrackSurfaces, halfWidthAt, hasKerb } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

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

/** Downward-ray hit y at centerline[i] + n_side * (halfWidthAt(side, i) + KERB_WIDTH + d). */
function probeY(
  world: RAPIER.World,
  track: TrackDataV2,
  side: Side,
  i: number,
  d: number,
  fromY: number,
): number | null {
  const sign = side === 'right' ? 1 : -1;
  const [rx, rz] = rightNormalAt(track.centerline, i);
  const t = halfWidthAt(track, side, i) + KERB_WIDTH + d;
  const [x0, z0] = track.centerline[i];
  const hit = world.castRay(
    new RAPIER.Ray({ x: x0 + sign * rx * t, y: fromY, z: z0 + sign * rz * t }, { x: 0, y: -1, z: 0 }),
    fromY + 100,
    true,
  );
  return hit === null ? null : fromY - hit.timeOfImpact;
}

/** Violation strings for every probe row: Rise(d) = hit y(d) - hit y(-0.05) above tol. */
function rises(
  world: RAPIER.World,
  track: TrackDataV2,
  label: string,
  side: Side,
  rows: number[],
  ds: number[],
  tol: number,
): string[] {
  const fromY = Math.max(...track.elevation) + 60;
  const bad: string[] = [];
  for (const i of rows) {
    const edge = probeY(world, track, side, i, -0.05, fromY);
    if (edge === null) {
      bad.push(`${label} ${side} ${i}: no kerb-edge hit`);
      continue;
    }
    for (const d of ds) {
      const y = probeY(world, track, side, i, d, fromY);
      if (y === null) {
        bad.push(`${label} ${side} ${i} d=${d}: no hit`);
        continue;
      }
      const rise = y - edge;
      if (rise > tol) bad.push(`${label} ${side} ${i} d=${d}: rise ${rise.toFixed(3)} m`);
    }
  }
  return bad;
}

function rowsOf(track: TrackDataV2, side: Side): number[] {
  const out: number[] = [];
  for (let i = 0; i < track.centerline.length; i++) {
    if (hasKerb(track, side, i)) out.push(i);
  }
  return out;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

function triangleCounts(track: TrackDataV2): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of buildTrackSurfaces(track)) {
    out[s.surface] = (out[s.surface] ?? 0) + s.indices.length / 3;
  }
  return out;
}

describe('300 verge fold over inner kerb acceptance', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  /** createPhysicsWorld without sausages, stepped twice; runs `probe` and frees. */
  function withWorld(id: string, probe: (w: RAPIER.World, t: TrackDataV2) => string[]): string[] {
    const track = loadTrack(id);
    world = createPhysicsWorld({ ...track, sausages: [] });
    world.step();
    world.step();
    const bad = probe(world, track);
    world.free();
    world = null;
    return bad;
  }

  it('AT1: mexico 1028..1039 right, 1875..1878 left and cleveland 207..217, 668 right rise at most 0.10 m at d 0.5, 1, 2', () => {
    const bad = [
      ...withWorld('mexico', (w, t) => [
        ...rises(w, t, 'mexico', 'right', range(1028, 1039), [0.5, 1, 2], 0.1),
        ...rises(w, t, 'mexico', 'left', range(1875, 1878), [0.5, 1, 2], 0.1),
      ]),
      ...withWorld('cleveland', (w, t) =>
        rises(w, t, 'cleveland', 'right', [...range(207, 217), 668], [0.5, 1, 2], 0.1),
      ),
    ];
    expect(bad).toEqual([]);
  }, 300000);

  it('AT2: monza 304..306 right, 322 left and detroit 150..162, 364..365, 668..688 left rise at most 0.10 m at d 0.5, 1, 2', () => {
    const bad = [
      ...withWorld('monza', (w, t) => [
        ...rises(w, t, 'monza', 'right', range(304, 306), [0.5, 1, 2], 0.1),
        ...rises(w, t, 'monza', 'left', [322], [0.5, 1, 2], 0.1),
      ]),
      ...withWorld('detroit', (w, t) =>
        rises(w, t, 'detroit', 'left', [...range(150, 162), ...range(364, 365), ...range(668, 688)], [0.5, 1, 2], 0.1),
      ),
    ];
    expect(bad).toEqual([]);
  }, 300000);

  it('AT3: every kerb row of mexico, monza, cleveland and detroit rises at most 0.20 m at d 0.5, 1, 2', () => {
    const bad: string[] = [];
    for (const id of ['mexico', 'monza', 'cleveland', 'detroit'] as const) {
      bad.push(
        ...withWorld(id, (w, t) => [
          ...rises(w, t, id, 'right', rowsOf(t, 'right'), [0.5, 1, 2], 0.2),
          ...rises(w, t, id, 'left', rowsOf(t, 'left'), [0.5, 1, 2], 0.2),
        ]),
      );
    }
    expect(bad).toEqual([]);
  }, 900000);

  it('AT4: asphalt and kerb triangle counts unchanged on mexico, monza and cleveland', () => {
    const expectCounts: Record<string, [number, number]> = {
      mexico: [4306, 3458],
      monza: [5788, 4020],
      cleveland: [3426, 2804],
    };
    for (const [id, [asphalt, kerb]] of Object.entries(expectCounts)) {
      const counts = triangleCounts(loadTrack(id));
      expect(counts.asphalt, `${id} asphalt`).toBe(asphalt);
      expect(counts.kerb, `${id} kerb`).toBe(kerb);
    }
  }, 300000);
});
