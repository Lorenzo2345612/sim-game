import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groundPalette } from '../../../src/render/terrainMaterial';

const ROOT = join(__dirname, '..', '..', '..');
const TRACKS_DIR = join(ROOT, 'public', 'tracks');

const EXPECTED: Record<string, string> = {
  baku: 'city',
  singapore: 'city',
  lasvegas: 'city',
  detroit: 'city',
  bahrain: 'desert',
  lusail: 'desert',
  fontana: 'desert',
  sepang: 'tropical',
  daytona: 'tropical',
  spa: 'forest',
  monza: 'parkland',
  silverstone: 'parkland',
  mexico: 'parkland',
  braselton: 'parkland',
  elkhart: 'parkland',
  budapest: 'parkland',
  spielberg: 'parkland',
  cleveland: 'parkland',
};

describe('156 environment type ground vegetation', () => {
  it('AT1: every track JSON in public/tracks declares the environment of the mapping', () => {
    const files = readdirSync(TRACKS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files.length, 'track JSON files found').toBeGreaterThanOrEqual(Object.keys(EXPECTED).length);
    for (const file of files) {
      const id = file.replace(/\.json$/, '');
      expect(EXPECTED[id], `unmapped track ${id}`).toBeDefined();
      const track = JSON.parse(readFileSync(join(TRACKS_DIR, file), 'utf8')) as { environment?: string };
      expect(track.environment, id).toBe(EXPECTED[id]);
    }
  });

  it("AT2: groundPalette('desert') is sand/dry/sand-b without stripes and parkland is the grass sets with stripes", () => {
    const desert = groundPalette('desert');
    expect(desert.dirs).toEqual(['ground/sand', 'ground/dry', 'ground/sand-b']);
    expect(desert.stripes).toBe(false);
    const parkland = groundPalette('parkland');
    expect(parkland.dirs).toEqual(['grass-mown', 'grass', 'grass-dark']);
    expect(parkland.stripes).toBe(true);
  });
});
