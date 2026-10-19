import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { Side, TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { buildTrackSurfaces, cornerCurvature, halfWidthAt, hasKerb } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['mexico', 'monza', 'cleveland'] as const;

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

/** centerline[i] + side normal * (halfWidthAt + KERB_WIDTH + d). */
function probePoint(track: TrackDataV2, side: Side, i: number, d: number): [number, number] {
  const sign = side === 'right' ? 1 : -1;
  const [rx, rz] = rightNormalAt(track.centerline, i);
  const t = halfWidthAt(track, side, i) + KERB_WIDTH + d;
  const [x0, z0] = track.centerline[i];
  return [x0 + sign * rx * t, z0 + sign * rz * t];
}

function probeY(
  world: RAPIER.World,
  track: TrackDataV2,
  side: Side,
  i: number,
  d: number,
  fromY: number,
): number | null {
  const [x, z] = probePoint(track, side, i, d);
  const hit = world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 240, true);
  return hit === null ? null : fromY - hit.timeOfImpact;
}

/** Violation strings for every probe of the row set: rise over the kerb edge exceeds tol. */
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

function innerRows(track: TrackDataV2, side: Side): number[] {
  const out: number[] = [];
  const cx = track.centerline;
  for (let i = 0; i < cx.length; i++) {
    if (!hasKerb(track, side, i)) continue;
    const c = cornerCurvature(cx, i);
    if (c !== null && c.side === side && c.radius < 200) out.push(i);
  }
  return out;
}

const GOLDEN: Record<(typeof IDS)[number], string> = {
  mexico: '77986b19c5b64f6c5ef98fa5157914f96150e3961f03495a33169f58f858a6e2',
  monza: '2cb4711e491c1d1ee02b56abefac051191d9ed12caa2ab90ca0b53cc27a82938',
  cleveland: 'fa5658d699920e7a9441b9c039fd2912a85aa01ecfcbcaf6437e97e3ab525172',
};

function asphaltKerbHash(track: TrackDataV2): string {
  const h = createHash('sha256');
  for (const s of buildTrackSurfaces(track)) {
    if (s.surface !== 'asphalt' && s.surface !== 'kerb') continue;
    h.update(s.surface);
    h.update(Buffer.from(s.positions.buffer, s.positions.byteOffset, s.positions.byteLength));
    h.update(Buffer.from(s.indices.buffer, s.indices.byteOffset, s.indices.byteLength));
  }
  return h.digest('hex');
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

  it('AT1: mexico left 1873..1881 probes at d 0.5..3 rise at most 0.05 m above the kerb edge', () => {
    const track = loadTrack('mexico');
    world = createPhysicsWorld(track);
    world.step();
    const rows = Array.from({ length: 9 }, (_, k) => 1873 + k);
    const bad = rises(world, track, 'mexico', 'left', rows, [0.5, 1, 2, 3], 0.05);
    world.free();
    world = null;
    expect(bad).toEqual([]);
  });

  it('AT2: monza left 326..327 and right 307..309 probes at d 0.5..5 rise at most 0.05 m above the kerb edge', () => {
    const track = loadTrack('monza');
    world = createPhysicsWorld(track);
    world.step();
    const bad = [
      ...rises(world, track, 'monza', 'left', [326, 327], [0.5, 1, 2, 3, 5], 0.05),
      ...rises(world, track, 'monza', 'right', [307, 308, 309], [0.5, 1, 2, 3, 5], 0.05),
    ];
    world.free();
    world = null;
    expect(bad).toEqual([]);
  });

  it('AT3: mexico, monza and cleveland inner-corner kerb rows rise at most 0.10 m above the kerb edge at d 0.5..2', () => {
    const bad: string[] = [];
    for (const id of IDS) {
      const track = loadTrack(id);
      world = createPhysicsWorld(track);
      world.step();
      for (const side of ['left', 'right'] as const) {
        bad.push(...rises(world, track, id, side, innerRows(track, side), [0.5, 1, 2], 0.1));
      }
      world.free();
      world = null;
    }
    expect(bad).toEqual([]);
  }, 600000);

  it('AT4: asphalt and kerb strips are byte-identical to before on mexico, monza and cleveland', () => {
    const actual = Object.fromEntries(IDS.map((id) => [id, asphaltKerbHash(loadTrack(id))]));
    expect(actual).toEqual(GOLDEN);
  });
});
