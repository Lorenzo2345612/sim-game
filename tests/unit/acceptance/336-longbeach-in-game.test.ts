import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const BASE = '79c5aaff';

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

describe('336 longbeach in game', () => {
  it('AT4: index.json ends with longbeach and earlier entries equal the base revision plus 331 tracks', () => {
    const index = readJson<Array<{ id: string; name: string; country: string }>>('public/tracks/index.json');
    const last = index[index.length - 1];
    expect(last.id).toBe('longbeach');
    expect(last.name).toBe('Long Beach');
    expect(last.country).toBe('United States');
    const base = JSON.parse(git('show', `${BASE}:public/tracks/index.json`)) as unknown[];
    expect(JSON.stringify(index.slice(0, base.length))).toBe(JSON.stringify(base));
    expect(index.slice(base.length, -1).map((e) => e.id)).toEqual(['bathurst', 'jeddah', 'miami']);
  });

  it('AT5: fetchDem TRACKS contains the longbeach source', () => {
    const src = readFileSync(join(ROOT, 'tools', 'dem', 'fetchDem.ts'), 'utf8');
    expect(src).toContain("{ id: 'longbeach', source: 'us-longbeach' }");
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
          return false; // added after the base revision by other tasks
        }
      });
    expect(out).toEqual([]);
  });

  it('AT7: elevation range under 8 m', () => {
    const e = readJson<{ elevation: number[] }>('public/tracks/longbeach.json').elevation;
    expect(Math.max(...e) - Math.min(...e)).toBeLessThan(8);
  });

  it('AT8: lengthMeters 3150-3270', () => {
    const len = readJson<{ lengthMeters: number }>('public/tracks/longbeach.json').lengthMeters;
    expect(len).toBeGreaterThanOrEqual(3150);
    expect(len).toBeLessThanOrEqual(3270);
  });
});
