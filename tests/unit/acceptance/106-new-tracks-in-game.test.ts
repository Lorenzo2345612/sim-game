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

  it('AT5: monza, spa and silverstone JSONs are unchanged vs the base revision, ignoring the sausages field task 149 adds', () => {
    const baseRev = (
      spawnSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? ''
    ).trim();
    expect(baseRev, 'git merge-base master HEAD').toMatch(/^[0-9a-f]{7,40}$/);
    const strip = (t: Record<string, unknown>): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...t };
      delete copy.sausages;
      delete copy.environment;
      delete copy.pit;
      delete copy.barriers;
      delete copy.escapeRoads;
      // 248 rebuild: runoffs clipped at the pit; barriers, trees and terrain derive from them.
      delete copy.runoffs;
      delete copy.trees;
      delete copy.terrain;
      // 250 adds the bollards array to every rebuilt track.
      delete copy.bollards;
      return copy;
    };
    for (const file of TRACK_FILES) {
      const prev = spawnSync('git', ['show', `${baseRev}:${file}`], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(prev.status, `git show ${baseRev}:${file} failed: ${prev.stderr}`).toBe(0);
      const before = strip(JSON.parse(prev.stdout ?? '') as Record<string, unknown>);
      const now = strip(JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as Record<string, unknown>);
      // 247 rebuild: the builder emits an all-zero bank array where the pre-task JSON had none.
      if (!('bank' in before) && Array.isArray(now.bank) && (now.bank as number[]).every((b) => b === 0)) {
        delete now.bank;
      }
      expect(now, `${file}: JSON changed vs base (sausages ignored)`).toEqual(before);
    }
  }, 60000);
});
