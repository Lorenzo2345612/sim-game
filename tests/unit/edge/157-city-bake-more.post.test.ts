import { describe, expect, it } from 'vitest';
import { unprojectXZ, type LonLat, type Point2 } from '../../../src/track/geo';
import {
  buildCityEnv,
  coastlineWaterRings,
  heightOf,
  materialOf,
  pointInPolygon,
  type CityEnvParams,
  type OverpassElement,
  type OverpassPoint,
} from '../../../tools/env/osmBuildings';

const ORIGIN: LonLat = [40, 50];
const BBOX: [number, number, number, number] = [0, 0, 10, 10];

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

describe('157 city bake more gaps', () => {
  it('heightOf rounds to 0.1 m and a height rounding to zero is not positive', () => {
    expect(heightOf({ height: '15.67' })).toBeCloseTo(15.7, 5);
    expect(heightOf({ 'building:levels': '1.55' })).toBeCloseTo(5, 5);
    expect(heightOf({ height: '0.04', building: 'house' })).toBe(0);
  });

  it('materialOf treats heights just below 40 as non-glass', () => {
    expect(materialOf({}, 39.9, false)).toBe('concrete');
    expect(materialOf({ building: 'house' }, 39.9, false)).toBe('brick');
    expect(materialOf({}, 40, false)).toBe('glass');
  });

  it('buildCityEnv keeps a barrier=city_wall way inside an old-city area as an 8 x 2.5 wall', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { historic: 'yes' }, rect(0, 0, 400, 700)),
        wayEl(2, { barrier: 'city_wall' }, [ll(100, 10), ll(200, 10)]),
      ],
      TRACK,
    );
    expect(env.walls).toEqual([
      { line: [[100, 10], [200, 10]], height: 8, thickness: 2.5 },
    ]);
  });

  it('buildCityEnv drops a wall way whose geometry collapses when the repeated closing point is removed', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { historic: 'yes' }, rect(0, 0, 400, 700)),
        wayEl(2, { barrier: 'wall' }, [ll(100, 10), ll(200, 10), ll(100, 10)]),
        wayEl(3, { barrier: 'wall' }, [ll(300, 10), ll(300, 10)]),
      ],
      TRACK,
    );
    expect(env.walls).toEqual([
      { line: [[100, 10], [200, 10]], height: 8, thickness: 2.5 },
    ]);
  });

  it('buildCityEnv skips open or degenerate building ways and node elements', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { building: 'yes' }, [ll(100, 100), ll(200, 100), ll(200, 200)]),
        wayEl(2, { building: 'yes' }, [ll(300, 100), ll(400, 100), ll(300, 100)]),
        { type: 'node', id: 3, tags: { building: 'yes' } },
      ],
      TRACK,
    );
    expect(env.buildings).toEqual([]);
    expect(env.walls).toEqual([]);
    expect(env.water).toEqual([]);
  });

  it('buildCityEnv ignores relations with no usable outer members', () => {
    const env = buildCityEnv(
      [
        {
          type: 'relation',
          id: 1,
          tags: { natural: 'water' },
          members: [
            { type: 'way' as const, role: 'inner', geometry: [ll(100, 100), ll(200, 100), ll(200, 200)] },
          ],
        },
        {
          type: 'relation',
          id: 2,
          tags: { building: 'yes' },
          members: [{ type: 'way' as const, role: 'outer' }],
        },
      ],
      SQUARE,
    );
    expect(env.buildings).toEqual([]);
    expect(env.water).toEqual([]);
  });

  it('buildCityEnv does not treat an open historic way as an old-city area', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { historic: 'yes' }, [ll(0, 0), ll(400, 0), ll(400, 700), ll(0, 700)]),
        wayEl(2, { building: 'yes' }, rect(100, 100, 140, 140)),
      ],
      SQUARE,
    );
    expect(env.buildings.map((b) => b.material)).toEqual(['concrete']);
  });

  it('coastlineWaterRings joins coastline ways that share their last or first endpoint', () => {
    const lastLast = coastlineWaterRings(
      [
        wayEl(1, { natural: 'coastline' }, [{ lon: 2, lat: 0 }, { lon: 5, lat: 5 }]),
        wayEl(2, { natural: 'coastline' }, [{ lon: 2, lat: 10 }, { lon: 5, lat: 5 }]),
      ],
      BBOX,
    );
    expect(lastLast).toHaveLength(1);
    expect(lastLast[0].some((p) => p.lon === 10 && p.lat === 10), 'east top corner').toBe(true);
    expect(pointInPolygon([6, 5], lastLast[0].map((p): Point2 => [p.lon, p.lat])), 'water east').toBe(
      true,
    );

    const startStart = coastlineWaterRings(
      [
        wayEl(3, { natural: 'coastline' }, [{ lon: 5, lat: 5 }, { lon: 2, lat: 0 }]),
        wayEl(4, { natural: 'coastline' }, [{ lon: 5, lat: 5 }, { lon: 2, lat: 10 }]),
      ],
      BBOX,
    );
    expect(startStart).toHaveLength(1);
    expect(startStart[0].some((p) => p.lon === 0 && p.lat === 10), 'west top corner').toBe(true);
    expect(pointInPolygon([1, 5], startStart[0].map((p): Point2 => [p.lon, p.lat])), 'water west').toBe(
      true,
    );
  });
});
