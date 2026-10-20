import { describe, expect, it } from 'vitest';
import { unprojectXZ, type LonLat, type Point2 } from '../../../src/track/geo';
import {
  buildCityEnv,
  coastlineWaterRings,
  pointInPolygon,
  type CityEnvParams,
  type ExtractBbox,
  type OverpassElement,
  type OverpassPoint,
} from '../../../tools/env/osmBuildings';

const ORIGIN: LonLat = [40, 50];
const BBOX: ExtractBbox = [0, 0, 10, 10];

function ll(x: number, z: number): OverpassPoint {
  const [lon, lat] = unprojectXZ([x, z], ORIGIN);
  return { lon, lat };
}

function rect(x0: number, z0: number, x1: number, z1: number): OverpassPoint[] {
  return [ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)];
}

function wayEl(id: number, tags: Record<string, string>, geometry: OverpassPoint[]): OverpassElement {
  return { type: 'way', id, tags, geometry };
}

function toPoly(ring: OverpassPoint[]): Point2[] {
  return ring.map((p): Point2 => [p.lon, p.lat]);
}

const SQUARE: CityEnvParams = {
  origin: ORIGIN,
  centerline: [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ],
  corridorAt: () => 50,
  keepRadius: 600,
  bbox: [39, 49, 41, 51],
};

const TRACK: CityEnvParams = {
  origin: ORIGIN,
  centerline: [
    [0, 0],
    [1000, 0],
    [0, 0],
  ],
  corridorAt: () => 50,
  keepRadius: 600,
  bbox: [39, 49, 41, 51],
};

describe('157 city bake further gaps', () => {
  it('coastlineWaterRings keeps the bbox entry vertex when a way enters the extract from outside', () => {
    const rings = coastlineWaterRings(
      [
        wayEl(1, { natural: 'coastline' }, [
          { lon: -5, lat: 5 },
          { lon: 5, lat: 5 },
          { lon: 5, lat: 10 },
        ]),
      ],
      BBOX,
    );
    expect(rings).toHaveLength(1);
    const ring = toPoly(rings[0]);
    expect(ring.some((p) => p[0] === 0 && p[1] === 5), 'entry vertex on the west edge').toBe(true);
    expect(pointInPolygon([1, 2], ring), 'water south of the coast reaches the west edge').toBe(true);
  });

  it('coastlineWaterRings joins two ways sharing an endpoint into one ring', () => {
    const rings = coastlineWaterRings(
      [
        wayEl(1, { natural: 'coastline' }, [
          { lon: 2, lat: 0 },
          { lon: 5, lat: 5 },
        ]),
        wayEl(2, { natural: 'coastline' }, [
          { lon: 5, lat: 5 },
          { lon: 2, lat: 10 },
        ]),
      ],
      BBOX,
    );
    expect(rings).toHaveLength(1);
    expect(rings[0].some((p) => p.lon === 10 && p.lat === 10), 'east top corner').toBe(true);
    expect(rings[0].some((p) => p.lon === 10 && p.lat === 0), 'east bottom corner').toBe(true);
    expect(pointInPolygon([6, 5], toPoly(rings[0])), 'water east of the chain').toBe(true);
    expect(pointInPolygon([1, 5], toPoly(rings[0])), 'land west of the chain').toBe(false);
  });

  it('buildCityEnv turns a multipolygon natural=water relation into one water polygon', () => {
    const env = buildCityEnv(
      [
        {
          type: 'relation',
          id: 9,
          tags: { natural: 'water' },
          members: [
            { type: 'way' as const, role: 'outer', geometry: [ll(100, 100), ll(300, 100), ll(300, 200)] },
            { type: 'way' as const, role: 'outer', geometry: [ll(300, 200), ll(100, 200), ll(100, 100)] },
          ],
        },
      ],
      SQUARE,
    );
    expect(env.water).toHaveLength(1);
    expect(env.water[0].length).toBeGreaterThanOrEqual(4);
    expect(env.water[0][0]).toEqual([100, 100]);
  });

  it('buildCityEnv marks buildings inside a multipolygon historic relation as stone', () => {
    const env = buildCityEnv(
      [
        {
          type: 'relation',
          id: 5,
          tags: { historic: 'yes' },
          members: [
            {
              type: 'way' as const,
              role: 'outer',
              geometry: [ll(0, 0), ll(400, 0), ll(400, 700), ll(0, 700), ll(0, 0)],
            },
          ],
        },
        wayEl(2, { building: 'yes' }, rect(100, 100, 140, 140)),
        wayEl(3, { building: 'yes' }, rect(600, 100, 640, 140)),
      ],
      SQUARE,
    );
    expect(env.buildings.map((b) => b.material)).toEqual(['stone', 'concrete']);
    expect(env.walls).toHaveLength(0);
  });

  it('buildCityEnv ignores inner members of a multipolygon building', () => {
    const env = buildCityEnv(
      [
        {
          type: 'relation',
          id: 7,
          tags: { building: 'yes' },
          members: [
            {
              type: 'way' as const,
              role: 'outer',
              geometry: [ll(100, 100), ll(300, 100), ll(300, 300), ll(100, 300), ll(100, 100)],
            },
            {
              type: 'way' as const,
              role: 'inner',
              geometry: [ll(150, 150), ll(200, 150), ll(200, 200), ll(150, 200), ll(150, 150)],
            },
          ],
        },
      ],
      SQUARE,
    );
    expect(env.buildings).toHaveLength(1);
    expect(env.buildings[0].ring[0]).toEqual([100, 100]);
  });

  it('buildCityEnv returns an empty env for empty input', () => {
    expect(buildCityEnv([], TRACK)).toEqual({ buildings: [], walls: [], water: [] });
  });

  it('buildCityEnv skips an open (non-closed) natural=water way', () => {
    const env = buildCityEnv(
      [wayEl(1, { natural: 'water' }, [ll(100, 100), ll(300, 100), ll(300, 200)])],
      SQUARE,
    );
    expect(env.water).toEqual([]);
    expect(env.buildings).toEqual([]);
  });
});
