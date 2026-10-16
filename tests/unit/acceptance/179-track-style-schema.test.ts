import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BarrierSegment, Side, TrackSegment } from '../../../src/core/types';
import { isBlue, isCream, isGreen, isGrey, isRed, isTeal, isWhite, isYellow } from './helpers/colour';

// Spec-179 signatures, typed locally and loaded through a variable specifier so
// this test-first file typechecks before the module exists (the 162/173 pattern).
const TRACK_STYLE_MODULE = '../../../src/track/trackStyle';

type Hex = string;

interface StyleRange {
  start: number;
  end: number;
  side?: Side;
}
interface KerbRange extends StyleRange {
  colors?: [Hex, Hex];
  outerStrip?: Hex;
}
type RunoffPattern = 'none' | 'solid' | 'stripes' | 'bands';
interface RunoffPaintRange extends StyleRange {
  pattern?: RunoffPattern;
  colors?: Hex[];
  stripeMeters?: number;
}
interface BarrierStyleRange extends StyleRange {
  fenceHeightMeters: number;
}
type PitRoofStyle = 'flat' | 'canopy' | 'folded' | 'sail' | 'curved';
type PropType = 'footbridge' | 'marshalPost' | 'tent' | 'scoreboard' | 'billboardRow' | 'tower';
interface ExtraGrandstand {
  start: number;
  end: number;
  side: Side;
  offsetMeters: number;
  rows: number;
  roof: boolean;
}
interface FloodlightStyle {
  style: 'arm' | 'mast';
  heightMeters: number;
  heads: number;
  spacingMeters: number;
  offsetMeters: number;
  side: 'both' | Side;
  ranges: StyleRange[];
}
interface TrackProp {
  type: PropType;
  index: number;
  side: Side;
  offsetMeters: number;
  lengthMeters: number;
  heightMeters: number;
  color: Hex | null;
}
interface ResolvedTrackStyle {
  version: 1;
  palette: { asphalt: Hex | null; grass: Hex | null; gravel: Hex | null };
  edgeLines: { color: Hex | null };
  kerbs: { colors: [Hex, Hex] | null; outerStrip: Hex | null; ranges: KerbRange[] };
  runoffPaint: {
    pattern: RunoffPattern;
    colors: Hex[];
    stripeMeters: number;
    ranges: RunoffPaintRange[];
  };
  barriers: {
    concrete: { color: Hex | null; bandColor: Hex | null };
    armco: { color: Hex | null };
    tyres: { beltColor: Hex | null };
    foam: { colors: [Hex, Hex] | null };
    fence: { heightMeters: number; types: BarrierSegment['type'][]; color: Hex | null };
    ranges: BarrierStyleRange[];
  };
  pitBuilding: {
    storeys: number;
    heightMeters: number;
    depthMeters: number;
    facade: Hex;
    roof: Hex | null;
    doors: Hex;
    accent: Hex | null;
    roofStyle: PitRoofStyle;
    glazing: number;
  };
  grandstands: {
    structure: Hex | null;
    roof: Hex | null;
    seats: Hex[] | null;
    roofStyle: 'flat' | 'sail' | 'truss';
  };
  extraGrandstands: ExtraGrandstand[];
  floodlights: FloodlightStyle | null;
  props: TrackProp[];
  sky: { hdri: string | null; fogDensityScale: number };
}
interface ParseResult {
  style: ResolvedTrackStyle;
  errors: string[];
  warnings: string[];
}
interface TrackStyleModule {
  DEFAULT_TRACK_STYLE: ResolvedTrackStyle;
  parseTrackStyle: (raw: unknown, pointCount: number) => ParseResult;
  rangeContains: (range: StyleRange, index: number, pointCount: number) => boolean;
  segmentOverride: <R extends StyleRange>(
    ranges: readonly R[],
    segment: TrackSegment,
    pointCount: number,
  ) => R | null;
}

async function loadTrackStyle(): Promise<TrackStyleModule> {
  return (await import(TRACK_STYLE_MODULE)) as TrackStyleModule;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const v of Object.values(value)) deepFreeze(v);
  Object.freeze(value);
}

/** AT18 input: every section, all values inside the design limits. */
function fullInput() {
  return {
    version: 1,
    palette: { asphalt: '#111111', grass: '#22aa22', gravel: '#888888' },
    edgeLines: { color: '#d0d0d0' },
    kerbs: {
      colors: ['#d02020', '#d0d0d0'],
      outerStrip: '#20a020',
      ranges: [{ start: 0, end: 10, side: 'left' }],
    },
    runoffPaint: {
      pattern: 'stripes',
      colors: ['#d02020', '#d0d0d0'],
      stripeMeters: 2,
      ranges: [{ start: 5, end: 15, side: 'right' }],
    },
    barriers: {
      concrete: { color: '#999999', bandColor: '#2020d0' },
      armco: { color: '#cccccc' },
      tyres: { beltColor: '#111111' },
      foam: { colors: ['#d02020', '#d0d0d0'] },
      fence: { heightMeters: 4, types: ['armco', 'tyres'], color: '#20a020' },
      ranges: [{ start: 0, end: 9, fenceHeightMeters: 4 }],
    },
    pitBuilding: {
      storeys: 2,
      heightMeters: 9,
      depthMeters: 15,
      facade: '#b8bcc0',
      roof: '#333333',
      doors: '#1c1c1e',
      accent: '#d02020',
      roofStyle: 'folded',
      glazing: 0.3,
    },
    grandstands: {
      structure: '#aaaaaa',
      roof: '#bbbbbb',
      seats: ['#d02020', '#2040d0'],
      roofStyle: 'truss',
    },
    extraGrandstands: [{ start: 10, end: 20, side: 'left' }],
    floodlights: {
      style: 'mast',
      heightMeters: 12,
      heads: 2,
      spacingMeters: 30,
      offsetMeters: 6,
      side: 'both',
      ranges: [{ start: 0, end: 50 }],
    },
    props: [{ type: 'tent', index: 0, side: 'left' }],
    sky: { hdri: 'qwantani_noon_puresky', fogDensityScale: 1.5 },
  };
}

describe('179 track style schema acceptance', () => {
  it('AT1: {version: 1} parses to the defaults with no errors or warnings', async () => {
    const { parseTrackStyle, DEFAULT_TRACK_STYLE } = await loadTrackStyle();
    const r = parseTrackStyle({ version: 1 }, 100);
    expect(r.style).toEqual(DEFAULT_TRACK_STYLE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('AT2: null raw parses to the defaults with no errors', async () => {
    const { parseTrackStyle, DEFAULT_TRACK_STYLE } = await loadTrackStyle();
    const r = parseTrackStyle(null, 100);
    expect(r.style).toEqual(DEFAULT_TRACK_STYLE);
    expect(r.errors).toEqual([]);
  });

  it('AT3: DEFAULT_TRACK_STYLE matches the design defaults', async () => {
    const { DEFAULT_TRACK_STYLE: s } = await loadTrackStyle();
    expect(s.pitBuilding).toEqual({
      storeys: 1,
      heightMeters: 4,
      depthMeters: 8,
      facade: '#b8bcc0',
      roof: null,
      doors: '#1c1c1e',
      accent: null,
      roofStyle: 'flat',
      glazing: 0,
    });
    expect(s.barriers.fence).toEqual({ heightMeters: 3, types: ['armco'], color: null });
    expect(s.kerbs.colors).toBeNull();
    expect(s.runoffPaint.pattern).toBe('none');
    expect(s.floodlights).toBeNull();
    expect(s.props).toEqual([]);
    expect(s.extraGrandstands).toEqual([]);
    expect(s.sky).toEqual({ hdri: null, fogDensityScale: 1 });
  });

  it('AT4: valid pitBuilding keys are kept, lower-cased and merged over defaults', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      {
        version: 1,
        pitBuilding: {
          storeys: 3,
          heightMeters: 12,
          facade: '#A1B2C3',
          roofStyle: 'folded',
          glazing: 0.5,
        },
      },
      100,
    );
    expect(r.style.pitBuilding.storeys).toBe(3);
    expect(r.style.pitBuilding.heightMeters).toBe(12);
    expect(r.style.pitBuilding.facade).toBe('#a1b2c3');
    expect(r.style.pitBuilding.roofStyle).toBe('folded');
    expect(r.style.pitBuilding.glazing).toBe(0.5);
    expect(r.style.pitBuilding.depthMeters).toBe(8);
    expect(r.style.pitBuilding.doors).toBe('#1c1c1e');
  });

  it('AT5: version 2 gives exactly one error containing version and the defaults', async () => {
    const { parseTrackStyle, DEFAULT_TRACK_STYLE } = await loadTrackStyle();
    const r = parseTrackStyle({ version: 2 }, 100);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('version');
    expect(r.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('AT6: storeys 6 errors on pitBuilding.storeys, falls back to 1 and keeps facade', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      { version: 1, pitBuilding: { storeys: 6, facade: '#dadada' } },
      100,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('pitBuilding.storeys');
    expect(r.style.pitBuilding.storeys).toBe(1);
    expect(r.style.pitBuilding.facade).toBe('#dadada');
  });

  it('AT7: kerbs.colors with 1 or 3 colours errors once and leaves colours null', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    for (const colors of [
      ['#fff', '#000000'],
      ['#ff0000', '#ffffff', '#000000'],
    ]) {
      const r = parseTrackStyle({ version: 1, kerbs: { colors } }, 100);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain('kerbs.colors');
      expect(r.style.kerbs.colors).toBeNull();
    }
  });

  it('AT8: unknown top-level and section keys warn without errors', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle({ version: 1, foo: 1, pitBuilding: { bar: 2 } }, 100);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes('foo'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('pitBuilding.bar'))).toBe(true);
  });

  it('AT9: barrier range past pointCount errors and is dropped, the valid one is kept', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      {
        version: 1,
        barriers: {
          ranges: [
            { start: 0, end: 100, fenceHeightMeters: 4 },
            { start: 90, end: 99, side: 'left', fenceHeightMeters: 5 },
          ],
        },
      },
      100,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('barriers.ranges[0]');
    expect(r.style.barriers.ranges).toEqual([
      { start: 90, end: 99, side: 'left', fenceHeightMeters: 5 },
    ]);
  });

  it('AT10: rangeContains is inclusive at both ends and wraps when end < start', async () => {
    const { rangeContains } = await loadTrackStyle();
    const wrap = { start: 90, end: 10 };
    expect(rangeContains(wrap, 95, 100)).toBe(true);
    expect(rangeContains(wrap, 5, 100)).toBe(true);
    expect(rangeContains(wrap, 0, 100)).toBe(true);
    expect(rangeContains(wrap, 10, 100)).toBe(true);
    expect(rangeContains(wrap, 50, 100)).toBe(false);
    const span = { start: 10, end: 20 };
    expect(rangeContains(span, 10, 100)).toBe(true);
    expect(rangeContains(span, 20, 100)).toBe(true);
    expect(rangeContains(span, 21, 100)).toBe(false);
  });

  it('AT11: segmentOverride returns the last matching range or null, same references', async () => {
    const { segmentOverride } = await loadTrackStyle();
    const A: StyleRange = { start: 0, end: 50, side: 'left' };
    const B: StyleRange = { start: 40, end: 60 };
    const ranges = [A, B];
    expect(segmentOverride(ranges, { start: 45, end: 70, side: 'left' }, 100)).toBe(B);
    expect(segmentOverride(ranges, { start: 45, end: 70, side: 'right' }, 100)).toBe(B);
    expect(segmentOverride(ranges, { start: 10, end: 20, side: 'left' }, 100)).toBe(A);
    expect(segmentOverride(ranges, { start: 10, end: 20, side: 'right' }, 100)).toBe(null);
  });

  it('AT12: 61 props give one props error and empty props', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const props = Array.from({ length: 61 }, (_, i) => ({ type: 'tent', index: i, side: 'left' }));
    const r = parseTrackStyle({ version: 1, props }, 100);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('props');
    expect(r.style.props).toEqual([]);
  });

  it('AT13: invalid prop type is dropped with a props[1] error and the valid one gets defaults', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      {
        version: 1,
        props: [
          { type: 'tent', index: 5, side: 'left' },
          { type: 'rocket', index: 6, side: 'left' },
        ],
      },
      100,
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('props[1]');
    expect(r.style.props).toHaveLength(1);
    expect(r.style.props[0].type).toBe('tent');
    expect(r.style.props[0].offsetMeters).toBe(10);
    expect(r.style.props[0].lengthMeters).toBe(10);
    expect(r.style.props[0].heightMeters).toBe(4);
    expect(r.style.props[0].color).toBeNull();
  });

  it('AT14: floodlights with only spacingMeters filled gets the other defaults', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle({ version: 1, floodlights: { spacingMeters: 30 } }, 100);
    expect(r.style.floodlights).toEqual({
      style: 'arm',
      heightMeters: 8,
      heads: 1,
      spacingMeters: 30,
      offsetMeters: 6,
      side: 'both',
      ranges: [],
    });
  });

  it('AT15: out-of-limit floodlight keys error, take their default and stay non-null', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const a = parseTrackStyle({ version: 1, floodlights: { spacingMeters: 5 } }, 100);
    expect(a.errors).toHaveLength(1);
    expect(a.errors[0]).toContain('floodlights.spacingMeters');
    expect(a.style.floodlights).not.toBeNull();
    expect(a.style.floodlights?.spacingMeters).toBe(20);
    const b = parseTrackStyle({ version: 1, floodlights: { heightMeters: 41 } }, 100);
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]).toContain('floodlights.heightMeters');
    expect(b.style.floodlights).not.toBeNull();
    expect(b.style.floodlights?.heightMeters).toBe(8);
  });

  it('AT16: extra grandstand entry gets the offset, rows and roof defaults', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 10, end: 20, side: 'left' }] },
      100,
    );
    expect(r.style.extraGrandstands[0]).toEqual({
      start: 10,
      end: 20,
      side: 'left',
      offsetMeters: 15,
      rows: 12,
      roof: true,
    });
  });

  it('AT17: unknown sky.hdri errors and falls back to null, a SKY_NAMES entry is kept', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const bad = parseTrackStyle({ version: 1, sky: { hdri: 'unknown_sky' } }, 100);
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('sky.hdri');
    expect(bad.style.sky.hdri).toBeNull();
    const good = parseTrackStyle(
      { version: 1, sky: { hdri: 'kloofendal_overcast_puresky' } },
      100,
    );
    expect(good.errors).toEqual([]);
    expect(good.style.sky.hdri).toBe('kloofendal_overcast_puresky');
  });

  it('AT18: a deep-frozen full input parses without throwing and shares no object', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const raw = fullInput();
    deepFreeze(raw);
    const r = parseTrackStyle(raw, 100);
    expect(r.style.props).toHaveLength(1);
    expect(r.style.props[0]).not.toBe(raw.props[0]);
    r.style.props[0].type = 'tower';
    expect(raw.props[0].type).toBe('tent');
  });

  it('AT19: src/track/trackStyle.ts imports nothing from three', () => {
    const file = fileURLToPath(new URL('../../../src/track/trackStyle.ts', import.meta.url));
    const src = readFileSync(file, 'utf8');
    expect(src).not.toContain("from 'three'");
  });

  it('AT20: colour helper predicates classify the design samples', () => {
    expect(isRed('#d0432d')).toBe(true);
    expect(isGreen('#58d23a')).toBe(true);
    expect(isCream('#cdb89a')).toBe(true);
    expect(isWhite('#ffffff')).toBe(true);
    expect(isGrey('#808080')).toBe(true);
    expect(isBlue('#1f4fbf')).toBe(true);
    expect(isYellow('#f2c400')).toBe(true);
    expect(isTeal('#1f9e8f')).toBe(true);
    expect(isRed('#58d23a')).toBe(false);
    expect(isGreen('#d0432d')).toBe(false);
    expect(isWhite('#cdb89a')).toBe(false);
  });

  it('AT21: facade and doors channels above 0xda clamp with one warning each', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      { version: 1, pitBuilding: { facade: '#ffffff', doors: '#f0e0d0' } },
      100,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes('pitBuilding.facade'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('pitBuilding.doors'))).toBe(true);
    expect(r.style.pitBuilding.facade).toBe('#dadada');
    expect(r.style.pitBuilding.doors).toBe('#dadad0');
  });
});
