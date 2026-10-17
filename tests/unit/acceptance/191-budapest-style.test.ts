import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { hsl, isBlue, isGreen, isLight, isOrange, isWhite } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const STYLE_PATH = join(ROOT, 'public', 'tracks', 'budapest.style.json');
const styleText = readFileSync(STYLE_PATH, 'utf8');
const rawStyle: unknown = JSON.parse(styleText);
const centerline = (JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'budapest.json'), 'utf8')) as {
  centerline: Point2[];
}).centerline;
const count = centerline.length;
const { style, errors, warnings } = parseTrackStyle(rawStyle, count);

const BRANDS = [
  'Pirelli', 'Rolex', 'Heineken', 'DHL', 'Aramco', 'Emirates', 'Petronas', 'Shell', 'Red Bull', 'Ferrari',
  'Mercedes', 'Gulf Air', 'Etihad', 'Qatar Airways', 'Crypto', 'Singtel', 'Marina Bay Sands', 'Sphere',
  'Formula 1', 'Indy', 'NASCAR',
];

function span(r: StyleRange): number {
  return r.end >= r.start ? r.end - r.start + 1 : count - r.start + r.end + 1;
}

function stringValues(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringValues(x, out));
  else if (typeof v === 'object' && v !== null) Object.values(v).forEach((x) => stringValues(x, out));
  return out;
}

function sectionRanges(): { section: string; ranges: StyleRange[] }[] {
  const fl = style.floodlights;
  return [
    { section: 'kerbs', ranges: style.kerbs.ranges },
    { section: 'runoffPaint', ranges: style.runoffPaint.ranges },
    { section: 'barriers', ranges: style.barriers.ranges },
    { section: 'floodlights', ranges: fl ? fl.ranges : [] },
    { section: 'extraGrandstands', ranges: style.extraGrandstands },
  ];
}

describe('191 budapest style acceptance', () => {
  it('AT1: style parses with no errors and no warnings', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('AT2: pitBuilding, kerbs.colors, barriers, grandstands and palette are non-default', () => {
    expect(style.pitBuilding).not.toEqual(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(style.kerbs.colors).not.toEqual(DEFAULT_TRACK_STYLE.kerbs.colors);
    expect(style.barriers).not.toEqual(DEFAULT_TRACK_STYLE.barriers);
    expect(style.barriers.fence).not.toEqual(DEFAULT_TRACK_STYLE.barriers.fence);
    expect(style.grandstands).not.toEqual(DEFAULT_TRACK_STYLE.grandstands);
    expect(style.palette).not.toEqual(DEFAULT_TRACK_STYLE.palette);
  });

  it('AT3: every range covers at most 40% of the lap, at least 1 index, with no repeated start/end per section and side', () => {
    for (const { section, ranges } of sectionRanges()) {
      const seen = new Set<string>();
      for (const r of ranges) {
        expect(span(r)).toBeGreaterThanOrEqual(1);
        expect(span(r)).toBeLessThanOrEqual(0.4 * count);
        const key = `${r.side ?? 'both'}:${r.start}:${r.end}`;
        expect(seen.has(key), `${section} repeats ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('AT4: every prop index is inside the centerline and props total at most 30', () => {
    expect(style.props.length).toBeLessThanOrEqual(30);
    for (const p of style.props) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(count);
    }
  });

  it('AT5: file contains no brand strings in string values that are not hex colours', () => {
    const values = stringValues(rawStyle).filter((s) => !/^#[0-9a-fA-F]{6}$/.test(s));
    for (const value of values) {
      for (const brand of BRANDS) expect(value.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it('AT6: npm run check:styles exits 0', () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(0);
  });

  it('AT7: kerbs.outerStrip is green', () => {
    expect(style.kerbs.outerStrip).not.toBeNull();
    expect(isGreen(style.kerbs.outerStrip as string)).toBe(true);
  });

  it('AT8: a kerb range has an orange colour', () => {
    const ok = style.kerbs.ranges.some((r) => (r.colors ?? []).some(isOrange));
    expect(ok).toBe(true);
  });

  it('AT9: palette.grass saturation is at most 0.45', () => {
    expect(style.palette.grass).not.toBeNull();
    expect(hsl(style.palette.grass as string).s).toBeLessThanOrEqual(0.45);
  });

  it('AT10: pitBuilding glazing is at least 0.2 and facade is white or light', () => {
    expect(style.pitBuilding.glazing).toBeGreaterThanOrEqual(0.2);
    expect(isWhite(style.pitBuilding.facade) || isLight(style.pitBuilding.facade)).toBe(true);
  });

  it('AT11: grandstands seats include a blue', () => {
    expect((style.grandstands.seats ?? []).some(isBlue)).toBe(true);
  });
});
