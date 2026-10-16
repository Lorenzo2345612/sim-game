import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { Game } from '../../../src/game/game';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import * as tyreState from '../../../src/physics/tyreState';
import { parseTrackData } from '../../../src/track/parseTrackData';

// Task 214 lands src/track/trackConditions.ts, adds the optional ambientC param to
// updateTyreState and Game.trackConditions; typed locally so this test-first file
// type-checks until the code lands (the 162/099 pattern).
const TRACK_CONDITIONS_MODULE = '../../../src/track/trackConditions';

interface TrackConditions {
  abrasion: number;
  trackTempC: number;
}

interface TrackConditionsModule {
  DEFAULT_TRACK_CONDITIONS: TrackConditions;
  TRACK_CONDITIONS: Record<string, TrackConditions>;
  conditionsFor: (id: string) => TrackConditions;
  trackWearMult: (c: TrackConditions) => number;
}

type UpdateTyreState = (
  s: tyreState.TyreState,
  c: TyreCompound,
  slipPower: number,
  speed: number,
  dt: number,
  wearMult: number,
  pressureKpa: number,
  optPressureKpa: number,
  ambientC?: number,
) => void;

async function loadTrackConditions(): Promise<TrackConditionsModule> {
  return (await import(TRACK_CONDITIONS_MODULE)) as TrackConditionsModule;
}

const { newTyreState } = tyreState;
const updateTyreState = (
  tyreState as unknown as { updateTyreState: UpdateTyreState }
).updateTyreState;

const trackConditionsOf = (game: Game): TrackConditions =>
  (game as unknown as { trackConditions: () => TrackConditions }).trackConditions();

const ROOT = join(__dirname, '..', '..', '..');

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
}

const SPEC = parseCarSpec(readJson('public/cars/f4.json'));
const MEDIUM = SPEC.tyres.compounds.medium;

const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const SCRIPT_2: DriverInput = { throttle: 0.6, brake: 0, steer: 0.3, reset: false };
const steps = (seconds: number): number => Math.round(seconds / FIXED_DT);

/** Elkhart + f4 with track.id overridden; runs the task-214 scripted input. */
async function scriptedGame(id: string): Promise<Game> {
  const track = parseTrackData(readJson('public/tracks/elkhart.json'));
  track.id = id;
  const game = await Game.create(track, SPEC);
  for (let i = 0; i < steps(6); i++) game.step(FULL);
  for (let i = 0; i < steps(6); i++) game.step(SCRIPT_2);
  return game;
}

describe('214 track conditions acceptance', () => {
  it('AT1: conditionsFor returns bahrain 1.5/30, lasvegas 0.7/15, sepang 1.3/50 and a fresh default copy for an unknown id', async () => {
    const { conditionsFor, DEFAULT_TRACK_CONDITIONS } = await loadTrackConditions();
    expect(conditionsFor('bahrain')).toEqual({ abrasion: 1.5, trackTempC: 30 });
    expect(conditionsFor('lasvegas')).toEqual({ abrasion: 0.7, trackTempC: 15 });
    expect(conditionsFor('sepang')).toEqual({ abrasion: 1.3, trackTempC: 50 });
    const unknown = conditionsFor('nope');
    expect(unknown).toEqual({ abrasion: 1, trackTempC: 30 });
    unknown.abrasion = 99;
    unknown.trackTempC = 999;
    expect(DEFAULT_TRACK_CONDITIONS).toEqual({ abrasion: 1, trackTempC: 30 });
  });

  it('AT2: every id in public/tracks/index.json has conditions with abrasion in [0.6, 1.6] and trackTempC in [10, 55]', async () => {
    const { TRACK_CONDITIONS } = await loadTrackConditions();
    const entries = readJson('public/tracks/index.json') as Array<{ id: string }>;
    for (const entry of entries) {
      const c = TRACK_CONDITIONS[entry.id];
      expect(c, entry.id).toBeDefined();
      if (!c) continue;
      expect(c.abrasion, entry.id).toBeGreaterThanOrEqual(0.6);
      expect(c.abrasion, entry.id).toBeLessThanOrEqual(1.6);
      expect(c.trackTempC, entry.id).toBeGreaterThanOrEqual(10);
      expect(c.trackTempC, entry.id).toBeLessThanOrEqual(55);
    }
  });

  it('AT3: trackWearMult equals abrasion × clamped 1 + 0.015 × (trackTempC − 30) on the seven spec cases', async () => {
    const { trackWearMult } = await loadTrackConditions();
    const cases: Array<{ c: TrackConditions; expected: number }> = [
      { c: { abrasion: 1, trackTempC: 30 }, expected: 1 },
      { c: { abrasion: 1.5, trackTempC: 30 }, expected: 1.5 },
      { c: { abrasion: 1, trackTempC: 50 }, expected: 1.3 },
      { c: { abrasion: 1, trackTempC: 10 }, expected: 0.7 },
      { c: { abrasion: 0.7, trackTempC: 15 }, expected: 0.5425 },
      { c: { abrasion: 1, trackTempC: 90 }, expected: 1.5 },
      { c: { abrasion: 1, trackTempC: -40 }, expected: 0.7 },
    ];
    for (const { c, expected } of cases) {
      expect(Math.abs(trackWearMult(c) - expected), JSON.stringify(c)).toBeLessThanOrEqual(
        1e-12,
      );
    }
  });

  it('AT4: cooling uses ambientC — omitted and 25 °C give 90 − coolCoef×65, 50 °C gives 90 − coolCoef×40', () => {
    const cooled = (ambientC?: number): number => {
      const s = newTyreState();
      s.tempC = 90;
      s.wear = 0;
      if (ambientC === undefined) updateTyreState(s, MEDIUM, 0, 0, 1, 1, 140, 140);
      else updateTyreState(s, MEDIUM, 0, 0, 1, 1, 140, 140, ambientC);
      return s.tempC;
    };
    const omitted = cooled();
    const at25 = cooled(25);
    const at50 = cooled(50);
    expect(Math.abs(omitted - (90 - MEDIUM.coolCoef * 65))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at25 - (90 - MEDIUM.coolCoef * 65))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(omitted - at25)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at50 - (90 - MEDIUM.coolCoef * 40))).toBeLessThanOrEqual(1e-9);
  });

  it(
    'AT5: after the script bahrain wear is 1.5× unknown-x per wheel and trackConditions reports {1.5,30} and {1,30}',
    async () => {
      const bahrain = await scriptedGame('bahrain');
      const unknown = await scriptedGame('unknown-x');
      try {
        expect(trackConditionsOf(bahrain)).toEqual({ abrasion: 1.5, trackTempC: 30 });
        expect(trackConditionsOf(unknown)).toEqual({ abrasion: 1, trackTempC: 30 });
        const bw = bahrain.getTelemetry().wheels;
        const uw = unknown.getTelemetry().wheels;
        for (let i = 0; i < 4; i++) {
          const ratio = bw[i].wear / uw[i].wear;
          expect(
            Math.abs(ratio / 1.5 - 1),
            `wheel ${i}: ${bw[i].wear} / ${uw[i].wear}`,
          ).toBeLessThanOrEqual(1e-3);
        }
      } finally {
        bahrain.dispose();
        unknown.dispose();
      }
    },
    120000,
  );

  it(
    'AT6: after the same script sepang mean tyre temp over 4 wheels is at least 0.5 °C above unknown-x',
    async () => {
      const sepang = await scriptedGame('sepang');
      const unknown = await scriptedGame('unknown-x');
      try {
        const meanTemp = (g: Game): number => {
          const ws = g.getTelemetry().wheels;
          return ws.reduce((sum, w) => sum + w.tempC, 0) / ws.length;
        };
        expect(meanTemp(sepang)).toBeGreaterThanOrEqual(meanTemp(unknown) + 0.5);
      } finally {
        sepang.dispose();
        unknown.dispose();
      }
    },
    120000,
  );
});
