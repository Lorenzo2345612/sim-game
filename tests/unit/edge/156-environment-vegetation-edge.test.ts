import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundPalette, createTerrainMaterial } from '../../../src/render/terrainMaterial';
import { parseTrackData } from '../../../src/track/parseTrackData';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');

interface TrackJson {
  treeSpecies?: { name: string; heightMeters: number }[];
  trees?: { species: string; data: number[] }[];
}

function readTrack(id: string): TrackJson {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackJson;
}

function heightsByName(track: TrackJson): Map<string, number> {
  return new Map((track.treeSpecies ?? []).map((s) => [s.name, s.heightMeters]));
}

function instanceCounts(track: TrackJson): Map<string, number> {
  const counts = new Map<string, number>();
  for (const batch of track.trees ?? []) counts.set(batch.species, (counts.get(batch.species) ?? 0) + batch.data.length / 4);
  return counts;
}

describe('156 environment ground vegetation edge', () => {
  it('EDGE1: forest and city ground palettes are the parkland grass sets with stripes', () => {
    const parkland = groundPalette('parkland');
    for (const type of ['forest', 'city'] as const) {
      const palette = groundPalette(type);
      expect(palette.dirs, type).toEqual(parkland.dirs);
      expect(palette.stripes, type).toBe(true);
    }
    expect(parkland.dirs).toEqual(['grass-mown', 'grass', 'grass-dark']);
    expect(parkland.stripes).toBe(true);
  });

  it('EDGE2: tropical ground palette is the current grass A/B with grass-dark C and stripes', () => {
    const tropical = groundPalette('tropical');
    expect(tropical.dirs).toEqual(['grass-mown', 'grass', 'grass-dark']);
    expect(tropical.stripes).toBe(true);
  });

  it('EDGE3: an unknown environment type falls back to the parkland palette', () => {
    const fallback = groundPalette('volcano' as never);
    expect(fallback.dirs).toEqual(groundPalette('parkland').dirs);
    expect(fallback.stripes).toBe(true);
  });

  it('EDGE4: createTerrainMaterial without a palette loads the parkland sets plus dirt and macro', () => {
    const urls: string[] = [];
    createTerrainMaterial((url: string) => {
      urls.push(url);
      return new THREE.Texture();
    });
    const expected: string[] = [];
    for (const dir of ['grass-mown', 'grass', 'grass-dark', 'dirt']) {
      for (const map of ['color', 'normal', 'roughness']) expected.push(`textures/${dir}/${map}.jpg`);
    }
    expected.push('textures/macro-noise.png');
    expect([...urls].sort()).toEqual(expected.sort());
  });

  it("EDGE5: parseTrackData defaults a missing environment to 'parkland' and keeps an explicit one", () => {
    const missing = parseTrackData({ version: 2 }) as TrackDataV2;
    expect(missing.environment).toBe('parkland');
    const explicit = parseTrackData({ version: 2, environment: 'desert' }) as TrackDataV2;
    expect(explicit.environment).toBe('desert');
  });

  it('EDGE6: bahrain track JSON uses the desert default species with the specified heights and instances each', () => {
    const bahrain = readTrack('bahrain');
    const heights = heightsByName(bahrain);
    expect([...heights.keys()].sort()).toEqual(['cactus', 'palm-date', 'shrub-dry']);
    expect(heights.get('palm-date')).toBe(9);
    expect(heights.get('cactus')).toBe(3);
    expect(heights.get('shrub-dry')).toBe(1.2);
    const counts = instanceCounts(bahrain);
    for (const name of ['palm-date', 'shrub-dry', 'cactus']) {
      expect(counts.get(name) ?? 0, name).toBeGreaterThan(0);
    }
  });

  it('EDGE7: sepang and baku track JSONs use the tropical and city default species with the specified heights', () => {
    const sepang = heightsByName(readTrack('sepang'));
    expect([...sepang.keys()].sort()).toEqual(['oak', 'palm-coconut']);
    expect(sepang.get('palm-coconut')).toBe(12);
    expect(sepang.get('oak')).toBe(18);
    const sepangCounts = instanceCounts(readTrack('sepang'));
    expect(sepangCounts.get('palm-coconut') ?? 0).toBeGreaterThan(0);

    const baku = heightsByName(readTrack('baku'));
    expect([...baku.keys()].sort()).toEqual(['oak', 'palm-date']);
    expect(baku.get('palm-date')).toBe(9);
    expect(baku.get('oak')).toBe(18);
    const bakuCounts = instanceCounts(readTrack('baku'));
    expect(bakuCounts.get('palm-date') ?? 0).toBeGreaterThan(0);
  });

  it('EDGE8: parkland and forest track JSONs keep their own biome species', () => {
    const monza = readTrack('monza');
    expect(monza.treeSpecies).toEqual([
      { name: 'oak', preset: 'Oak Medium', heightMeters: 18 },
      { name: 'ash', preset: 'Ash Medium', heightMeters: 20 },
      { name: 'aspen', preset: 'Aspen Large', heightMeters: 25 },
    ]);
    const monzaSpecies = [...instanceCounts(monza).keys()].sort();
    expect(monzaSpecies.length).toBeGreaterThan(0);
    expect(monzaSpecies.every((s) => ['oak', 'ash', 'aspen'].includes(s))).toBe(true);

    const spa = readTrack('spa');
    expect((spa.treeSpecies ?? []).map((s) => [s.name, s.heightMeters])).toEqual([
      ['pine', 26],
      ['oak', 18],
    ]);
    const spaSpecies = [...instanceCounts(spa).keys()].sort();
    expect(spaSpecies.length).toBeGreaterThan(0);
    expect(spaSpecies.every((s) => ['oak', 'pine'].includes(s))).toBe(true);
  });
});
