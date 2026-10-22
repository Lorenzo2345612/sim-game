import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseSeries } from '../../../src/career/series';

const ROOT = join(__dirname, '..', '..', '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

const trackIds = (readJson('public/tracks/index.json') as { id: string }[]).map((t) => t.id);
const formatIds = (readJson('public/career/formats.json') as { formats: { id: string }[] }).formats.map(
  (f) => f.id,
);
const seriesJson = readJson('public/career/series/f4-latam.json') as Record<string, unknown>;

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(seriesJson)) as Record<string, unknown>;
}

const variants: [string, (j: Record<string, unknown>) => void][] = [
  ['1 team', (j) => { j.teams = (j.teams as unknown[]).slice(0, 1); }],
  ['duplicate team id', (j) => {
    const teams = j.teams as { id: string }[];
    teams[1] = { ...teams[1], id: teams[0].id };
  }],
  ['perf 1.01', (j) => { (j.teams as { perf: number }[])[0].perf = 1.01; }],
  ['colour red', (j) => { (j.teams as { colour: string }[])[0].colour = 'red'; }],
  ['trackId nowhere', (j) => { (j.calendar as { trackId: string }[])[0].trackId = 'nowhere'; }],
  ['0 events', (j) => { j.calendar = []; }],
  ['13 events', (j) => {
    const cal = j.calendar as unknown[];
    j.calendar = [...cal, ...cal, ...cal].slice(0, 13);
  }],
  ['format endurance', (j) => { j.formats = [...(j.formats as string[]), 'endurance']; }],
  ['formats empty', (j) => { j.formats = []; }],
];

describe('324 series data and parser acceptance', () => {
  it('AT1: f4-latam.json parses into 6 teams, the fixed calendar, formats and car', () => {
    const s = parseSeries(seriesJson, trackIds, formatIds);
    expect(s.teams.length).toBe(6);
    expect(s.teams.map((t: { perf: number }) => t.perf)).toEqual([1, 0.995, 0.99, 0.985, 0.98, 0.975]);
    expect(s.calendar.map((e: { trackId: string }) => e.trackId)).toEqual([
      'mexico',
      'braselton',
      'ermita-federal',
      'elkhart',
      'cleveland',
      'ermita-centro',
    ]);
    expect(s.formats).toEqual(['short', 'standard', 'sprint']);
    expect(s.carId).toBe('f4');
  });

  it('AT2: each invalid f4-latam variant throws an error starting with "Invalid series"', () => {
    for (const [label, mutate] of variants) {
      const json = clone();
      mutate(json);
      let err: unknown;
      try {
        parseSeries(json, trackIds, formatIds);
      } catch (e) {
        err = e;
      }
      expect(err, label).toBeInstanceOf(Error);
      expect((err as Error).message, label).toMatch(/^Invalid series/);
    }
  });
});
