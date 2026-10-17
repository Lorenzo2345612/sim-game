import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle } from '../../../src/track/trackStyle';
import type { ResolvedTrackStyle, StyleRange } from '../../../src/track/trackStyle';
import { BRAND_DENY_LIST } from './helpers/brands';
import { hsl, isGrey, isLight } from './helpers/colour';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STYLE_PATH = `${ROOT}public/tracks/cleveland.style.json`;
const TRACK_PATH = `${ROOT}public/tracks/cleveland.json`;

const styleText = existsSync(STYLE_PATH) ? readFileSync(STYLE_PATH, 'utf8') : '{}';
const raw: unknown = JSON.parse(styleText);
const track = JSON.parse(readFileSync(TRACK_PATH, 'utf8')) as { centerline: unknown[] };
const n = track.centerline.length;
const parsed = parseTrackStyle(raw, n);
const style: ResolvedTrackStyle = parsed.style;

const HEX = /^#[0-9a-f]{6}$/i;

function span(r: StyleRange): number {
  return r.start <= r.end ? r.end - r.start + 1 : n - r.start + r.end + 1;
}

function isNonDefault<K extends keyof ResolvedTrackStyle>(key: K): boolean {
  return JSON.stringify(style[key]) !== JSON.stringify(DEFAULT_TRACK_STYLE[key]);
}

function collectStrings(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

describe('198 cleveland style', () => {
  it('AT1: style parses with no errors and no warnings', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('AT2: pitBuilding, kerbs.colors, barriers fence, grandstands and palette are non-default', () => {
    expect(isNonDefault('pitBuilding')).toBe(true);
    expect(style.kerbs.colors).not.toBeNull();
    expect(JSON.stringify(style.barriers.fence)).not.toBe(JSON.stringify(DEFAULT_TRACK_STYLE.barriers.fence));
    expect(isNonDefault('grandstands')).toBe(true);
    expect(isNonDefault('palette')).toBe(true);
  });

  it('AT3: every range covers 1..40% of the lap and none repeats start/end per section and side', () => {
    const sections: Record<string, StyleRange[]> = {
      kerbs: style.kerbs.ranges,
      runoffPaint: style.runoffPaint.ranges,
      barriers: style.barriers.ranges,
      floodlights: style.floodlights?.ranges ?? [],
      extraGrandstands: style.extraGrandstands,
    };
    for (const [name, ranges] of Object.entries(sections)) {
      const seen = new Set<string>();
      for (const r of ranges) {
        expect(span(r), name).toBeGreaterThanOrEqual(1);
        expect(span(r), name).toBeLessThanOrEqual(0.4 * n);
        const key = `${r.side ?? 'both'}:${r.start}:${r.end}`;
        expect(seen.has(key), `${name} ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('AT4: props have valid indices and there are at most 30', () => {
    expect(style.props.length).toBeLessThanOrEqual(30);
    for (const p of style.props) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(n);
    }
  });

  it('AT5: no brand string in non-hex string values', () => {
    const values = collectStrings(raw, []).filter((s) => !HEX.test(s));
    for (const v of values) {
      for (const brand of BRAND_DENY_LIST) {
        expect(v.toLowerCase().includes(brand.toLowerCase()), `${v} / ${brand}`).toBe(false);
      }
    }
  });

  it('AT6: npm run check:styles exits 0', { timeout: 120000 }, () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('AT7: palette.asphalt is light or grey with l >= 0.5', () => {
    const a = style.palette.asphalt;
    expect(a !== null && (isLight(a) || isGrey(a)) && hsl(a).l >= 0.5).toBe(true);
  });

  it('AT8: fence types include wall and height is at least 3.5 m', () => {
    expect(style.barriers.fence.types).toContain('wall');
    expect(style.barriers.fence.heightMeters).toBeGreaterThanOrEqual(3.5);
  });

  it('AT9: at least 2 extraGrandstands', () => {
    expect(style.extraGrandstands.length).toBeGreaterThanOrEqual(2);
  });

  it('AT10: no floodlights', () => {
    expect(style.floodlights).toBeNull();
  });
});
