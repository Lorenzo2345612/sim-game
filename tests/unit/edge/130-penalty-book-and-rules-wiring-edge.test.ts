import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { PenaltyBook } from '../../../src/race/penalties';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { Results } from '../../../src/ui/results';

const ROOT = join(__dirname, '..', '..', '..');

class FakeEl {
  private readonly cls = new Set<string>();
  id = '';
  textContent: string | null = null;
  children: FakeEl[] = [];
  style: Record<string, string> = { display: '' };
  readonly classList = {
    add: (c: string): void => void this.cls.add(c),
    remove: (c: string): void => void this.cls.delete(c),
    contains: (c: string): boolean => this.cls.has(c),
  };
  constructor(public ownerDocument: FakeDoc) {}
  get className(): string {
    return [...this.cls].join(' ');
  }
  set className(v: string) {
    this.cls.clear();
    for (const c of v.split(/\s+/).filter(Boolean)) this.cls.add(c);
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [];
    for (const c of cs) this.appendChild(c);
  }
  addEventListener(): void {}
}

class FakeDoc {
  createElement(): FakeEl {
    return new FakeEl(this);
  }
}

function walk(e: FakeEl): FakeEl[] {
  return [e, ...e.children.flatMap(walk)];
}
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
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

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function stepUntilGo(game: RaceGame, input: DriverInput, maxTicks = steps(12)): boolean {
  let prev = game.startLights();
  for (let i = 0; i < maxTicks; i++) {
    game.step(input);
    const lights = game.startLights();
    if (prev > 0 && lights === 0) return true;
    prev = lights;
  }
  return false;
}

function penaltyOf(game: RaceGame, car: number): number {
  return game.standings().find((s) => s.car === car)?.penalty ?? 0;
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('130 penalty book and rules wiring edge', () => {
  it('EDGE1: warnings store seconds 0 and never count into totals; totals are per car', () => {
    const book = new PenaltyBook(3);
    book.add(0, 'warning', 5, 'track limits', 1);
    book.add(0, 'warning', 0, 'track limits', 2);
    book.add(0, 'penalty', 5, 'track limits', 3);
    book.add(1, 'penalty', 3, 'jump start', 4);
    book.add(2, 'penalty', 5, 'VSC delta', 5);
    book.add(2, 'warning', 0, 'yellow flag overtake', 6);
    book.add(2, 'penalty', 5, 'yellow flag overtake', 7);
    expect(book.forCar(0)[0].seconds, 'warning stored with 0 s').toBe(0);
    expect(book.total(0)).toBe(5);
    expect(book.total(1)).toBe(3);
    expect(book.total(2)).toBe(10);
    expect(book.entries()).toHaveLength(7);
  });

  it('EDGE2: entries keep insertion order and forCar keeps the per-car order', () => {
    const book = new PenaltyBook(2);
    book.add(1, 'penalty', 5, 'jump start', 12);
    book.add(0, 'warning', 0, 'track limits', 10);
    book.add(1, 'penalty', 5, 'VSC delta', 11);
    expect(book.entries().map((e) => e.car)).toEqual([1, 0, 1]);
    expect(book.entries().map((e) => e.time), 'insertion order, not time order').toEqual([12, 10, 11]);
    expect(book.entries().map((e) => e.time), 'repeated reads stay stable').toEqual([12, 10, 11]);
    expect(book.forCar(0).map((e) => e.reason)).toEqual(['track limits']);
    expect(book.forCar(1).map((e) => e.reason)).toEqual(['jump start', 'VSC delta']);
    expect(book.total(0), 'a warnings-only history sums to 0').toBe(0);
    expect(new PenaltyBook(2).entries()).toEqual([]);
    expect(new PenaltyBook(2).forCar(1)).toEqual([]);
  });

  it('EDGE3: a car out of range throws RangeError from add, total and forCar', () => {
    const book = new PenaltyBook(2);
    expect(() => book.add(-1, 'warning', 0, 'track limits', 0)).toThrow(RangeError);
    expect(() => book.add(2, 'warning', 0, 'track limits', 0)).toThrow(RangeError);
    expect(() => book.add(0.5, 'warning', 0, 'track limits', 0)).toThrow(RangeError);
    expect(() => book.total(2)).toThrow(RangeError);
    expect(() => book.total(-1)).toThrow(RangeError);
    expect(() => book.forCar(2)).toThrow(RangeError);
    expect(() => book.forCar(1.5)).toThrow(RangeError);
    expect(book.entries(), 'failed adds store nothing').toEqual([]);
  });

  it('EDGE4: a jump start books one 5 s jump start entry and feeds the classification', async () => {
    const spec = loadSpec();
    spec.brakes.maxTorque = 0;
    const game = await RaceGame.create(loadTrack(), spec, raceConfig(0));
    try {
      for (let i = 0; i < steps(3); i++) game.step(FULL);
      const entries = game.penalties.entries().filter((e) => e.car === 0);
      expect(entries, 'penalised once despite moving all 3 s').toHaveLength(1);
      expect(entries[0].kind).toBe('penalty');
      expect(entries[0].seconds).toBe(5);
      expect(entries[0].reason).toBe('jump start');
      expect(entries[0].time).toBeGreaterThanOrEqual(0);
      expect(entries[0].time).toBeLessThan(3);
      expect(game.penalties.total(0)).toBe(5);
      expect(penaltyOf(game, 0), 'the book feeds classification.addPenalty').toBe(5);
      expect(game.penalties.entries().filter((e) => e.car !== 0), 'no other car').toEqual([]);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE5: debugForceTrackLimits books 3 warnings and one 5 s track limits penalty for that car only', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE), 'go reached').toBe(true);
      game.debugForceTrackLimits(1, 0);
      for (let i = 0; i < 2; i++) game.step(IDLE);
      expect(game.penalties.entries(), 'count 0 strikes nothing').toEqual([]);
      game.debugForceTrackLimits(1, 4);
      for (let i = 0; i < 2; i++) game.step(IDLE);
      const entries = game.penalties.entries();
      expect(entries).toHaveLength(4);
      expect(entries.map((e) => `${e.car}:${e.kind}:${e.reason}`)).toEqual([
        '1:warning:track limits',
        '1:warning:track limits',
        '1:warning:track limits',
        '1:penalty:track limits',
      ]);
      expect(entries[3].seconds).toBe(5);
      expect(game.penalties.total(1)).toBe(5);
      expect(penaltyOf(game, 1), 'the penalty feeds classification').toBe(5);
      expect(game.penalties.total(0), 'the player is untouched').toBe(0);
      expect(penaltyOf(game, 0)).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE6: debugStopCar holds the AI stopped and exempts it from the stuck respawn', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      game.debugStopCar(1);
      expect(stepUntilGo(game, IDLE), 'go reached').toBe(true);
      const buf = buffers(game.carCount);
      game.getStates(buf);
      const atGo = { x: buf[1].position.x, z: buf[1].position.z };
      let prev = atGo;
      let maxMove = 0;
      for (let i = 0; i < steps(14); i++) {
        game.step(IDLE);
        game.getStates(buf);
        expect(Math.abs(buf[1].forwardSpeed), 'stays stopped').toBeLessThan(1);
        const p = { x: buf[1].position.x, z: buf[1].position.z };
        maxMove = Math.max(maxMove, horiz(p, prev));
        prev = p;
      }
      expect(maxMove, 'no snap back to the centerline (exempt from stuck respawn)').toBeLessThan(1);
      expect(horiz(prev, atGo), 'held in place').toBeLessThan(2);
      expect(game.penalties.total(1), 'a stationary car draws no penalty').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE7: passing a stopped car under yellow books no penalty', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE), 'go reached').toBe(true);
      for (let i = 0; i < steps(3.5); i++) game.step(IDLE);
      game.debugStopCar(1);
      for (let i = 0; i < steps(1.5); i++) game.step(IDLE);
      for (let i = 0; i < steps(7); i++) game.step(FULL);
      expect(
        game.penalties.entries().filter((e) => e.car === 0 && e.reason === 'yellow flag overtake'),
      ).toHaveLength(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE8: the results penalty cell shows total seconds with joined reasons, or a dash', () => {
    const doc = new FakeDoc();
    const parent = new FakeEl(doc);
    const results = new Results(parent as unknown as HTMLElement);
    results.show(
      [
        { position: 1, name: 'You', totalTime: 61.2, bestLap: 60.5, penalty: 10, penaltyReasons: ['track limits', 'jump start'] },
        { position: 2, name: 'Bot', totalTime: 62, bestLap: 61, penalty: 0 },
        { position: 3, name: 'Mid', totalTime: 63, bestLap: 62, penalty: 5, penaltyReasons: ['track limits'] },
      ],
      { onRestart: () => {}, onMenu: () => {} },
    );
    const cell = (name: string): FakeEl => {
      const row = walk(parent).find((e) => e.children.length >= 5 && e.children[1].textContent === name);
      if (!row) throw new Error(`no row ${name}`);
      return row.children[4];
    };
    expect(cell('You').textContent).toBe('10 s (track limits, jump start)');
    expect(cell('Mid').textContent).toBe('5 s (track limits)');
    expect(cell('Bot').textContent, 'no penalties shows a dash').toBe('-');
    expect(cell('You').className, 'the .penalty cell').toContain('penalty');
  });
});
