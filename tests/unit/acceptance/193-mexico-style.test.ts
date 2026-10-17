import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { BRAND_DENY_LIST } from './helpers/brands';
import { isDark, isGreen, isRed, isWhite, isYellow } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const STYLE_PATH = join(ROOT, 'public', 'tracks', 'mexico.style.json');
const rawText = readFileSync(STYLE_PATH, 'utf8');
const raw: unknown = JSON.parse(rawText);
const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'mexico.json'), 'utf8')) as {
  centerline: unknown[];
};
const n = track.centerline.length;
const { style, errors, warnings } = parseTrackStyle(raw, n);

const span = (r: StyleRange): number => (((r.end - r.start) % n) + n) % n + 1;

function rangeSets(): Record<string, StyleRange[]> {
  return {
    kerbs: style.kerbs.ranges,
    runoffPaint: style.runoffPaint.ranges,
    barriers: style.barriers.ranges,
    floodlights: style.floodlights?.ranges ?? [],
    extraGrandstands: style.extraGrandstands,
  };
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('193 mexico style', () => {
  it('AT1: style parses with no errors or warnings', () => {
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('AT2: key sections are non-default', () => {
    expect(style.pitBuilding).not.toEqual(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(style.kerbs.colors).not.toBeNull();
    expect(style.barriers.fence).not.toEqual(DEFAULT_TRACK_STYLE.barriers.fence);
    expect(style.grandstands).not.toEqual(DEFAULT_TRACK_STYLE.grandstands);
    expect(style.palette).not.toEqual(DEFAULT_TRACK_STYLE.palette);
  });

  it('AT3: ranges cover at most 40% of the lap, at least one index, no identical repeats', () => {
    for (const [name, ranges] of Object.entries(rangeSets())) {
      const seen = new Set<string>();
      for (const r of ranges) {
        expect(span(r), name).toBeGreaterThanOrEqual(1);
        expect(span(r), name).toBeLessThanOrEqual(0.4 * n);
        const key = `${r.side ?? 'both'}:${r.start}:${r.end}`;
        expect(seen.has(key), `${name} repeats ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('AT4: props are inside the centerline and at most 30', () => {
    expect(style.props.length).toBeLessThanOrEqual(30);
    for (const p of style.props) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(n);
    }
  });

  it('AT5: no brand names in non-colour string values', () => {
    const values = strings(raw).filter((s) => !/^#[0-9a-f]{6}$/i.test(s));
    for (const v of values) {
      for (const brand of BRAND_DENY_LIST) {
        expect(v.toLowerCase().includes(brand.toLowerCase()), `${v} contains ${brand}`).toBe(false);
      }
    }
  });

  it('AT6: check:styles exits 0', () => {
    const res = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status).toBe(0);
  }, 60_000);

  it('AT7: kerbs outerStrip is green', () => {
    expect(style.kerbs.outerStrip).not.toBeNull();
    expect(isGreen(style.kerbs.outerStrip ?? '')).toBe(true);
  });

  it('AT8: runoffPaint stripes include red and white', () => {
    const rp = style.runoffPaint;
    const colors = rp.ranges
      .filter((r) => (r.pattern ?? rp.pattern) === 'stripes')
      .flatMap((r) => r.colors ?? rp.colors);
    expect(colors.some(isRed)).toBe(true);
    expect(colors.some(isWhite)).toBe(true);
  });

  it('AT9: concrete barrier colour is green', () => {
    expect(style.barriers.concrete.color).not.toBeNull();
    expect(isGreen(style.barriers.concrete.color ?? '')).toBe(true);
  });

  it('AT10: pit building has 3 storeys and a yellow accent', () => {
    expect(style.pitBuilding.storeys).toBe(3);
    expect(style.pitBuilding.accent).not.toBeNull();
    expect(isYellow(style.pitBuilding.accent ?? '')).toBe(true);
  });

  it('AT11: grandstands use truss roof style and a dark roof', () => {
    expect(style.grandstands.roofStyle).toBe('truss');
    expect(style.grandstands.roof).not.toBeNull();
    expect(isDark(style.grandstands.roof ?? '')).toBe(true);
  });
});
