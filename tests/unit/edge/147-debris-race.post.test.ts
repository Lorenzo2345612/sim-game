import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
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

function config(): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 0, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

describe('147 debris race-game wiring', () => {
  let game: RaceGame;

  beforeAll(async () => {
    await initPhysics();
    game = await RaceGame.create(loadTrack(), loadSpec(), config());
  });

  afterAll(() => {
    game.dispose();
  });

  it(
    'POSTR1: a front wing crossing 0.95 does not spawn; above it spawns frontWing debris once',
    () => {
      const field = game.debrisField;
      expect(field.count).toBe(0);
      game.playerDamage.frontWing = 0.95;
      game.step(IDLE);
      expect(field.count).toBe(0);
      game.playerDamage.frontWing = 0.96;
      game.step(IDLE);
      expect(field.count).toBe(1);
      expect(field.getKinds()[0]).toBe('frontWing');
      for (let i = 0; i < 20; i++) game.step(IDLE);
      expect(field.count).toBe(1);
      expect(field.getKinds()[0]).toBe('frontWing');
    },
    60000,
  );

  it(
    'POSTR2: a rear wing above 0.95 spawns rearWing debris once, independent of the front wing',
    () => {
      const field = game.debrisField;
      const before = field.count;
      game.playerDamage.rearWing = 0.96;
      game.step(IDLE);
      expect(field.count).toBe(before + 1);
      expect([...field.getKinds()]).toContain('rearWing');
      for (let i = 0; i < 20; i++) game.step(IDLE);
      expect([...field.getKinds()].filter((k) => k === 'rearWing')).toHaveLength(1);
    },
    60000,
  );

  it(
    'POSTR3: a detaching wheel spawns wheel debris once and hides that car wheel',
    () => {
      const field = game.debrisField;
      const before = field.count;
      game.playerDamage.detached[2] = true;
      game.step(IDLE);
      expect(field.count).toBe(before + 1);
      expect(field.wheelHidden(0, 2)).toBe(true);
      expect(field.getKinds()[field.getKinds().length - 1]).toBe('wheel');
      for (let i = 0; i < 20; i++) game.step(IDLE);
      expect(field.count).toBe(before + 1);
      expect(field.wheelHidden(0, 2)).toBe(true);
    },
    60000,
  );

  it(
    'POSTR4: 60 s of an undamaged race creates no debris and no extra physics bodies',
    async () => {
      const clean = await RaceGame.create(loadTrack(), loadSpec(), config());
      try {
        const world = (clean as unknown as { world: RAPIER.World }).world;
        const base = world.bodies.len();
        for (let i = 0; i < steps(60); i++) clean.step(IDLE);
        expect(clean.debrisField.count).toBe(0);
        expect(clean.debrisField.getBodies()).toHaveLength(0);
        expect(world.bodies.len()).toBe(base);
        const dmg = clean.playerDamage;
        expect(dmg.frontWing).toBe(0);
        expect(dmg.rearWing).toBe(0);
        expect(dmg.detached.some((d: boolean) => d)).toBe(false);
      } finally {
        clean.dispose();
      }
    },
    180000,
  );
});
