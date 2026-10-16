import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TrackSegment } from '../../../src/core/types';
import * as trackStyle from '../../../src/track/trackStyle';

const { parseTrackStyle, DEFAULT_TRACK_STYLE, SKY_NAMES, rangeContains, segmentOverride } = trackStyle;

describe('179 track style schema post-code gaps', () => {
  it('POST1: module exports exactly the five public names and the three SKY_NAMES', () => {
    expect(Object.keys(trackStyle).sort()).toEqual([
      'DEFAULT_TRACK_STYLE',
      'SKY_NAMES',
      'parseTrackStyle',
      'rangeContains',
      'segmentOverride',
    ]);
    expect(SKY_NAMES).toEqual([
      'kloofendal_48d_partly_cloudy_puresky',
      'kloofendal_overcast_puresky',
      'qwantani_noon_puresky',
    ]);
  });

  it('POST2: source contains no any outside comments', () => {
    const file = fileURLToPath(new URL('../../../src/track/trackStyle.ts', import.meta.url));
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bany\b/);
  });

  it('POST3: DEFAULT_TRACK_STYLE is deep-frozen and parses never share objects with it', () => {
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE.pitBuilding)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE.barriers.fence)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE.barriers.fence.types)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE.props)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TRACK_STYLE.kerbs.ranges)).toBe(true);

    const a = parseTrackStyle({ version: 1 }, 100).style;
    expect(a).not.toBe(DEFAULT_TRACK_STYLE);
    expect(a.pitBuilding).not.toBe(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(a.barriers.fence.types).not.toBe(DEFAULT_TRACK_STYLE.barriers.fence.types);
    expect(a.props).not.toBe(DEFAULT_TRACK_STYLE.props);
    a.pitBuilding.storeys = 5;
    a.barriers.fence.types.push('foam');
    a.props.push({
      type: 'tent',
      index: 0,
      side: 'left',
      offsetMeters: 10,
      lengthMeters: 10,
      heightMeters: 4,
      color: null,
    });

    const b = parseTrackStyle({ version: 1 }, 100).style;
    expect(b.pitBuilding.storeys).toBe(1);
    expect(b.barriers.fence.types).toEqual(['armco']);
    expect(b.props).toEqual([]);
    expect(DEFAULT_TRACK_STYLE.pitBuilding.storeys).toBe(1);
    expect(DEFAULT_TRACK_STYLE.barriers.fence.types).toEqual(['armco']);
  });

  it('POST4: raw without a version key gives exactly one version error and the defaults', () => {
    const r = parseTrackStyle({}, 100);
    expect(r.errors).toEqual(['version: must be 1']);
    expect(r.warnings).toEqual([]);
    expect(r.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('POST5: every section and array key set to null counts as absent without errors', () => {
    const r = parseTrackStyle(
      {
        version: 1,
        palette: null,
        edgeLines: null,
        kerbs: null,
        runoffPaint: null,
        barriers: null,
        pitBuilding: null,
        grandstands: null,
        extraGrandstands: null,
        floodlights: null,
        props: null,
        sky: null,
      },
      100,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('POST6: pit building numeric limits error per field and boundaries are kept', () => {
    const lo = parseTrackStyle(
      { version: 1, pitBuilding: { storeys: 6, heightMeters: 2, depthMeters: 4 } },
      100,
    );
    expect(lo.errors).toEqual([
      'pitBuilding.storeys: must be an integer 1-5',
      'pitBuilding.heightMeters: must be 3-40',
      'pitBuilding.depthMeters: must be 5-40',
    ]);
    expect(lo.style.pitBuilding).toMatchObject({ storeys: 1, heightMeters: 4, depthMeters: 8 });

    const hi = parseTrackStyle(
      { version: 1, pitBuilding: { heightMeters: 41, depthMeters: 41 } },
      100,
    );
    expect(hi.errors).toHaveLength(2);
    expect(hi.style.pitBuilding.heightMeters).toBe(4);
    expect(hi.style.pitBuilding.depthMeters).toBe(8);

    const ok = parseTrackStyle(
      { version: 1, pitBuilding: { storeys: 5, heightMeters: 3, depthMeters: 40, glazing: 1 } },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.pitBuilding).toMatchObject({
      storeys: 5,
      heightMeters: 3,
      depthMeters: 40,
      glazing: 1,
    });
  });

  it('POST7: fence height and types limits error with defaults; types array is copied', () => {
    const bad = parseTrackStyle(
      { version: 1, barriers: { fence: { heightMeters: 9, types: ['fence'] } } },
      100,
    );
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors.some((e) => e.includes('barriers.fence.heightMeters'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('barriers.fence.types'))).toBe(true);
    expect(bad.style.barriers.fence).toEqual({ heightMeters: 3, types: ['armco'], color: null });

    const ok = parseTrackStyle(
      { version: 1, barriers: { fence: { heightMeters: 8, types: [], color: '#d0d0d0' } } },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.barriers.fence).toEqual({ heightMeters: 8, types: [], color: '#d0d0d0' });

    const raw = { version: 1, barriers: { fence: { types: ['armco', 'wall'] } } };
    const copy = parseTrackStyle(raw, 100);
    expect(copy.style.barriers.fence.types).not.toBe(raw.barriers.fence.types);
    copy.style.barriers.fence.types.push('foam');
    expect(raw.barriers.fence.types).toEqual(['armco', 'wall']);
  });

  it('POST8: floodlight numeric and enum limits error per key and take defaults', () => {
    const bad = parseTrackStyle(
      { version: 1, floodlights: { heads: 0, spacingMeters: 121, style: 'pole', side: 'middle' } },
      100,
    );
    expect(bad.errors).toHaveLength(4);
    for (const path of [
      'floodlights.heads',
      'floodlights.spacingMeters',
      'floodlights.style',
      'floodlights.side',
    ]) {
      expect(bad.errors.some((e) => e.includes(path))).toBe(true);
    }
    expect(bad.style.floodlights).toEqual({
      style: 'arm',
      heightMeters: 8,
      heads: 1,
      spacingMeters: 20,
      offsetMeters: 6,
      side: 'both',
      ranges: [],
    });

    const frac = parseTrackStyle({ version: 1, floodlights: { heads: 2.5 } }, 100);
    expect(frac.errors).toHaveLength(1);
    expect(frac.style.floodlights?.heads).toBe(1);

    const ok = parseTrackStyle(
      { version: 1, floodlights: { style: 'mast', heightMeters: 4, heads: 12, spacingMeters: 10, offsetMeters: 0, side: 'right' } },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.floodlights).toMatchObject({
      style: 'mast',
      heightMeters: 4,
      heads: 12,
      spacingMeters: 10,
      offsetMeters: 0,
      side: 'right',
    });

    const nonObj = parseTrackStyle({ version: 1, floodlights: 5 }, 100);
    expect(nonObj.errors).toEqual(['floodlights: must be an object']);
    expect(nonObj.style.floodlights).toBeNull();
  });

  it('POST9: runoffPaint pattern, colour count and stripe limits', () => {
    const bad = parseTrackStyle(
      { version: 1, runoffPaint: { pattern: 'dots', colors: [], stripeMeters: 0.5 } },
      100,
    );
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors.some((e) => e.includes('runoffPaint.pattern'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('runoffPaint.colors'))).toBe(true);
    expect(bad.style.runoffPaint).toMatchObject({ pattern: 'none', colors: [], stripeMeters: 0.5 });

    const five = parseTrackStyle(
      { version: 1, runoffPaint: { colors: ['#d02020', '#2040d0', '#1c1c1e', '#58d23a', '#1f4fbf'] } },
      100,
    );
    expect(five.errors).toHaveLength(1);
    expect(five.style.runoffPaint.colors).toEqual([]);

    const ok = parseTrackStyle(
      { version: 1, runoffPaint: { pattern: 'bands', colors: ['#d02020', '#2040d0'], stripeMeters: 0.5 } },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.runoffPaint).toEqual({
      pattern: 'bands',
      colors: ['#d02020', '#2040d0'],
      stripeMeters: 0.5,
      ranges: [],
    });
  });

  it('POST10: invalid roofStyle enums error and fall back to flat, valid ones are kept', () => {
    const bad = parseTrackStyle(
      { version: 1, pitBuilding: { roofStyle: 'dome' }, grandstands: { roofStyle: 'dome' } },
      100,
    );
    expect(bad.errors).toHaveLength(2);
    expect(bad.errors[0]).toContain('pitBuilding.roofStyle');
    expect(bad.errors[1]).toContain('grandstands.roofStyle');
    expect(bad.style.pitBuilding.roofStyle).toBe('flat');
    expect(bad.style.grandstands.roofStyle).toBe('flat');

    const ok = parseTrackStyle(
      { version: 1, pitBuilding: { roofStyle: 'canopy' }, grandstands: { roofStyle: 'truss' } },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.pitBuilding.roofStyle).toBe('canopy');
    expect(ok.style.grandstands.roofStyle).toBe('truss');
  });

  it('POST11: props with out-of-limit scalars each drop with one props[i] error', () => {
    const r = parseTrackStyle(
      {
        version: 1,
        props: [
          { type: 'tent', index: 0, lengthMeters: 0 },
          { type: 'tent', index: 0, heightMeters: 41 },
          { type: 'tent', index: 0, offsetMeters: -1 },
          { type: 'tent', index: 100, side: 'left' },
          { type: 'tent', index: 0, side: 'middle' },
        ],
      },
      100,
    );
    expect(r.errors).toHaveLength(5);
    for (let i = 0; i < 5; i++) expect(r.errors[i]).toContain(`props[${i}]`);
    expect(r.style.props).toEqual([]);
  });

  it('POST12: props at their numeric boundaries are kept in input order with defaults', () => {
    const r = parseTrackStyle(
      {
        version: 1,
        props: [
          { type: 'tent', index: 0, side: 'right', offsetMeters: 0, lengthMeters: 1, heightMeters: 1, color: '#d0d0d0' },
          { type: 'tower', index: 99, offsetMeters: 200, lengthMeters: 200, heightMeters: 40 },
        ],
      },
      100,
    );
    expect(r.errors).toEqual([]);
    expect(r.style.props).toEqual([
      { type: 'tent', index: 0, side: 'right', offsetMeters: 0, lengthMeters: 1, heightMeters: 1, color: '#d0d0d0' },
      { type: 'tower', index: 99, side: 'left', offsetMeters: 200, lengthMeters: 200, heightMeters: 40, color: null },
    ]);
  });

  it('POST13: props that are not an array and props entries missing type', () => {
    const nonArr = parseTrackStyle({ version: 1, props: 5 }, 100);
    expect(nonArr.errors).toEqual(['props: must be an array']);
    expect(nonArr.style.props).toEqual([]);

    const missing = parseTrackStyle({ version: 1, props: [{ index: 3, side: 'left' }] }, 100);
    expect(missing.errors).toHaveLength(1);
    expect(missing.errors[0]).toContain('props[0]');
    expect(missing.errors[0]).toContain('type');
    expect(missing.style.props).toEqual([]);
  });

  it('POST14: range containers that are not arrays give one must-be-an-array error', () => {
    const cases: Array<[unknown, string]> = [
      [{ version: 1, kerbs: { ranges: 5 } }, 'kerbs.ranges'],
      [{ version: 1, barriers: { ranges: 'x' } }, 'barriers.ranges'],
      [{ version: 1, floodlights: { ranges: 5 } }, 'floodlights.ranges'],
      [{ version: 1, extraGrandstands: 5 }, 'extraGrandstands'],
    ];
    for (const [raw, path] of cases) {
      const r = parseTrackStyle(raw, 100);
      expect(r.errors).toEqual([`${path}: must be an array`]);
    }
    expect(parseTrackStyle({ version: 1, floodlights: { ranges: 5 } }, 100).style.floodlights).not.toBeNull();
  });

  it('POST15: malformed range entries error once with the entry path and valid entries keep order', () => {
    const missing = parseTrackStyle({ version: 1, kerbs: { ranges: [{}] } }, 100);
    expect(missing.errors).toEqual(['kerbs.ranges[0].start: is required']);
    expect(missing.style.kerbs.ranges).toEqual([]);

    const nonObj = parseTrackStyle({ version: 1, kerbs: { ranges: [5] } }, 100);
    expect(nonObj.errors).toEqual(['kerbs.ranges[0]: must be an object']);

    const nullStart = parseTrackStyle({ version: 1, kerbs: { ranges: [{ start: null, end: 5 }] } }, 100);
    expect(nullStart.errors).toHaveLength(1);
    expect(nullStart.errors[0]).toContain('kerbs.ranges[0]');
    expect(nullStart.style.kerbs.ranges).toEqual([]);

    const order = parseTrackStyle(
      {
        version: 1,
        kerbs: {
          ranges: [
            { start: 0, end: 9, side: 'left' },
            { start: 10, end: 100, side: 'left' },
            { start: 20, end: 29, side: 'left' },
          ],
        },
      },
      100,
    );
    expect(order.errors).toHaveLength(1);
    expect(order.errors[0]).toContain('kerbs.ranges[1]');
    expect(order.style.kerbs.ranges.map((r) => r.start)).toEqual([0, 20]);
  });

  it('POST16: kerb range entries validate colours and clamp warnings carry the entry path', () => {
    const bad = parseTrackStyle(
      { version: 1, kerbs: { ranges: [{ start: 0, end: 5, side: 'left', colors: ['#fff', '#000000'] }] } },
      100,
    );
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('kerbs.ranges[0]');
    expect(bad.style.kerbs.ranges).toEqual([]);

    const ok = parseTrackStyle(
      {
        version: 1,
        kerbs: {
          ranges: [
            { start: 0, end: 5, side: 'left', colors: ['#AA0000', '#D0D0D0'], outerStrip: '#ffffff' },
          ],
        },
      },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toHaveLength(1);
    expect(ok.warnings[0]).toContain('kerbs.ranges[0].outerStrip');
    expect(ok.style.kerbs.ranges).toEqual([
      { start: 0, end: 5, side: 'left', colors: ['#aa0000', '#d0d0d0'], outerStrip: '#dadada' },
    ]);
  });

  it('POST17: colour list clamping warns at the indexed path and bad hex errors the list', () => {
    const clamp = parseTrackStyle({ version: 1, kerbs: { colors: ['#ffffff', '#000000'] } }, 100);
    expect(clamp.errors).toEqual([]);
    expect(clamp.warnings).toHaveLength(1);
    expect(clamp.warnings[0]).toContain('kerbs.colors[0]');
    expect(clamp.style.kerbs.colors).toEqual(['#dadada', '#000000']);

    const invalid = parseTrackStyle({ version: 1, kerbs: { colors: ['#zzzzzz', '#000000'] } }, 100);
    expect(invalid.errors).toHaveLength(1);
    expect(invalid.errors[0]).toContain('kerbs.colors');
    expect(invalid.warnings).toEqual([]);
    expect(invalid.style.kerbs.colors).toBeNull();
  });

  it('POST18: runoffPaint range entries keep their keys and drop on an invalid pattern', () => {
    const ok = parseTrackStyle(
      {
        version: 1,
        runoffPaint: {
          ranges: [
            { start: 5, end: 15, side: 'right', pattern: 'bands', colors: ['#d02020'], stripeMeters: 3 },
          ],
        },
      },
      100,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.style.runoffPaint.ranges).toEqual([
      { start: 5, end: 15, side: 'right', pattern: 'bands', colors: ['#d02020'], stripeMeters: 3 },
    ]);

    const bad = parseTrackStyle(
      {
        version: 1,
        runoffPaint: {
          ranges: [{ start: 0, end: 5, pattern: 'dots' }, { start: 10, end: 15 }],
        },
      },
      100,
    );
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toContain('runoffPaint.ranges[0]');
    expect(bad.style.runoffPaint.ranges).toEqual([{ start: 10, end: 15 }]);
  });

  it('POST19: extra grandstand entries drop on non-object, bad roof and fractional rows', () => {
    const nonObj = parseTrackStyle({ version: 1, extraGrandstands: [7] }, 100);
    expect(nonObj.errors).toEqual(['extraGrandstands[0]: must be an object']);

    const roof = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 1, end: 5, side: 'left', roof: 'yes' }] },
      100,
    );
    expect(roof.errors).toHaveLength(1);
    expect(roof.errors[0]).toContain('extraGrandstands[0]');
    expect(roof.style.extraGrandstands).toEqual([]);

    const rows = parseTrackStyle(
      { version: 1, extraGrandstands: [{ start: 1, end: 5, side: 'left', rows: 4.5 }] },
      100,
    );
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toContain('extraGrandstands[0]');
    expect(rows.style.extraGrandstands).toEqual([]);
  });

  it('POST20: nested unknown keys warn with the exact format and nested bad sections error once', () => {
    const warn = parseTrackStyle(
      { version: 1, barriers: { bogus: 2, concrete: { color: '#111111', zzz: 1 } } },
      100,
    );
    expect(warn.errors).toEqual([]);
    expect(warn.warnings).toHaveLength(2);
    expect(warn.warnings).toContain('barriers.bogus: unknown key');
    expect(warn.warnings).toContain('barriers.concrete.zzz: unknown key');

    const nested = parseTrackStyle(
      { version: 1, barriers: { concrete: 5, armco: { color: '#111111' } } },
      100,
    );
    expect(nested.errors).toEqual(['barriers.concrete: must be an object']);
    expect(nested.style.barriers.concrete).toEqual({ color: null, bandColor: null });
    expect(nested.style.barriers.armco.color).toBe('#111111');
  });

  it('POST21: rangeContains normalises out-of-range indices and handles single-point and zero pointCount', () => {
    expect(rangeContains({ start: 90, end: 10 }, -1, 100)).toBe(true);
    expect(rangeContains({ start: 10, end: 20 }, -1, 100)).toBe(false);
    expect(rangeContains({ start: 10, end: 20 }, 115, 100)).toBe(true);
    expect(rangeContains({ start: 5, end: 5 }, 4, 100)).toBe(false);
    expect(rangeContains({ start: 5, end: 5 }, 5, 100)).toBe(true);
    expect(rangeContains({ start: 5, end: 5 }, 6, 100)).toBe(false);
    expect(rangeContains({ start: 0, end: 0 }, 7, 1)).toBe(true);
    expect(rangeContains({ start: 0, end: 0 }, 0, 0)).toBe(true);
    expect(rangeContains({ start: 5, end: 0 }, 3, 0)).toBe(false);
  });

  it('POST22: segmentOverride on empty ranges, equal ties and side-specific ranges', () => {
    const seg: TrackSegment = { start: 10, end: 20, side: 'left' };
    expect(segmentOverride([], seg, 100)).toBeNull();

    const dup: trackStyle.StyleRange[] = [{ start: 0, end: 99 }, { start: 0, end: 99 }];
    expect(segmentOverride(dup, seg, 100)).toBe(dup[1]);

    const sides: trackStyle.StyleRange[] = [
      { start: 0, end: 99, side: 'left' },
      { start: 0, end: 99, side: 'right' },
    ];
    expect(segmentOverride(sides, seg, 100)).toBe(sides[0]);
    expect(segmentOverride(sides, { start: 10, end: 20, side: 'right' }, 100)).toBe(sides[1]);
  });

  it('POST23: pointCount 0 collects errors without throwing and huge pointCount accepts top indices', () => {
    const zero = parseTrackStyle(
      {
        version: 1,
        kerbs: { ranges: [{ start: 0, end: 0, side: 'left' }] },
        props: [{ type: 'tent', index: 0, side: 'left' }],
      },
      0,
    );
    expect(zero.errors).toHaveLength(2);
    expect(zero.errors[0]).toContain('kerbs.ranges[0]');
    expect(zero.errors[1]).toContain('props[0]');
    expect(zero.style.kerbs.ranges).toEqual([]);
    expect(zero.style.props).toEqual([]);

    const big = parseTrackStyle(
      { version: 1, kerbs: { ranges: [{ start: 999999, end: 999999, side: 'left' }] } },
      1_000_000,
    );
    expect(big.errors).toEqual([]);
    expect(big.style.kerbs.ranges).toEqual([{ start: 999999, end: 999999, side: 'left' }]);
  });

  it('POST24: the result shares no object or array with the input and the input is never mutated', () => {
    const raw = {
      version: 1,
      palette: { asphalt: '#111111' },
      kerbs: { colors: ['#d02020', '#d0d0d0'], ranges: [{ start: 0, end: 5, side: 'left' }] },
      runoffPaint: { colors: ['#d02020'], ranges: [{ start: 0, end: 5 }] },
      barriers: { fence: { types: ['armco', 'wall'] }, ranges: [{ start: 0, end: 5, fenceHeightMeters: 4 }] },
      grandstands: { seats: ['#d02020'] },
      extraGrandstands: [{ start: 1, end: 5, side: 'right' }],
      floodlights: { ranges: [{ start: 0, end: 9 }] },
      props: [{ type: 'tent', index: 1, side: 'left' }],
    };
    const r = parseTrackStyle(raw, 100);
    expect(r.errors).toEqual([]);
    expect(r.style.kerbs.colors).not.toBe(raw.kerbs.colors);
    expect(r.style.kerbs.ranges[0]).not.toBe(raw.kerbs.ranges[0]);
    expect(r.style.runoffPaint.colors).not.toBe(raw.runoffPaint.colors);
    expect(r.style.runoffPaint.ranges[0]).not.toBe(raw.runoffPaint.ranges[0]);
    expect(r.style.barriers.fence.types).not.toBe(raw.barriers.fence.types);
    expect(r.style.barriers.ranges[0]).not.toBe(raw.barriers.ranges[0]);
    expect(r.style.grandstands.seats).not.toBe(raw.grandstands.seats);
    expect(r.style.extraGrandstands[0]).not.toBe(raw.extraGrandstands[0]);
    expect(r.style.props[0]).not.toBe(raw.props[0]);
    expect(r.style.floodlights?.ranges[0]).not.toBe(raw.floodlights.ranges[0]);

    r.style.kerbs.ranges[0].start = 50;
    r.style.barriers.fence.types.push('foam');
    r.style.grandstands.seats?.push('#2040d0');
    expect(raw.kerbs.ranges[0].start).toBe(0);
    expect(raw.barriers.fence.types).toEqual(['armco', 'wall']);
    expect(raw.grandstands.seats).toEqual(['#d02020']);

    const again = parseTrackStyle(raw, 100);
    expect(again.style.kerbs.ranges).toEqual([{ start: 0, end: 5, side: 'left' }]);
    expect(again.style.barriers.fence.types).toEqual(['armco', 'wall']);
  });
});
