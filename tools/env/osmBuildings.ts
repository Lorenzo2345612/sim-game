import { projectLonLat, type LonLat, type Point2 } from '../../src/track/geo';

export type BuildingMaterial = 'glass' | 'concrete' | 'brick' | 'stone' | 'plaster';

export interface Building {
  ring: Point2[];
  height: number;
  material: BuildingMaterial;
  color?: number;
  tank?: boolean;
}

export interface Wall {
  line: Point2[];
  height: number;
  thickness: number;
}

export interface CityEnv {
  buildings: Building[];
  walls: Wall[];
  water: Point2[][];
}

export interface OverpassPoint {
  lat: number;
  lon: number;
}

export interface OverpassMember {
  type: 'way' | 'relation';
  role: string;
  geometry?: OverpassPoint[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: OverpassMember[];
}

/** Extract bbox [lonMin, latMin, lonMax, latMax]. */
export type ExtractBbox = [number, number, number, number];

export interface CityEnvParams {
  origin: LonLat;
  centerline: Point2[];
  /** Metres from centerline segment i (point i to i+1, closed) within which buildings are dropped. */
  corridorAt: (segmentIndex: number) => number;
  keepRadius: number;
  bbox: ExtractBbox;
  /** Keep only the N buildings closest to the centerline; undefined = unlimited. */
  maxBuildings?: number;
}

const WALL_HEIGHT = 8;
const WALL_THICKNESS = 2.5;

const TYPE_DEFAULT_HEIGHTS: Record<string, number> = {
  house: 7,
  residential: 15,
  apartments: 15,
  commercial: 24,
  retail: 24,
  office: 24,
  hotel: 40,
};

function round1(v: number): number {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r;
}

function round2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

// A value with an ft/' suffix is feet; any other suffix is stripped and read as metres.
function parseMetres(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!(v >= 0)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('ft') || unit.startsWith("'")) return v * 0.3048;
  return v;
}

/** Building height: `height` tag -> `building:levels` x 3.2 -> type default. */
export function heightOf(tags: Record<string, string>): number {
  const h = parseMetres(tags.height);
  if (h !== null) return round1(h);
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return round1(levels * 3.2);
  const type = tags.building ?? '';
  return TYPE_DEFAULT_HEIGHTS[type] ?? 12;
}

export function materialOf(
  tags: Record<string, string>,
  height: number,
  insideOldCity: boolean,
): BuildingMaterial {
  if (height >= 40) return 'glass';
  if (tags.historic !== undefined || insideOldCity) return 'stone';
  if (tags.building === 'residential' || tags.building === 'house') return 'brick';
  return 'concrete';
}

function pointSegDist2(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2));
  const ex = px - ax - t * dx;
  const ez = pz - az - t * dz;
  return ex * ex + ez * ez;
}

function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** 0 when the segments properly cross, else the min point-segment distance (squared when not crossing). */
function segSegDist2(a: Point2, b: Point2, c: Point2, d: Point2): number {
  const o1 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    pointSegDist2(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegDist2(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointSegDist2(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

const CELL = 100;

/** Uniform grid over the closed centerline's segments for distance threshold queries. */
class CenterlineIndex {
  private cells = new Map<string, number[]>();
  private segs: [number, number, number, number][] = [];
  private limits: number[] = [];
  private maxLimit = 0;

  constructor(points: Point2[], corridorAt: (segmentIndex: number) => number) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const idx = this.segs.length;
      this.segs.push([a[0], a[1], b[0], b[1]]);
      const limit = corridorAt(i);
      this.limits.push(limit);
      if (limit > this.maxLimit) this.maxLimit = limit;
      const minX = Math.floor(Math.min(a[0], b[0]) / CELL);
      const maxX = Math.floor(Math.max(a[0], b[0]) / CELL);
      const minZ = Math.floor(Math.min(a[1], b[1]) / CELL);
      const maxZ = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const key = `${cx},${cz}`;
          const list = this.cells.get(key);
          if (list) list.push(idx);
          else this.cells.set(key, [idx]);
        }
      }
    }
  }

  /** True when any point is closer than `dist` to the centerline. */
  anyPointCloserThan(points: Point2[], dist: number): boolean {
    const d2 = dist * dist;
    const r = Math.ceil(dist / CELL);
    for (const p of points) {
      const cx = Math.floor(p[0] / CELL);
      const cz = Math.floor(p[1] / CELL);
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cz - r; j <= cz + r; j++) {
          const list = this.cells.get(`${i},${j}`);
          if (!list) continue;
          for (const s of list) {
            const seg = this.segs[s];
            if (pointSegDist2(p[0], p[1], seg[0], seg[1], seg[2], seg[3]) < d2) return true;
          }
        }
      }
    }
    return false;
  }

  /** True when any closed-ring edge comes closer than the local limit of a nearby segment. */
  anyEdgeCloserThan(ring: Point2[]): boolean {
    const r = this.maxLimit;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const minX = Math.floor((Math.min(a[0], b[0]) - r) / CELL);
      const maxX = Math.floor((Math.max(a[0], b[0]) + r) / CELL);
      const minZ = Math.floor((Math.min(a[1], b[1]) - r) / CELL);
      const maxZ = Math.floor((Math.max(a[1], b[1]) + r) / CELL);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const list = this.cells.get(`${cx},${cz}`);
          if (!list) continue;
          for (const s of list) {
            const seg = this.segs[s];
            const limit = this.limits[s];
            if (segSegDist2(a, b, [seg[0], seg[1]], [seg[2], seg[3]]) < limit * limit) return true;
          }
        }
      }
    }
    return false;
  }
}

export function pointInPolygon(p: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function samePt(a: OverpassPoint, b: OverpassPoint): boolean {
  return a.lon === b.lon && a.lat === b.lat;
}

function dropDuplicateClose(points: OverpassPoint[]): OverpassPoint[] {
  return points.length > 1 && samePt(points[0], points[points.length - 1])
    ? points.slice(0, -1)
    : points;
}

/** Join polylines sharing endpoints into the largest chains; returns closed rings (and open chains when keepOpen). */
function joinChains(lines: OverpassPoint[][], keepOpen = false): OverpassPoint[][] {
  const chains: OverpassPoint[][] = lines.map((l) => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const a = chains[i];
        if (samePt(a[0], a[a.length - 1])) break; // already a closed ring
        const b = chains[j];
        if (samePt(b[0], b[b.length - 1])) continue; // closed rings stay standalone
        if (samePt(a[a.length - 1], b[0])) {
          chains[i] = a.concat(b);
        } else if (samePt(a[a.length - 1], b[b.length - 1])) {
          chains[i] = a.concat(b.reverse());
        } else if (samePt(a[0], b[b.length - 1])) {
          chains[i] = b.concat(a);
        } else if (samePt(a[0], b[0])) {
          chains[i] = b.reverse().concat(a);
        } else {
          continue;
        }
        chains.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return chains.filter((c) => (keepOpen ? c.length >= 2 : c.length >= 3 && samePt(c[0], c[c.length - 1])));
}

function outerRings(members: OverpassMember[]): OverpassPoint[][] {
  const lines = members
    .filter((m) => m.role === 'outer' && m.geometry && m.geometry.length >= 2)
    .map((m) => m.geometry as OverpassPoint[]);
  return joinChains(lines);
}

/** Closed outer rings of an element (closed way, or multipolygon relation outers). */
function elementRings(el: OverpassElement): OverpassPoint[][] {
  if (el.type === 'way') {
    const g = el.geometry;
    if (!g || g.length < 4 || !samePt(g[0], g[g.length - 1])) return [];
    return [g.slice(0, -1)];
  }
  if (el.type === 'relation') return outerRings(el.members ?? []);
  return [];
}

function shoelace(ring: OverpassPoint[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].lon - ring[i].lon) * (ring[j].lat + ring[i].lat);
  }
  return sum;
}

function perimeterT(p: OverpassPoint, bbox: ExtractBbox): number {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const eps = 1e-9;
  if (Math.abs(p.lat - latMin) < eps) return (p.lon - lonMin) / (lonMax - lonMin);
  if (Math.abs(p.lon - lonMax) < eps) return 1 + (p.lat - latMin) / (latMax - latMin);
  if (Math.abs(p.lat - latMax) < eps) return 2 + (lonMax - p.lon) / (lonMax - lonMin);
  return 3 + (latMax - p.lat) / (latMax - latMin);
}

function bboxArc(from: OverpassPoint, to: OverpassPoint, bbox: ExtractBbox, cw: boolean): OverpassPoint[] {
  const corners: OverpassPoint[] = [
    { lon: bbox[0], lat: bbox[1] },
    { lon: bbox[2], lat: bbox[1] },
    { lon: bbox[2], lat: bbox[3] },
    { lon: bbox[0], lat: bbox[3] },
  ];
  const tFrom = perimeterT(from, bbox);
  let tTo = perimeterT(to, bbox);
  if (cw) {
    if (tTo > tFrom) tTo -= 4;
  } else {
    if (tTo < tFrom) tTo += 4;
  }
  const picked: [number, OverpassPoint][] = [];
  for (let i = 0; i < 4; i++) {
    let t = i;
    if (cw) {
      while (t > tFrom) t -= 4;
      if (t >= tTo - 1e-9) picked.push([t, corners[i]]);
    } else {
      while (t < tFrom) t += 4;
      if (t <= tTo + 1e-9) picked.push([t, corners[i]]);
    }
  }
  picked.sort((a, b) => (cw ? b[0] - a[0] : a[0] - b[0]));
  return picked.map((p) => p[1]);
}

function clipToBbox(pts: OverpassPoint[], bbox: ExtractBbox): OverpassPoint[][] {
  const [lonMin, latMin, lonMax, latMax] = bbox;
  const eps = 1e-12;
  const inside = (p: OverpassPoint): boolean =>
    p.lon >= lonMin - eps && p.lon <= lonMax + eps && p.lat >= latMin - eps && p.lat <= latMax + eps;
  // Boundary crossing of segment a->b with the bbox slab (one endpoint is inside).
  const slabTs = (a: OverpassPoint, b: OverpassPoint): [number, number] => {
    const dLon = b.lon - a.lon;
    const dLat = b.lat - a.lat;
    let tEnter = -Infinity;
    let tExit = Infinity;
    const slab = (aV: number, dV: number, lo: number, hi: number): void => {
      if (Math.abs(dV) < 1e-15) {
        if (aV < lo || aV > hi) {
          tEnter = 1;
          tExit = 0;
        }
        return;
      }
      let t1 = (lo - aV) / dV;
      let t2 = (hi - aV) / dV;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
    };
    slab(a.lon, dLon, lonMin, lonMax);
    slab(a.lat, dLat, latMin, latMax);
    return [tEnter, tExit];
  };
  const at = (a: OverpassPoint, b: OverpassPoint, t: number): OverpassPoint => ({
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
  });
  const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
  const crossing = (a: OverpassPoint, b: OverpassPoint): OverpassPoint => {
    const [tEnter, tExit] = slabTs(a, b);
    return at(a, b, clamp01(inside(b) ? tEnter : tExit));
  };
  const out: OverpassPoint[][] = [];
  let cur: OverpassPoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const inA = inside(a);
    const inB = inside(b);
    if (inA) cur.push(a);
    if (inA !== inB) {
      const x = crossing(a, b);
      cur.push(x);
      if (cur.length >= 2) out.push(cur);
      cur = inB ? [x] : [];
    } else if (!inA && !inB) {
      const [tEnter, tExit] = slabTs(a, b);
      if (!(tEnter <= tExit)) continue;
      const entry = at(a, b, clamp01(tEnter));
      const exit = at(a, b, clamp01(tExit));
      if (!samePt(entry, exit)) out.push([entry, exit]);
    }
  }
  const last = pts[pts.length - 1];
  if (cur.length > 0 && inside(last)) {
    cur.push(last);
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}

/**
 * Water rings from coastline ways: chains clipped to the extract bbox, closed along the
 * bbox boundary on the water side (OSM convention: water on the right of the way, i.e. the
 * closed ring must be clockwise in the lon/lat plane).
 */
export function coastlineWaterRings(elements: OverpassElement[], bbox: ExtractBbox): OverpassPoint[][] {
  const pieces: OverpassPoint[][] = [];
  for (const el of elements) {
    if (el.type !== 'way' || el.tags?.natural !== 'coastline' || !el.geometry) continue;
    pieces.push(...clipToBbox(el.geometry, bbox));
  }
  const rings: OverpassPoint[][] = [];
  for (const chain of joinChains(pieces, true)) {
    const first = chain[0];
    const last = chain[chain.length - 1];
    if (samePt(first, last)) continue; // island fully inside the extract: not representable
    const cw = chain.concat(bboxArc(last, first, bbox, true));
    const ccw = chain.concat(bboxArc(last, first, bbox, false));
    rings.push(shoelace(cw) <= shoelace(ccw) ? cw : ccw);
  }
  return rings;
}

function isWaterTagged(tags: Record<string, string>): boolean {
  return tags.natural === 'water' || tags.natural === 'basin';
}

function isWallWay(tags: Record<string, string>): boolean {
  return tags.barrier === 'wall' || tags.barrier === 'city_wall' || tags.historic === 'citywalls';
}

function byFirstVertex(a: Point2[], b: Point2[]): number {
  return a[0][0] - b[0][0] || a[0][1] - b[0][1];
}

/** Bake cached Overpass elements into the city environment (deterministic). */
export function buildCityEnv(elements: OverpassElement[], params: CityEnvParams): CityEnv {
  const { origin, centerline, corridorAt, keepRadius, bbox } = params;
  const center = new CenterlineIndex(centerline, corridorAt);
  const project = (pts: OverpassPoint[]): Point2[] =>
    projectLonLat(pts.map((p): LonLat => [p.lon, p.lat]), origin).map(
      ([x, z]): Point2 => [round2(x), round2(z)],
    );

  const oldCityAreas: Point2[][] = [];
  const coastlines: OverpassElement[] = [];
  const buildings: Building[] = [];
  const walls: Wall[] = [];
  const water: Point2[][] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const rings = elementRings(el);
    if (rings.length > 0 && tags.historic !== undefined) {
      for (const ring of rings) oldCityAreas.push(project(ring));
    }
    if (el.type === 'way' && tags.natural === 'coastline' && el.geometry) coastlines.push(el);
  }

  for (const el of elements) {
    const tags = el.tags ?? {};
    const isBuilding =
      (tags.building !== undefined && tags.building !== 'no') ||
      tags['building:part'] !== undefined;
    if (isBuilding) {
      const height = heightOf(tags);
      if (!(height > 0)) continue;
      for (const ring of elementRings(el)) {
        const pts = project(ring);
        if (pts.length < 3) continue;
        if (!center.anyPointCloserThan(pts, keepRadius)) continue;
        if (center.anyEdgeCloserThan(pts)) continue;
        const insideOldCity = oldCityAreas.some((area) => pointInPolygon(pts[0], area));
        buildings.push({ ring: pts, height, material: materialOf(tags, height, insideOldCity) });
      }
      continue;
    }
    if (el.type === 'way' && isWallWay(tags) && el.geometry && el.geometry.length >= 2) {
      const pts = project(dropDuplicateClose(el.geometry));
      if (pts.length < 2) continue;
      if (!center.anyPointCloserThan(pts, keepRadius)) continue;
      const inOldCity = oldCityAreas.some((area) => pts.some((p) => pointInPolygon(p, area)));
      if (!inOldCity) continue;
      walls.push({ line: pts, height: WALL_HEIGHT, thickness: WALL_THICKNESS });
      continue;
    }
    if (elementRings(el).length > 0 && isWaterTagged(tags)) {
      for (const ring of elementRings(el)) {
        const pts = project(ring);
        if (pts.length < 3) continue;
        if (!center.anyPointCloserThan(pts, keepRadius)) continue;
        water.push(pts);
      }
    }
  }

  for (const ring of coastlineWaterRings(coastlines, bbox)) {
    const pts = project(ring);
    if (pts.length < 3) continue;
    if (!center.anyPointCloserThan(pts, keepRadius)) continue;
    water.push(pts);
  }

  buildings.sort((a, b) => byFirstVertex(a.ring, b.ring));
  walls.sort((a, b) => byFirstVertex(a.line, b.line));
  water.sort(byFirstVertex);
  return { buildings: capBuildings(buildings, centerline, params.maxBuildings), walls, water };
}

/** Minimum distance from any ring vertex to the nearest centerline segment (metres). */
function minVertexCenterlineDist(ring: Point2[], centerline: Point2[]): number {
  let best = Infinity;
  const n = centerline.length;
  for (const p of ring) {
    for (let i = 0; i < n; i++) {
      const a = centerline[i];
      const b = centerline[(i + 1) % n];
      const d = pointSegDist2(p[0], p[1], a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function capBuildings(
  buildings: Building[],
  centerline: Point2[],
  maxBuildings: number | undefined,
): Building[] {
  if (maxBuildings === undefined) return buildings;
  if (maxBuildings <= 0) throw new Error(`maxBuildings must be positive, got ${maxBuildings}`);
  if (buildings.length <= maxBuildings) return buildings;
  const scored = buildings.map((b, i) => ({ i, d: minVertexCenterlineDist(b.ring, centerline) }));
  scored.sort((a, b) => a.d - b.d || a.i - b.i);
  const keep = new Set(scored.slice(0, maxBuildings).map((s) => s.i));
  return buildings.filter((_, i) => keep.has(i));
}
