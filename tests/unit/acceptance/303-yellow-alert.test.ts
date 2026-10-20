import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { YellowAlert } from '../../../src/ui/yellowAlert';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;
const YELLOW_S2 = '⚠ YELLOW FLAG · SECTOR 2 · NO OVERTAKING';
const CLEAR_TEXT = '✓ SECTOR CLEAR · GREEN';

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function yellowUntil(a: YellowAlert, sector: number, tEnd: number): void {
  for (let t = 9; t <= tEnd + 1e-9; t += DT) a.update('yellow', sector, t);
}

describe('303 yellow alert', () => {
  it('AT1: green flag never shows an alert', () => {
    const a = new YellowAlert();
    for (let i = 0; i <= 5 * 120; i++) {
      const v = a.update('green', 1, i * DT);
      expect(v.mode).toBe('none');
      expect(v.text).toBe('');
    }
  });

  it('AT2: yellow shows banner text and flashing lights', () => {
    const a = new YellowAlert();
    const v = a.update('yellow', 2, 10);
    expect(v.mode).toBe('yellow');
    expect(v.text).toBe(YELLOW_S2);
    expect(v.lightsOn).toBe(true);
    expect(a.update('yellow', 2, 10.3).lightsOn).toBe(false);
    expect(a.update('yellow', 2, 10.5).lightsOn).toBe(true);
  });

  it('AT3: double yellow shows its banner text', () => {
    const a = new YellowAlert();
    const v = a.update('double-yellow', 3, 10);
    expect(v.mode).toBe('double');
    expect(v.text).toBe('⚠⚠ DOUBLE YELLOW · SECTOR 3 · SLOW DOWN, BE READY TO STOP');
  });

  it('AT4: clearing yellow shows sector clear for 3 s then none', () => {
    const a = new YellowAlert();
    yellowUntil(a, 2, 10);
    const v = a.update('green', 2, 10 + DT);
    expect(v.mode).toBe('clear');
    expect(v.text).toBe(CLEAR_TEXT);
    expect(v.lightsOn).toBe(false);
    let mid = v;
    for (let t = 10 + 2 * DT; t <= 12.9; t += DT) mid = a.update('green', 2, t);
    expect(mid.mode).toBe('clear');
    expect(a.update('green', 2, 13.1).mode).toBe('none');
  });

  it('AT5: leaving the yellow sector shows sector clear', () => {
    const a = new YellowAlert();
    yellowUntil(a, 2, 10);
    expect(a.update('green', 3, 10 + DT).mode).toBe('clear');
  });

  it('AT6: new yellow during clear shows yellow at once', () => {
    const a = new YellowAlert();
    yellowUntil(a, 2, 10);
    a.update('green', 2, 10 + DT);
    const v = a.update('yellow', 3, 11);
    expect(v.mode).toBe('yellow');
    expect(v.text).toContain('SECTOR 3');
  });

  it('AT7: double yellow to yellow is plain yellow', () => {
    const a = new YellowAlert();
    for (let t = 9; t <= 10 + 1e-9; t += DT) a.update('double-yellow', 2, t);
    expect(a.update('yellow', 2, 10 + DT).mode).toBe('yellow');
  });

  it('AT8: RaceGame exposes the player sector from lap distance', async () => {
    const track = parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
    const spec = parseCarSpec(readJson('public/cars/f4.json'));
    const cfg: RaceConfig = {
      trackId: 'cleveland',
      carId: 'f4',
      laps: 3,
      aiCount: 5,
      difficulty: 'expert',
      seed: 1,
    };
    const game = await RaceGame.create(track, spec, cfg);
    const priv = game as unknown as {
      lapLength: number;
      traffic: { distance: number }[];
    };
    const expected = Math.floor(priv.traffic[0].distance / (priv.lapLength / 3)) + 1;
    expect(Number.isInteger(game.playerSector)).toBe(true);
    expect(game.playerSector).toBeGreaterThanOrEqual(1);
    expect(game.playerSector).toBeLessThanOrEqual(3);
    expect(game.playerSector).toBe(expected);
  });
});
