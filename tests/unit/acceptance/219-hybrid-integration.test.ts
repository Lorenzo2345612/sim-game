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
import { deriveAeroZones } from '../../../src/track/aeroZones';
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

function accelerateToKmh(lab: Lab, kmh: number): void {
  for (let i = 0; i < steps(30) && speedKmh(lab) < kmh; i++) step(lab, FULL);
}

function brakeBelowKmh(lab: Lab, kmh: number): number {
  const start = lab.vehicle.getState().position;
  for (let i = 0; i < steps(30) && speedKmh(lab) > kmh; i++) step(lab, BRAKE_FULL);
  const end = lab.vehicle.getState().position;
  return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
}

beforeAll(async () => {
  await initPhysics();
});

afterEach(() => {
  for (const lab of labs) lab.world.free();
  labs.length = 0;
});

describe('219 hybrid and active aero integration acceptance', () => {
  it('AT1: plain f4 has no ers and no aero after 2 s full throttle', () => {
    const lab = build(plainSpec());
    for (let i = 0; i < steps(2); i++) step(lab, FULL);
    const tel = lab.vehicle.getTelemetry();
    expect(tel.ers).toBeUndefined();
    expect(tel.aero).toBeUndefined();
  });

  it('AT2: hybrid 6 s full throttle is at least 5 km/h faster, drains soc and conserves lap energy', () => {
    const plain = build(plainSpec());
    const hybrid = build(hybridSpec());
    for (let i = 0; i < steps(6); i++) {
      step(plain, FULL);
      step(hybrid, FULL);
    }
    expect(speedKmh(hybrid)).toBeGreaterThanOrEqual(speedKmh(plain) + 5);
    const ers = ersOf(hybrid.vehicle.getTelemetry());
    expect(ers.socFrac).toBeLessThan(1);
    expect(Math.abs(ers.lapDeployJ - ((1 - ers.socFrac) * 4e6 - ers.lapHarvestJ))).toBeLessThanOrEqual(1e3);
  });

  it('AT3: full brake from 150 to 20 km/h harvests, raises soc and stops within 5 % of plain', () => {
    const plain = build(plainSpec());
    const hybrid = build(hybridSpec());
    accelerateToKmh(plain, 150);
    accelerateToKmh(hybrid, 150);
    expect(speedKmh(plain)).toBeGreaterThanOrEqual(150);
    expect(speedKmh(hybrid)).toBeGreaterThanOrEqual(150);
    const socBefore = ersOf(hybrid.vehicle.getTelemetry()).socFrac;
    const plainM = brakeBelowKmh(plain, 20);
    const hybridM = brakeBelowKmh(hybrid, 20);
    const ers = ersOf(hybrid.vehicle.getTelemetry());
    expect(ers.lapHarvestJ).toBeGreaterThan(0);
    expect(ers.socFrac).toBeGreaterThan(socBefore);
    expect(hybridM).toBeGreaterThanOrEqual(plainM * 0.95);
    expect(hybridM).toBeLessThanOrEqual(plainM * 1.05);
  });

  it('AT4: ersCycle held 10 steps then pulsed walks balance to attack (once) to charge', () => {
    const lab = build(hybridSpec());
    setSpeedMs(lab, 50 / MS_TO_KMH);
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('balance');
    for (let i = 0; i < 10; i++) step(lab, { ...IDLE, ersCycle: true });
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('attack');
    step(lab, { ...IDLE, ersCycle: false });
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('attack');
    step(lab, { ...IDLE, ersCycle: true });
    expect(ersOf(lab.vehicle.getTelemetry()).mode).toBe('charge');
  });

  it('AT5: reset after the 6 s run restores socFrac 1, lapDeployJ 0 and aero blend 0', () => {
    const lab = build(hybridSpec());
    lab.vehicle.setAeroZone(true);
    for (let i = 0; i < steps(6); i++) step(lab, FULL);
    lab.vehicle.reset({ position: { x: 0, y: lab.spec.chassis.cgHeight, z: 0 }, yaw: 0 });
    const tel = lab.vehicle.getTelemetry();
    expect(ersOf(tel).socFrac).toBeCloseTo(1, 9);
    expect(ersOf(tel).lapDeployJ).toBeCloseTo(0, 9);
    expect(aeroOf(tel).blend).toBeCloseTo(0, 9);
  });

  it('AT6: zone on full throttle reaches blend 1 in 1 s and full brake clears it in 0.4 s', () => {
    const lab = build(hybridSpec());
    setSpeedMs(lab, 50);
    lab.vehicle.setAeroZone(true);
    for (let i = 0; i < steps(1); i++) step(lab, FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(1, 9);
    for (let i = 0; i < steps(0.4); i++) step(lab, BRAKE_FULL);
    expect(aeroOf(lab.vehicle.getTelemetry()).blend).toBeCloseTo(0, 9);
  });

  it('AT7: forced zone on top speed after 25 s full throttle is at least 3 km/h above zone off', () => {
    const topSpeed = (inZone: boolean): number => {
      const lab = build(hybridSpec());
      let top = 0;
      for (let i = 0; i < steps(25); i++) {
        lab.vehicle.setAeroZone(inZone);
        step(lab, FULL);
        top = Math.max(top, speedKmh(lab));
      }
      return top;
    };
    const on = topSpeed(true);
    const off = topSpeed(false);
    expect(on).toBeGreaterThanOrEqual(off + 3);
  }, 120000);

  it('AT8: Game aeroZones equals deriveAeroZones(track.centerline) on Elkhart', async () => {
    const track = parseTrackData(readJson('public/tracks/elkhart.json'));
    const game = await Game.create(track, hybridSpec());
    try {
      const zones = game.aeroZones();
      expect(zones.length).toBeGreaterThanOrEqual(1);
      expect(zones).toEqual(deriveAeroZones(track.centerline));
    } finally {
      game.dispose();
    }
  });

  it('AT9: lapStarted after teleport 30 m before the line resets lapDeployJ and keeps socFrac', async () => {
    const track = parseTrackData(readJson('public/tracks/elkhart.json'));
    const game = await Game.create(track, hybridSpec());
    try {
      const cum = cumulativeLengths(track.centerline, true);
      const lapLength = cum[track.centerline.length];
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < track.centerline.length; i++) {
        const d = Math.abs(cum[i] - (lapLength - 30));
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      game.teleportToIndex(idx);
      let socBefore = 0;
      let lapDeployAfter = Infinity;
      let socAfter = 0;
      let saw = false;
      for (let i = 0; i < steps(10) && !saw; i++) {
        socBefore = ersOf(game.getTelemetry()).socFrac;
        game.step(FULL);
        if (game.drainEvents().some((e) => e.type === 'lapStarted')) {
          saw = true;
          const ers = ersOf(game.getTelemetry());
          lapDeployAfter = ers.lapDeployJ;
          socAfter = ers.socFrac;
        }
      }
      expect(saw).toBe(true);
      expect(lapDeployAfter).toBeLessThan(1e5);
      expect(socAfter).toBeCloseTo(socBefore, 3);
    } finally {
      game.dispose();
    }
  }, 60000);
});
