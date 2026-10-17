import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { isGreen, isGrey, isRed, isWhite } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const ID = 'spielberg';
const MAX_SPAN = 0.4;
const MAX_PROPS = 30;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BRANDS = [
  'Pirelli', 'Rolex', 'Heineken', 'DHL', 'Aramco', 'Emirates', 'Petronas', 'Shell', 'Red Bull', 'Ferrari',
  'Mercedes', 'Gulf Air', 'Etihad', 'Qatar Airways', 'Crypto', 'Singtel', 'Marina Bay Sands', 'Sphere',
  'Formula 1', 'Indy', 'NASCAR',
];

const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${ID}.style.json`), 'utf8')) as unknown;
const centerline = (JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${ID}.json`), 'utf8')) as { centerline: unknown[] }).centerline;
const n = centerline.length;
const parsed = parseTrackStyle(raw, n);
const style: ResolvedTrackStyle = parsed.style;

function span(r: StyleRange): number {
  return r.end >= r.start ? r.end - r.start + 1 : r.end + n - r.start + 1;
}

function allRanges(): { section: string; range: StyleRange }[] {
  const out: { section: string; range: StyleRange }[] = [];
  const add = (section: string, list: StyleRange[]): void => {
    for (const range of list) out.push({ section, range });
  };
  add('kerbs', style.kerbs.ranges);
  add('runoffPaint', style.runoffPaint.ranges);
  add('barriers', style.barriers.ranges);
  add('floodlights', style.floodlights?.ranges ?? []);
  add('extraGrandstands', style.extraGrandstands);
  return out;
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (typeof v === 'object' && v !== null) Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('192 Spielberg style data', () => {
  it('AT1: parses with no errors and no warnings', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  it('AT2: pitBuilding, kerbs.colors, barriers fence, grandstands and palette are non-default', () => {
    expect(style.pitBuilding).not.toEqual(DEFAULT_TRACK_STYLE.pitBuilding);
    expect(style.kerbs.colors).not.toEqual(DEFAULT_TRACK_STYLE.kerbs.colors);
    expect(style.barriers.fence).not.toEqual(DEFAULT_TRACK_STYLE.barriers.fence);
    expect(style.grandstands).not.toEqual(DEFAULT_TRACK_STYLE.grandstands);
    expect(style.palette).not.toEqual(DEFAULT_TRACK_STYLE.palette);
  });

  it('AT3: every range covers 1 index to 40% of the lap and none repeats start/end for the same section and side', () => {
    const seen = new Set<string>();
    for (const { section, range } of allRanges()) {
      const s = span(range);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(MAX_SPAN * n);
      const key = `${section}|${range.side ?? 'both'}|${range.start}|${range.end}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('AT4: every prop index is inside the centerline and there are at most 30 props', () => {
    expect(style.props.length).toBeLessThanOrEqual(MAX_PROPS);
    for (const p of style.props) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(n);
    }
  });

  it('AT5: no brand string appears in non-hex string values', () => {
    const values = strings(raw).filter((s) => !HEX_RE.test(s)).map((s) => s.toLowerCase());
    for (const brand of BRANDS) {
      const b = brand.toLowerCase();
      expect(values.filter((v) => v.includes(b))).toEqual([]);
    }
  });

  it('AT6: npm run check:styles exits 0', () => {
    const res = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status).toBe(0);
  }, 60_000);

  it('AT7: a runoffPaint stripes range has red and white', () => {
    const hit = style.runoffPaint.ranges.some(
      (r) => r.pattern === 'stripes' && (r.colors ?? []).some(isRed) && (r.colors ?? []).some(isWhite),
    );
    expect(hit).toBe(true);
  });

  it('AT8: kerbs.outerStrip or a kerb range outerStrip is green', () => {
    const strips = [style.kerbs.outerStrip, ...style.kerbs.ranges.map((r) => r.outerStrip ?? null)];
    expect(strips.some((c) => c !== null && isGreen(c))).toBe(true);
  });

  it('AT9: pitBuilding glazing is at least 0.4 and facade is grey', () => {
    expect(style.pitBuilding.glazing).toBeGreaterThanOrEqual(0.4);
    expect(isGrey(style.pitBuilding.facade)).toBe(true);
  });

  it('AT10: at least 2 extraGrandstands', () => {
    expect(style.extraGrandstands.length).toBeGreaterThanOrEqual(2);
  });
});
