import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const NEW_IDS = ['fontana', 'cleveland', 'detroit'];

function sourceOf(id: string): { dataset?: string; license?: string } {
  const data = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
    source?: { dataset?: string; license?: string };
  };
  return data.source ?? {};
}

function centerlineLength(id: string): number {
  const data = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
    centerline: [number, number][];
  };
  const closed = data.centerline;
  let length = 0;
  for (let i = 0; i < closed.length; i++) {
    const a = closed[i];
    const b = closed[(i + 1) % closed.length];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

describe('168 us tracks in game', () => {
  it('AT4: the three track JSONs declare the OpenStreetMap dataset under ODbL 1.0', () => {
    for (const id of NEW_IDS) {
      const source = sourceOf(id);
      expect(source.dataset, `${id}: source.dataset`).toBe('OpenStreetMap');
      expect(source.license, `${id}: source.license`).toBe('ODbL 1.0');
    }
  });

  it('AT5: every other public/tracks JSON is unchanged vs the base revision', () => {
    const baseRev = (
      spawnSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? ''
    ).trim();
    expect(baseRev, 'git merge-base master HEAD').toMatch(/^[0-9a-f]{7,40}$/);
    const diff = spawnSync('git', ['diff', '--name-only', baseRev, '--', 'public/tracks/'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(diff.status, `git diff failed: ${diff.stderr}`).toBe(0);
    const changed = (diff.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .map((path) => path.split('/').pop() ?? '');
    const unexpected = changed.filter(
      (file) =>
        file.endsWith('.json') &&
        file !== 'index.json' &&
        !NEW_IDS.includes(file.replace(/\.json$/, '')),
    );
    expect(unexpected, 'other track JSONs changed vs base').toEqual([]);
  }, 60000);

  it('AT6: the closed centerline lengths of the three tracks fall in the expected ranges', () => {
    const ranges: Record<string, [number, number]> = {
      fontana: [2300, 2550],
      cleveland: [3250, 3550],
      detroit: [2450, 2700],
    };
    for (const id of NEW_IDS) {
      const [min, max] = ranges[id];
      const length = centerlineLength(id);
      expect(length, `${id}: length >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(length, `${id}: length <= ${max}`).toBeLessThanOrEqual(max);
    }
  });
});
