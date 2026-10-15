import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../..', import.meta.url);
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8');

const mainSrc = (): string => read('src/main.ts');
const settingsSrc = (): string => read('src/core/settings.ts');
const gameSrc = (): string => read('src/game/game.ts');
const hudCss = (): string => read('src/ui/hudTyres.ts');

// 070 is pure wiring in main.ts / game.ts / settings.ts (no DOM in the node env), so
// the wiring edges are source contracts (same pattern as edge 054), one per spec rule.

function settingsImports(src: string): string[] {
  const m = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/core\/settings'/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.replace(/\btype\b/, '').trim())
    .filter(Boolean);
}

function tripleWithin(src: string, a: string, b: string, c: string, span: number): boolean {
  const pos = (t: string): number[] =>
    [...src.matchAll(new RegExp(`['"]${t}['"]`, 'g'))].map((m) => m.index ?? 0);
  const xs = pos(a);
  const ys = pos(b);
  const zs = pos(c);
  for (const i of xs) {
    for (const j of ys) {
      for (const k of zs) {
        if (Math.max(i, j, k) - Math.min(i, j, k) <= span) return true;
      }
    }
  }
  return false;
}

function simGameBlock(src: string): string {
  const i = src.indexOf('window.__SIMGAME__ = {');
  const j = src.indexOf('async function main', i);
  return i >= 0 && j > i ? src.slice(i, j) : '';
}

function frameBlock(src: string): string {
  const i = src.indexOf('const frameFn');
  if (i < 0) return '';
  const ends = [src.indexOf('const resume', i), src.indexOf('const onKeydown', i)].filter((k) => k > i);
  return src.slice(i, ends.length ? Math.min(...ends) : i + 4000);
}

function restartBlock(src: string): string {
  const i = src.search(/const\s+restart\s*=/);
  if (i < 0) return '';
  const ends = [src.indexOf('const changeTrack', i), src.indexOf('const showPauseMenu', i), src.indexOf('const onKeydown', i)].filter(
    (k) => k > i,
  );
  return src.slice(i, ends.length ? Math.min(...ends) : i + 2000);
}

// The spec passed to Game.create is the one applySetup returned: either inline, or a
// variable assigned from applySetup, or one loaded through a helper whose body applies it.
function appliedSpecReachesGame(src: string): boolean {
  const gi = src.indexOf('Game.create(');
  if (gi < 0) return false;
  const call = src.slice(gi, gi + 240);
  if (/Game\.create\(\s*track\s*,\s*(?:await\s+)?applySetup\s*\(/.test(call)) return true;
  const m = call.match(/Game\.create\(\s*track\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/);
  if (!m) return false;
  const v = m[1];
  const assign = (name: string, window: number): boolean =>
    new RegExp(String.raw`\b${name}\s*(?::[^=]+)?=\s*(?:await\s+)?[^;\n]{0,${window}}applySetup\s*\(`).test(src);
  if (assign(v, 240)) return true;
  for (const a of src.matchAll(/applySetup\s*\(/g)) {
    const before = src.slice(Math.max(0, (a.index ?? 0) - 900), a.index ?? 0);
    for (const f of before.matchAll(/(?:function\s+|const\s+|let\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=?/g)) {
      if (f[1] === v) continue;
      if (new RegExp(String.raw`\b${v}\s*(?::[^=]+)?=\s*(?:await\s+)?[^;\n]{0,160}\b${f[1]}\s*\(`).test(src)) return true;
    }
  }
  return false;
}

function minDistance(src: string, reA: RegExp, reB: RegExp): number {
  const a = [...src.matchAll(reA)].map((m) => m.index ?? 0);
  const b = [...src.matchAll(reB)].map((m) => m.index ?? 0);
  let best = Infinity;
  for (const i of a) {
    for (const j of b) {
      best = Math.min(best, Math.abs(i - j));
    }
  }
  return best;
}

describe('070 dynamics integration edges', () => {
  it('EDGE1: boot picks the car from ?car= (default f4) with a dynamic /cars/<id>.json fetch; no hardcoded f4 fetch remains', () => {
    const src = mainSrc();
    expect(src).toMatch(/get\(\s*['"]car['"]\s*\)/);
    expect(src).toMatch(/['"]f4['"]/);
    expect(src).toMatch(/\/cars\/\$\{/);
    expect(src).not.toMatch(/['"]\/cars\/f4\.json['"]/);
    // Step 6: the setup panel is fed the spec from the boot loader (no separate fetch).
    expect(src).toMatch(/new\s+SetupPanel\b[\s\S]{0,200}\bspec\s*:/);
  });

  it('EDGE2: the boot spec is applySetup(loadSetup(...)) fed to Game.create, and restart reloads the setup fresh', () => {
    const src = mainSrc();
    expect(src).toMatch(/loadSetup\s*\(/);
    expect(src).toMatch(/applySetup\s*\(/);
    expect(minDistance(src, /loadSetup\s*\(/g, /applySetup\s*\(/g)).toBeLessThanOrEqual(400);
    expect(appliedSpecReachesGame(src)).toBe(true);
    const body = restartBlock(src);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/Game\.create\(\s*track\s*,\s*carSpec\s*\)/);
    expect(
      /loadSetup\s*\(|apply\w+Setup\s*\(|(?:load|read|build|resolve|current|fresh|applied)\w*Spec\s*\(|reload\w*|startGame\s*\(/.test(
        body,
      ),
    ).toBe(true);
  });

  it('EDGE3: compound is ?compound=soft|medium|hard else stored else medium, and the active compound feeds setCompound and the HUD lookup', () => {
    const src = mainSrc();
    expect(src).toMatch(/get\(\s*['"]compound['"]\s*\)/);
    // The valid set is checked (soft/medium/hard literals together) or an unknown key falls back to medium.
    const validSet = tripleWithin(src, 'soft', 'medium', 'hard', 300);
    const lookupFallback = /compounds\s*\[[^\]]{0,80}\][\s\S]{0,100}\?\?[\s\S]{0,80}medium|hasOwn\w*\(\s*[^,)]*compounds/.test(src);
    expect(validSet || lookupFallback).toBe(true);
    const st = settingsSrc();
    expect(st).toMatch(/\bcompound\b/);
    expect(st).toMatch(/\bcompound\b[\s\S]{0,120}'medium'/);
    const all = src + gameSrc();
    expect(all).toMatch(/setCompound\s*\(/);
    const sub = src.match(/compounds\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/);
    expect(sub).not.toBeNull();
    expect(new RegExp(String.raw`setCompound\s*\(\s*(?:\w+\.)?${sub![1]}\b`).test(all)).toBe(true);
  });

  it('EDGE4: ?wear= and ?fuel= are read, stored options default to 1 via settings, and the values reach setMultipliers', () => {
    const src = mainSrc();
    expect(src).toMatch(/get\(\s*['"]wear['"]\s*\)/);
    expect(src).toMatch(/get\(\s*['"]fuel['"]\s*\)/);
    const st = settingsSrc();
    expect(st).toMatch(/\bwear\b[\s\S]{0,160}\b1\b/);
    expect(st).toMatch(/\bfuel\b[\s\S]{0,160}\b1\b/);
    // Stored options are read through a new settings accessor (query overrides them).
    const known = new Set(['loadPreset', 'parseQuality', 'presetSettings', 'Preset']);
    expect(settingsImports(src).some((n) => !known.has(n))).toBe(true);
    expect(src + gameSrc()).toMatch(/setMultipliers\s*\(/);
  });

  it('EDGE5: HudTyres is mounted with its stylesheet and updated in the frame loop with compound temp window and fuel in litres', () => {
    const src = mainSrc();
    expect(src).toMatch(/new\s+HudTyres\s*\(/);
    expect(src + hudCss()).toMatch(/hudTyres\.css/);
    expect(src).toMatch(/optTempC/);
    expect(src).toMatch(/tempWindowC/);
    expect(src).toMatch(/fuelL/);
    expect(src).toMatch(/meanLapL/);
    // kg from telemetry -> litres for the widget (069 HudTyresData.fuelL).
    expect(src).toMatch(/densityKgL/);
    expect(frameBlock(src)).toMatch(/optTempC|tempWindowC|meanLapL|fuelL/);
  });

  it('EDGE6: the HUD meanLapL is the mean fuel burnt over completed laps and null before the first', () => {
    const src = mainSrc();
    const all = src + gameSrc();
    expect(src).toMatch(/meanLapL\s*:/);
    const nullDefault =
      /(?:meanLap\w*|fuel\w*)[^=\n]{0,60}=\s*null/.test(all) ||
      /meanLapL\s*[:=][^;]{0,160}\bnull\b/.test(src) ||
      /(?:\blaps\b|\blapCount\b|\bcompletedLaps?\b)[\s\S]{0,80}\?\s*[^:;]{0,80}:\s*null/.test(all);
    expect(nullDefault).toBe(true);
    const mean =
      /(?:sum|total|burn\w*|used\w*|fuel\w*)[^;]{0,60}\/\s*(?:laps?\b|laps?\w+|lapCount|count\b|completedLaps?\b)/i.test(all) ||
      minDistance(all, /lapCompleted/g, /\bfuel\w*|\bburnt\b|\bsumFuel\b|\btotalFuel\b/gi) <= 500;
    expect(mean).toBe(true);
  });

  it('EDGE7: __SIMGAME__ gains telemetry() declared with rpm and gear while the existing members stay', () => {
    const src = mainSrc();
    expect(src).toMatch(/telemetry\s*\(\)\s*:\s*(?:\{[\s\S]{0,400}\brpm\s*:\s*number\b[\s\S]{0,300}\bgear\s*:\s*number\b|\w*Telemetry\b)/);
    const block = simGameBlock(src);
    expect(block.length).toBeGreaterThan(0);
    for (const key of [
      'ready',
      'getSpeedKmh',
      'getLap',
      'getSimTime',
      'trackId',
      'surfaceUnderCar',
      'carPosition',
      'trackHeightUnderCar',
      'getHeading',
      'sceneStats',
      'renderStats',
      'drawCalls',
      'cameraMode',
      'gear',
      'preset',
      'teleportToIndex',
      'audioPaused',
      'setLivery',
      'telemetry',
    ]) {
      expect(block).toMatch(new RegExp(String.raw`\b${key}\s*[:(]`));
    }
  });

  it('EDGE8: game.ts exposes telemetry, a heading accessor and a per-lap fuel accessor', () => {
    const g = gameSrc();
    expect(g).toMatch(/getTelemetry/);
    expect(g).toMatch(/heading\w*\s*[:(]/i);
    expect(g).toMatch(/(?:fuel|lapFuel|meanLap)\w*\s*[:(]/i);
  });
});
