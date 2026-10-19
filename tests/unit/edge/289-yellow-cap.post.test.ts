import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { yellowCap, YELLOW_FOLLOW_MIN_MS } from '../../../src/race/yellowCap';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function overtakeEntries(game: RaceGame, car: number): ReturnType<RaceGame['penalties']['entries']> {
  return game.penalties.entries().filter((e) => e.car === car && e.reason === 'yellow flag overtake');
}

function sector1Flag(game: RaceGame): string {
  return (game as unknown as { flags: { sectorFlag(s: number): string } }).flags.sectorFlag(1);
}

describe('289 yellow cap post gaps', () => {
  it('POST1: an empty field yields NaN', () => {
    expect(Number.isNaN(yellowCap(0, [], [], [], 1000))).toBe(true);
  });

  it('POST2: a negative-speed candidate is never eligible', () => {
    expect(Number.isNaN(yellowCap(0, [100, 110], [30, -3], [0, 0], 1000))).toBe(true);
    expect(Number.isNaN(yellowCap(0, [100, 110], [30, Number.NEGATIVE_INFINITY], [0, 0], 1000))).toBe(
      true,
    );
  });

  it('POST3: any non-zero out value makes the car ineligible', () => {
    expect(Number.isNaN(yellowCap(0, [100, 110], [30, 20], [0, 2], 1000))).toBe(true);
    expect(yellowCap(0, [100, 110, 125], [30, 2, 12], [0, 2, 0], 1000)).toBe(12);
  });

  it('POST4: the queried index need not be 0', () => {
    expect(yellowCap(1, [90, 100, 120], [20, 30, 10], [0, 0, 0], 1000)).toBe(10);
  });

  it('POST5: negative lap distances wrap the same way', () => {
    expect(yellowCap(0, [-10, 10], [30, 8], [0, 0], 1000)).toBe(8);
  });

  it(
    'POST6: passing a slow rolling car (below the follow min, not stopped) under yellow books no penalty',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), {
        ...raceConfig(1),
        scenario: {
          starts: [
            { s: 0, d: 0, v: 0 },
            { s: 40, d: 0, v: YELLOW_FOLLOW_MIN_MS - 1 },
          ],
          frozen: [1],
        },
      });
      try {
        for (let i = 0; i < steps(8); i++) game.step(FULL);
        const rows = game.standings();
        expect(
          rows.find((r) => r.car === 0)!.distance,
          'the player did pass the slow car',
        ).toBeGreaterThan(rows.find((r) => r.car === 1)!.distance);
        expect(sector1Flag(game), 'the slow car keeps its sector yellow').not.toBe('green');
        expect(overtakeEntries(game, 0), 'no yellow-overtake booking for a slow pass').toHaveLength(0);
      } finally {
        game.dispose();
      }
    },
    120000,
  );

  it(
    'POST7: passing a moving car (>= follow min) under yellow still books the 5 s penalty',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), {
        ...raceConfig(2),
        scenario: {
          starts: [
            { s: 0, d: 0, v: 0 },
            { s: 10, d: 0, v: 10 },
            { s: 600, d: 0, v: 0 },
          ],
          speedScales: [1, 0.5, 1],
          frozen: [2],
        },
      });
      try {
        let found = false;
        for (let i = 0; i < steps(20) && !found; i++) {
          game.step(FULL);
          found = overtakeEntries(game, 0).length > 0;
        }
        const entries = overtakeEntries(game, 0);
        expect(entries.length, 'the moving pass under yellow is booked').toBeGreaterThan(0);
        expect(entries[0].seconds).toBe(5);
      } finally {
        game.dispose();
      }
    },
    180000,
  );

  it(
    'POST8: the booking filter is not evaluated on green — a plain overtake books nothing',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), {
        ...raceConfig(1),
        scenario: {
          starts: [
            { s: 0, d: 0, v: 0 },
            { s: 10, d: 0, v: 6 },
          ],
          speedScales: [1, 0.15],
        },
      });
      try {
        for (let i = 0; i < steps(8); i++) game.step(FULL);
        const rows = game.standings();
        expect(
          rows.find((r) => r.car === 0)!.distance,
          'the player did pass the AI',
        ).toBeGreaterThan(rows.find((r) => r.car === 1)!.distance);
        expect(sector1Flag(game), 'no yellow was raised').toBe('green');
        expect(overtakeEntries(game, 0), 'a green-flag pass books nothing').toHaveLength(0);
      } finally {
        game.dispose();
      }
    },
    180000,
  );
});
