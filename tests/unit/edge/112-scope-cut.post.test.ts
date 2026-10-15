import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const CONFIG_DIR = join(ROOT, 'assets', 'cars');
const MODELS = join(ROOT, 'public', 'models');

const EXPECTED_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d', 'hyper-a', 'lmp2-a'];
const CUT_IDS = ['lmp2-b', 'hyper-b'];

const IN_SCOPE_ROWS = [
  {
    asset: 'LMP2 car A source (original design)',
    author: 'mosigana',
    source: 'assets/vendor/cars/katattak-ka01/katattak_ka01_lmp2_prototype_full.glb',
  },
  {
    asset: 'Hypercar A source (real-brand shape, dev only; de-brand before release)',
    author: 'supranakamura',
    source:
      'assets/vendor/cars/cadillac-v-series-r/2023_-_2026_cadillac_v-series.r_lmdh_hypercar.glb',
  },
];

const CUT_ROW_TEXTS = ['LMP2 car B source', 'Hypercar B source'];

describe('112 scope cut edges', () => {
  it('POST10: assets/cars holds exactly the in-scope pipeline configs', () => {
    const ids = readdirSync(CONFIG_DIR)
      .filter((f) => f.endsWith('.pipeline.json'))
      .map((f) => f.slice(0, -'.pipeline.json'.length))
      .sort();
    expect(ids).toEqual(EXPECTED_IDS);
  });

  it('POST11: the cut prototypes lmp2-b and hyper-b have no build outputs', () => {
    for (const id of CUT_IDS) {
      for (const ext of ['glb', 'json']) {
        expect(existsSync(join(MODELS, `${id}.${ext}`)), `${id}.${ext}`).toBe(false);
      }
    }
  });

  it('POST12: no _tmp inspection scripts remain in the worktree', () => {
    for (const dir of [join(ROOT, 'tools', 'assets'), join(ROOT, 'scripts', 'preview')]) {
      const tmp = readdirSync(dir).filter((f) => f.startsWith('_tmp_'));
      expect(tmp, dir).toEqual([]);
    }
  });

  it('POST13: ASSETS_LICENSES keeps exactly the two in-scope prototype rows', () => {
    const text = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    for (const row of IN_SCOPE_ROWS) {
      const lines = text.split('\n').filter((line) => line.includes(row.asset));
      expect(lines, row.asset).toHaveLength(1);
      const cells = lines[0]
        .split('|')
        .map((cell) => cell.trim().replace(/`/g, ''))
        .filter((cell) => cell.length > 0);
      expect(cells.length, row.asset).toBe(6);
      expect(cells[1], row.asset).toBe(row.source);
      expect(cells[2], row.asset).toContain(row.author);
      expect(cells[3], row.asset).toBe('CC-BY 4.0');
      expect(cells[5], row.asset).toBe('no');
      expect(existsSync(join(ROOT, row.source)), `${row.asset} source`).toBe(true);
    }
    for (const cut of CUT_ROW_TEXTS) {
      expect(text.includes(cut), cut).toBe(false);
    }
  });
});
