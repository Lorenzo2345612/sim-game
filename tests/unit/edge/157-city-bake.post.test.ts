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
  corridorLimit: 50,
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
  corridorLimit: 50,
  keepRadius: 600,
  bbox: [39, 49, 41, 51],
};

function firsts(items: { ring: Point2[] }[]): Point2[] {
  return items.map((i) => i.ring[0]);
}

describe('157 city bake post-coder gaps', () => {
  it('heightOf converts ft-suffixed heights and rejects negative height tags', () => {
    expect(heightOf({ height: '100 ft' })).toBeCloseTo(30.5, 5);
    expect(heightOf({ height: "30'" })).toBeCloseTo(9.1, 5);
    expect(heightOf({ height: '10 FT', building: 'hotel' })).toBeCloseTo(3, 5);
    expect(heightOf({ height: '-10 m', building: 'house' })).toBeCloseTo(7, 5);
  });

  it('heightOf treats zero, negative and non-numeric level counts as absent', () => {
    expect(heightOf({ 'building:levels': '0', building: 'house' })).toBeCloseTo(7, 5);
    expect(heightOf({ 'building:levels': '-2', building: 'residential' })).toBeCloseTo(15, 5);
    expect(heightOf({ 'building:levels': 'abc', building: 'office' })).toBeCloseTo(24, 5);
    expect(heightOf({ height: 'n/a', 'building:levels': 'x', building: 'house' })).toBeCloseTo(7, 5);
  });

  it('materialOf matches height, then historic/old-city, then brick, then concrete', () => {
    expect(materialOf({}, 45, false)).toBe('glass');
    expect(materialOf({ historic: 'yes' }, 50, false)).toBe('glass');
    expect(materialOf({ building: 'house' }, 40, true)).toBe('glass');
    expect(materialOf({ historic: 'yes' }, 30, false)).toBe('stone');
    expect(materialOf({}, 30, true)).toBe('stone');
    expect(materialOf({ historic: 'yes', building: 'house' }, 7, false)).toBe('stone');
    expect(materialOf({ building: 'house' }, 7, false)).toBe('brick');
    expect(materialOf({ building: 'residential' }, 7, false)).toBe('brick');
    expect(materialOf({ building: 'apartments' }, 7, false)).toBe('concrete');
    expect(materialOf({ building: 'yes' }, 7, false)).toBe('concrete');
  });

  it('pointInPolygon handles convex, concave and empty polygons', () => {
    const square: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    const notch: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [6, 10],
      [6, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(pointInPolygon([5, 2], notch)).toBe(true);
    expect(pointInPolygon([8, 8], notch)).toBe(true);
    expect(pointInPolygon([5, 8], notch)).toBe(false);
    expect(pointInPolygon([5, 5], [])).toBe(false);
  });

  it('coastlineWaterRings closes a chain against the extract bbox on the water (right) side', () => {
    const bbox: [number, number, number, number] = [0, 0, 10, 10];
    const north = coastlineWaterRings([wayEl(1, { natural: 'coastline' }, [
      { lon: 2, lat: 0 },
      { lon: 5, lat: 5 },
      { lon: 2, lat: 10 },
    ])], bbox);
    expect(north).toHaveLength(1);
    expect(north[0].some((p) => p.lon === 10 && p.lat === 10), 'east top corner').toBe(true);
    expect(north[0].some((p) => p.lon === 10 && p.lat === 0), 'east bottom corner').toBe(true);
    expect(north[0].some((p) => p.lon === 0), 'no west corners').toBe(false);
    expect(pointInPolygon([6, 5], north[0].map((p): Point2 => [p.lon, p.lat]))).toBe(true);
    expect(pointInPolygon([1, 5], north[0].map((p): Point2 => [p.lon, p.lat]))).toBe(false);

    const south = coastlineWaterRings([wayEl(2, { natural: 'coastline' }, [
      { lon: 2, lat: 10 },
      { lon: 5, lat: 5 },
      { lon: 2, lat: 0 },
    ])], bbox);
    expect(south).toHaveLength(1);
    expect(south[0].some((p) => p.lon === 0 && p.lat === 10), 'west top corner').toBe(true);
    expect(south[0].some((p) => p.lon === 0 && p.lat === 0), 'west bottom corner').toBe(true);
    expect(south[0].some((p) => p.lon === 10), 'no east corners').toBe(false);
    expect(pointInPolygon([1, 5], south[0].map((p): Point2 => [p.lon, p.lat]))).toBe(true);
    expect(pointInPolygon([6, 5], south[0].map((p): Point2 => [p.lon, p.lat]))).toBe(false);
  });

  it('coastlineWaterRings keeps a coast along an extract edge when water lies inside, and skips islands and out-of-bbox ways', () => {
    const bbox: [number, number, number, number] = [0, 0, 10, 10];
    const edge = coastlineWaterRings([wayEl(1, { natural: 'coastline' }, [
      { lon: 8, lat: 0 },
      { lon: 2, lat: 0 },
    ])], bbox);
    expect(edge).toHaveLength(1);
    for (const [lon, lat] of [[0, 0], [10, 0], [10, 10], [0, 10]]) {
      expect(edge[0].some((p) => p.lon === lon && p.lat === lat), `corner ${lon},${lat}`).toBe(true);
    }
    expect(pointInPolygon([5, 5], edge[0].map((p): Point2 => [p.lon, p.lat]))).toBe(true);

    const island = coastlineWaterRings([wayEl(2, { natural: 'coastline' }, [
      { lon: 4, lat: 4 },
      { lon: 6, lat: 4 },
      { lon: 6, lat: 6 },
      { lon: 4, lat: 6 },
      { lon: 4, lat: 4 },
    ])], bbox);
    expect(island).toEqual([]);

    const away = coastlineWaterRings([wayEl(3, { natural: 'coastline' }, [
      { lon: 5, lat: 20 },
      { lon: 6, lat: 20 },
    ])], bbox);
    expect(away).toEqual([]);
  });

  it('buildCityEnv keeps a ring exactly at the corridor limit and drops one closer', () => {
    const kept = buildCityEnv(
      [wayEl(1, { building: 'yes' }, rect(400, 50, 600, 150))],
      TRACK,
    );
    expect(kept.buildings).toHaveLength(1);
    const dropped = buildCityEnv(
      [wayEl(1, { building: 'yes' }, rect(400, 49.99, 600, 149.99))],
      TRACK,
    );
    expect(dropped.buildings).toHaveLength(0);
  });

  it('buildCityEnv drops a ring whose vertices clear the corridor but whose edge dips into it', () => {
    const env = buildCityEnv(
      [wayEl(1, { building: 'yes' }, rect(400, -100, 600, 100))],
      TRACK,
    );
    expect(env.buildings).toHaveLength(0);
  });

  it('buildCityEnv keeps features with any vertex inside the keep radius and drops far ones', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { building: 'yes' }, rect(400, 599, 600, 650)),
        wayEl(2, { building: 'yes' }, rect(400, 605, 600, 700)),
      ],
      TRACK,
    );
    expect(env.buildings).toHaveLength(1);
    expect(env.buildings[0].ring[0]).toEqual([400, 599]);
  });

  it('buildCityEnv skips building=no and height<=0 and keeps building:part with the default height', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { building: 'no', height: '30 m' }, rect(100, 100, 140, 140)),
        wayEl(2, { 'building:part': 'yes' }, rect(150, 100, 190, 140)),
        wayEl(3, { building: 'yes', height: '0 m' }, rect(200, 100, 240, 140)),
        wayEl(4, { building: 'yes', height: '12.7' }, rect(250, 100, 290, 140)),
      ],
      TRACK,
    );
    expect(env.buildings.map((b) => b.height)).toEqual([12, 12.7]);
    expect(env.buildings.map((b) => b.material)).toEqual(['concrete', 'concrete']);
  });

  it('buildCityEnv keeps only old-city walls inside the keep radius, ignoring the corridor for walls', () => {
    const area = wayEl(1, { historic: 'yes' }, rect(0, 0, 400, 700));
    const env = buildCityEnv(
      [
        area,
        wayEl(2, { barrier: 'wall' }, [ll(100, 10), ll(200, 10)]),
        wayEl(3, { barrier: 'wall' }, [ll(100, 100), ll(200, 100)]),
        wayEl(4, { historic: 'citywalls' }, [ll(100, 200), ll(200, 200)]),
        wayEl(5, { barrier: 'wall' }, [ll(600, 100), ll(700, 100)]),
        wayEl(6, { barrier: 'wall' }, [ll(100, 650), ll(200, 650)]),
      ],
      TRACK,
    );
    expect(env.walls.map((w) => w.line[0])).toEqual([
      [100, 10],
      [100, 100],
      [100, 200],
    ]);
    for (const w of env.walls) {
      expect(w.height).toBe(8);
      expect(w.thickness).toBe(2.5);
    }
  });

  it('buildCityEnv keeps water inside the keep radius with no corridor drop', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { natural: 'basin' }, rect(100, 10, 300, 40)),
        wayEl(2, { natural: 'water' }, rect(100, 100, 300, 140)),
        wayEl(3, { natural: 'water' }, rect(100, 650, 300, 700)),
      ],
      TRACK,
    );
    expect(env.water.map((poly) => poly[0])).toEqual([
      [100, 10],
      [100, 100],
    ]);
  });

  it('buildCityEnv marks buildings inside a historic area as stone and historic-tagged ones outside it too', () => {
    const env = buildCityEnv(
      [
        wayEl(1, { historic: 'yes' }, rect(0, 0, 400, 700)),
        wayEl(2, { building: 'yes' }, rect(100, 100, 140, 140)),
        wayEl(3, { building: 'yes' }, rect(600, 100, 640, 140)),
        wayEl(4, { building: 'house', historic: 'yes' }, rect(600, 200, 640, 240)),
      ],
      SQUARE,
    );
    expect(env.buildings.map((b) => b.material)).toEqual(['stone', 'concrete', 'stone']);
    expect(env.buildings.map((b) => b.height)).toEqual([12, 12, 7]);
  });

  it('buildCityEnv assembles a multipolygon relation building from split outer ways', () => {
    const env = buildCityEnv(
      [
        {
          type: 'relation',
          id: 9,
          tags: { building: 'yes' },
          members: [
            { type: 'way' as const, role: 'outer', geometry: [ll(100, 100), ll(300, 100), ll(300, 200)] },
            { type: 'way' as const, role: 'outer', geometry: [ll(300, 200), ll(100, 200), ll(100, 100)] },
          ],
        },
      ],
      SQUARE,
    );
    expect(env.buildings).toHaveLength(1);
    expect(env.buildings[0].height).toBe(12);
    expect(env.buildings[0].ring.length).toBeGreaterThanOrEqual(4);
  });

  it('buildCityEnv breaks first-vertex sort ties by the second coordinate', () => {
    const params: CityEnvParams = { ...SQUARE, corridorLimit: 5 };
    const env = buildCityEnv(
      [
        wayEl(1, { building: 'yes' }, rect(10, 50, 20, 54)),
        wayEl(2, { building: 'yes' }, rect(10, 10, 20, 14)),
      ],
      params,
    );
    expect(firsts(env.buildings)).toEqual([
      [10, 10],
      [10, 50],
    ]);
  });

  it('buildCityEnv keeps a ring 100 m off a parallel centerline segment', () => {
    const params: CityEnvParams = {
      origin: ORIGIN,
      centerline: [
        [0, 0],
        [100, 0],
        [100, 1000],
        [0, 1000],
      ],
      corridorLimit: 50,
      keepRadius: 600,
      bbox: [39, 49, 41, 51],
    };
    const env = buildCityEnv(
      [wayEl(1, { building: 'yes' }, rect(200, 0, 400, 400))],
      params,
    );
    expect(env.buildings).toHaveLength(1);
  });

  it('buildCityEnv does not mutate its inputs and is deterministic', () => {
    const elements: OverpassElement[] = [
      wayEl(1, { historic: 'yes' }, rect(0, 0, 400, 700)),
      wayEl(2, { building: 'yes', height: '33.3' }, rect(100, 100, 200, 200)),
      wayEl(3, { barrier: 'wall' }, [ll(100, 100), ll(300, 300)]),
      wayEl(4, { natural: 'water' }, rect(100, 100, 300, 300)),
      wayEl(5, { natural: 'coastline' }, [ll(0, -500), ll(200, -400), ll(0, -300)]),
    ];
    const centerline: Point2[] = [[0, 0], [1000, 0], [0, 0]];
    const params: CityEnvParams = { ...TRACK, centerline };
    const snapshot = JSON.stringify({ elements, params });
    const first = buildCityEnv(elements, params);
    const second = buildCityEnv(elements, params);
    expect(JSON.stringify({ elements, params })).toBe(snapshot);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
