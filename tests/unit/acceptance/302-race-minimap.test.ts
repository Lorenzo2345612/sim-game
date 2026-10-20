import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { splitSectors, sectorStyle } from '../../../src/ui/minimap';

const ROOT = join(__dirname, '..', '..', '..');
const TICKS_PER_S = 120;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(): RaceConfig {
  return { trackId: 'cleveland', carId: 'f4', laps: 3, aiCount: 5, difficulty: 'expert', seed: 1 };
}

const SQ: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const TOL = 1e-3;

type MapOut = { x: number; z: number; stopped: boolean };

function goTimeOf(game: RaceGame): number | null {
  return (game as unknown as { start: { goTime: number | null } }).start.goTime;
}

function playerPosition(game: RaceGame): { x: number; z: number } {
  const p = (game as unknown as { current: { position: { x: number; z: number } }[] }).current[0]
    .position;
  return { x: p.x, z: p.z };
}

function polyLength(poly: readonly [number, number][]): number {
  let len = 0;
  for (let i = 1; i < poly.length; i++) {
    len += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  }
  return len;
}

function expectPoint(p: readonly [number, number], expected: readonly [number, number]): void {
  expect(Math.abs(p[0] - expected[0])).toBeLessThanOrEqual(TOL);
  expect(Math.abs(p[1] - expected[1])).toBeLessThanOrEqual(TOL);
}

describe('302 race minimap acceptance', () => {
  it('AT1: splitSectors cuts the 400 m square into three 133.333 m polylines', () => {
    const s = splitSectors(SQ, [1 / 3, 2 / 3]);
    expect(s).toHaveLength(3);
    expect(s[0]).toHaveLength(3);
    expectPoint(s[0][0], [0, 0]);
    expectPoint(s[0][1], [100, 0]);
    expectPoint(s[0][2], [100, 33.333]);
    expectPoint(s[1][0], [100, 33.333]);
    expectPoint(s[1][s[1].length - 1], [33.333, 100]);
    expectPoint(s[2][0], [33.333, 100]);
    expectPoint(s[2][s[2].length - 1], [0, 0]);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(polyLength(s[i]) - 133.333)).toBeLessThanOrEqual(TOL);
    }
  });

  it('AT2: sectorStyle maps flags to colours, widths and the blinking yellow', () => {
    expect(sectorStyle('green', 0)).toEqual({ color: '#e8edf3', width: 5 });
    expect(sectorStyle('yellow', 0)).toEqual({ color: '#ffd400', width: 9 });
    expect(sectorStyle('yellow', 0.3)).toEqual({ color: '#a08600', width: 9 });
    expect(sectorStyle('yellow', 0.5).color).toBe('#ffd400');
    expect(sectorStyle('double-yellow', 0)).toEqual({ color: '#ffd400', width: 12 });
  });

  it('AT3: before go carMapState reports no stopped cars and the player position', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
    try {
      for (let k = 0; k < TICKS_PER_S; k++) game.step(BRAKE);
      expect(game.raceElapsed).toBeLessThan(0);
      const pos = playerPosition(game);
      const out: MapOut = { x: 0, z: 0, stopped: false };
      for (let i = 0; i <= 5; i++) {
        game.carMapState(i, out);
        expect(out.stopped, `car ${i} before go`).toBe(false);
        if (i === 0) {
          expect(Math.abs(out.x - pos.x)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(out.z - pos.z)).toBeLessThanOrEqual(1e-6);
        }
      }
    } finally {
      game.dispose();
    }
  }, 300000);

  it('AT4: 10 s after go the braked player is stopped and at least 3 AI are not', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
    try {
      for (let i = 0; i < Math.round(12 * TICKS_PER_S) && goTimeOf(game) === null; i++) {
        game.step(BRAKE);
      }
      const go = goTimeOf(game);
      expect(go).not.toBeNull();
      while (game.simTime - (go as number) < 10) game.step(BRAKE);
      const out: MapOut = { x: 0, z: 0, stopped: false };
      game.carMapState(0, out);
      expect(out.stopped).toBe(true);
      let running = 0;
      for (let i = 1; i <= 5; i++) {
        game.carMapState(i, out);
        if (!out.stopped) running++;
      }
      expect(running).toBeGreaterThanOrEqual(3);
    } finally {
      game.dispose();
    }
  }, 300000);
});
