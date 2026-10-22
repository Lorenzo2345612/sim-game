import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const BASE = '79c5aaff';
const IDS = ['bathurst', 'jeddah', 'miami'];

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

describe('331 bathurst, jeddah, miami in game', () => {
  it('AT4: index.json ends with the three new tracks and earlier entries equal the base revision', () => {
    const index = readJson<Array<{ id: string; name: string; country: string }>>('public/tracks/index.json');
    const base = JSON.parse(git('show', `${BASE}:public/tracks/index.json`)) as unknown[];
    const last = index.slice(base.length, base.length + 3);
    expect(last.map((e) => e.id)).toEqual(IDS);
    expect(last.map((e) => e.name)).toEqual(['Mount Panorama', 'Jeddah', 'Miami']);
    expect(last.map((e) => e.country)).toEqual(['Australia', 'Saudi Arabia', 'United States']);
    expect(JSON.stringify(index.slice(0, base.length))).toBe(JSON.stringify(base));
  });

  it('AT5: fetchDem TRACKS contains the three new sources', () => {
    const src = readFileSync(join(ROOT, 'tools', 'dem', 'fetchDem.ts'), 'utf8');
    expect(src).toContain("{ id: 'bathurst', source: 'au-bathurst' }");
    expect(src).toContain("{ id: 'jeddah', source: 'sa-jeddah' }");
    expect(src).toContain("{ id: 'miami', source: 'us-miami' }");
  });

  it('AT6: no track JSON other than index.json changed vs the base revision', () => {
    const out = git('diff', '--name-only', BASE, '--', 'public/tracks')
      .split('\n')
      .filter((f) => f !== '' && f !== 'public/tracks/index.json')
      .filter((f) => {
        try {
          git('cat-file', '-e', `${BASE}:${f}`);
          return true;
        } catch {
          return false; // added after the base revision by another task
        }
      });
    expect(out).toEqual([]);
  });

  it('AT7: elevation range per track', () => {
    const range = (id: string): number => {
      const e = readJson<{ elevation: number[] }>(`public/tracks/${id}.json`).elevation;
      return Math.max(...e) - Math.min(...e);
    };
    expect(range('bathurst')).toBeGreaterThanOrEqual(160);
    expect(range('bathurst')).toBeLessThanOrEqual(180);
    expect(range('jeddah')).toBeLessThan(8);
    expect(range('miami')).toBeLessThan(8);
  });

  it('AT8: lengthMeters per track', () => {
    const len = (id: string): number => readJson<{ lengthMeters: number }>(`public/tracks/${id}.json`).lengthMeters;
    expect(len('bathurst')).toBeGreaterThanOrEqual(6100);
    expect(len('bathurst')).toBeLessThanOrEqual(6300);
    expect(len('jeddah')).toBeGreaterThanOrEqual(6080);
    expect(len('jeddah')).toBeLessThanOrEqual(6280);
    expect(len('miami')).toBeGreaterThanOrEqual(5320);
    expect(len('miami')).toBeLessThanOrEqual(5500);
  });
});
