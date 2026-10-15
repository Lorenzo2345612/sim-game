import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const OSM_IDS = [
  'daytona',
  'lusail',
  'bahrain',
  'braselton',
  'elkhart',
  'baku',
  'budapest',
  'singapore',
  'lasvegas',
  'spielberg',
];
const F1_CIRCUITS_IDS = ['mexico', 'sepang'];
const LEGACY_IDS = ['monza', 'spa', 'silverstone'];
const TRACK_FILES = LEGACY_IDS.map((id) => `public/tracks/${id}.json`);

function sourceOf(id: string): { dataset?: string; license?: string } {
  const data = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
    source?: { dataset?: string; license?: string };
  };
  return data.source ?? {};
}

describe('106 new tracks in game', () => {
  it('AT4: the twelve new track JSONs declare the correct data source', () => {
    for (const id of OSM_IDS) {
      const source = sourceOf(id);
      expect(source.dataset, `${id}: source.dataset`).toBe('OpenStreetMap');
      expect(source.license, `${id}: source.license`).toBe('ODbL 1.0');
    }
    for (const id of F1_CIRCUITS_IDS) {
      const source = sourceOf(id);
      expect(source.dataset, `${id}: source.dataset`).toBe('bacinger/f1-circuits');
      expect(source.license, `${id}: source.license`).toBe('MIT');
    }
  });

  it('AT5: monza, spa and silverstone JSONs are unchanged vs the base revision', () => {
    const baseRev = (
      spawnSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? ''
    ).trim();
    expect(baseRev, 'git merge-base master HEAD').toMatch(/^[0-9a-f]{7,40}$/);
    const diff = spawnSync('git', ['diff', '--exit-code', baseRev, '--', ...TRACK_FILES], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const report = `${diff.stdout ?? ''}${diff.stderr ?? ''}`.slice(0, 2000);
    expect(diff.status, `git diff vs base:\n${report}`).toBe(0);
  }, 60000);
});
