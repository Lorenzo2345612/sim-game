import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ghostTimeAt } from '../../../src/game/ghostDelta';

const MAIN_TS = readFileSync(fileURLToPath(new URL('../../../src/main.ts', import.meta.url)), 'utf8');

const BASE_TIMES = Array.from({ length: 11 }, (_, i) => 6 * i);
const BASE_DIST = Array.from({ length: 11 }, (_, i) => (i === 10 ? 0 : 100 * i));

const AT5_TIMES = [0, 0.05, 6, 12, 18, 24, 30, 36, 42, 48, 54];
const AT5_DIST = [999, 1, 100, 200, 300, 400, 500, 600, 700, 800, 900];

describe('212 ghost delta wrap acceptance', () => {
  it('AT1: base ghost at d=450, lapTime=25 interpolates ghost time 27', () => {
    expect(ghostTimeAt(BASE_TIMES, BASE_DIST, 450, 25, 1000)).toBeCloseTo(27, 9);
  });

  it('AT2: d=999.5 with lapTime=0.01 wraps to the line and yields ghost time 0', () => {
    expect(ghostTimeAt(BASE_TIMES, BASE_DIST, 999.5, 0.01, 1000)).toBeCloseTo(0, 9);
  });

  it('AT3: call at d=900 then at d=200 gives 54 then 12 with no state between calls', () => {
    const first = ghostTimeAt(BASE_TIMES, BASE_DIST, 900, 54, 1000);
    const second = ghostTimeAt(BASE_TIMES, BASE_DIST, 200, 55, 1000);
    expect(first).toBeCloseTo(54, 9);
    expect(second).toBeCloseTo(12, 9);
  });

  it('AT4: d=999.5 with lapTime=59.9 (near end of lap) yields a time between 54 and 60 inclusive', () => {
    const t = ghostTimeAt(BASE_TIMES, BASE_DIST, 999.5, 59.9, 1000);
    expect(t).not.toBeNull();
    const v = t as number;
    expect(v).toBeGreaterThanOrEqual(54);
    expect(v).toBeLessThanOrEqual(60);
  });

  it('AT5: leading sample just behind the line is ignored; d=150, lapTime=9 yields ghost time 9', () => {
    expect(ghostTimeAt(AT5_TIMES, AT5_DIST, 150, 9, 1000)).toBeCloseTo(9, 9);
  });

  it('AT6: arrays of length 1 or d=NaN yield null', () => {
    expect(ghostTimeAt([6], [0], 450, 25, 1000)).toBeNull();
    expect(ghostTimeAt(BASE_TIMES, BASE_DIST, Number.NaN, 25, 1000)).toBeNull();
  });

  it('AT7: src/main.ts has no ghostCursor identifier and imports ghostTimeAt from ./game/ghostDelta', () => {
    expect(MAIN_TS).not.toMatch(/ghostCursor/);
    expect(MAIN_TS).toMatch(
      /import\s*\{[^}]*\bghostTimeAt\b[^}]*\}\s*from\s*['"]\.\/game\/ghostDelta['"]/,
    );
  });
});
