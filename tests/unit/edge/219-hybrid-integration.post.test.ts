import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { AeroTelemetry, ErsTelemetry, HybridSpec } from '../../../src/physics/hybridTypes';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { Vehicle, type Telemetry } from '../../../src/physics/vehicle';
import { deriveAeroZones, inAeroZone } from '../../../src/track/aeroZones';
import { cumulativeLengths } from '../../../src/track/centerline';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = new URL('../../..', import.meta.url);

const HYBRID: HybridSpec = {
  mgukW: 100000,
  batteryJ: 4e6,
  deployJPerLap: 8.5e6,
  harvestJPerLap: 8.5e6,
  overtakeExtraJ: 5e5,
  minSpeedMs: 50 / 3.6,
  taperStartMs: 290 / 3.6,
  taperEndMs: 345 / 3.6,
  overtakeTaperStartMs: 337 / 3.6,
  overtakeTaperEndMs: 355 / 3.6,
  regenW: 100000,
  superClipW: 100000,
  liftHarvestW: 100000,
};

const ACTIVE_AERO = { dragScale: 0.7, downforceScale: 0.6, transitionS: 0.4 };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

const steps = (seconds: number): number => Math.round(seconds / FIXED_DT);

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8'));
}

function f4Json(): Record<string, unknown> {
  return readJson('public/cars/f4.json') as Record<string, unknown>;
}

function plainSpec(): CarSpec {
  return parseCarSpec(f4Json());
}

function hybridJson(over: Partial<HybridSpec>): Record<string, unknown> {
  const json = f4Json();
  json.hybrid = { ...HYBRID, ...over };
  return json;
}

function hybridSpec(): CarSpec {
  const json = hybridJson({});
  json.activeAero = { ...ACTIVE_AERO };
  return parseCarSpec(json);
}

function hybridOnlySpec(): CarSpec {
  return parseCarSpec(hybridJson({}));
}

interface Lab {
  world: ReturnType<typeof createPhysicsWorld>;
  vehicle: Vehicle;
  spec: CarSpec;
}

const labs: Lab[] = [];

function build(spec: CarSpec): Lab {
  const world = createPhysicsWorld();
  const vehicle = new Vehicle(world, spec, {
    position: { x: 0, y: spec.chassis.cgHeight, z: 0 },
    yaw: 0,
  });
  const lab: Lab = { world, vehicle, spec };
  labs.push(lab);
  return lab;
}

function step(lab: Lab, input: DriverInput): void {
  lab.vehicle.setInput(input);
  lab.vehicle.prePhysicsStep(FIXED_DT);
  lab.world.step();
}

function speedKmh(lab: Lab): number {
  return lab.vehicle.getState().forwardSpeed * MS_TO_KMH;
}

function speedMs(lab: Lab): number {
  return lab.vehicle.getState().forwardSpeed;
}

function setSpeedMs(lab: Lab, ms: number): void {
  lab.vehicle.body.setLinvel({ x: 0, y: 0, z: -ms }, true);
}

function ersOf(t: Telemetry): ErsTelemetry {
  if (!t.ers) throw new Error('telemetry.ers missing');
  return t.ers;
}

function aeroOf(t: Telemetry): AeroTelemetry {
  if (!t.aero) throw new Error('telemetry.aero missing');
  return t.aero;
}

function stateDiff(a: Lab, b: Lab): number {
  const sa = a.vehicle.getState();
  const sb = b.vehicle.getState();
  return Math.max(
    Math.abs(sa.forwardSpeed - sb.forwardSpeed),
    Math.abs(sa.position.x - sb.position.x),
    Math.abs(sa.position.z - sb.position.z),
    Math.abs(a.vehicle.getTelemetry().fuelKg - b.vehicle.getTelemetry().fuelKg),
  );
}

function accelerateToKmh(lab: Lab, kmh: number): void {
  for (let i = 0; i < steps(30) && speedKmh(lab) < kmh; i++) step(lab, FULL);
}

beforeAll(async () => {
  await initPhysics();
});

afterEach(() => {
  for (const lab of labs) lab.world.free();
  labs.length = 0;
});

describe('219 hybrid and active aero integration post-code gaps', () => {
  it('POST1: a harvesting twin under 0.6 brake decelerates like a non-harvesting twin (BBW cut)', () => {
    const free = build(parseCarSpec(hybridJson({ harvestJPerLap: 1e-9 })));
    const harnessed = build(parseCarSpec(hybridJson({})));
    accelerateToKmh(free, 120);
    accelerateToKmh(harnessed, 120);
    expect(stateDiff(free, harnessed)).toBe(0);
    expect(speedKmh(free)).toBeGreaterThanOrEqual(120);
    const v0a = speedMs(free);
    const v0b = speedMs(harnessed);
    for (let i = 0; i < steps(0.2); i++) {
      step(free, { ...IDLE, brake: 0.6 });
      step(harnessed, { ...IDLE, brake: 0.6 });
    }
    const da = v0a - speedMs(free);
    const db = v0b - speedMs(harnessed);
    expect(ersOf(harnessed.vehicle.getTelemetry()).lapHarvestJ).toBeGreaterThan(0);
    expect(ersOf(free.vehicle.getTelemetry()).lapHarvestJ).toBeLessThan(1e-3);
    expect(da).toBeGreaterThan(0);
    expect(Math.abs(db - da)).toBeLessThanOrEqual(0.02 * da);
  });

  it('POST2: lift-coast above the min speed sheds more speed on the hybrid than on plain f4', () => {
    const plain = build(plainSpec());
    const hybrid = build(hybridSpec());
    accelerateToKmh(plain, 120);
    accelerateToKmh(hybrid, 120);
    const v0p = speedMs(plain);
    const v0h = speedMs(hybrid);
    for (let i = 0; i < steps(0.4); i++) {
      step(plain, IDLE);
      step(hybrid, IDLE);
    }
    const dp = v0p - speedMs(plain);
    const dh = v0h - speedMs(hybrid);
    expect(ersOf(hybrid.vehicle.getTelemetry()).lapHarvestJ).toBeGreaterThan(0);
    expect(dh).toBeGreaterThan(dp + 0.5);
  });

  it('POST3: reset clears the aero-zone flag so inZone stays false until setAeroZone is called again', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setAeroZone(true);
    for (let i = 0; i < 3; i++) step(lab, FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).inZone).toBe(true);
    lab.vehicle.reset({ position: { x: 0, y: lab.spec.chassis.cgHeight, z: 0 }, yaw: 0 });
    let aero = aeroOf(lab.vehicle.getTelemetry());
    expect(aero.inZone).toBe(false);
    expect(aero.blend).toBeCloseTo(0, 9);
    step(lab, FULL);
    aero = aeroOf(lab.vehicle.getTelemetry());
    expect(aero.inZone).toBe(false);
    expect(aero.blend).toBeCloseTo(0, 9);
  });

  it('POST4: getTelemetry(out) on plain f4 clears stale ers and aero fields carried in out', () => {
    const hybrid = build(hybridSpec());
    const plain = build(plainSpec());
    step(hybrid, FULL);
    const out = hybrid.vehicle.getTelemetry();
    expect(out.ers).toBeDefined();
    const ret = plain.vehicle.getTelemetry(out);
    expect(ret).toBe(out);
    expect(out.ers).toBeUndefined();
    expect(out.aero).toBeUndefined();
  });

  it('POST5: reverse gear silences the ERS even at forward speed above the min speed', () => {
    const rev = build(hybridSpec());
    const fwd = build(hybridSpec());
    rev.vehicle.setReverse(true);
    expect(rev.vehicle.gear()).toBe(-1);
    setSpeedMs(rev, 20);
    setSpeedMs(fwd, 20);
    step(rev, FULL);
    step(fwd, FULL);
    expect(ersOf(fwd.vehicle.getTelemetry()).powerW).toBeGreaterThan(0);
    const ers = ersOf(rev.vehicle.getTelemetry());
    expect(ers.powerW).toBeCloseTo(0, 9);
    expect(ers.lapDeployJ).toBeCloseTo(0, 9);
  });

  it('POST6: a further ersCycle pulse wraps charge back to balance', () => {
    const lab = build(hybridSpec());
    step(lab, { ...IDLE, ersCycle: true });
    step(lab, IDLE);
    step(lab, { ...IDLE, ersCycle: true });
    step(lab, IDLE);
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('charge');
    step(lab, { ...IDLE, ersCycle: true });
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('balance');
  });

  it('POST7: setAeroZone and ersNewLap are inert on plain f4', () => {
    const a = build(plainSpec());
    const b = build(plainSpec());
    for (let i = 0; i < steps(2); i++) {
      step(a, FULL);
      b.vehicle.setAeroZone(true);
      b.vehicle.ersNewLap();
      step(b, FULL);
      expect(stateDiff(a, b)).toBe(0);
    }
    const t = b.vehicle.getTelemetry();
    expect(t.ers).toBeUndefined();
    expect(t.aero).toBeUndefined();
  });

  it('POST8: the aero-zone flag is inert without an activeAero block', () => {
    const a = build(hybridOnlySpec());
    const b = build(hybridOnlySpec());
    for (let i = 0; i < steps(2); i++) {
      step(a, FULL);
      b.vehicle.setAeroZone(true);
      step(b, FULL);
      expect(stateDiff(a, b)).toBe(0);
    }
    expect(a.vehicle.getTelemetry().aero).toBeUndefined();
    expect(b.vehicle.getTelemetry().aero).toBeUndefined();
  });

  it('POST9: Game resets lastDistance on teleportToIndex, so the first step flags the zone at d = 0', async () => {
    const track = parseTrackData(readJson('public/tracks/elkhart.json'));
    const zones = deriveAeroZones(track.centerline);
    const cum = cumulativeLengths(track.centerline, true);
    const n = track.centerline.length;
    const lapLength = cum[n];
    const z0 = inAeroZone(zones, 0, lapLength);

    let idx = -1;
    for (let i = 0; i < n; i++) {
      const flag = inAeroZone(zones, cum[i], lapLength);
      if (flag === z0) continue;
      let steady = true;
      for (let k = 1; k <= 10; k++) {
        if (inAeroZone(zones, cum[(i + k) % n], lapLength) !== flag) {
          steady = false;
          break;
        }
      }
      if (steady) {
        idx = i;
        break;
      }
    }
    expect(idx).toBeGreaterThanOrEqual(0);

    const game = await Game.create(track, hybridSpec());
    try {
      game.teleportToIndex(idx);
      for (let i = 0; i < 3; i++) game.step(FULL);
      expect(aeroOf(game.getTelemetry()).inZone).toBe(!z0);
      game.teleportToIndex(idx);
      game.step(IDLE);
      expect(aeroOf(game.getTelemetry()).inZone).toBe(z0);
      game.step(IDLE);
      expect(aeroOf(game.getTelemetry()).inZone).toBe(!z0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST10: omitted overtake and ersCycle input fields default to false', () => {
    const lab = build(hybridSpec());
    const bare: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
    for (let i = 0; i < 5; i++) {
      setSpeedMs(lab, 20);
      step(lab, bare);
    }
    const ers = ersOf(lab.vehicle.getTelemetry());
    expect(ers.mode).toBe('balance');
    expect(ers.overtake).toBe(false);
    expect(ers.powerW).toBeGreaterThan(0);
    expect(ers.lapDeployJ).toBeCloseTo(5 * ers.powerW * FIXED_DT, 3);
  });

  it('POST11: a large step dt meters the ERS with that dt and jumps the aero blend past the transition', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setAeroZone(true);
    setSpeedMs(lab, 20);
    lab.vehicle.setInput(FULL);
    lab.vehicle.prePhysicsStep(1);
    lab.world.step();
    const ers = ersOf(lab.vehicle.getTelemetry());
    expect(ers.powerW).toBeGreaterThan(0);
    expect(ers.lapDeployJ).toBeCloseTo(ers.powerW * 1, 6);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(1, 9);
  });

  it('POST12: an exhausted battery super-clips through the telemetry flag with negative power', () => {
    const json = hybridJson({ batteryJ: 2000 });
    const aids = json.aids as { tc: { enabled: boolean } };
    aids.tc.enabled = false;
    const lab = build(parseCarSpec(json));
    let clipPower = 0;
    let clipped = false;
    for (let i = 0; i < 12 && !clipped; i++) {
      setSpeedMs(lab, 20);
      step(lab, FULL);
      const ers = ersOf(lab.vehicle.getTelemetry());
      clipped = ers.clipping;
      if (clipped) clipPower = ers.powerW;
    }
    const ers = ersOf(lab.vehicle.getTelemetry());
    expect(clipped).toBe(true);
    expect(clipPower).toBeLessThan(0);
    expect(ers.lapDeployJ).toBeGreaterThan(0);
    expect(ers.socFrac).toBeLessThan(1);
  });

  it('POST13: Game on plain f4 exposes the aero zones once and no hybrid telemetry', async () => {
    const track = parseTrackData(readJson('public/tracks/elkhart.json'));
    const game = await Game.create(track, plainSpec());
    try {
      const zones = game.aeroZones();
      expect(zones.length).toBeGreaterThanOrEqual(1);
      expect(zones).toEqual(deriveAeroZones(track.centerline));
      expect(game.aeroZones()).toBe(zones);
      game.step(FULL);
      const t = game.getTelemetry();
      expect(t.ers).toBeUndefined();
      expect(t.aero).toBeUndefined();
    } finally {
      game.dispose();
    }
  }, 60000);
});
