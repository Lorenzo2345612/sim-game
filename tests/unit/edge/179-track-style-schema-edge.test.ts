import { describe, expect, it } from 'vitest';
import type { Side } from '../../../src/core/types';

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
interface BarrierStyleRange extends StyleRange {
  fenceHeightMeters: number;
}
interface ExtraGrandstand {
  start: number;
  end: number;
  side: Side;
  offsetMeters: number;
  rows: number;
  roof: boolean;
}
interface TrackProp {
  type: string;
  index: number;
  side: Side;
  offsetMeters: number;
  lengthMeters: number;
  heightMeters: number;
  color: Hex | null;
}
interface Style {
  version: 1;
  palette: { asphalt: Hex | null; grass: Hex | null; gravel: Hex | null };
  edgeLines: { color: Hex | null };
  kerbs: { colors: [Hex, Hex] | null; outerStrip: Hex | null; ranges: KerbRange[] };
  runoffPaint: { pattern: string; colors: Hex[]; stripeMeters: number; ranges: unknown[] };
  barriers: {
    fence: { heightMeters: number; types: string[]; color: Hex | null };
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
    roofStyle: string;
    glazing: number;
  };
  grandstands: {
    structure: Hex | null;
    roof: Hex | null;
    seats: Hex[] | null;
    roofStyle: string;
  };
  extraGrandstands: ExtraGrandstand[];
  floodlights: unknown;
  props: TrackProp[];
  sky: { hdri: string | null; fogDensityScale: number };
}
interface ParseResult {
  style: Style;
  errors: string[];
  warnings: string[];
}
interface TrackStyleModule {
  DEFAULT_TRACK_STYLE: Style;
  parseTrackStyle: (raw: unknown, pointCount: number) => ParseResult;
}

async function loadTrackStyle(): Promise<TrackStyleModule> {
  return (await import(TRACK_STYLE_MODULE)) as TrackStyleModule;
}

describe('179 track style schema edge cases', () => {
  it('EDGE1: undefined raw parses to defaults; a non-object raw gives one version error', async () => {
    const { parseTrackStyle, DEFAULT_TRACK_STYLE } = await loadTrackStyle();
    const u = parseTrackStyle(undefined, 100);
    expect(u.style).toEqual(DEFAULT_TRACK_STYLE);
    expect(u.errors).toEqual([]);
    expect(u.warnings).toEqual([]);
    const n = parseTrackStyle(42, 100);
    expect(n.errors).toHaveLength(1);
    expect(n.errors[0]).toContain('version');
    expect(n.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('EDGE2: keys set to null are absent and floodlights null is the default', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const r = parseTrackStyle(
      { version: 1, pitBuilding: { storeys: null, facade: '#d02020' }, floodlights: null },
      100,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.style.pitBuilding.storeys).toBe(1);
    expect(r.style.pitBuilding.facade).toBe('#d02020');
    expect(r.style.floodlights).toBeNull();
  });

  it('EDGE3: a section that is not an object gives one error per section and its default', async () => {
    const { parseTrackStyle, DEFAULT_TRACK_STYLE } = await loadTrackStyle();
    const r = parseTrackStyle({ version: 1, pitBuilding: 5, kerbs: 'nope' }, 100);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.some((e) => e.includes('pitBuilding'))).toBe(true);
    expect(r.errors.some((e) => e.includes('kerbs'))).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.style.pitBuilding).toEqual(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(r.style.kerbs).toEqual(DEFAULT_TRACK_STYLE.kerbs);
  });

  it('EDGE4: channels equal to 0xda are kept, above it one warning per field clamps to 0xda', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const ok = parseTrackStyle({ version: 1, palette: { asphalt: '#da00da' } }, 100);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
    expect(ok.style.palette.asphalt).toBe('#da00da');
    const hot = parseTrackStyle(
      { version: 1, palette: { asphalt: '#db0000', grass: '#dbdbdb' } },
      100,
    );
    expect(hot.errors).toEqual([]);
    expect(hot.warnings).toHaveLength(2);
    expect(hot.warnings.some((w) => w.includes('palette.asphalt'))).toBe(true);
    expect(hot.warnings.some((w) => w.includes('palette.grass'))).toBe(true);
    expect(hot.style.palette.asphalt).toBe('#da0000');
    expect(hot.style.palette.grass).toBe('#dadada');
  });

  it('EDGE5: range entries accept wrap-around and drop out-of-limit values with per-entry errors', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const wrap = parseTrackStyle(
      { version: 1, kerbs: { ranges: [{ start: 90, end: 10, side: 'left' }] } },
      100,
    );
    expect(wrap.errors).toEqual([]);
    expect(wrap.style.kerbs.ranges).toEqual([{ start: 90, end: 10, side: 'left' }]);
    const bad = parseTrackStyle(
      {
        version: 1,
        kerbs: {
          ranges: [
            { start: 5.5, end: 10 },
            { start: -1, end: 4 },
            { start: 0, end: 100 },
            { start: 0, end: 9, side: 'middle' },
          ],
        },
      },
      100,
    );
    expect(bad.errors).toHaveLength(4);
    expect(bad.errors.some((e) => e.includes('kerbs.ranges[0]'))).toBe(true);
    expect(bad.style.kerbs.ranges).toEqual([]);
    const fence = parseTrackStyle(
      {
        version: 1,
        barriers: {
          ranges: [
            { start: 0, end: 9, fenceHeightMeters: 0 },
            { start: 0, end: 9, fenceHeightMeters: 8 },
            { start: 0, end: 9, fenceHeightMeters: 9 },
            { start: 0, end: 9 },
          ],
        },
      },
      100,
    );
    expect(fence.errors).toHaveLength(2);
    expect(fence.style.barriers.ranges).toEqual([
      { start: 0, end: 9, fenceHeightMeters: 0 },
      { start: 0, end: 9, fenceHeightMeters: 8 },
    ]);
  });

  it('EDGE6: invalid scalars error per field and keep defaults; a fractional prop index drops the entry', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const hex = parseTrackStyle({ version: 1, palette: { asphalt: '#ff00zz' } }, 100);
    expect(hex.errors).toHaveLength(1);
    expect(hex.errors[0]).toContain('palette.asphalt');
    expect(hex.warnings).toEqual([]);
    expect(hex.style.palette.asphalt).toBeNull();
    const frac = parseTrackStyle({ version: 1, pitBuilding: { storeys: 2.5 } }, 100);
    expect(frac.errors).toHaveLength(1);
    expect(frac.errors[0]).toContain('pitBuilding.storeys');
    expect(frac.style.pitBuilding.storeys).toBe(1);
    const idx = parseTrackStyle(
      { version: 1, props: [{ type: 'tent', index: 1.5, side: 'left' }] },
      100,
    );
    expect(idx.errors).toHaveLength(1);
    expect(idx.errors[0]).toContain('props[0]');
    expect(idx.style.props).toEqual([]);
  });

  it('EDGE7: the 60-prop cap is checked before entry validation; unknown entry keys are ignored', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const over = parseTrackStyle(
      {
        version: 1,
        props: Array.from({ length: 61 }, (_, i) => ({ type: 'rocket', index: i, side: 'left' })),
      },
      100,
    );
    expect(over.errors).toHaveLength(1);
    expect(over.errors[0]).toMatch(/^props: /);
    expect(over.style.props).toEqual([]);
    const valid60 = Array.from({ length: 60 }, (_, i) =>
      i === 0
        ? { type: 'tent', index: 0, side: 'left', foo: 1 }
        : { type: 'tent', index: i, side: 'left' },
    );
    const ok = parseTrackStyle({ version: 1, props: valid60 }, 100);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
    expect(ok.style.props).toHaveLength(60);
  });

  it('EDGE8: extra grandstands outside limits or missing side drop; offset and row boundaries are kept', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const off = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 10, end: 20, side: 'left', offsetMeters: 201 }] },
      100,
    );
    expect(off.errors).toHaveLength(1);
    expect(off.errors[0]).toContain('extraGrandstands[0]');
    expect(off.style.extraGrandstands).toEqual([]);
    const rows = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 10, end: 20, side: 'left', rows: 3 }] },
      100,
    );
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toContain('extraGrandstands[0]');
    expect(rows.style.extraGrandstands).toEqual([]);
    const noSide = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 10, end: 20 }] },
      100,
    );
    expect(noSide.errors).toHaveLength(1);
    expect(noSide.errors[0]).toContain('extraGrandstands[0]');
    expect(noSide.style.extraGrandstands).toEqual([]);
    const edge = parseTrackStyle(
      {
        version: 1,
        extraGrandstands: [
          { start: 10, end: 20, side: 'right', offsetMeters: 0, rows: 4, roof: false },
          { start: 30, end: 40, side: 'left', offsetMeters: 200, rows: 40, roof: true },
        ],
      },
      100,
    );
    expect(edge.errors).toEqual([]);
    expect(edge.style.extraGrandstands).toHaveLength(2);
    expect(edge.style.extraGrandstands[0].offsetMeters).toBe(0);
    expect(edge.style.extraGrandstands[1].rows).toBe(40);
  });

  it('EDGE9: design numeric limits outside the acceptance table fall back to defaults', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const fogBad = parseTrackStyle({ version: 1, sky: { fogDensityScale: 5 } }, 100);
    expect(fogBad.errors).toHaveLength(1);
    expect(fogBad.errors[0]).toContain('sky.fogDensityScale');
    expect(fogBad.style.sky.fogDensityScale).toBe(1);
    const fogMin = parseTrackStyle({ version: 1, sky: { fogDensityScale: 0.25 } }, 100);
    expect(fogMin.errors).toEqual([]);
    expect(fogMin.style.sky.fogDensityScale).toBe(0.25);
    const fogMax = parseTrackStyle({ version: 1, sky: { fogDensityScale: 4 } }, 100);
    expect(fogMax.errors).toEqual([]);
    expect(fogMax.style.sky.fogDensityScale).toBe(4);
    const glazeBad = parseTrackStyle({ version: 1, pitBuilding: { glazing: 1.5 } }, 100);
    expect(glazeBad.errors).toHaveLength(1);
    expect(glazeBad.errors[0]).toContain('pitBuilding.glazing');
    expect(glazeBad.style.pitBuilding.glazing).toBe(0);
    const stripeBad = parseTrackStyle({ version: 1, runoffPaint: { stripeMeters: 0.4 } }, 100);
    expect(stripeBad.errors).toHaveLength(1);
    expect(stripeBad.errors[0]).toContain('runoffPaint.stripeMeters');
    expect(stripeBad.style.runoffPaint.stripeMeters).toBe(2);
    const stripeMax = parseTrackStyle({ version: 1, runoffPaint: { stripeMeters: 10 } }, 100);
    expect(stripeMax.errors).toEqual([]);
    expect(stripeMax.style.runoffPaint.stripeMeters).toBe(10);
  });

  it('EDGE10: grandstands.seats accepts 1-4 colours and rejects 5 back to null', async () => {
    const { parseTrackStyle } = await loadTrackStyle();
    const five = ['#d02020', '#d0d0d0', '#20a020', '#2040d0', '#1c1c1e'];
    const bad = parseTrackStyle(
      { version: 1, grandstands: { structure: '#aaaaaa', seats: five } },
      100,
    );
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('grandstands.seats');
    expect(bad.style.grandstands.seats).toBeNull();
    expect(bad.style.grandstands.structure).toBe('#aaaaaa');
    const four = parseTrackStyle(
      { version: 1, grandstands: { seats: five.slice(0, 4) } },
      100,
    );
    expect(four.errors).toEqual([]);
    expect(four.style.grandstands.seats).toEqual(five.slice(0, 4));
    const one = parseTrackStyle(
      { version: 1, grandstands: { seats: ['#d02020'] } },
      100,
    );
    expect(one.errors).toEqual([]);
    expect(one.style.grandstands.seats).toEqual(['#d02020']);
  });
});
