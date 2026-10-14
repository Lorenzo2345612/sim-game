import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RacingLine } from '../../../src/ai/racingLine';
import { AiDriver } from '../../../src/ai/aiDriver';
import type { DriverInput } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;

function straightLine(): RacingLine {
  const n = 201;
  const points = new Float64Array(2 * n);
  const offsets = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    points[2 * i] = 0;
    points[2 * i + 1] = -2 * i;
    dist[i] = 2 * i;
  }
  return { offsets, points, dist, length: 2 * (n - 1) };
}

// consistent closed loop: dist[i] arc length, length includes the closing segment
function circleLine(R = 50, n = 180): RacingLine {
  const points = new Float64Array(2 * n);
  const offsets = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    points[2 * i] = R * Math.sin(a);
    points[2 * i + 1] = -R * Math.cos(a);
    dist[i] = R * a;
  }
  return { offsets, points, dist, length: 2 * Math.PI * R };
}

function tangentYawAt(line: RacingLine, i: number): number {
  const n = line.points.length / 2;
  const j = (i + 1) % n;
  const dx = line.points[2 * j] - line.points[2 * i];
  const dz = line.points[2 * j + 1] - line.points[2 * i + 1];
  return Math.atan2(-dx, -dz);
}

function flatSpeeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function freshOut(): DriverInput {
  return { throttle: 0, brake: 0, steer: 0, reset: false };
}

function obs(x: number, z: number, yaw: number, speed: number) {
  return { x, z, yaw, speed };
}

describe('089 AI driver gap cases', () => {
  it('GAP1: a large dt applies the whole lateral slew in one step', () => {
    const line = straightLine();
    const out = freshOut();
    const big = new AiDriver(line, flatSpeeds(201, 30));
    big.setLateralOffset(3);
    // step 1.5·10 = 15 m ≥ 3 → offset 3 immediately: car is 3 m left of the shifted line
    big.update(obs(0, -100, 0, 20), 10, out);
    expect(out.steer).toBeCloseTo(0.2903, 3);
    const small = new AiDriver(line, flatSpeeds(201, 30));
    small.setLateralOffset(3);
    const out2 = freshOut();
    small.update(obs(0, -100, 0, 20), 0.01, out2);
    expect(out2.steer).toBeCloseTo(0.001548, 5);
  });

  it('GAP2: the 1.5 m/s slew clamps in the negative direction too', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    drv.setLateralOffset(-3);
    const out = freshOut();
    // step 0.15 → offset −0.15: shifted line 0.15 m left of the car → steer −0.01547
    drv.update(obs(0, -100, 0, 20), 0.1, out);
    expect(out.steer).toBeCloseTo(-0.01547, 4);
  });

  it('GAP3: negative speed stays finite, clamps lookahead to min and commands throttle', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs(-2, -100, 0, -5), DT, out);
    // L = clamp(−3, 8, 45) = 8 → same geometry as the speed-0 clamp case
    expect(out.steer).toBeCloseTo(0.433615, 4);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
    expect(out.reset).toBe(false);
  });

  it('GAP4: an all-zero speed profile brakes at full when the car is moving', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 0));
    const out = freshOut();
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.steer).toBeCloseTo(0, 6);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(1);
  });

  it('GAP5: an empty params object behaves like the defaults', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30), {});
    const out = freshOut();
    drv.update(obs(-2, -100, 0, 20), DT, out);
    expect(out.steer).toBeCloseTo(0.20044, 4);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
  });

  it('GAP6: kp and kb overrides disable throttle and brake on both sides of the target', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30), { kp: 0, kb: 0 });
    const out = freshOut();
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBeCloseTo(0, 10);
    drv.update(obs(0, -100, 0, 40), DT, out);
    expect(out.throttle).toBeCloseTo(0, 10);
    expect(out.brake).toBeCloseTo(0, 10);
  });

  it('GAP7: wheelbase and maxSteerAngle overrides scale the steer', () => {
    const line = straightLine();
    const speeds = flatSpeeds(201, 30);
    const out = freshOut();
    // δ = atan(2·1.3·2/148) = 0.0351207, /0.35
    new AiDriver(line, speeds, { wheelbase: 1.3 }).update(obs(-2, -100, 0, 20), DT, out);
    expect(out.steer).toBeCloseTo(0.10034, 4);
    // δ = 0.0701550, /0.7
    new AiDriver(line, speeds, { maxSteerAngle: 0.7 }).update(obs(-2, -100, 0, 20), DT, out);
    expect(out.steer).toBeCloseTo(0.10022, 4);
  });

  it('GAP8: the stored line.offsets are not re-applied to the path', () => {
    const speeds = flatSpeeds(201, 30);
    const clean = straightLine();
    const dirty = straightLine();
    dirty.offsets.fill(5);
    const outA = freshOut();
    const outB = freshOut();
    new AiDriver(clean, speeds).update(obs(-2, -100, 0, 20), DT, outA);
    new AiDriver(dirty, speeds).update(obs(-2, -100, 0, 20), DT, outB);
    expect(outB.steer).toBe(outA.steer);
    expect(outB.steer).toBeCloseTo(0.20044, 4);
  });

  it('GAP9: projection and lookahead wrap the seam of a closed loop', () => {
    const line = circleLine();
    const speeds = flatSpeeds(180, 30);
    const mid = new AiDriver(line, speeds);
    const outMid = freshOut();
    const kMid = 45;
    mid.update(
      obs(line.points[2 * kMid], line.points[2 * kMid + 1], tangentYawAt(line, kMid), 20),
      DT,
      outMid,
    );
    // chord-tangent heading shifts α to ~0.1025 rad → δ = atan(5.2·sin α / ld)
    expect(outMid.steer).toBeCloseTo(0.1273, 3);
    for (const k of [179, 0]) {
      const drv = new AiDriver(line, speeds);
      const out = freshOut();
      drv.update(
        obs(line.points[2 * k], line.points[2 * k + 1], tangentYawAt(line, k), 20),
        DT,
        out,
      );
      expect(Math.abs(out.steer - outMid.steer)).toBeLessThan(0.01);
    }
  });

  it('GAP10: the speed preview walks across the seam of a closed loop', () => {
    const line = circleLine();
    const speeds = flatSpeeds(180, 30);
    for (let i = 0; i < 4; i++) speeds[i] = 25;
    const seam = new AiDriver(line, speeds);
    const out = freshOut();
    // car on the last point, preview 9 m crosses index 0 → target 25 → brake
    seam.update(obs(line.points[2 * 179], line.points[2 * 179 + 1], tangentYawAt(line, 179), 30), DT, out);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(1);
    const mid = new AiDriver(line, speeds);
    const out2 = freshOut();
    mid.update(obs(line.points[2 * 90], line.points[2 * 90 + 1], tangentYawAt(line, 90), 30), DT, out2);
    expect(out2.throttle).toBe(0);
    expect(out2.brake).toBeCloseTo(0, 10);
  });

  it('GAP11: a one-point line (zero-length normal) keeps every output finite', () => {
    const line: RacingLine = {
      offsets: new Float64Array(1),
      points: new Float64Array([0, 0]),
      dist: new Float64Array(1),
      length: 0,
    };
    const drv = new AiDriver(line, flatSpeeds(1, 30));
    const out = freshOut();
    // 12 % 0 = NaN in the lookahead walk; target falls back to the single point behind the car
    drv.update(obs(-2, -8, 0, 20), DT, out);
    expect(Number.isFinite(out.steer)).toBe(true);
    expect(Number.isFinite(out.throttle)).toBe(true);
    expect(Number.isFinite(out.brake)).toBe(true);
    expect(out.steer).toBeCloseTo(0.433615, 4);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
    expect(out.reset).toBe(false);
  });

  it('GAP12: update body contains no object or array construction', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'aiDriver.ts'), 'utf8');
    const start = src.indexOf(
      'update(obs: AiObservation, dt: number, out: DriverInput): DriverInput',
    );
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let body = '';
    for (let j = src.indexOf('{', start); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) {
          body = src.slice(src.indexOf('{', start) + 1, j);
          break;
        }
      }
    }
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/new\s/);
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/function\s*\(/);
    expect(body).not.toMatch(/=\s*[{[]/);
    expect(body).not.toMatch(/\(\s*\{/);
  });

  it('GAP13: aiDriver imports only core, track and racingLine', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'aiDriver.ts'), 'utf8');
    const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(
        spec.startsWith('../core/') || spec.startsWith('../track/') || spec === './racingLine',
      ).toBe(true);
    }
  });

  it('GAP14: architecture.md lists the ai and race layers', () => {
    const md = readFileSync(join(ROOT, 'ai', 'guides', 'architecture.md'), 'utf8');
    expect(md).toMatch(/^src\/ai\s+→/m);
    expect(md).toMatch(/^src\/race\s+→/m);
    const game = md.split('\n').find((l) => l.startsWith('src/game'));
    expect(game).toBeDefined();
    expect(game).toContain('ai');
    expect(game).toContain('race');
  });
});
