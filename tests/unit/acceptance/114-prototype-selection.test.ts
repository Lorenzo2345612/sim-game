import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

interface CreditEntry {
  asset: string;
  author: string;
  license: string;
  url: string;
}

const CREDITS_BEFORE_114 = [
  'F4 single-seater chassis',
  'GT3 car A source',
  'GT3 car B source',
  'GT3 low-poly car source',
  'GT3 car D source',
];

describe('114 prototype selection acceptance', () => {
  it('AT3: credits gain exactly 2 lines — LMP2 car A source by mosigana and Hypercar A source by supranakamura, CC-BY 4.0 with source urls', () => {
    const entries = JSON.parse(
      readFileSync(join(ROOT, 'public', 'credits.json'), 'utf8'),
    ) as CreditEntry[];
    const added = entries.filter((entry) => !CREDITS_BEFORE_114.includes(entry.asset));
    expect(added).toHaveLength(2);

    const lmp2 = entries.filter((entry) => entry.asset === 'LMP2 car A source');
    expect(lmp2).toHaveLength(1);
    expect(lmp2[0].author).toContain('mosigana');
    expect(lmp2[0].license).toBe('CC-BY 4.0');
    expect(lmp2[0].url).toBe('https://sketchfab.com/3d-models/6044bd804bed4ac4b9f0c782c5c3459b');

    const hyper = entries.filter((entry) => entry.asset === 'Hypercar A source');
    expect(hyper).toHaveLength(1);
    expect(hyper[0].author).toContain('supranakamura');
    expect(hyper[0].license).toBe('CC-BY 4.0');
    expect(hyper[0].url).toBe('https://sketchfab.com/3d-models/efe600b0b1694e2aae055f35db3aaeda');
  });
});
