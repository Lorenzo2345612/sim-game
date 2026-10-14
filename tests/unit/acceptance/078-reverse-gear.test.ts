import { describe, it, expect } from 'vitest';
import { Gearbox } from '../../../src/physics/gearbox';
import { FIXED_DT } from '../../../src/core/constants';

type Pedals = { throttle: number; brake: number };
// Task 078 target signatures; the intersection keeps this file typechecking before Gearbox has them.
type Gearbox078 = Gearbox & {
  update(speedMs: number, dt?: number, input?: Pedals): void;
  driveTorque(engineTorqueNm: number, input: Pedals, speedMs: number): number;
  brakeRequest(input: Pedals): number;
};

const REVERSE_SPEED_MS = -31 / 3.6;

describe('078 reverse gear acceptance', () => {
  it('AT1: auto engages reverse after 0.4 s of full brake at standstill, not at 0.35 s', () => {
    const gb = new Gearbox() as Gearbox078;
    for (let i = 0; i < Math.round(0.35 / FIXED_DT); i++) {
      gb.update(0, FIXED_DT, { throttle: 0, brake: 1 });
    }
    expect(gb.gear).toBe(1);
    for (let i = 0; i < Math.round(0.1 / FIXED_DT); i++) {
      gb.update(0, FIXED_DT, { throttle: 0, brake: 1 });
    }
    expect(gb.gear).toBe(-1);
  });

  it('AT2: in reverse brake drives backwards (negative torque), throttle gives zero torque and a brake request of 1', () => {
    const gb = new Gearbox() as Gearbox078;
    gb.setMode('manual');
    gb.shiftDown();
    expect(gb.gear).toBe(-1);
    expect(gb.driveTorque(300, { throttle: 0, brake: 1 }, 0)).toBeLessThan(0);
    expect(gb.driveTorque(300, { throttle: 1, brake: 0 }, 0)).toBeCloseTo(0, 6);
    expect(gb.brakeRequest({ throttle: 1, brake: 0 })).toBeCloseTo(1, 6);
  });

  it('AT3: in reverse, throttle 0.6 below 0.5 m/s returns to gear 1', () => {
    const gb = new Gearbox() as Gearbox078;
    for (let i = 0; i < Math.round(0.45 / FIXED_DT); i++) {
      gb.update(0, FIXED_DT, { throttle: 0, brake: 1 });
    }
    expect(gb.gear).toBe(-1);
    gb.update(0.2, FIXED_DT, { throttle: 0.6, brake: 0 });
    expect(gb.gear).toBe(1);
  });

  it('AT4: manual shiftDown at gear 1 gives reverse below 0.5 m/s and stays in 1 at 5 m/s; shiftUp from reverse gives 1', () => {
    const gb = new Gearbox() as Gearbox078;
    gb.setMode('manual');
    gb.update(0.3, FIXED_DT);
    gb.shiftDown();
    expect(gb.gear).toBe(-1);
    gb.shiftUp();
    expect(gb.gear).toBe(1);
    gb.update(5, FIXED_DT);
    gb.shiftDown();
    expect(gb.gear).toBe(1);
  });

  it('AT5: reverse drive torque is 0 at 31 km/h backwards', () => {
    const gb = new Gearbox() as Gearbox078;
    gb.setMode('manual');
    gb.shiftDown();
    expect(gb.gear).toBe(-1);
    expect(gb.driveTorque(300, { throttle: 0, brake: 1 }, REVERSE_SPEED_MS)).toBeCloseTo(0, 6);
  });
});
