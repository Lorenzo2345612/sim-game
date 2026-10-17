import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type StyleRange } from '../../../src/track/trackStyle';
import { BRAND_DENY_LIST } from './helpers/brands';
import { isBlue, isWhite } from './helpers/colour';

const ROOT = join(__dirname, '..', '..', '..');
const STYLE_PATH = join(ROOT, 'public', 'tracks', 'daytona.style.json');

function readStyleText(): string {
  return readFileSync(STYLE_PATH, 'utf8');
}

function pointCount(): number {
  const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8')) as {
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

describe('194 Daytona style', () => {
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
    for (const brand of BRAND_DENY_LIST) {
      for (const v of strings) expect(v.toLowerCase()).not.toContain(brand.toLowerCase());
    }
  });

  it('AT6: check:styles exits 0', () => {
    const r = spawnSync('npm', ['run', '-s', 'check:styles'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('AT7: fence is at least 6 m tall and includes wall', () => {
    const { fence } = load().result.style.barriers;
    expect(fence.heightMeters).toBeGreaterThanOrEqual(6);
    expect(fence.types).toContain('wall');
  });

  it('AT8: runoffPaint colours include blue and white', () => {
    const { runoffPaint } = load().result.style;
    const colors = [...runoffPaint.colors, ...runoffPaint.ranges.flatMap((r) => r.colors ?? [])];
    expect(colors.some(isBlue)).toBe(true);
    expect(colors.some(isWhite)).toBe(true);
  });

  it('AT9: concrete band is blue or concrete is white', () => {
    const { concrete } = load().result.style.barriers;
    const ok = (concrete.bandColor !== null && isBlue(concrete.bandColor))
      || (concrete.color !== null && isWhite(concrete.color));
    expect(ok).toBe(true);
  });

  it('AT10: has a tower or scoreboard prop', () => {
    const { props } = load().result.style;
    expect(props.some((p) => p.type === 'tower' || p.type === 'scoreboard')).toBe(true);
  });

  it('AT11: grandstand seats have at least 3 colours', () => {
    const seats = load().result.style.grandstands.seats;
    expect(seats?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('AT12: floodlights are masts', () => {
    const { floodlights } = load().result.style;
    expect(floodlights).not.toBeNull();
    expect(floodlights?.style).toBe('mast');
  });
});
