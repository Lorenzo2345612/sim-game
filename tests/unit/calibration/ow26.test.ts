import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;
type Script = (t: number, state: VehicleState) => DriverInput;

const ROOT = join(__dirname, '..', '..', '..');
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const WINDOW_S = 2;
const SKID_RADIUS = 100;
const SKID_CX = -SKID_RADIUS;

const INDEX_OTHERS = [
  { id: 'f4', name: 'F4', category: 'open-wheel' },
  { id: 'gt3-a', name: 'GT3 A', category: 'gt3' },
  { id: 'gt3-b', name: 'GT3 B', category: 'gt3' },
  { id: 'gt3-c', name: 'GT3 C', category: 'gt3' },
  { id: 'lmp2-a', name: 'LMP2 A', category: 'lmp2' },
  { id: 'hyper-a', name: 'Hypercar A', category: 'hypercar' },
];
const INDEX_OW26 = { id: 'ow26', name: 'OW-26 Hybrid', category: 'open-wheel' };

function loadSpec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

interface Lab {
  world: World;
  vehicle: Vehicle;
  spec: CarSpec;
}

const labs: Lab[] = [];

function build(mutate?: (spec: CarSpec) => void): Lab {
  const world = createPhysicsWorld();
  const spec = loadSpec();
  mutate?.(spec);
  const vehicle = new Vehicle(world, spec, {
    position: { x: 0, y: spec.chassis.cgHeight, z: 0 },
    yaw: 0,
  });
  const lab: Lab = { world, vehicle, spec };
  labs.push(lab);
  return lab;
}

function run(lab: Lab, script: Script, seconds: number, zone?: boolean): VehicleState {
  const n = Math.round(seconds / FIXED_DT);
  const state = lab.vehicle.getState();
  for (let i = 0; i < n; i++) {
    if (zone !== undefined) lab.vehicle.setAeroZone(zone);
    lab.vehicle.setInput(script(i * FIXED_DT, state));
    lab.vehicle.prePhysicsStep(FIXED_DT);
    lab.world.step();
    lab.vehicle.getState(state);
  }
  return lab.vehicle.getState();
}

function setSpeed(lab: Lab, ms: number): void {
  lab.vehicle.body.setLinvel({ x: 0, y: 0, z: -ms }, true);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface TopSpeed {
  meanKmh: number;
  meanRpm: number;
  clipped: boolean;
}

function topSpeedRun(zone: boolean): TopSpeed {
  const lab = build();
  const speeds: number[] = [];
  const rpms: number[] = [];
  let clipped = false;
  run(
    lab,
    (t, state) => {
      speeds.push(state.forwardSpeed);
      const tel = lab.vehicle.getTelemetry();
      rpms.push(tel.rpm);
      if (tel.ers?.clipping) clipped = true;
      return FULL;
    },
    40,
    zone,
  );
  const n = Math.round(WINDOW_S / FIXED_DT);
  const tailS = speeds.slice(-n);
  const tailR = rpms.slice(-n);
  return {
    meanKmh: (tailS.reduce((a, b) => a + b, 0) / tailS.length) * MS_TO_KMH,
    meanRpm: tailR.reduce((a, b) => a + b, 0) / tailR.length,
    clipped,
  };
}

describe('221 OW-26 car calibration acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const lab of labs) lab.world.free();
    labs.length = 0;
  });

  it('AT1: ow26.json parses as open-wheel with hybrid, activeAero, 8 ratios and limiter 15000', () => {
    const spec = loadSpec();
    expect(spec.category).toBe('open-wheel');
    expect(spec.hybrid).toBeDefined();
    expect(spec.activeAero).toBeDefined();
    expect(spec.gearbox.ratios).toHaveLength(8);
    expect(spec.engine.limiterRpm).toBe(15000);
    const banned = /f1|formula/i;
    expect(banned.test(spec.id)).toBe(false);
    expect(banned.test(spec.name)).toBe(false);
  });

  it('AT2: 0-100 km/h takes 2.3-3.2 s at full throttle with TC on', () => {
    const lab = build((spec) => {
      spec.aids.tc.enabled = true;
    });
    let t100 = -1;
    run(
      lab,
      (t, state) => {
        if (t100 < 0 && state.forwardSpeed >= 100 / MS_TO_KMH) t100 = t;
        return FULL;
      },
      10,
      false,
    );
    expect(t100).toBeGreaterThanOrEqual(2.3);
    expect(t100).toBeLessThanOrEqual(3.2);
  }, 60000);

  it('AT3: 0-200 km/h takes 4.8-7.5 s at full throttle with TC on', () => {
    const lab = build((spec) => {
      spec.aids.tc.enabled = true;
    });
    let t200 = -1;
    run(
      lab,
      (t, state) => {
        if (t200 < 0 && state.forwardSpeed >= 200 / MS_TO_KMH) t200 = t;
        return FULL;
      },
      10,
      false,
    );
    expect(t200).toBeGreaterThanOrEqual(4.8);
    expect(t200).toBeLessThanOrEqual(7.5);
  }, 60000);

  it('AT4: vmax after 40 s full throttle with the zone forced on is 320-355 km/h and ers clips', () => {
    const r = topSpeedRun(true);
    expect(r.meanKmh).toBeGreaterThanOrEqual(320);
    expect(r.meanKmh).toBeLessThanOrEqual(355);
    expect(r.clipped).toBe(true);
  }, 120000);

  it('AT5: vmax with the zone forced off is 290-335 km/h and at least 8 km/h below the zone-on run', () => {
    const on = topSpeedRun(true);
    const off = topSpeedRun(false);
    expect(off.meanKmh).toBeGreaterThanOrEqual(290);
    expect(off.meanKmh).toBeLessThanOrEqual(335);
    expect(on.meanKmh - off.meanKmh).toBeGreaterThanOrEqual(8);
  }, 120000);

  it('AT6: braking from 200 km/h to a stop with ABS covers at most 85 m', () => {
    const lab = build((spec) => {
      spec.aids.abs.enabled = true;
    });
    const target = 200 / MS_TO_KMH;
    let braking = false;
    let brakeX = Number.NaN;
    let brakeY = Number.NaN;
    let brakeZ = Number.NaN;
    let stopped = false;
    const end = run(
      lab,
      (t, state) => {
        if (!braking) {
          if (state.forwardSpeed < target) return FULL;
          braking = true;
          brakeX = state.position.x;
          brakeY = state.position.y;
          brakeZ = state.position.z;
        } else if (state.forwardSpeed <= 0.3) {
          stopped = true;
        }
        return BRAKE;
      },
      30,
    );
    expect(braking, 'never reached 200 km/h').toBe(true);
    expect(stopped, 'never stopped within the scenario').toBe(true);
    const distance = Math.hypot(end.position.x - brakeX, end.position.y - brakeY, end.position.z - brakeZ);
    expect(distance).toBeLessThanOrEqual(85);
  }, 60000);

  it('AT7: max steady lateral accel on a 100 m constant radius is 2.4-4.2 g', () => {
    const lab = build();
    setSpeed(lab, 12);
    const wheelbase = lab.spec.wheels.positions[2][2] - lab.spec.wheels.positions[0][2];
    let vt = 12;
    let integral = 0;
    let best = 0;
    let lost = false;
    const script: Script = (t, state) => {
      const dx = state.position.x - SKID_CX;
      const dz = state.position.z;
      const radius = Math.hypot(dx, dz);
      const error = radius - SKID_RADIUS;
      if (Math.abs(error) > 8) lost = true;
      const tanX = dz / radius;
      const tanZ = -dx / radius;
      const q = state.rotation;
      const fwdX = -2 * (q.w * q.y + q.z * q.x);
      const fwdZ = -1 + 2 * (q.x * q.x + q.y * q.y);
      const headingErr = Math.atan2(fwdZ * tanX - fwdX * tanZ, fwdX * tanX + fwdZ * tanZ);
      integral = clamp(integral + error * FIXED_DT, -3, 3);
      const delta = Math.atan(wheelbase / SKID_RADIUS) + 0.04 * error + 0.01 * integral + headingErr;
      const v = lab.vehicle.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      vt += 0.25 * FIXED_DT;
      const st = lab.spec.steering;
      const maxAngle =
        st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
      const ay = (speed * speed) / SKID_RADIUS / Math.abs(GRAVITY);
      if (Math.abs(error) < 4 && ay > best) best = ay;
      return {
        throttle: clamp(0.3 + 0.2 * (vt - speed), 0, 1),
        brake: 0,
        steer: -delta / maxAngle,
        reset: false,
      };
    };
    for (let i = 0; i < 200 && !lost; i++) run(lab, script, 1);
    expect(best).toBeGreaterThanOrEqual(2.4);
    expect(best).toBeLessThanOrEqual(4.2);
  }, 120000);

  it('AT8: rpm at vmax in the zone-on run is 11000-15000', () => {
    const r = topSpeedRun(true);
    expect(r.meanRpm).toBeGreaterThanOrEqual(11000);
    expect(r.meanRpm).toBeLessThanOrEqual(15000);
  }, 120000);

  it('AT9: cars index contains ow26 and the other entries are unchanged', () => {
    const entries = JSON.parse(
      readFileSync(join(ROOT, 'public', 'cars', 'index.json'), 'utf8'),
    ) as { id: string; name: string; category: string }[];
    expect(entries).toContainEqual(INDEX_OW26);
    expect(entries.filter((e) => e.id !== 'ow26')).toEqual(INDEX_OTHERS);
  });
});
