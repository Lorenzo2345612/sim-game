import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { isBlue, isDark, isGreen, isGrey, isRed, isYellow } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const STYLE_PATH = join(ROOT, 'public', 'tracks', 'spa.style.json');

const BRANDS = [
  'Pirelli', 'Rolex', 'Heineken', 'DHL', 'Aramco', 'Emirates', 'Petronas', 'Shell', 'Red Bull',
  'Ferrari', 'Mercedes', 'Gulf Air', 'Etihad', 'Qatar Airways', 'Crypto', 'Singtel',
  'Marina Bay Sands', 'Sphere', 'Formula 1', 'Indy', 'NASCAR',
];

function readStyleText(): string {
  return readFileSync(STYLE_PATH, 'utf8');
}

function pointCount(): number {
  const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'spa.json'), 'utf8')) as {
    centerline: unknown[];
  };
  return track.centerline.length;
}

function load() {
  const n = pointCount();
  const raw: unknown = JSON.parse(readStyleText());
  return { n, raw, result: parseTrackStyle(raw, n) };
}

function collectStrings(value: unknown, out: string[]): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

function span(range: StyleRange, n: number): number {
  return range.end >= range.start ? range.end - range.start + 1 : range.end + n - range.start + 1;
}

describe('189 Spa style', () => {
  it('AT1: style parses with no errors and no warnings', () => {
    const { result } = load();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('AT2: key sections are non-default', () => {
    const { style } = load().result;
    const d = DEFAULT_TRACK_STYLE;
    expect(style.pitBuilding).not.toEqual(d.pitBuilding);
    expect(style.kerbs.colors).not.toEqual(d.kerbs.colors);
    expect(style.kerbs.colors).not.toBeNull();
    expect(style.barriers.fence).not.toEqual(d.barriers.fence);
    expect(style.barriers.fence.color).not.toBeNull();
    expect(style.grandstands).not.toEqual(d.grandstands);
    expect(style.palette).not.toEqual(d.palette);
  });

  it('AT3: ranges cover at most 40% of the lap and do not repeat', () => {
    const { n, result } = load();
    const s = result.style;
    const groups: Record<string, (StyleRange & { side?: string })[]> = {
      kerbs: s.kerbs.ranges,
      runoffPaint: s.runoffPaint.ranges,
      barriers: s.barriers.ranges,
      floodlights: s.floodlights?.ranges ?? [],
      extraGrandstands: s.extraGrandstands,
    };
    for (const [name, ranges] of Object.entries(groups)) {
      const keys = new Set<string>();
      for (const r of ranges) {
        const len = span(r, n);
        expect(len, `${name} span`).toBeGreaterThanOrEqual(1);
        expect(len, `${name} span`).toBeLessThanOrEqual(0.4 * n);
        const key = `${r.side ?? 'both'}:${r.start}:${r.end}`;
        expect(keys.has(key), `${name} duplicate ${key}`).toBe(false);
        keys.add(key);
      }
    }
  });

  it('AT4: prop indices are inside the centerline and at most 30 props', () => {
    const { n, result } = load();
    const props = result.style.props;
    expect(props.length).toBeLessThanOrEqual(30);
    for (const p of props) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(n);
    }
  });

  it('AT5: file contains no brand strings', () => {
    const strings = collectStrings(JSON.parse(readStyleText()), []).filter(
      (v) => !/^#[0-9a-f]{6}$/i.test(v),
    );
    for (const brand of BRANDS) {
      for (const v of strings) expect(v.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it('AT6: check:styles exits 0', () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('AT7: a runoffPaint stripes range has red, yellow and dark colours', () => {
    const { runoffPaint } = load().result.style;
    const ok = runoffPaint.ranges.some((r) => {
      if (r.pattern !== 'stripes') return false;
      const colors = r.colors ?? runoffPaint.colors;
      return colors.some(isRed) && colors.some(isYellow) && colors.some(isDark);
    });
    expect(ok).toBe(true);
  });

  it('AT8: fence colour is green', () => {
    const color = load().result.style.barriers.fence.color;
    expect(color).not.toBeNull();
    expect(isGreen(color ?? '')).toBe(true);
  });

  it('AT9: grandstand seats include blue', () => {
    const seats = load().result.style.grandstands.seats;
    expect(seats?.some(isBlue)).toBe(true);
  });

  it('AT10: pit building has 2 storeys and a grey facade', () => {
    const pit = load().result.style.pitBuilding;
    expect(pit.storeys).toBe(2);
    expect(isGrey(pit.facade)).toBe(true);
  });

  it('AT11: sky hdri is kloofendal_overcast_puresky', () => {
    expect(load().result.style.sky.hdri).toBe('kloofendal_overcast_puresky');
  });
});
