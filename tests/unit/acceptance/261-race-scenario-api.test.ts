import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { cumulativeLengths } from '../../../src/track/centerline';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

interface CenterlineSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

function centerlineAt(track: TrackDataV2, cum: Float64Array, sTarget: number): CenterlineSample {
  const cl = track.centerline;
  const n = cl.length;
  const lap = cum[n];
  let s = sTarget % lap;
  if (s < 0) s += lap;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (cum[k] <= s && s < cum[k + 1]) {
      i = k;
      break;
    }
  }
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (s - cum[i]) / seg : 0;
  const a = cl[i];
  const b = cl[(i + 1) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return { x: a[0] + t * dx, z: a[1] + t * dz, tx: dx / len, tz: dz / len };
}

// Right of travel (TrackProgress.lateral sign): (-tz, tx) for a unit tangent.
function pointRightOf(track: TrackDataV2, cum: Float64Array, s: number, d: number): CenterlineSample {
  const c = centerlineAt(track, cum, s);
  return { x: c.x + d * -c.tz, z: c.z + d * c.tx, tx: c.tx, tz: c.tz };
}

function forwardOf(q: { x: number; y: number; z: number; w: number }): { fx: number; fz: number } {
  return {
    fx: -2 * (q.w * q.y + q.x * q.z),
    fz: -1 + 2 * (q.x * q.x + q.y * q.y),
  };
}

describe('261 race scenario API acceptance', () => {
  it('AT1: scenario start pose puts car 1 at the s=100 centerline point shifted 2 m right, yaw on track', async () => {
    const track = loadTrack();
    const cum = cumulativeLengths(track.centerline, true);
    const game = await RaceGame.create(track, loadSpec(), {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 1000, d: -8, v: 0 },
          { s: 100, d: 2, v: 0 },
        ],
      },
    });
    try {
      const states = game.getStates(buffers(2));
      const p = states[1].position;
      const want = pointRightOf(track, cum, 100, 2);
      expect(Math.hypot(p.x - want.x, p.z - want.z), 'car 1 XZ vs expected spawn').toBeLessThanOrEqual(0.5);
      const { fx, fz } = forwardOf(states[1].rotation);
      const err = Math.atan2(fx * want.tz - fz * want.tx, fx * want.tx + fz * want.tz);
      expect(Math.abs(err), 'yaw error vs track direction').toBeLessThan(0.05);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('AT2: start v 30 gives car 1 forwardSpeed 30 ± 1.5 on the first step', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 1000, d: -8, v: 0 },
          { s: 100, d: 2, v: 30 },
        ],
      },
    });
    try {
      game.step(IDLE);
      const states = game.getStates(buffers(2));
      expect(Math.abs(states[1].forwardSpeed - 30), 'forwardSpeed vs 30').toBeLessThanOrEqual(1.5);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('AT3: with a scenario the phase is go from t 0 and the AI speed rises over 0.5 s', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 1000, d: -8, v: 0 },
          { s: 100, d: 2, v: 0 },
        ],
      },
    });
    try {
      expect(game.startLights(), 'lights at create').toBe(0);
      const buf = buffers(2);
      game.step(IDLE);
      game.getStates(buf);
      const early = buf[1].forwardSpeed;
      expect(game.startLights(), 'lights after first step').toBe(0);
      for (let i = 1; i < steps(0.5); i++) {
        game.step(IDLE);
        game.getStates(buf);
        expect(game.startLights(), `lights at tick ${i}`).toBe(0);
      }
      const late = buf[1].forwardSpeed;
      expect(late, 'AI 1 forwardSpeed rising').toBeGreaterThan(early);
      const totalTime = game.standings()[0].totalTime;
      expect(totalTime, 'raceTime equals simTime (go at t 0)').toBeCloseTo(game.simTime, 2);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('AT4: speedScale 0.8 covers at most 0.9x the distance of 1.0 over 15 s', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    async function run(scale: number): Promise<number> {
      const game = await RaceGame.create(track, spec, {
        ...raceConfig(1),
        scenario: {
          starts: [
            { s: 500, d: -8, v: 0 },
            { s: 500, d: 2, v: 0 },
          ],
          speedScales: [1, scale],
        },
      });
      try {
        const buf = buffers(2);
        game.getStates(buf);
        let px = buf[1].position.x;
        let pz = buf[1].position.z;
        let dist = 0;
        for (let i = 0; i < steps(15); i++) {
          game.step(IDLE);
          game.getStates(buf);
          dist += Math.hypot(buf[1].position.x - px, buf[1].position.z - pz);
          px = buf[1].position.x;
          pz = buf[1].position.z;
        }
        return dist;
      } finally {
        game.dispose();
      }
    }
    const d08 = await run(0.8);
    const d10 = await run(1.0);
    expect(d08, 'scaled distance <= 0.9 x unscaled').toBeLessThanOrEqual(0.9 * d10);
  }, 120000);

  it('AT5: frozen car 1 stays below 0.5 m/s for 10 s', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 2000, d: -8, v: 0 },
          { s: 100, d: 0, v: 0 },
        ],
        frozen: [1],
      },
    });
    try {
      const buf = buffers(2);
      for (let i = 0; i < steps(10); i++) {
        game.step(IDLE);
        game.getStates(buf);
        expect(Math.abs(buf[1].forwardSpeed), `car 1 speed at tick ${i}`).toBeLessThan(0.5);
      }
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT6: two AIs side by side at the same s register 1 to 5 contacts in 2 s', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), {
      ...raceConfig(2),
      scenario: {
        starts: [
          { s: 3000, d: 0, v: 0 },
          { s: 100, d: -0.5, v: 0 },
          { s: 100, d: 0.5, v: 0 },
        ],
      },
    });
    try {
      for (let i = 0; i < steps(2); i++) game.step(IDLE);
      expect(game.contactCount, 'contactCount').toBeGreaterThanOrEqual(1);
      expect(game.contactCount, 'contactCount').toBeLessThanOrEqual(5);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT7: one AI alone on track with a scenario registers no contacts in 10 s', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 3000, d: -8, v: 0 },
          { s: 100, d: 2, v: 0 },
        ],
      },
    });
    try {
      for (let i = 0; i < steps(10); i++) game.step(IDLE);
      expect(game.contactCount, 'contactCount').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT8: without a scenario, create + 3 s matches master behaviour', async () => {
    // Golden states captured from the unmodified implementation (aiCount 1, seed 1, IDLE, 3 s).
    // Positions are Rapier f32: Math.fround rebuilds the exact stored value.
    const golden = [
      { x: Math.fround(-591.92), y: Math.fround(0.312702), z: Math.fround(306.6838), forwardSpeed: 0.000012371108 },
      { x: Math.fround(-585.07623), y: Math.fround(0.3075749), z: Math.fround(299.3917), forwardSpeed: 0.000038942327 },
    ];
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      const buf = buffers(2);
      for (let i = 0; i < steps(3); i++) game.step(IDLE);
      game.getStates(buf);
      expect(game.startLights(), 'start sequence still running').toBe(2);
      for (let i = 0; i < 2; i++) {
        expect(Math.abs(buf[i].position.x - golden[i].x), `car ${i} x`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(buf[i].position.y - golden[i].y), `car ${i} y`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(buf[i].position.z - golden[i].z), `car ${i} z`).toBeLessThanOrEqual(1e-9);
        expect(
          Math.abs(buf[i].forwardSpeed - golden[i].forwardSpeed),
          `car ${i} forwardSpeed`,
        ).toBeLessThanOrEqual(1e-9);
      }
    } finally {
      game.dispose();
    }
  }, 120000);
});
