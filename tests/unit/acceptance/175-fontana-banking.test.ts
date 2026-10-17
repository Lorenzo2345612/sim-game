import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const FRONT: [number, number] = [1830, 2210];
const INFIELD: Array<[number, number]> = [
  [0, 1770],
  [2250, 2426],
];

function loadFontana(): TrackDataV2 & { bank?: number[] } {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'fontana.json'), 'utf8'));
  return json as TrackDataV2 & { bank?: number[] };
}

function cumulativeOf(track: TrackDataV2): number[] {
  const cx = track.centerline;
  const cum = [0];
  for (let i = 1; i < cx.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]));
  }
  return cum;
}

describe('175 fontana banking acceptance', () => {
  it('AT1: front stretch 1830..2210 m has max |bank| in [10, 12] deg at least 60 m inside', () => {
    const fontana = loadFontana();
    const bank = fontana.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(fontana.centerline.length);
    const cum = cumulativeOf(fontana);
    let maxDeg = 0;
    let checked = 0;
    for (let i = 0; i < cum.length; i++) {
      if (Math.min(cum[i] - FRONT[0], FRONT[1] - cum[i]) < 60) continue;
      const deg = Math.abs((bank ?? [])[i] ?? NaN) / DEG;
      maxDeg = Math.max(maxDeg, deg);
      checked++;
    }
    expect(checked, 'no index at least 60 m inside the front stretch').toBeGreaterThan(0);
    expect(maxDeg).toBeGreaterThanOrEqual(10);
    expect(maxDeg).toBeLessThanOrEqual(12);
  });

  it('AT2: infield indices at 0..1770 m and 2250 m..end have bank = 0', () => {
    const fontana = loadFontana();
    const bank = fontana.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(fontana.centerline.length);
    const cum = cumulativeOf(fontana);
    let checked = 0;
    for (let i = 0; i < cum.length; i++) {
      const m = cum[i];
      if (!INFIELD.some(([from, to]) => m >= from && m <= to)) continue;
      expect(Math.abs((bank ?? [])[i] ?? NaN), `index ${i} at ${m.toFixed(1)} m`).toBeLessThanOrEqual(
        1e-12,
      );
      checked++;
    }
    expect(checked, 'no infield index found').toBeGreaterThan(0);
  });
});
