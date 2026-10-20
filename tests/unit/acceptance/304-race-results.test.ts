import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { RaceClassification } from '../../../src/race/classification';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { formatLapTime } from '../../../src/ui/formatTime';
import { Results, type ResultsRow } from '../../../src/ui/results';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const HANDLERS = { onRestart: () => {}, onMenu: () => {} };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

class FakeEl {
  private readonly cls = new Set<string>();
  id = '';
  textContent: string | null = null;
  title = '';
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
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
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(...cs: FakeEl[]): void {
    for (const c of this.children) c.parent = null;
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

function makeResults(): { results: Results; parent: FakeEl } {
  const parent = new FakeEl(new FakeDoc());
  return { results: new Results(parent as unknown as HTMLElement), parent };
}

function bodyRows(parent: FakeEl): FakeEl[] {
  return walk(parent).filter(
    (e) => e.children.length === 5 && /^\d+$/.test(e.children[0].textContent ?? ''),
  );
}

function row(position: number, name: string, patch: Partial<ResultsRow>): ResultsRow {
  return { position, name, totalTime: null, bestLap: null, penalty: 0, status: 'running', ...patch };
}

describe('304 race results acceptance', () => {
  it('AT1: finished time cell includes the penalty', () => {
    const { results, parent } = makeResults();
    results.show(
      [
        row(1, 'You', {
          totalTime: 600,
          bestLap: 95,
          penalty: 5,
          penaltyReasons: ['track limits'],
          status: 'finished',
        }),
      ],
      HANDLERS,
    );
    const r = bodyRows(parent)[0];
    expect(r.children[2].textContent).toBe(formatLapTime(605));
    expect(r.children[4].textContent).toBe('5 s (track limits)');
  });

  it("AT2: running and dnf rows show 'Running' and 'DNF'", () => {
    const { results, parent } = makeResults();
    results.show(
      [row(1, 'A', { status: 'running' }), row(2, 'B', { status: 'dnf' })],
      HANDLERS,
    );
    const rows = bodyRows(parent);
    expect(rows[0].children[2].textContent).toBe('Running');
    expect(rows[1].children[2].textContent).toBe('DNF');
  });

  it('AT3: update replaces the table body and keeps the action buttons', () => {
    const { results, parent } = makeResults();
    results.show(
      [row(1, 'You', { totalTime: 600, bestLap: 95, penalty: 5, status: 'finished' })],
      HANDLERS,
    );
    const actions = walk(parent).find((e) => e.classList.contains('results-actions'))!;
    const before = [...actions.children];
    expect(before.length).toBeGreaterThan(0);
    results.update([row(1, 'You', { totalTime: 600, status: 'finished' }), row(2, 'Bot', { status: 'running' })]);
    expect(bodyRows(parent)).toHaveLength(2);
    const after = walk(parent).find((e) => e.classList.contains('results-actions'))!.children;
    expect(after).toHaveLength(before.length);
    after.forEach((b, i) => expect(b).toBe(before[i]));
  });

  it('AT4: a 5 s penalty drops the earlier finisher behind a car 3 s slower', () => {
    const c = new RaceClassification(2, 1, 1000);
    for (const car of [0, 1]) {
      c.update(car, 950, 9);
      c.update(car, 50, 11);
      c.update(car, 500, 300);
    }
    c.update(0, 950, 599);
    c.update(0, 50, 601);
    c.update(1, 950, 602);
    c.update(1, 50, 604);
    c.addPenalty(0, 5);
    const s = c.standings();
    const p = (car: number): number => s.find((x) => x.car === car)!.position;
    expect(s.find((x) => x.car === 0)!.finished).toBe(true);
    expect(s.find((x) => x.car === 1)!.finished).toBe(true);
    expect(p(1)).toBe(1);
    expect(p(0)).toBe(2);
  });
});

async function makeGame(aiCount = 3): Promise<RaceGame> {
  const track = parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
  const spec = parseCarSpec(readJson('public/cars/f4.json'));
  const cfg: RaceConfig = {
    trackId: 'cleveland',
    carId: 'f4',
    laps: 1,
    aiCount,
    difficulty: 'expert',
    seed: 1,
  };
  return RaceGame.create(track, spec, cfg);
}

function carDone(game: RaceGame, car: number): boolean {
  return game.standings().find((s) => s.car === car)!.finished;
}

function stepUntil(game: RaceGame, cond: () => boolean, capS: number): boolean {
  for (let i = 0; i < capS / DT; i++) {
    if (cond()) return true;
    game.step(BRAKE);
  }
  return cond();
}

describe('304 race results acceptance (sim)', () => {
  it('AT5: autopilot finishes the race for the player and the race ends with every car finished or retired', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      expect(stepUntil(game, () => carDone(game, 0), 400)).toBe(true);
      expect(stepUntil(game, () => game.raceFinished, 200)).toBe(true);
      for (const s of game.standings()) expect(s.finished || game.isRetired(s.car)).toBe(true);
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT6: autopilot stays on after finishing even if switched off', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      expect(stepUntil(game, () => carDone(game, 0), 400)).toBe(true);
      game.setPlayerAutopilot(false);
      const d0 = game.standings().find((s) => s.car === 0)!.distance;
      for (let i = 0; i < 30 / DT; i++) game.step(BRAKE);
      const d1 = game.standings().find((s) => s.car === 0)!.distance;
      expect(d1 - d0).toBeGreaterThan(300);
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT7: isRetired is true only for the stopped car', async () => {
    const game = await makeGame();
    try {
      game.debugStopCar(2);
      expect(game.isRetired(2)).toBe(true);
      expect(game.isRetired(1)).toBe(false);
    } finally {
      game.dispose();
    }
  }, 60000);
});
