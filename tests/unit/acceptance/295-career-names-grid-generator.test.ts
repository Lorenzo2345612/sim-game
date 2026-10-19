import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { generateGrid, shortName, seriesForTrack } from '../../../src/race/drivers';
import type { Driver, GridsFile, NameList } from '../../../src/race/drivers';

const ROOT = join(__dirname, '..', '..', '..');
const NAMES_DIR = join(ROOT, 'public', 'career', 'names');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function nameFiles(): string[] {
  return readdirSync(NAMES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'blocklist.json')
    .sort();
}

function readList(file: string): NameList {
  return JSON.parse(readFileSync(join(NAMES_DIR, file), 'utf8')) as NameList;
}

function loadLists(): Record<string, NameList> {
  const out: Record<string, NameList> = {};
  for (const f of nameFiles()) out[f.replace(/\.json$/, '')] = readList(f);
  return out;
}

const LATAM: Record<string, number> = {
  MEX: 0.45, ARG: 0.12, BRA: 0.12, COL: 0.12, ESP: 0.07, USA: 0.07,
  FRA: 0.01, ITA: 0.01, GBR: 0.01, DEU: 0.01, CAN: 0.01,
};

describe('295 career names and grid generator acceptance', () => {
  it('AT1: 16 name files match their nat and hold at least 25 unique non-empty first and last names', () => {
    const files = nameFiles();
    expect(files).toHaveLength(16);
    for (const f of files) {
      const list = readList(f);
      expect(list.nat).toBe(f.replace(/\.json$/, ''));
      const firsts = new Set(list.first.filter((s: string) => s.trim() !== ''));
      const lasts = new Set(list.last.filter((s: string) => s.trim() !== ''));
      expect(firsts.size).toBeGreaterThanOrEqual(25);
      expect(lasts.size).toBeGreaterThanOrEqual(25);
    }
  });

  it('AT2: no last name in any list is in the blocklist case- and accent-insensitively', () => {
    const block = JSON.parse(readFileSync(join(NAMES_DIR, 'blocklist.json'), 'utf8')) as string[];
    const blocked = new Set(block.map(fold));
    for (const f of nameFiles()) {
      for (const last of readList(f).last) {
        expect(blocked.has(fold(last)), `${f}: ${last}`).toBe(false);
      }
    }
  });

  it('AT3: grids.json mixes are positive and sum to 1, cover their nats, and map every real track to an existing series', () => {
    const grids = readJson('public/career/grids.json') as GridsFile;
    const lists = loadLists();
    const seriesIds = Object.keys(grids.series);
    const series = Object.values(grids.series) as { mix: Record<string, number> }[];
    for (const s of series) {
      const entries = Object.entries(s.mix);
      for (const [, w] of entries) expect(w).toBeGreaterThan(0);
      const sum = entries.reduce((acc, [, w]) => acc + w, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.01);
      for (const [nat] of entries) expect(Object.keys(lists)).toContain(nat);
    }
    const tracks = readJson('public/tracks/index.json') as { id: string }[];
    for (const t of tracks) expect(seriesIds).toContain(seriesForTrack(grids, t.id));
    expect(seriesForTrack(grids, 'unknown-track-id-295')).toBe(grids.default);
  });

  it('AT4: same seed reproduces an identical 11-driver grid with unique names, codes and numbers', () => {
    const lists = loadLists();
    const a = generateGrid(11, 1, LATAM, lists);
    const b = generateGrid(11, 1, LATAM, lists);
    expect(a).toEqual(b);
    expect(a).toHaveLength(11);
    expect(new Set(a.map((d: Driver) => `${d.first} ${d.last}`)).size).toBe(11);
    const codes = new Set<string>();
    const numbers = new Set<number>();
    for (const d of a) {
      expect(d.code).toMatch(/^[A-Z]{3}$/);
      codes.add(d.code);
      expect(d.number).toBeGreaterThanOrEqual(2);
      expect(d.number).toBeLessThanOrEqual(99);
      numbers.add(d.number);
    }
    expect(codes.size).toBe(11);
    expect(numbers.size).toBe(11);
  });

  it('AT5: seed 1 and seed 2 produce different grids', () => {
    const lists = loadLists();
    const a = generateGrid(11, 1, LATAM, lists);
    const b = generateGrid(11, 2, LATAM, lists);
    expect(a).not.toEqual(b);
  });

  it('AT6: over 20 grids of 98 the MEX share stays in [0.40, 0.50] and every nat is in the mix', () => {
    const lists = loadLists();
    const all: Driver[] = [];
    for (let s = 1; s <= 20; s++) all.push(...generateGrid(98, s, LATAM, lists));
    expect(all).toHaveLength(1960);
    const mex = all.filter((d) => d.nat === 'MEX').length;
    const share = mex / all.length;
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.5);
    for (const d of all) expect(LATAM[d.nat]).toBeGreaterThan(0);
  });

  it('AT7: a MEX-only mix draws every driver and name from the MEX list', () => {
    const lists = loadLists();
    const subset = { ARG: lists.ARG, MEX: lists.MEX };
    const grid = generateGrid(5, 3, { MEX: 1 }, subset);
    expect(grid).toHaveLength(5);
    const mexFirsts = new Set(lists.MEX.first);
    const mexLasts = new Set(lists.MEX.last);
    for (const d of grid) {
      expect(d.nat).toBe('MEX');
      expect(mexFirsts.has(d.first)).toBe(true);
      expect(mexLasts.has(d.last)).toBe(true);
    }
  });

  it('AT8: invalid counts throw RangeError and count 0 returns an empty grid', () => {
    const lists = loadLists();
    for (const count of [99, -1, 2.5]) {
      expect(() => generateGrid(count, 1, LATAM, lists)).toThrow(RangeError);
    }
    expect(generateGrid(0, 1, LATAM, lists)).toEqual([]);
  });

  it('AT9: shortName renders first initial plus surname and the Núñez code folds to NUN', () => {
    const d: Driver = { first: 'Diego', last: 'Ruiz', code: 'RUI', nat: 'MEX', number: 7 };
    expect(shortName(d)).toBe('D. Ruiz');
    const names: Record<string, NameList> = { MEX: { nat: 'MEX', first: ['Diego'], last: ['Núñez'] } };
    const grid = generateGrid(1, 3, { MEX: 1 }, names);
    expect(grid[0].code).toBe('NUN');
  });
});
