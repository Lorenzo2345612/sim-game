import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { SETTINGS_KEY, loadAssistLevel, saveAssistLevel } from '../../../src/core/settings';
import { applyAssists, assistPreset, brakeAssist, lookaheadTarget } from '../../../src/game/assists';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { circleTrack } from '../../fixtures/circleTrack';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

const input = (over: Partial<DriverInput> = {}): DriverInput => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  reset: false,
  ...over,
});

describe('125 assist presets post-code gaps', () => {
  it('POST1: applyAssists keeps throttle at assist exactly 0.05 and cuts it just above', () => {
    const preset = assistPreset('beginner');
    const base = { targetSpeed: 20, distanceToTarget: 100, yawRateError: 0 };
    // ((30² − 20²)/(2·100))/50 = 2.5/50 = 0.05
    expect(brakeAssist(30, 20, 100, 50)).toBeCloseTo(0.05, 12);
    const at = applyAssists(preset, input({ throttle: 1 }), { ...base, speed: 30, decel: 50 });
    expect(at.brake).toBeCloseTo(0.05, 12);
    expect(at.throttle).toBe(1);
    // 2.5/49 > 0.05
    const above = applyAssists(preset, input({ throttle: 1 }), { ...base, speed: 30, decel: 49 });
    expect(above.brake).toBeGreaterThan(0.05);
    expect(above.throttle).toBe(0);
  });

  it('POST2: intermediate preset never brakes for the driver but trims steer by 0.2·error', () => {
    const preset = assistPreset('intermediate');
    const src = input({ throttle: 1, brake: 0, steer: 0.5 });
    const out = applyAssists(preset, src, {
      speed: 80,
      targetSpeed: 20,
      distanceToTarget: 10,
      decel: 30,
      yawRateError: 1,
    });
    expect(out.brake).toBe(0);
    expect(out.throttle).toBe(1);
    expect(out.steer).toBeCloseTo(0.3, 12);
    expect(src.steer).toBe(0.5);
  });

  it('POST3: applyAssists propagates the beginner preset throw when decel ≤ 0', () => {
    const ctx = { speed: 60, targetSpeed: 30, distanceToTarget: 100, yawRateError: 0 };
    expect(() =>
      applyAssists(assistPreset('beginner'), input(), { ...ctx, decel: 0 }),
    ).toThrow();
    expect(() =>
      applyAssists(assistPreset('beginner'), input(), { ...ctx, decel: -1 }),
    ).toThrow();
    // pro never calls brakeAssist, so a degenerate decel is ignored
    const out = applyAssists(assistPreset('pro'), input({ brake: 0.2 }), { ...ctx, decel: 0 });
    expect(out.brake).toBe(0.2);
  });

  it('POST4: applyAssists copies optional input flags through', () => {
    const out = applyAssists(assistPreset('pro'), input({ shiftUp: true, reset: true }), {
      speed: 0,
      targetSpeed: 0,
      distanceToTarget: 0,
      decel: 30,
      yawRateError: 0,
    });
    expect(out.shiftUp).toBe(true);
    expect(out.reset).toBe(true);
  });

  it('POST5: lookaheadTarget throws on empty profile, dist mismatch and non-positive length', () => {
    expect(() => lookaheadTarget(new Float64Array(0), new Float64Array(0), 100, 0)).toThrow();
    expect(() =>
      lookaheadTarget(Float64Array.from([10, 20]), Float64Array.from([0]), 100, 0),
    ).toThrow();
    expect(() =>
      lookaheadTarget(Float64Array.from([10, 20]), Float64Array.from([0, 50]), 0, 0),
    ).toThrow();
    expect(() =>
      lookaheadTarget(Float64Array.from([10, 20]), Float64Array.from([0, 50]), -10, 0),
    ).toThrow();
  });

  it('POST6: lookaheadTarget wraps at the track end and returns the far-side minimum', () => {
    const speeds = Float64Array.from([40, 20, 35, 25, 45, 30]);
    const dist = Float64Array.from([0, 50, 100, 150, 200, 250]);
    // 300 m track: from 200 m the horizon sees 250 (30) and 0 (40); 50 m is 150 m away
    const wrap = lookaheadTarget(speeds, dist, 300, 200, 120);
    expect(wrap.targetSpeed).toBe(30);
    expect(wrap.distance).toBe(250);
    // exact horizon distance is included; one meter less drops the wrapped point
    expect(lookaheadTarget(speeds, dist, 300, 200, 50).distance).toBe(250);
    expect(lookaheadTarget(speeds, dist, 300, 200, 49).distance).toBe(200);
  });

  it('POST7: lookaheadTarget normalises a negative distance onto the wrapped position', () => {
    const speeds = Float64Array.from([40, 20, 35, 28]);
    const dist = Float64Array.from([0, 50, 100, 145]);
    const neg = lookaheadTarget(speeds, dist, 150, -5, 20);
    const pos = lookaheadTarget(speeds, dist, 150, 145, 20);
    expect(neg.targetSpeed).toBe(pos.targetSpeed);
    expect(neg.targetSpeed).toBe(28);
    expect(neg.distance).toBe(145);
  });

  it('POST8: lookaheadTarget works on a single-point profile', () => {
    const single = lookaheadTarget(Float64Array.from([12]), Float64Array.from([0]), 100, 5);
    expect(single.targetSpeed).toBe(12);
    expect(single.distance).toBe(0);
  });

  it('POST9: lookaheadTarget still scans wrapped points when past the last profile sample', () => {
    const speeds = Float64Array.from([40, 20, 35]);
    const dist = Float64Array.from([0, 50, 100]);
    // car at 110 m of a 150 m track: ahead are 0 m (f=40, speed 40) and 50 m (f=90, speed 20)
    const look = lookaheadTarget(speeds, dist, 150, 110, 90);
    expect(look.targetSpeed).toBe(20);
    expect(look.distance).toBe(50);
  });

  it('POST10: loadAssistLevel reads invalid or corrupt payloads as intermediate', () => {
    const map = new Map<string, string>();
    const st = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    map.set(SETTINGS_KEY, JSON.stringify({ assistLevel: 'expert' }));
    expect(loadAssistLevel(st)).toBe('intermediate');
    map.set(SETTINGS_KEY, '{not json');
    expect(loadAssistLevel(st)).toBe('intermediate');
    map.set(SETTINGS_KEY, JSON.stringify(['pro']));
    expect(loadAssistLevel(st)).toBe('intermediate');
    map.set(SETTINGS_KEY, JSON.stringify({ assistLevel: 'pro' }));
    expect(loadAssistLevel(st)).toBe('pro');
  });

  it('POST11: saveAssistLevel overwrites a previous level in place', () => {
    const map = new Map<string, string>();
    const st = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    saveAssistLevel(st, 'beginner');
    saveAssistLevel(st, 'pro');
    expect(loadAssistLevel(st)).toBe('pro');
  });

  it('POST12: the menu exposes an #assist-level selector persisted with saveAssistLevel', () => {
    const source = readFileSync(join(ROOT, 'src', 'ui', 'menu.ts'), 'utf8');
    expect(source).toMatch(/assist-level/);
    expect(source).toMatch(/saveAssistLevel\s*\(/);
    expect(source).toMatch(/loadAssistLevel\s*\(/);
  });

  it('POST15: lookaheadTarget treats a distance beyond one track length as its wrapped value', () => {
    const speeds = Float64Array.from([40, 20, 35]);
    const dist = Float64Array.from([0, 50, 100]);
    const base = lookaheadTarget(speeds, dist, 150, 45);
    expect(lookaheadTarget(speeds, dist, 150, 195)).toEqual(base);
    expect(lookaheadTarget(speeds, dist, 150, 150)).toEqual(
      lookaheadTarget(speeds, dist, 150, 0),
    );
    expect(base.targetSpeed).toBe(20);
    expect(base.distance).toBe(50);
  });

  describe('Game preset aids wiring to the CarSpec copy', () => {
    let game: Game | null = null;

    beforeAll(async () => {
      await initPhysics();
    });

    afterEach(() => {
      game?.dispose();
      game = null;
    });

    function monza(): TrackDataV2 {
      return parseTrackData(
        JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8')),
      ) as TrackDataV2;
    }

    async function aidsProbe(level: 'beginner' | 'pro'): Promise<{
      vAtBrake: number;
      minFrontKappa: number;
      maxRearKappa: number;
    }> {
      game = await Game.create(monza(), undefined, undefined, level);
      const thr: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
      let maxRear = -Infinity;
      for (let i = 0; i < 300; i++) {
        const st = game.getCurrentState();
        game.step(thr);
        if (st.forwardSpeed >= 3 && st.forwardSpeed <= 10) {
          const w = game.getTelemetry().wheels;
          maxRear = Math.max(maxRear, w[2].kappa, w[3].kappa);
        }
        if (st.forwardSpeed >= 25) break;
      }
      const vAtBrake = game.getCurrentState().forwardSpeed;
      const br: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
      let minFront = Infinity;
      for (let i = 0; i < 400; i++) {
        const st = game.getCurrentState();
        game.step(br);
        if (st.forwardSpeed > 5 && i > 5) {
          const w = game.getTelemetry().wheels;
          minFront = Math.min(minFront, w[0].kappa, w[1].kappa);
        }
        if (st.forwardSpeed <= 5) break;
      }
      return { vAtBrake, minFrontKappa: minFront, maxRearKappa: maxRear };
    }

    it('POST16: ABS bites under hard braking only when the preset enables it', async () => {
      const beg = await aidsProbe('beginner');
      const pro = await aidsProbe('pro');
      expect(beg.vAtBrake).toBeGreaterThan(10);
      expect(pro.vAtBrake).toBeGreaterThan(10);
      // ABS keeps front slip bounded near the aid threshold; without it the wheels lock
      expect(beg.minFrontKappa).toBeGreaterThan(-0.5);
      expect(pro.minFrontKappa).toBeLessThan(-0.9);
    }, 60000);

    it('POST17: TC bounds driven-wheel spin in first gear only when the preset enables it', async () => {
      const beg = await aidsProbe('beginner');
      const pro = await aidsProbe('pro');
      expect(pro.maxRearKappa - beg.maxRearKappa).toBeGreaterThan(0.5);
    }, 60000);
  });

  describe('Game assist-level gearbox wiring', () => {
    let game: Game | null = null;

    beforeAll(async () => {
      await initPhysics();
    });

    afterEach(() => {
      game?.dispose();
      game = null;
    });

    async function holdBrakeAtStop(level: 'beginner' | 'pro'): Promise<number> {
      game = await Game.create(circleTrack, undefined, undefined, level);
      for (let i = 0; i < 60; i++) game.step(IDLE);
      for (let i = 0; i < 80; i++) game.step(BRAKE);
      return game.getTelemetry().gear;
    }

    it('POST13: beginner auto gearbox engages reverse when holding the brake at a stop', async () => {
      expect(await holdBrakeAtStop('beginner')).toBe(-1);
    }, 30000);

    it('POST14: pro manual gearbox stays in gear when holding the brake at a stop', async () => {
      expect(await holdBrakeAtStop('pro')).toBe(1);
    }, 30000);
  });

  describe('Game preset override and reset with assists', () => {
    let game: Game | null = null;

    beforeAll(async () => {
      await initPhysics();
    });

    afterEach(() => {
      game?.dispose();
      game = null;
    });

    it('POST18: the preset forces aids on over a disabled spec without mutating it', async () => {
      const spec = parseCarSpec(
        JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
      );
      spec.aids.abs.enabled = false;
      spec.aids.tc.enabled = false;
      const monza = parseTrackData(
        JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8')),
      ) as TrackDataV2;
      game = await Game.create(monza, spec, undefined, 'beginner');
      for (let i = 0; i < 300 && game.getCurrentState().forwardSpeed < 25; i++) {
        game.step(input({ throttle: 1 }));
      }
      expect(game.getCurrentState().forwardSpeed).toBeGreaterThan(10);
      let minFront = Infinity;
      for (let i = 0; i < 500; i++) {
        const st = game.getCurrentState();
        game.step(BRAKE);
        if (st.forwardSpeed > 5 && i > 5) {
          const w = game.getTelemetry().wheels;
          minFront = Math.min(minFront, w[0].kappa, w[1].kappa);
        }
        if (st.forwardSpeed <= 5) break;
      }
      expect(minFront, 'beginner ABS bounds slip despite the disabled spec').toBeGreaterThan(-0.5);
      expect(spec.aids.abs.enabled).toBe(false);
      expect(spec.aids.tc.enabled).toBe(false);
    }, 60000);

    it('POST19: reset with assists returns to spawn and keeps the sim finite afterwards', async () => {
      game = await Game.create(circleTrack, undefined, undefined, 'beginner');
      const spawn = spawnFromTrack(circleTrack);
      for (let i = 0; i < 150; i++) game.step(input({ throttle: 1, steer: 0.6 }));
      game.step(input({ reset: true }));
      const pos = game.getCurrentState().position;
      expect(Math.abs(pos.x - spawn.position.x)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(pos.y - spawn.position.y)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(pos.z - spawn.position.z)).toBeLessThanOrEqual(0.05);
      expect(game.getLapInfo().lap).toBe(0);
      for (let i = 0; i < 90; i++) game.step(input({ throttle: 1, steer: -0.4 }));
      const after = game.getCurrentState();
      expect(Number.isFinite(after.position.x)).toBe(true);
      expect(Number.isFinite(after.position.z)).toBe(true);
      expect(Number.isFinite(game.heading())).toBe(true);
    }, 30000);
  });
});
