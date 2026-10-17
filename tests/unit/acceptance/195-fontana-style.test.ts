import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { BRAND_DENY_LIST } from './helpers/brands';
import { isGreen, isRed, isYellow } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const STYLE_PATH = join(ROOT, 'public', 'tracks', 'fontana.style.json');
const styleText = readFileSync(STYLE_PATH, 'utf8');
const rawStyle: unknown = JSON.parse(styleText);
const centerline = (JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'fontana.json'), 'utf8')) as {
  centerline: Point2[];
}).centerline;
const count = centerline.length;
const { style, errors, warnings } = parseTrackStyle(rawStyle, count);

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

describe('195 fontana style acceptance', () => {
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
      for (const brand of BRAND_DENY_LIST) expect(value.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it('AT6: npm run check:styles exits 0', () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(0);
  });

  it('AT7: grandstands.seats include red and yellow', () => {
    const seats = style.grandstands.seats ?? [];
    expect(seats.some(isRed)).toBe(true);
    expect(seats.some(isYellow)).toBe(true);
  });

  it('AT8: pitBuilding roof is red', () => {
    expect(style.pitBuilding.roof).not.toBeNull();
    expect(isRed(style.pitBuilding.roof as string)).toBe(true);
  });

  it('AT9: a scoreboard or tower prop has a red colour', () => {
    const ok = style.props.some((p) => (p.type === 'scoreboard' || p.type === 'tower') && p.color !== null && isRed(p.color));
    expect(ok).toBe(true);
  });

  it('AT10: fence heightMeters is at least 4 and types include wall', () => {
    expect(style.barriers.fence.heightMeters).toBeGreaterThanOrEqual(4);
    expect(style.barriers.fence.types).toContain('wall');
  });

  it('AT11: palette.grass is green', () => {
    expect(style.palette.grass).not.toBeNull();
    expect(isGreen(style.palette.grass as string)).toBe(true);
  });
});
