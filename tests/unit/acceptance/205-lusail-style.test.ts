import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle } from '../../../src/track/trackStyle';
import type { StyleRange } from '../../../src/track/trackStyle';
import { BRAND_DENY_LIST } from './helpers/brands';
import { isCream, isGreen, isTeal } from './helpers/colour';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STYLE_PATH = `${ROOT}public/tracks/lusail.style.json`;
const TRACK_PATH = `${ROOT}public/tracks/lusail.json`;

const styleText = existsSync(STYLE_PATH) ? readFileSync(STYLE_PATH, 'utf8') : '{}';
const raw: unknown = JSON.parse(styleText);
const track = JSON.parse(readFileSync(TRACK_PATH, 'utf8')) as { centerline: unknown[] };
const n = track.centerline.length;
const { style, errors, warnings } = parseTrackStyle(raw, n);

function span(r: StyleRange): number {
  return r.start <= r.end ? r.end - r.start + 1 : n - r.start + r.end + 1;
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

describe('205 lusail style acceptance', () => {
  it('AT1: style parses with no errors and no warnings', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('AT2: pitBuilding, kerbs.colors, barriers fence, grandstands and palette are non-default', () => {
    expect(style.pitBuilding).not.toEqual(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(style.kerbs.colors).not.toEqual(DEFAULT_TRACK_STYLE.kerbs.colors);
    expect(style.barriers.fence).not.toEqual(DEFAULT_TRACK_STYLE.barriers.fence);
    expect(style.grandstands).not.toEqual(DEFAULT_TRACK_STYLE.grandstands);
    expect(style.palette).not.toEqual(DEFAULT_TRACK_STYLE.palette);
  });

  it('AT3: every range covers at least 1 index and at most 40% of the lap, with no repeated start/end per section and side', () => {
    for (const { section, ranges } of sectionRanges()) {
      const seen = new Set<string>();
      for (const r of ranges) {
        expect(span(r), section).toBeGreaterThanOrEqual(1);
        expect(span(r), section).toBeLessThanOrEqual(0.4 * n);
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
      expect(p.index).toBeLessThan(n);
    }
  });

  it('AT5: file contains no brand strings in string values that are not hex colours', () => {
    const values = stringValues(raw).filter((s) => !/^#[0-9a-fA-F]{6}$/.test(s));
    for (const value of values) {
      for (const brand of BRAND_DENY_LIST) expect(value.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it('AT6: npm run check:styles exits 0', { timeout: 120000 }, () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(0);
  });

  it('AT7: floodlights are non-null mast style, 25-30 m tall with at least 4 heads', () => {
    const fl = style.floodlights;
    expect(fl).not.toBeNull();
    if (fl === null) return;
    expect(fl.style).toBe('mast');
    expect(fl.heightMeters).toBeGreaterThanOrEqual(25);
    expect(fl.heightMeters).toBeLessThanOrEqual(30);
    expect(fl.heads).toBeGreaterThanOrEqual(4);
  });

  it('AT8: fence colour is teal or green', () => {
    const c = style.barriers.fence.color;
    expect(c).not.toBeNull();
    if (c === null) return;
    expect(isTeal(c) || isGreen(c)).toBe(true);
  });

  it('AT10: pitBuilding storeys is 2', () => {
    expect(style.pitBuilding.storeys).toBe(2);
  });

  it('AT11: palette.grass is cream (sand)', () => {
    const g = style.palette.grass;
    expect(g).not.toBeNull();
    if (g === null) return;
    expect(isCream(g)).toBe(true);
  });
});
