import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildCorridor, corridorAt, type CorridorSample, type TrackCorridor } from '../../../src/ai/raceView';
import { computeRacingLine } from '../../../src/ai/racingLine';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { halfWidthAt } from '../../../src/track/surfaces';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { BlueFlagTimer } from '../../../src/race/blueFlagTimer';
import { FlagState, type FlagCar } from '../../../src/race/flags';
import { RaceHud, type RaceHudData } from '../../../src/ui/raceHud';

const DT = 1 / 120;
const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function corridorOf(track: TrackDataV2): TrackCorridor {
  const n = track.centerline.length;
  const hl = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'left', i));
  const hr = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'right', i));
  const line = computeRacingLine(track.centerline, track.widthMeters / 2, 2.2, undefined, hl, hr);
  return buildCorridor(track, line, new Float64Array(n));
}

function sampleAt(c: TrackCorridor, s: number): CorridorSample {
  return corridorAt(c, s, { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 });
}

interface Internals {
  traffic: { distance: number; lateral: number; speed: number }[];
  wheelsOff: Uint8Array;
}

interface Start {
  s: number;
  d: number;
  v: number;
}

interface Run {
  game: RaceGame;
  lap: number;
}

async function makeGame(
  starts: Start[],
  speedScales: number[],
  lapsAhead: number[],
  frozen: number[],
): Promise<Run> {
  const track = loadTrack();
  const cfg: RaceConfig = {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount: starts.length - 1,
    difficulty: 'expert',
    seed: 1,
    scenario: { starts, speedScales, lapsAhead, frozen },
  };
  const game = await RaceGame.create(track, loadSpec(), cfg);
  return { game, lap: corridorOf(track).lapLength };
}

function wrap(x: number, lap: number): number {
  const w = ((x % lap) + lap) % lap;
  return w > lap / 2 ? w - lap : w;
}

function priv(game: RaceGame): Internals {
  return game as unknown as Internals;
}

function car(distance: number, lapDistance: number): FlagCar {
  return { distance, lapDistance, speed: 50, offTrack: false, retired: false };
}

function trueTimes(segments: { lapper: number; gap: number; seconds: number }[]): number[] {
  const timer = new BlueFlagTimer();
  const times: number[] = [];
  let tick = 0;
  for (const seg of segments) {
    const n = Math.round(seg.seconds / DT);
    for (let i = 0; i < n; i++) {
      tick++;
      if (timer.update(seg.lapper, seg.gap, DT)) times.push(tick * DT);
    }
  }
  return times;
}

class FakeEl {
  id = '';
  className = '';
  textContent: string | null = null;
  children: FakeEl[] = [];
  style: Record<string, string> = { display: '' };
  readonly dataset: Record<string, string> = {};
  readonly classList = { add: (): void => {}, remove: (): void => {}, contains: (): boolean => false };
  constructor(public ownerDocument: FakeDoc) {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    this.children.push(...cs);
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [...cs];
  }
  remove(): void {}
  addEventListener(): void {}
}

class FakeDoc {
  body = new FakeEl(this);
  createElement(): FakeEl {
    return new FakeEl(this);
  }
}

function walk(e: FakeEl): FakeEl[] {
  return [e, ...e.children.flatMap(walk)];
}

function hudData(patch: Partial<RaceHudData>): RaceHudData {
  return {
    standings: [],
    playerCar: 0,
    laps: 3,
    flags: ['green', 'green', 'green'],
    blue: false,
    blueLapper: -1,
    vscPhase: 'off',
    vscDelta: 0,
    ...patch,
  };
}

describe('321 blue flags acceptance', () => {
  it('AT1: blueLapper finds the nearest car more than half a lap ahead within the window behind', () => {
    const fs = new FlagState([0, 1000, 2000], 3000);
    fs.update([car(1500, 1500), car(4400, 1400), car(1400, 1400)], 0);
    expect(fs.blueLapper(0)).toBe(1);
    expect(fs.blueFor(0)).toBe(true);
    expect(fs.blueLapper(1)).toBe(-1);
    expect(fs.blueLapper(2)).toBe(1);
  });

  it('AT2: the timer fires once after 10 s within 100 m of the same lapper', () => {
    const times = trueTimes([{ lapper: 1, gap: 50, seconds: 32 }]);
    expect(times).toHaveLength(1);
    expect(Math.abs(times[0] - 10)).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('AT3: a gap above 100 m pauses the count', () => {
    const times = trueTimes([
      { lapper: 1, gap: 50, seconds: 6 },
      { lapper: 1, gap: 150, seconds: 5 },
      { lapper: 1, gap: 50, seconds: 4 },
    ]);
    expect(times).toHaveLength(1);
    expect(Math.abs(times[0] - 15)).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('AT4: 3 s without a lapper resets the count and a different lapper restarts it', () => {
    const times = trueTimes([
      { lapper: 1, gap: 50, seconds: 6 },
      { lapper: -1, gap: 0, seconds: 3 },
      { lapper: 1, gap: 50, seconds: 6 },
      { lapper: 2, gap: 50, seconds: 10 },
    ]);
    expect(times).toHaveLength(1);
    expect(times[0]).toBeGreaterThan(15);
    expect(Math.abs(times[0] - 25)).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('AT8: the HUD shows the blue banner with the lapper and hides it otherwise', () => {
    const doc = new FakeDoc();
    const parent = new FakeEl(doc);
    const hud = new RaceHud(parent as unknown as HTMLElement);
    const banner = walk(parent).find((e) => e.id === 'blue-banner')!;
    hud.update(hudData({ blue: true, blueLapper: 3 }));
    expect(banner.style.display).not.toBe('none');
    expect(banner.textContent).toBe('BLUE FLAG · LET AI 3 BY');
    hud.update(hudData({ blue: false, blueLapper: -1 }));
    expect(banner.style.display).toBe('none');
  });

  it('AT5: a lapper passes a slower car in its own lane without contact or the lapped car leaving the track', async () => {
    const corridor = corridorOf(loadTrack());
    const { game, lap } = await makeGame(
      [
        { s: 1500, d: -(sampleAt(corridor, 1500).halfLeft + 8), v: 0 },
        { s: 300, d: 0, v: 50 },
        { s: 380, d: 0, v: 40 },
      ],
      [1, 1.0, 0.85],
      [0, 1, 0],
      [0],
    );
    try {
      let passed = -1;
      let sepAtClose = Number.NaN;
      let offTicks = 0;
      const ticks = Math.round(30 / DT);
      for (let i = 0; i < ticks; i++) {
        game.step(BRAKE);
        const t = priv(game).traffic;
        const gap = wrap(t[2].distance - t[1].distance, lap);
        if (Number.isNaN(sepAtClose) && gap < 5) sepAtClose = Math.abs(t[1].lateral - t[2].lateral);
        if (passed < 0 && gap <= 0) passed = (i + 1) * DT;
        if (priv(game).wheelsOff[2] >= 4) offTicks++;
      }
      expect(passed).toBeGreaterThan(0);
      expect(passed).toBeLessThan(30);
      expect(game.contactCount).toBe(0);
      expect(offTicks * DT).toBeLessThanOrEqual(0.5);
      expect(sepAtClose).toBeGreaterThanOrEqual(2.0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT6: a lapper passes two battling cars without slowing them', async () => {
    const corridor = corridorOf(loadTrack());
    const pd = -(sampleAt(corridor, 1500).halfLeft + 8);
    const seconds = 40;
    const ticks = Math.round(seconds / DT);

    const withLapper = await makeGame(
      [
        { s: 1500, d: pd, v: 0 },
        { s: 300, d: 0, v: 50 },
        { s: 380, d: 0, v: 40 },
        { s: 400, d: 0, v: 40 },
      ],
      [1, 1.0, 0.85, 0.85],
      [0, 1, 0, 0],
      [0],
    );
    const without = await makeGame(
      [
        { s: 1500, d: pd, v: 0 },
        { s: 380, d: 0, v: 40 },
        { s: 400, d: 0, v: 40 },
      ],
      [1, 0.85, 0.85],
      [0, 0, 0],
      [0],
    );
    try {
      const lap = withLapper.lap;
      let pass2 = -1;
      let pass3 = -1;
      let sumA = 0;
      let sumB = 0;
      for (let i = 0; i < ticks; i++) {
        withLapper.game.step(BRAKE);
        without.game.step(BRAKE);
        const t = priv(withLapper.game).traffic;
        const u = priv(without.game).traffic;
        if (pass2 < 0 && wrap(t[2].distance - t[1].distance, lap) <= 0) pass2 = (i + 1) * DT;
        if (pass3 < 0 && wrap(t[3].distance - t[1].distance, lap) <= 0) pass3 = (i + 1) * DT;
        sumA += t[2].speed + t[3].speed;
        sumB += u[1].speed + u[2].speed;
      }
      expect(pass2).toBeGreaterThan(0);
      expect(pass2).toBeLessThan(40);
      expect(pass3).toBeGreaterThan(0);
      expect(pass3).toBeLessThan(40);
      expect(withLapper.game.contactCount).toBe(0);
      expect(sumA / ticks / 2).toBeGreaterThanOrEqual(0.97 * (sumB / ticks / 2));
    } finally {
      withLapper.game.dispose();
      without.game.dispose();
    }
  }, 240000);

  it('AT7: a player on the line ignoring a lapper is penalised 5 s once', async () => {
    const corridor = corridorOf(loadTrack());
    const { game } = await makeGame(
      [
        { s: 600, d: sampleAt(corridor, 600).lineD, v: 0 },
        { s: 500, d: 0, v: 10 },
      ],
      [1, 0.3],
      [0, 1],
      [0],
    );
    try {
      for (let i = 0; i < Math.round(20 / DT); i++) game.step(BRAKE);
      const mine = game.penalties.forCar(0).filter((p) => (p.reason as string) === 'ignoring blue flags');
      expect(mine).toHaveLength(1);
      expect(mine[0].seconds).toBe(5);
      const ai = game.penalties.entries().filter((p) => p.car !== 0 && (p.reason as string) === 'ignoring blue flags');
      expect(ai).toHaveLength(0);
    } finally {
      game.dispose();
    }
  }, 120000);
});
