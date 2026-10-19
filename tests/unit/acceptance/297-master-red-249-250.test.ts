import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import type { QaReport } from '../../../tools/track-qa/report';

const ROOT = join(__dirname, '..', '..', '..');
const NESTED_TIMEOUT = 900_000;
const CLI_TIMEOUT = 300_000;

function runCmd(cmd: string, args: string[], timeout: number): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

describe('297 master red acceptance', () => {
  it('AT1: npx vitest run tests/unit/acceptance/249- tests/unit/acceptance/250- exits 0 (all pass)', () => {
    const r = runCmd(
      'npx',
      ['vitest', 'run', 'tests/unit/acceptance/249-', 'tests/unit/acceptance/250-'],
      NESTED_TIMEOUT,
    );
    expect(r.status, r.out.slice(-4000)).toBe(0);
  }, NESTED_TIMEOUT);

  it('AT2: npm run track:qa baku reports barrier-fold at ok or warn, never fail', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'simgame-297-'));
    try {
      const r = runCmd(
        'npm',
        ['run', '-s', 'track:qa', '--', 'baku', '--out', outDir],
        CLI_TIMEOUT,
      );
      const reportPath = join(outDir, 'baku.json');
      expect(existsSync(reportPath), `track:qa wrote a report (status ${r.status}): ${r.out.slice(-2000)}`).toBe(true);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as QaReport & { id: string };
      const named = report.checks.filter((c) => c.name === 'barrier-fold');
      expect(named, 'barrier-fold check present').toHaveLength(1);
      const level = named[0].level;
      expect(['ok', 'warn'], `barrier-fold level ${level}`).toContain(level);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, CLI_TIMEOUT);

  it('AT3: the rebuilt baku.json differs from the committed one only in barriers entries within 4500-4800 m lap distance', () => {
    const rel = 'public/tracks/baku.json';
    const abs = join(ROOT, rel);
    const before = readFileSync(abs);
    try {
      const build = runCmd('npm', ['run', '-s', 'build:tracks', '--', 'baku'], CLI_TIMEOUT);
      expect(build.status, build.out.slice(-2000)).toBe(0);
      const rebuilt = JSON.parse(readFileSync(abs, 'utf8')) as TrackDataV2;
      const base = JSON.parse(committedFile(baselineRev(), rel).toString('utf8')) as TrackDataV2;
      const rebuiltPin: Record<string, unknown> = { ...rebuilt };
      const basePin: Record<string, unknown> = { ...base };
      const rebuiltBarriers = rebuiltPin.barriers as BarrierSegment[];
      const baseBarriers = basePin.barriers as BarrierSegment[];
      delete rebuiltPin.barriers;
      delete basePin.barriers;
      expect(Object.keys(rebuiltPin).sort(), 'top-level keys').toEqual(Object.keys(basePin).sort());
      for (const k of Object.keys(rebuiltPin)) {
        expect(JSON.stringify(rebuiltPin[k]), `key ${k} unchanged`).toBe(JSON.stringify(basePin[k]));
      }
      const cum = lapCum(rebuilt);
      for (const b of changedBarriers(baseBarriers, rebuiltBarriers)) {
        expect(cum[b.start], `${b.side} ${b.start}-${b.end} lap start`).toBeGreaterThanOrEqual(4500);
        expect(cum[b.end], `${b.side} ${b.start}-${b.end} lap end`).toBeLessThanOrEqual(4800);
      }
    } finally {
      writeFileSync(abs, before);
    }
  }, CLI_TIMEOUT);

  it('AT4: rebuilding every other track leaves its JSON byte-identical to the committed one', () => {
    const config = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
    ) as { id: string }[];
    const ids = config.map((t) => t.id).filter((id) => id !== 'baku');
    const rels = ids.map((id) => `public/tracks/${id}.json`);
    const before = rels.map((rel) => readFileSync(join(ROOT, rel)));
    try {
      const build = runCmd('npm', ['run', '-s', 'build:tracks', '--', ...ids], CLI_TIMEOUT);
      for (const id of ids) expect(build.out, `rebuilt ${id}`).toContain(`${id}:`);
      const rev = baselineRev();
      for (let i = 0; i < rels.length; i++) {
        const rebuilt = readFileSync(join(ROOT, rels[i]));
        const base = committedFile(rev, rels[i]);
        expect(rebuilt.equals(base), `${rels[i]} byte-identical to committed ${rev}`).toBe(true);
      }
    } finally {
      for (let i = 0; i < rels.length; i++) writeFileSync(join(ROOT, rels[i]), before[i]);
    }
  }, CLI_TIMEOUT);
});

function baselineRev(): string {
  return execFileSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function committedFile(rev: string, rel: string): Buffer {
  return execFileSync('git', ['show', `${rev}:${rel}`], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function lapCum(track: TrackDataV2): number[] {
  const cx = track.centerline;
  const cum = new Array<number>(cx.length);
  cum[0] = 0;
  for (let i = 1; i < cx.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
  }
  return cum;
}

function changedBarriers(before: BarrierSegment[], after: BarrierSegment[]): BarrierSegment[] {
  const key = (b: BarrierSegment): string => `${b.side}:${b.start}:${b.end}`;
  const oldMap = new Map(before.map((b) => [key(b), b]));
  const newMap = new Map(after.map((b) => [key(b), b]));
  const out: BarrierSegment[] = [];
  for (const [k, v] of newMap) {
    const o = oldMap.get(k);
    if (o === undefined || JSON.stringify(o) !== JSON.stringify(v)) out.push(v);
  }
  for (const [k, v] of oldMap) {
    if (!newMap.has(k)) out.push(v);
  }
  return out;
}
