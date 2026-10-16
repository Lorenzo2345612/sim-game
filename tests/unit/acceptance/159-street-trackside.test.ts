import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';

// Task 159 creates src/render/streetFurniture.ts; the variable specifier keeps
// typecheck green until the module exists (the 157 pattern).
const STREET_FURNITURE = '../../../src/render/streetFurniture';

type Lamp = { x: number; z: number; yaw: number };
type LampPositions = (wallPath: [number, number][], spacing: number, inset: number) => Lamp[];

const ROOT = join(__dirname, '..', '..', '..');

async function loadLampPositions(): Promise<LampPositions> {
  const mod = (await import(STREET_FURNITURE)) as { lampPositions: LampPositions };
  return mod.lampPositions;
}

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

describe('159 street circuit trackside acceptance', () => {
  it('AT1: every baku barrier segment type is wall or foam', () => {
    const track = loadTrack('baku');
    expect(track.barriers.length, 'baku barriers').toBeGreaterThan(0);
    const other = track.barriers
      .filter((b) => b.type !== 'wall' && b.type !== 'foam')
      .map((b) => b.type);
    expect(other, 'segments that are neither wall nor foam').toEqual([]);
  });

  it('AT2: each side of a 400 m straight wall run gets 11 lamps at 40 m +-0.5 m spacing', async () => {
    const lampPositions = await loadLampPositions();
    const runs: [number, number][][] = [
      [
        [0, 0],
        [400, 0],
      ],
      [
        [0, -20],
        [400, -20],
      ],
    ];
    for (const run of runs) {
      const lamps = lampPositions(run, 40, 1);
      expect(lamps, 'lamps per side').toHaveLength(11);
      for (let i = 1; i < lamps.length; i++) {
        const gap = Math.hypot(lamps[i].x - lamps[i - 1].x, lamps[i].z - lamps[i - 1].z);
        expect(Math.abs(gap - 40), `gap between lamps ${i - 1} and ${i}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('AT4: rebuilt monza.json is identical to the pre-task JSON (not a city)', () => {
    const baseRev = execFileSync('git', ['merge-base', 'HEAD', 'master'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const prev = execFileSync('git', ['show', `${baseRev}:public/tracks/monza.json`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    const now = readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'));
    expect(now.equals(prev), 'monza.json differs from the pre-task JSON').toBe(true);
  });
});
