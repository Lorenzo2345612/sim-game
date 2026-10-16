import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { AeroTelemetry, ErsTelemetry } from '../../../src/physics/hybridTypes';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { Vehicle, type Telemetry } from '../../../src/physics/vehicle';
import { deriveAeroZones, inAeroZone } from '../../../src/track/aeroZones';
import { cumulativeLengths } from '../../../src/track/centerline';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = new URL('../../..', import.meta.url);

const HYBRID = {
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
const BRAKE_FULL: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const MIN_SPEED_MS = HYBRID.minSpeedMs;

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

function hybridSpec(): CarSpec {
  const json = f4Json();
  json.hybrid = { ...HYBRID };
  json.activeAero = { ...ACTIVE_AERO };
  return parseCarSpec(json);
}

function hybridOnlySpec(): CarSpec {
  const json = f4Json();
  json.hybrid = { ...HYBRID };
  return parseCarSpec(json);
}

function aeroOnlySpec(): CarSpec {
  const json = f4Json();
  json.activeAero = { ...ACTIVE_AERO };
  return parseCarSpec(json);
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

beforeAll(async () => {
  await initPhysics();
});

afterEach(() => {
  for (const lab of labs) lab.world.free();
  labs.length = 0;
});

describe('219 hybrid and active aero integration edge cases', () => {
  it('EDGE1: ers and aero telemetry appear only for the blocks the spec carries', () => {
    const hybrid = build(hybridOnlySpec());
    for (let i = 0; i < steps(2); i++) step(hybrid, FULL);
    const ht = hybrid.vehicle.getTelemetry();
    expect(ht.ers).toBeDefined();
    expect(ht.aero).toBeUndefined();

    const aero = build(aeroOnlySpec());
    aero.vehicle.setAeroZone(true);
    for (let i = 0; i < steps(2); i++) step(aero, FULL);
    const at = aero.vehicle.getTelemetry();
    expect(at.aero).toBeDefined();
    expect(at.ers).toBeUndefined();
  });

  it('EDGE2: hybrid f4 with the zone off matches plain f4 exactly below the ERS min speed', () => {
    const plain = build(plainSpec());
    const hybrid = build(hybridSpec());
    let worst = 0;
    for (let i = 0; i < steps(5) && speedKmh(plain) < MIN_SPEED_MS * MS_TO_KMH; i++) {
      step(plain, FULL);
      step(hybrid, FULL);
      worst = Math.max(worst, stateDiff(plain, hybrid));
    }
    expect(worst).toBeLessThan(1e-9);

    setSpeedMs(plain, MIN_SPEED_MS - 2);
    setSpeedMs(hybrid, MIN_SPEED_MS - 2);
    worst = 0;
    for (let i = 0; i < steps(3); i++) {
      step(plain, BRAKE_FULL);
      step(hybrid, BRAKE_FULL);
      worst = Math.max(worst, stateDiff(plain, hybrid));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('EDGE3: overtake drives the MGU-K taper and deploy cap and the DriverInput is not mutated', () => {
    const lab = build(hybridSpec());
    const inp: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false, overtake: true };
    const snap = { ...inp };

    setSpeedMs(lab, MIN_SPEED_MS - 4);
    step(lab, inp);
    let ers = ersOf(lab.vehicle.getTelemetry());
    expect(ers.powerW).toBeCloseTo(0, 9);
    expect(ers.overtake).toBe(false);
    expect(ers.deployCapJ).toBeCloseTo(HYBRID.deployJPerLap, 6);
    expect(inp).toEqual(snap);

    setSpeedMs(lab, 20);
    step(lab, inp);
    ers = ersOf(lab.vehicle.getTelemetry());
    // ot taper at 20 m/s is 1, throttle 1 with kappa <= tc.slip gives thr 1, ot skips the mode factor
    expect(ers.powerW).toBeCloseTo(HYBRID.mgukW, 6);
    expect(ers.overtake).toBe(true);
    expect(ers.deployCapJ).toBeCloseTo(HYBRID.deployJPerLap + HYBRID.overtakeExtraJ, 6);
    expect(ers.lapDeployJ).toBeCloseTo(HYBRID.mgukW * FIXED_DT, 6);
    expect(inp).toEqual(snap);
  });

  it('EDGE4: ersNewLap zeroes the lap energy counters and the deploy cap and keeps soc', () => {
    const lab = build(hybridSpec());
    const ot: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false, overtake: true };
    setSpeedMs(lab, 20);
    step(lab, ot);
    setSpeedMs(lab, 20);
    step(lab, ot);
    setSpeedMs(lab, 20);
    step(lab, BRAKE_FULL);
    let ers = ersOf(lab.vehicle.getTelemetry());
    expect(ers.lapDeployJ).toBeGreaterThan(0);
    expect(ers.lapHarvestJ).toBeGreaterThan(0);
    expect(ers.deployCapJ).toBeCloseTo(HYBRID.deployJPerLap + HYBRID.overtakeExtraJ, 6);
    const socBefore = ers.socFrac;

    lab.vehicle.ersNewLap();
    ers = ersOf(lab.vehicle.getTelemetry());
    expect(ers.lapDeployJ).toBeCloseTo(0, 9);
    expect(ers.lapHarvestJ).toBeCloseTo(0, 9);
    expect(ers.deployCapJ).toBeCloseTo(HYBRID.deployJPerLap, 6);
    expect(ers.socFrac).toBeCloseTo(socBefore, 12);
  });

  it('EDGE5: telemetry reuses the ers and aero objects and mutates out in place', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setAeroZone(true);
    step(lab, FULL);
    const a = lab.vehicle.getTelemetry();
    const b = lab.vehicle.getTelemetry();
    expect(b.ers).toBe(a.ers);
    expect(b.aero).toBe(a.aero);

    const out = lab.vehicle.getTelemetry();
    const c = lab.vehicle.getTelemetry(out);
    expect(c).toBe(out);
    step(lab, FULL);
    const d = lab.vehicle.getTelemetry(out);
    expect(d).toBe(out);
    expect(d.ers).toBe(c.ers);
    expect(d.aero).toBe(c.aero);
  });

  it('EDGE6: aero blend ramps at dt / transitionS and settles exactly on the target', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setAeroZone(true);
    const ramp = FIXED_DT / ACTIVE_AERO.transitionS;
    step(lab, FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(ramp, 12);
    for (let i = 1; i < 24; i++) step(lab, FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(24 * ramp, 9);
    for (let i = 24; i < 48; i++) step(lab, FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(1, 9);
  });

  it('EDGE7: blend targets 1 only in zone with throttle >= 0.9 and brake < 0.05 while inZone reports the flag', () => {
    const lab = build(hybridSpec());
    let aero = aeroOf(lab.vehicle.getTelemetry());
    expect(aero.inZone).toBe(false);
    expect(aero.blend).toBeCloseTo(0, 9);

    lab.vehicle.setAeroZone(true);
    for (let i = 0; i < 2; i++) step(lab, { ...IDLE, throttle: 0.8 });
    aero = aeroOf(lab.vehicle.getTelemetry());
    expect(aero.inZone).toBe(true);
    expect(aero.blend).toBeCloseTo(0, 9);

    for (let i = 0; i < 2; i++) step(lab, { ...IDLE, throttle: 1, brake: 0.5 });
    aero = aeroOf(lab.vehicle.getTelemetry());
    expect(aero.inZone).toBe(true);
    expect(aero.blend).toBeCloseTo(0, 9);
  });

  it('EDGE8: MGU-K deploy does not change fuel burn and an empty tank silences the ERS', () => {
    const plain = build(plainSpec());
    const full = build(hybridSpec());
    const dry = build(hybridSpec());

    dry.vehicle.setMultipliers(1, 1e12);
    step(dry, FULL);
    expect(dry.vehicle.getTelemetry().fuelKg).toBeCloseTo(0, 9);

    setSpeedMs(plain, 20);
    setSpeedMs(full, 20);
    setSpeedMs(dry, 20);
    step(plain, FULL);
    step(full, FULL);
    step(dry, FULL);

    // kappa_prev 0 keeps thr at 1: balance deploy = mgukW * 1 * 1 * 0.8 at 20 m/s
    expect(ersOf(full.vehicle.getTelemetry()).powerW).toBeCloseTo(0.8 * HYBRID.mgukW, 6);
    expect(full.vehicle.getTelemetry().fuelKg).toBeCloseTo(plain.vehicle.getTelemetry().fuelKg, 12);

    const dryErs = ersOf(dry.vehicle.getTelemetry());
    expect(dryErs.powerW).toBeCloseTo(0, 9);
    expect(dryErs.lapDeployJ).toBeCloseTo(0, 9);
    expect(dryErs.lapHarvestJ).toBeCloseTo(0, 9);
  });

  it('EDGE9: the ERS is silent while the gearbox cuts the drive and resumes after the shift', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setGearMode('manual');
    for (let i = 0; i < steps(10) && speedKmh(lab) < 65; i++) step(lab, FULL);
    expect(speedKmh(lab)).toBeGreaterThanOrEqual(65);
    let power = ersOf(lab.vehicle.getTelemetry()).powerW;
    expect(power).toBeGreaterThanOrEqual(0.5 * 0.8 * HYBRID.mgukW - 1);
    expect(power).toBeLessThanOrEqual(0.8 * HYBRID.mgukW + 1);

    lab.vehicle.shiftUp();
    step(lab, FULL);
    power = ersOf(lab.vehicle.getTelemetry()).powerW;
    expect(power).toBeCloseTo(0, 9);

    for (let i = 0; i < steps(0.3); i++) step(lab, FULL);
    expect(ersOf(lab.vehicle.getTelemetry()).powerW).toBeGreaterThan(0);
  });

  it('EDGE10: Game feeds the zone flag from lastDistance, which is 0 at start and after a reset', async () => {
    const track = parseTrackData(readJson('public/tracks/elkhart.json'));
    const zones = deriveAeroZones(track.centerline);
    const cum = cumulativeLengths(track.centerline, true);
    const n = track.centerline.length;
    const lapLength = cum[n];
    const z0 = inAeroZone(zones, 0, lapLength);

    let idx = 0;
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
        if (flag) break;
      }
    }

    const game = await Game.create(track, hybridSpec());
    try {
      game.step(IDLE);
      expect(aeroOf(game.getTelemetry()).inZone).toBe(z0);

      game.teleportToIndex(idx);
      for (let i = 0; i < 3; i++) game.step(FULL);
      game.step({ throttle: 0, brake: 0, steer: 0, reset: true });
      expect(aeroOf(game.getTelemetry()).inZone).toBe(z0);
    } finally {
      game.dispose();
    }
  }, 60000);
});
