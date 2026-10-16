import type { Point2 } from '../../src/track/geo';
import type { EnvironmentType, Terrain, TreeInstances, BarrierSegment } from '../../src/core/types';

export interface Biome { species: { name: string; weight: number }[]; density: number }

const DEFAULT_BIOMES: Partial<Record<EnvironmentType, Biome>> = {
  desert: {
    species: [{ name: 'palm-date', weight: 0.5 }, { name: 'shrub-dry', weight: 0.4 }, { name: 'cactus', weight: 0.1 }],
    density: 0.08,
  },
  tropical: {
    species: [{ name: 'palm-coconut', weight: 0.6 }, { name: 'oak', weight: 0.4 }],
    density: 0.5,
  },
  city: {
    species: [{ name: 'palm-date', weight: 0.5 }, { name: 'oak', weight: 0.5 }],
    density: 0.03,
  },
};

const VEG_SPECIES = new Set(['palm-date', 'palm-coconut', 'cactus', 'shrub-dry']);

/** Desert/tropical/city fall back to their default species unless the track names one itself. */
export function biomeFor(environment: EnvironmentType, biome: Biome): Biome {
  const fallback = DEFAULT_BIOMES[environment];
  if (!fallback || biome.species.some((sp) => VEG_SPECIES.has(sp.name))) return biome;
  return fallback;
}

const CELL = 12;
const MAX_TREES = 6000;
const CLEARANCE = 15;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Grid { cell: number; map: Map<string, Point2[]> }

function buildCenterlineGrid(centerline: Point2[], cell: number): Grid {
  const map = new Map<string, Point2[]>();
  for (const p of centerline) {
    const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return { cell, map };
}

function nearestCenterlineDistance(grid: Grid, x: number, z: number): number {
  const cx = Math.floor(x / grid.cell);
  const cz = Math.floor(z / grid.cell);
  let min = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = grid.map.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const [px, pz] of list) {
        const d = Math.hypot(x - px, z - pz);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

export function placeTrees(
  trackId: string, centerline: Point2[], terrain: Terrain,
  barriers: BarrierSegment[], biome: Biome,
): TreeInstances[] {
  const rng = mulberry32(fnv1a32(trackId));
  const maxOffset = barriers.length ? Math.max(...barriers.map((b) => b.offsetMeters)) : 0;
  const exclusion = maxOffset + CLEARANCE;
  const grid = buildCenterlineGrid(centerline, exclusion);

  const minX = terrain.originX - terrain.sizeX / 2;
  const minZ = terrain.originZ - terrain.sizeZ / 2;
  const maxX = terrain.originX + terrain.sizeX / 2;
  const maxZ = terrain.originZ + terrain.sizeZ / 2;
  const cols = Math.ceil(terrain.sizeX / CELL);
  const rows = Math.ceil(terrain.sizeZ / CELL);

  const totalWeight = biome.species.reduce((s, sp) => s + sp.weight, 0);
  const cumulative: { name: string; cum: number }[] = [];
  let acc = 0;
  for (const sp of biome.species) {
    acc += sp.weight / totalWeight;
    cumulative.push({ name: sp.name, cum: acc });
  }

  const bySpecies = new Map<string, number[]>();
  let count = 0;

  outer: for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (count >= MAX_TREES) break outer;
      const rx = rng();
      const rz = rng();
      const densityRoll = rng();
      const speciesRoll = rng();
      const scaleRoll = rng();
      const rotRoll = rng();

      const x = minX + (i + rx) * CELL;
      const z = minZ + (j + rz) * CELL;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (densityRoll >= biome.density) continue;
      if (nearestCenterlineDistance(grid, x, z) <= exclusion) continue;

      let name = cumulative[cumulative.length - 1]?.name ?? '';
      for (const c of cumulative) {
        if (speciesRoll < c.cum) {
          name = c.name;
          break;
        }
      }

      let data = bySpecies.get(name);
      if (!data) {
        data = [];
        bySpecies.set(name, data);
      }
      data.push(x, z, 0.85 + 0.3 * scaleRoll, rotRoll * Math.PI * 2);
      count++;
    }
  }

  return biome.species
    .filter((sp) => (bySpecies.get(sp.name)?.length ?? 0) > 0)
    .map((sp) => ({ species: sp.name, data: bySpecies.get(sp.name)! }));
}
