import { describe, expect, it } from 'vitest';
import type { DriverInput } from '../../../src/core/types';
import { loadAssistLevel, saveAssistLevel, SETTINGS_KEY } from '../../../src/core/settings';
import {
  applyAssists,
  assistPreset,
  brakeAssist,
  lookaheadTarget,
  steerAssist,
} from '../../../src/game/assists';

function memoryStorage(initial?: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(initial ?? {}));
}

function storageOf(map: Map<string, string>) {
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('125 assist presets edge cases', () => {
  it('EDGE1: assistPreset returns a fresh object each call (mutation does not leak)', () => {
    const a = assistPreset('beginner');
    a.steerAssist = 0.9;
    a.abs = false;
    const b = assistPreset('beginner');
    expect(b.steerAssist).toBe(0.5);
    expect(b.abs).toBe(true);
  });

  it('EDGE2: brakeAssist returns 0 exactly at speed = targetSpeed + 1 and positive just above', () => {
    expect(brakeAssist(31, 30, 50, 30)).toBe(0);
    // (31.001² − 30²)/(2·50)/30 = 61.062001/3000
    expect(brakeAssist(31.001, 30, 50, 30)).toBeCloseTo(61.062001 / 3000, 12);
    expect(brakeAssist(20, 30, 100, 30)).toBe(0);
    expect(brakeAssist(-5, 0, 100, 30)).toBe(0);
  });

  it('EDGE3: brakeAssist floors distance at 0.1 m for zero and negative distances', () => {
    // (31.1² − 30²)/(2·0.1)/1000 = 67.21/200
    expect(brakeAssist(31.1, 30, -5, 1000)).toBeCloseTo(67.21 / 200, 12);
    expect(brakeAssist(31.1, 30, 0, 1000)).toBeCloseTo(67.21 / 200, 12);
    expect(brakeAssist(31.1, 30, 0.05, 1000)).toBeCloseTo(67.21 / 200, 12);
  });

  it('EDGE4: brakeAssist throws when decel ≤ 0', () => {
    expect(() => brakeAssist(60, 30, 100, 0)).toThrow();
    expect(() => brakeAssist(60, 30, 100, -1)).toThrow();
  });

  it('EDGE5: steerAssist clamps to −1 and clamps yawRateError to ±1 before applying k', () => {
    expect(steerAssist(-0.9, 2, 0.5)).toBe(-1);
    expect(steerAssist(0, 2, 0.5)).toBeCloseTo(-0.5, 12);
    expect(steerAssist(0, 5, 0.5)).toBeCloseTo(-0.5, 12);
    expect(steerAssist(0, -5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('EDGE6: steerAssist with k = 0 leaves the input unchanged despite large yawRateError', () => {
    expect(steerAssist(0.3, 10, 0)).toBe(0.3);
    expect(steerAssist(0.3, -10, 0)).toBe(0.3);
  });

  it('EDGE7: applyAssists raises brake, zeroes throttle and does not mutate the input', () => {
    const preset = assistPreset('beginner');
    const input: DriverInput = { throttle: 1, brake: 0, steer: 0.2, reset: false };
    const out = applyAssists(preset, input, {
      speed: 60,
      targetSpeed: 30,
      distanceToTarget: 100,
      decel: 30,
      yawRateError: 0,
    });
    expect(out).not.toBe(input);
    expect(out.brake).toBeCloseTo(0.45, 12);
    expect(out.throttle).toBe(0);
    expect(out.steer).toBeCloseTo(0.2, 12);
    expect(input.brake).toBe(0);
    expect(input.throttle).toBe(1);

    const cruising = applyAssists(preset, input, {
      speed: 30.5,
      targetSpeed: 30,
      distanceToTarget: 50,
      decel: 30,
      yawRateError: 0,
    });
    expect(cruising.brake).toBe(0);
    expect(cruising.throttle).toBe(1);

    const alreadyBraking: DriverInput = { throttle: 1, brake: 0.7, steer: 0, reset: false };
    const out2 = applyAssists(preset, alreadyBraking, {
      speed: 60,
      targetSpeed: 30,
      distanceToTarget: 100,
      decel: 30,
      yawRateError: 0,
    });
    expect(out2.brake).toBeCloseTo(0.7, 12);
    expect(out2.throttle).toBe(0);
  });

  it('EDGE8: applyAssists with the pro preset leaves brake, throttle and steer untouched', () => {
    const preset = assistPreset('pro');
    const input: DriverInput = { throttle: 1, brake: 0.3, steer: 0.5, reset: false };
    const out = applyAssists(preset, input, {
      speed: 80,
      targetSpeed: 20,
      distanceToTarget: 10,
      decel: 30,
      yawRateError: 2,
    });
    expect(out.brake).toBe(0.3);
    expect(out.throttle).toBe(1);
    expect(out.steer).toBe(0.5);
  });

  it('EDGE9: lookaheadTarget returns the minimum speed within the horizon and wraps around', () => {
    const speeds = Float64Array.from([40, 20, 35, 25, 45, 30]);
    const dist = Float64Array.from([0, 50, 100, 150, 200, 250]);
    const ahead = lookaheadTarget(speeds, dist, 300, 10, 90);
    expect(ahead.targetSpeed).toBe(20);
    expect(ahead.distance).toBe(50);

    const around = lookaheadTarget(speeds, dist, 300, 200, 120);
    expect(around.targetSpeed).toBe(30);
    expect(around.distance).toBe(250);

    const defHorizon = lookaheadTarget(speeds, dist, 300, 10);
    expect(defHorizon.targetSpeed).toBe(20);
    expect(defHorizon.distance).toBe(50);
  });

  it('EDGE10: loadAssistLevel defaults to intermediate and saveAssistLevel keeps other keys', () => {
    const empty = storageOf(memoryStorage());
    expect(loadAssistLevel(empty)).toBe('intermediate');

    const map = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ preset: 'low' }) });
    const st = storageOf(map);
    saveAssistLevel(st, 'beginner');
    expect(loadAssistLevel(st)).toBe('beginner');
    const stored = JSON.parse(map.get(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.preset).toBe('low');
  });
});
