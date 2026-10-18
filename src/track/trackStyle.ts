import type { BarrierSegment, Side, TrackSegment } from '../core/types';

export type Hex = string;
export interface StyleRange { start: number; end: number; side?: Side }
export interface KerbRange extends StyleRange { colors?: [Hex, Hex]; outerStrip?: Hex }
export type RunoffPattern = 'none' | 'solid' | 'stripes' | 'bands';
export interface RunoffPaintRange extends StyleRange { pattern?: RunoffPattern; colors?: Hex[]; stripeMeters?: number }
export interface BarrierStyleRange extends StyleRange { fenceHeightMeters: number }
export type PitRoofStyle = 'flat' | 'canopy' | 'folded' | 'sail' | 'curved';
export type PropType = 'footbridge' | 'marshalPost' | 'tent' | 'scoreboard' | 'billboardRow' | 'tower';
export interface ExtraGrandstand { start: number; end: number; side: Side; offsetMeters: number; rows: number; roof: boolean }
export interface FloodlightStyle { style: 'arm' | 'mast'; heightMeters: number; heads: number; spacingMeters: number; offsetMeters: number; side: 'both' | Side; ranges: StyleRange[] }
export interface TrackProp { type: PropType; index: number; side: Side; offsetMeters: number; lengthMeters: number; heightMeters: number; color: Hex | null }
export interface ResolvedTrackStyle {
  version: 1;
  palette: { asphalt: Hex | null; grass: Hex | null; gravel: Hex | null };
  edgeLines: { color: Hex | null };
  kerbs: { colors: [Hex, Hex] | null; outerStrip: Hex | null; ranges: KerbRange[] };
  runoffPaint: { pattern: RunoffPattern; colors: Hex[]; stripeMeters: number; ranges: RunoffPaintRange[] };
  barriers: {
    concrete: { color: Hex | null; bandColor: Hex | null }; armco: { color: Hex | null };
    tyres: { beltColor: Hex | null }; foam: { colors: [Hex, Hex] | null };
    fence: { heightMeters: number; types: BarrierSegment['type'][]; color: Hex | null };
    ranges: BarrierStyleRange[];
  };
  pitBuilding: { storeys: number; heightMeters: number; depthMeters: number; facade: Hex; roof: Hex | null; doors: Hex; accent: Hex | null; roofStyle: PitRoofStyle; glazing: number };
  grandstands: { structure: Hex | null; roof: Hex | null; seats: Hex[] | null; roofStyle: 'flat' | 'sail' | 'truss' };
  extraGrandstands: ExtraGrandstand[];
  floodlights: FloodlightStyle | null;
  props: TrackProp[];
  sky: { hdri: string | null; fogDensityScale: number };
}

export const SKY_NAMES: readonly string[] = [
  'kloofendal_48d_partly_cloudy_puresky',
  'kloofendal_overcast_puresky',
  'qwantani_noon_puresky',
];

function makeDefault(): ResolvedTrackStyle {
  return {
    version: 1,
    palette: { asphalt: null, grass: null, gravel: null },
    edgeLines: { color: null },
    kerbs: { colors: null, outerStrip: null, ranges: [] },
    runoffPaint: { pattern: 'none', colors: [], stripeMeters: 2, ranges: [] },
    barriers: {
      concrete: { color: null, bandColor: null },
      armco: { color: null },
      tyres: { beltColor: null },
      foam: { colors: null },
      fence: { heightMeters: 3, types: ['armco'], color: null },
      ranges: [],
    },
    pitBuilding: { storeys: 1, heightMeters: 4, depthMeters: 8, facade: '#b8bcc0', roof: null, doors: '#1c1c1e', accent: null, roofStyle: 'flat', glazing: 0 },
    grandstands: { structure: null, roof: null, seats: null, roofStyle: 'flat' },
    extraGrandstands: [],
    floodlights: null,
    props: [],
    sky: { hdri: null, fogDensityScale: 1 },
  };
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    Object.values(v as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

export const DEFAULT_TRACK_STYLE: ResolvedTrackStyle = deepFreeze(makeDefault());

type Obj = Record<string, unknown>;
interface Ctx { errors: string[]; warnings: string[] }

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const CHANNEL_CAP = 0xda;
const PIT_ROOFS: readonly string[] = ['flat', 'canopy', 'folded', 'sail', 'curved'];
const STAND_ROOFS: readonly string[] = ['flat', 'sail', 'truss'];
const PATTERNS: readonly string[] = ['none', 'solid', 'stripes', 'bands'];
const PROP_TYPES: readonly string[] = ['footbridge', 'marshalPost', 'tent', 'scoreboard', 'billboardRow', 'tower'];
const FENCE_TYPES: readonly string[] = ['armco', 'tyres', 'wall', 'foam'];
const SIDES: readonly string[] = ['left', 'right'];

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const join = (p: string, k: string): string => (p ? `${p}.${k}` : k);

function fail(c: Ctx, path: string, reason: string): void {
  c.errors.push(`${path}: ${reason}`);
}

function num(c: Ctx, o: Obj, p: string, key: string, min: number, max: number, int = false): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
    fail(c, join(p, key), `must be ${int ? 'an integer ' : ''}${min}-${max}`);
    return undefined;
  }
  return v;
}

function oneOf<T extends string>(c: Ctx, o: Obj, p: string, key: string, list: readonly string[]): T | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !list.includes(v)) {
    fail(c, join(p, key), `must be one of ${list.join(', ')}`);
    return undefined;
  }
  return v as T;
}

function normHex(c: Ctx, v: unknown, path: string, cap = true): Hex | undefined {
  if (typeof v !== 'string' || !HEX_RE.test(v)) return undefined;
  const lower = v.toLowerCase();
  let clamped = false;
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    let ch = parseInt(lower.slice(i, i + 2), 16);
    if (cap && ch > CHANNEL_CAP) { ch = CHANNEL_CAP; clamped = true; }
    out += ch.toString(16).padStart(2, '0');
  }
  if (clamped) c.warnings.push(`${path}: channel above #dadada clamped`);
  return out;
}

function hex(c: Ctx, o: Obj, p: string, key: string): Hex | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  const h = normHex(c, v, join(p, key));
  if (h === undefined) fail(c, join(p, key), 'must be a #rrggbb colour');
  return h;
}

function hexList(c: Ctx, o: Obj, p: string, key: string, min: number, max: number, cap = true): Hex[] | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  const path = join(p, key);
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    fail(c, path, min === max ? `must be exactly ${min} colours` : `must be ${min}-${max} colours`);
    return undefined;
  }
  const out: Hex[] = [];
  for (let i = 0; i < v.length; i++) {
    const h = normHex(c, v[i], `${path}[${i}]`, cap);
    if (h === undefined) {
      fail(c, path, 'must contain #rrggbb colours');
      return undefined;
    }
    out.push(h);
  }
  return out;
}

function section(c: Ctx, parent: Obj, p: string, key: string, keys: readonly string[]): Obj | undefined {
  const v = parent[key];
  if (v === undefined || v === null) return undefined;
  const path = join(p, key);
  if (!isObj(v)) {
    fail(c, path, 'must be an object');
    return undefined;
  }
  for (const k of Object.keys(v)) if (!keys.includes(k)) c.warnings.push(`${join(path, k)}: unknown key`);
  return v;
}

function parseRange(c: Ctx, e: Obj, p: string, pointCount: number, sideRequired: boolean): StyleRange | undefined {
  const last = pointCount - 1;
  const start = num(c, e, p, 'start', 0, last, true);
  const end = num(c, e, p, 'end', 0, last, true);
  if (start === undefined && e.start === undefined) fail(c, join(p, 'start'), 'is required');
  if (end === undefined && e.end === undefined) fail(c, join(p, 'end'), 'is required');
  const side = oneOf<Side>(c, e, p, 'side', SIDES);
  if (side === undefined && sideRequired && e.side === undefined) fail(c, join(p, 'side'), 'is required');
  if (start === undefined || end === undefined) return undefined;
  const r: StyleRange = { start, end };
  if (side !== undefined) r.side = side;
  return r;
}

// Validates each entry in its own context: any entry error drops it and reports once.
function parseEntries<T>(
  c: Ctx, raw: unknown, p: string, entry: (sub: Ctx, e: Obj, path: string) => T | undefined,
): T[] {
  const out: T[] = [];
  if (raw === undefined || raw === null) return out;
  if (!Array.isArray(raw)) {
    fail(c, p, 'must be an array');
    return out;
  }
  raw.forEach((e, i) => {
    const path = `${p}[${i}]`;
    if (!isObj(e)) {
      fail(c, path, 'must be an object');
      return;
    }
    const sub: Ctx = { errors: [], warnings: [] };
    const r = entry(sub, e, path);
    if (sub.errors.length > 0 || r === undefined) {
      c.errors.push(sub.errors[0] ?? `${path}: invalid`);
      return;
    }
    c.warnings.push(...sub.warnings);
    out.push(r);
  });
  return out;
}

function rangeList<T extends StyleRange>(
  c: Ctx, raw: unknown, p: string, pointCount: number,
  extra: (sub: Ctx, e: Obj, path: string, r: StyleRange) => T | undefined,
): T[] {
  return parseEntries(c, raw, p, (sub, e, path) => {
    const r = parseRange(sub, e, path, pointCount, false);
    return r ? extra(sub, e, path, r) : undefined;
  });
}

function withKey<T extends object, K extends string, V>(o: T, k: K, v: V | undefined): T & { [P in K]?: V } {
  if (v !== undefined) (o as Record<string, unknown>)[k] = v;
  return o as T & { [P in K]?: V };
}

export function parseTrackStyle(raw: unknown, pointCount: number): { style: ResolvedTrackStyle; errors: string[]; warnings: string[] } {
  const style = makeDefault();
  const c: Ctx = { errors: [], warnings: [] };
  const done = () => ({ style, errors: c.errors, warnings: c.warnings });
  if (raw === null || raw === undefined) return done();
  if (!isObj(raw) || raw.version !== 1) {
    fail(c, 'version', 'must be 1');
    return done();
  }
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) c.warnings.push(`${k}: unknown key`);
  }

  const pal = section(c, raw, '', 'palette', ['asphalt', 'grass', 'gravel']);
  if (pal) {
    for (const k of ['asphalt', 'grass', 'gravel'] as const) style.palette[k] = hex(c, pal, 'palette', k) ?? null;
  }

  const edge = section(c, raw, '', 'edgeLines', ['color']);
  if (edge) style.edgeLines.color = hex(c, edge, 'edgeLines', 'color') ?? null;

  const kerbs = section(c, raw, '', 'kerbs', ['colors', 'outerStrip', 'ranges']);
  if (kerbs) {
    const colors = hexList(c, kerbs, 'kerbs', 'colors', 2, 2);
    style.kerbs.colors = colors ? [colors[0], colors[1]] : null;
    style.kerbs.outerStrip = hex(c, kerbs, 'kerbs', 'outerStrip') ?? null;
    style.kerbs.ranges = rangeList<KerbRange>(c, kerbs.ranges, 'kerbs.ranges', pointCount, (sub, e, path, r) => {
      const cols = hexList(sub, e, path, 'colors', 2, 2);
      const k: KerbRange = { ...r };
      if (cols) k.colors = [cols[0], cols[1]];
      return withKey(k, 'outerStrip', hex(sub, e, path, 'outerStrip'));
    });
  }

  const rp = section(c, raw, '', 'runoffPaint', ['pattern', 'colors', 'stripeMeters', 'ranges']);
  if (rp) {
    style.runoffPaint.pattern = oneOf<RunoffPattern>(c, rp, 'runoffPaint', 'pattern', PATTERNS) ?? 'none';
    style.runoffPaint.colors = hexList(c, rp, 'runoffPaint', 'colors', 1, 4, false) ?? [];
    style.runoffPaint.stripeMeters = num(c, rp, 'runoffPaint', 'stripeMeters', 0.5, 10) ?? 2;
    style.runoffPaint.ranges = rangeList<RunoffPaintRange>(c, rp.ranges, 'runoffPaint.ranges', pointCount, (sub, e, path, r) => {
      const k: RunoffPaintRange = { ...r };
      withKey(k, 'pattern', oneOf<RunoffPattern>(sub, e, path, 'pattern', PATTERNS));
      withKey(k, 'colors', hexList(sub, e, path, 'colors', 1, 4, false));
      return withKey(k, 'stripeMeters', num(sub, e, path, 'stripeMeters', 0.5, 10));
    });
  }

  const bar = section(c, raw, '', 'barriers', ['concrete', 'armco', 'tyres', 'foam', 'fence', 'ranges']);
  if (bar) {
    const b = style.barriers;
    const concrete = section(c, bar, 'barriers', 'concrete', ['color', 'bandColor']);
    if (concrete) {
      b.concrete.color = hex(c, concrete, 'barriers.concrete', 'color') ?? null;
      b.concrete.bandColor = hex(c, concrete, 'barriers.concrete', 'bandColor') ?? null;
    }
    const armco = section(c, bar, 'barriers', 'armco', ['color']);
    if (armco) b.armco.color = hex(c, armco, 'barriers.armco', 'color') ?? null;
    const tyres = section(c, bar, 'barriers', 'tyres', ['beltColor']);
    if (tyres) b.tyres.beltColor = hex(c, tyres, 'barriers.tyres', 'beltColor') ?? null;
    const foam = section(c, bar, 'barriers', 'foam', ['colors']);
    if (foam) {
      const cols = hexList(c, foam, 'barriers.foam', 'colors', 2, 2);
      b.foam.colors = cols ? [cols[0], cols[1]] : null;
    }
    const fence = section(c, bar, 'barriers', 'fence', ['heightMeters', 'types', 'color']);
    if (fence) {
      b.fence.heightMeters = num(c, fence, 'barriers.fence', 'heightMeters', 0, 8) ?? 3;
      const t = fence.types;
      if (t !== undefined && t !== null) {
        if (Array.isArray(t) && t.every((x) => typeof x === 'string' && FENCE_TYPES.includes(x))) {
          b.fence.types = [...t] as BarrierSegment['type'][];
        } else {
          fail(c, 'barriers.fence.types', `must be an array of ${FENCE_TYPES.join(', ')}`);
        }
      }
      b.fence.color = hex(c, fence, 'barriers.fence', 'color') ?? null;
    }
    b.ranges = rangeList<BarrierStyleRange>(c, bar.ranges, 'barriers.ranges', pointCount, (sub, e, path, r) => {
      const h = num(sub, e, path, 'fenceHeightMeters', 0, 8);
      if (h === undefined) {
        if (e.fenceHeightMeters === undefined || e.fenceHeightMeters === null) fail(sub, join(path, 'fenceHeightMeters'), 'is required');
        return undefined;
      }
      return { ...r, fenceHeightMeters: h };
    });
  }

  const pit = section(c, raw, '', 'pitBuilding', ['storeys', 'heightMeters', 'depthMeters', 'facade', 'roof', 'doors', 'accent', 'roofStyle', 'glazing']);
  if (pit) {
    const d = style.pitBuilding;
    d.storeys = num(c, pit, 'pitBuilding', 'storeys', 1, 5, true) ?? d.storeys;
    d.heightMeters = num(c, pit, 'pitBuilding', 'heightMeters', 3, 40) ?? d.heightMeters;
    d.depthMeters = num(c, pit, 'pitBuilding', 'depthMeters', 5, 40) ?? d.depthMeters;
    d.facade = hex(c, pit, 'pitBuilding', 'facade') ?? d.facade;
    d.roof = hex(c, pit, 'pitBuilding', 'roof') ?? null;
    d.doors = hex(c, pit, 'pitBuilding', 'doors') ?? d.doors;
    d.accent = hex(c, pit, 'pitBuilding', 'accent') ?? null;
    d.roofStyle = oneOf<PitRoofStyle>(c, pit, 'pitBuilding', 'roofStyle', PIT_ROOFS) ?? d.roofStyle;
    d.glazing = num(c, pit, 'pitBuilding', 'glazing', 0, 1) ?? d.glazing;
  }

  const gs = section(c, raw, '', 'grandstands', ['structure', 'roof', 'seats', 'roofStyle']);
  if (gs) {
    style.grandstands.structure = hex(c, gs, 'grandstands', 'structure') ?? null;
    style.grandstands.roof = hex(c, gs, 'grandstands', 'roof') ?? null;
    style.grandstands.seats = hexList(c, gs, 'grandstands', 'seats', 1, 4) ?? null;
    style.grandstands.roofStyle = oneOf<'flat' | 'sail' | 'truss'>(c, gs, 'grandstands', 'roofStyle', STAND_ROOFS) ?? 'flat';
  }

  style.extraGrandstands = parseEntries<ExtraGrandstand>(c, raw.extraGrandstands, 'extraGrandstands', (sub, e, path) => {
    const r = parseRange(sub, e, path, pointCount, true);
    if (!r || !r.side) return undefined;
    const offsetMeters = num(sub, e, path, 'offsetMeters', 0, 200) ?? 15;
    const rows = num(sub, e, path, 'rows', 4, 40, true) ?? 12;
    let roof = true;
    if (e.roof !== undefined && e.roof !== null) {
      if (typeof e.roof === 'boolean') roof = e.roof;
      else fail(sub, join(path, 'roof'), 'must be a boolean');
    }
    return { start: r.start, end: r.end, side: r.side, offsetMeters, rows, roof };
  });

  if (raw.floodlights !== undefined && raw.floodlights !== null) {
    const fl = section(c, raw, '', 'floodlights', ['style', 'heightMeters', 'heads', 'spacingMeters', 'offsetMeters', 'side', 'ranges']);
    if (fl) {
      style.floodlights = {
        style: oneOf<'arm' | 'mast'>(c, fl, 'floodlights', 'style', ['arm', 'mast']) ?? 'arm',
        heightMeters: num(c, fl, 'floodlights', 'heightMeters', 4, 40) ?? 8,
        heads: num(c, fl, 'floodlights', 'heads', 1, 12, true) ?? 1,
        spacingMeters: num(c, fl, 'floodlights', 'spacingMeters', 10, 120) ?? 20,
        offsetMeters: num(c, fl, 'floodlights', 'offsetMeters', 0, 200) ?? 6,
        side: oneOf<'both' | Side>(c, fl, 'floodlights', 'side', ['both', 'left', 'right']) ?? 'both',
        ranges: rangeList<StyleRange>(c, fl.ranges, 'floodlights.ranges', pointCount, (_s, _e, _p, r) => r),
      };
    }
  }

  if (Array.isArray(raw.props) && raw.props.length > 60) {
    fail(c, 'props', 'at most 60 entries');
  } else {
    style.props = parseEntries<TrackProp>(c, raw.props, 'props', (sub, e, path) => {
      const type = oneOf<PropType>(sub, e, path, 'type', PROP_TYPES);
      if (type === undefined) {
        if (e.type === undefined || e.type === null) fail(sub, join(path, 'type'), 'is required');
        return undefined;
      }
      const index = num(sub, e, path, 'index', 0, pointCount - 1, true);
      if (index === undefined) {
        if (e.index === undefined || e.index === null) fail(sub, join(path, 'index'), 'is required');
        return undefined;
      }
      return {
        type,
        index,
        side: oneOf<Side>(sub, e, path, 'side', SIDES) ?? 'left',
        offsetMeters: num(sub, e, path, 'offsetMeters', 0, 200) ?? 10,
        lengthMeters: num(sub, e, path, 'lengthMeters', 1, 200) ?? 10,
        heightMeters: num(sub, e, path, 'heightMeters', 1, 40) ?? 4,
        color: hex(sub, e, path, 'color') ?? null,
      };
    });
  }

  const sky = section(c, raw, '', 'sky', ['hdri', 'fogDensityScale']);
  if (sky) {
    style.sky.hdri = oneOf<string>(c, sky, 'sky', 'hdri', SKY_NAMES) ?? null;
    style.sky.fogDensityScale = num(c, sky, 'sky', 'fogDensityScale', 0.25, 4) ?? 1;
  }

  return done();
}

const TOP_KEYS: readonly string[] = [
  'version', 'palette', 'edgeLines', 'kerbs', 'runoffPaint', 'barriers', 'pitBuilding',
  'grandstands', 'extraGrandstands', 'floodlights', 'props', 'sky',
];

export function rangeContains(range: StyleRange, index: number, pointCount: number): boolean {
  const i = pointCount > 0 ? ((index % pointCount) + pointCount) % pointCount : index;
  return range.start <= range.end ? i >= range.start && i <= range.end : i >= range.start || i <= range.end;
}

export function segmentOverride<R extends StyleRange>(ranges: readonly R[], segment: TrackSegment, pointCount: number): R | null {
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (rangeContains(r, segment.start, pointCount) && (r.side === undefined || r.side === segment.side)) return r;
  }
  return null;
}
