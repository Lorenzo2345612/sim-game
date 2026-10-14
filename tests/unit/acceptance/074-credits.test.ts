import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCredits, type CreditEntry } from '../../../tools/assets/buildCredits';

const ROOT = join(__dirname, '..', '..', '..');

function ccByRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6 && cells[3].startsWith('CC-BY'));
}

describe('074 credits acceptance', () => {
  it('AT1: current ASSETS_LICENSES.md yields one entry per CC-BY row with author, license and url', () => {
    const markdown = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    const rows = ccByRows(markdown);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const entries = parseCredits(markdown);
    expect(entries).toHaveLength(rows.length);
    entries.forEach((entry: CreditEntry, i: number) => {
      expect(entry.author).toBe(rows[i][2]);
      expect(entry.license).toBe(rows[i][3]);
      expect(entry.url).toBe(rows[i][4]);
      expect(entry.author).not.toBe('');
      expect(entry.license.startsWith('CC-BY')).toBe(true);
      expect(entry.url).not.toBe('');
    });
  });

  it('AT2: CC0 rows are excluded from the credits', () => {
    const markdown = [
      '| Asset | Path | Author / source | License | URL | NC |',
      '|---|---|---|---|---|---|',
      '| asphalt Asphalt010 | `public/textures/asphalt/` | ambientCG | CC0 1.0 | https://ambientcg.com/a/Asphalt010 | no |',
      '| grass Grass005 | `public/textures/grass/` | ambientCG | CC0 1.0 | https://ambientcg.com/a/Grass005 | no |',
      '| F4 single-seater chassis (source GLB) | `assets/vendor/f4/f4.glb` | RoyalBlond, Sketchfab | CC-BY 4.0 | https://sketchfab.com/3d-models/f4 | no |',
    ].join('\n');
    const entries = parseCredits(markdown);
    expect(entries).toHaveLength(1);
    expect(entries[0].license.startsWith('CC-BY')).toBe(true);
    expect(entries.some((entry: CreditEntry) => entry.license.startsWith('CC0'))).toBe(false);
    expect(entries.some((entry: CreditEntry) => entry.url === 'https://ambientcg.com/a/Asphalt010')).toBe(false);
    expect(entries.some((entry: CreditEntry) => entry.url === 'https://ambientcg.com/a/Grass005')).toBe(false);
  });
});
