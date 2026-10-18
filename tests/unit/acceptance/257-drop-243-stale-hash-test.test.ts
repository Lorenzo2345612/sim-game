import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '243-arroyo-bridges.test.ts');

describe('257 drop stale 243 hash test acceptance', () => {
  it('AT1: 243 file drops AT9/MASTER_HASHES and its AT9-only imports; AT1-AT8 and AT10 unchanged', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src, 'no AT9 present').not.toContain('AT9');
    expect(src, 'no MASTER_HASHES present').not.toContain('MASTER_HASHES');
    expect(src, 'no createHash import').not.toContain('createHash');
    expect(src, 'no readdirSync import').not.toContain('readdirSync');
    const kept = [
      'AT1: fixture G yields exactly one bridge spanning x 480-520',
      'AT2: bridge span elevation is linear and matches the no-arroyo elevation at both abutment ends',
      'AT3: the bed carves the terrain to -2 m on the arroyo line and is back to 0 by 30 m',
      'AT4: elevation outside the bridge span equals the same build without water',
      'AT5: with arroyo absent the build deep-equals the no-water build and has no bridges/arroyos keys',
      'AT6: bridge spans get armco guardrails at 7.25 m on both sides',
      'AT7: the bridge renderer builds deck and two stone side walls, with no parapets above the deck and no piers',
      'AT8: federal and poniente each have a bridge whose midpoint is within 30 m of the real OSM crossing',
      'AT10: on every ermita track tree density within 15 m of an arroyo corridor edge is at least 2x the density 50-100 m away',
    ];
    for (const title of kept) {
      expect(src, title).toContain(title);
    }
  });
});
