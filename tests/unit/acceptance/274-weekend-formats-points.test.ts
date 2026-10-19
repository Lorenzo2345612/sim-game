import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parsePointsTable, parseWeekendFormat, pointsFor } from '../../../src/career/points';
import type { PointsTable, WeekendFormat } from '../../../src/career/types';

const ROOT = join(__dirname, '..', '..', '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

const standard10: PointsTable = {
  id: 'standard10',
  positions: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  fastestLap: { points: 1, maxPosition: 10 },
};

const sprint8: PointsTable = {
  id: 'sprint8',
  positions: [8, 7, 6, 5, 4, 3, 2, 1],
};

type KindList = { name: string; sessions: { kind: string }[] };

function validFormat(): Record<string, unknown> {
  return {
    id: 'x',
    name: 'X',
    sessions: [{ kind: 'practice', minutes: 10 }, { kind: 'race', laps: 5, points: 'standard10' }],
  };
}

describe('274 weekend formats and points acceptance', () => {
  it('AT1: standard10 pays 25 / 1 / 0 for P1 / P10 / P11 classified without fastest lap', () => {
    expect(pointsFor(standard10, 1, true, false)).toBe(25);
    expect(pointsFor(standard10, 10, true, false)).toBe(1);
    expect(pointsFor(standard10, 11, true, false)).toBe(0);
  });

  it('AT2: standard10 adds fastest lap 1 only within the table rule', () => {
    expect(pointsFor(standard10, 3, true, true)).toBe(16);
    expect(pointsFor(standard10, 1, true, true)).toBe(26);
    expect(pointsFor(standard10, 11, true, true)).toBe(0);
  });

  it('AT3: unclassified driver scores 0 even with fastest lap', () => {
    expect(pointsFor(standard10, 5, false, true)).toBe(0);
  });

  it('AT4: sprint8 pays 1 for P8 and ignores fastest lap (no rule)', () => {
    expect(pointsFor(sprint8, 8, true, true)).toBe(1);
    expect(pointsFor(sprint8, 9, true, true)).toBe(0);
  });

  it('AT5: career JSON files parse into the three tables and three formats', () => {
    const tablesJson = readJson('public/career/points.json') as { tables: unknown[] };
    const formatsJson = readJson('public/career/formats.json') as { formats: unknown[] };
    const tables: Record<string, PointsTable> = {};
    for (const t of tablesJson.tables) {
      const p = parsePointsTable(t);
      tables[p.id] = p;
    }
    expect(Object.keys(tables).sort()).toEqual(['sprint8', 'standard10']);
    expect(tables.standard10.positions).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
    expect(tables.standard10.fastestLap).toEqual({ points: 1, maxPosition: 10 });
    expect(tables.sprint8.positions).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(tables.sprint8.fastestLap).toBeUndefined();

    const formats = new Map<string, WeekendFormat>();
    for (const f of formatsJson.formats) {
      const w = parseWeekendFormat(f, tables);
      formats.set(w.id, w);
    }
    expect([...formats.keys()].sort()).toEqual(['short', 'sprint', 'standard']);

    const short = formats.get('short') as KindList;
    expect(short.name).toBe('Short');
    expect(short.sessions.map((s) => s.kind)).toEqual(['qualifying', 'race']);
    expect(short.sessions[0]).toMatchObject({ minutes: 10 });
    expect(short.sessions[1]).toMatchObject({ laps: 5, points: 'standard10', grid: 'qualifying' });

    const standard = formats.get('standard') as KindList;
    expect(standard.name).toBe('Standard');
    expect(standard.sessions.map((s) => s.kind)).toEqual(['practice', 'qualifying', 'race']);
    expect(standard.sessions[0]).toMatchObject({ minutes: 20 });
    expect(standard.sessions[1]).toMatchObject({ minutes: 15 });
    expect(standard.sessions[2]).toMatchObject({ laps: 10, points: 'standard10', grid: 'qualifying' });

    const sprint = formats.get('sprint') as KindList;
    expect(sprint.name).toBe('Sprint');
    expect(sprint.sessions.map((s) => s.kind)).toEqual(['practice', 'qualifying', 'sprint', 'race']);
    expect(sprint.sessions[0]).toMatchObject({ minutes: 20 });
    expect(sprint.sessions[1]).toMatchObject({ minutes: 15, polePoints: 2 });
    expect(sprint.sessions[2]).toMatchObject({ laps: 6, points: 'sprint8', grid: 'reverse-top8' });
    expect(sprint.sessions[3]).toMatchObject({ laps: 10, points: 'standard10', grid: 'qualifying' });
  });

  it('AT6: invalid weekend format variants throw Invalid weekend format', () => {
    const tables = { standard10 };
    const cases: Record<string, unknown>[] = [
      { ...validFormat(), sessions: [] },
      { ...validFormat(), sessions: [{ kind: 'warmup', minutes: 10 }, { kind: 'race', laps: 5, points: 'standard10' }] },
      { ...validFormat(), sessions: [{ kind: 'practice', minutes: 10 }, { kind: 'race', laps: 5, points: 'nope' }] },
      { ...validFormat(), sessions: [{ kind: 'qualifying', laps: 5 }, { kind: 'race', laps: 5, points: 'standard10' }] },
      { ...validFormat(), sessions: [{ kind: 'practice', minutes: 10 }, { kind: 'race', points: 'standard10' }] },
      { ...validFormat(), sessions: [{ kind: 'practice', minutes: 10 }, { kind: 'race', laps: 5, points: 'standard10', polePoints: 1 }] },
    ];
    for (const c of cases) {
      expect(() => parseWeekendFormat(c, tables)).toThrowError(/^Invalid weekend format/);
    }
  });

  it('AT7: invalid points table variants throw Invalid points table', () => {
    const cases: Record<string, unknown>[] = [
      { id: 'a', positions: [10, 12] },
      { id: 'a', positions: [5, -1] },
      { positions: [10] },
    ];
    for (const c of cases) {
      expect(() => parsePointsTable(c)).toThrowError(/^Invalid points table/);
    }
  });
});
