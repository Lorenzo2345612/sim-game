// AT1 probe: `npx tsx scripts/dev/262-at1.mts [seconds] [rc|classic]` — prints s/d/v of A and B each second.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCorridor, corridorAt } from '../../src/ai/raceView';
import { computeRacingLine } from '../../src/ai/racingLine';
import { FIXED_DT } from '../../src/core/constants';
import type { TrackDataV2, VehicleState } from '../../src/core/types';
import { createVehicleState } from '../../src/core/interpolation';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';
import { TrackProgress } from '../../src/track/trackProgress';

interface CraftProbe {
  ais: {
    craft?: {
      craft: { intent: string };
      targetD: number;
      speedCap: number | null;
    };
  }[];
}

const seconds = Number(process.argv[2] ?? 120);
const mode = process.argv[3] ?? 'rc';
const root = process.cwd();
const json = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const track = parseTrackData(json('public/tracks/monza.json')) as TrackDataV2;
const spec = parseCarSpec(json('public/cars/f4.json'));
const n = track.centerline.length;
const hl = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'left', i));
const hr = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'right', i));
const line = computeRacingLine(track.centerline, track.widthMeters / 2, 2.4, undefined, hl, hr);
const c = buildCorridor(track, line, new Float64Array(n));
const sample = { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
const lineD = (s: number): number => corridorAt(c, s, sample).lineD;
const game = await RaceGame.create(track, spec, {
  trackId: 'monza', carId: 'f4', laps: 3, aiCount: 2, difficulty: 'medium', seed: 1,
  scenario: {
    starts: [
      { s: 0, d: -(corridorAt(c, 0, sample).halfLeft + 8), v: 0 },
      { s: 200, d: lineD(200), v: 40 },
      { s: 230, d: lineD(230), v: 40 },
    ],
    speedScales: [1, 1, 0.85],
    frozen: [0],
  },
  ...(mode === 'classic' ? { classicTraffic: true } : {}),
} as Parameters<typeof RaceGame.create>[2]);
const probe = game as unknown as CraftProbe;
const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
const buf: VehicleState[] = [createVehicleState(4), createVehicleState(4), createVehicleState(4)];
const prog = [new TrackProgress(track.centerline), new TrackProgress(track.centerline)];
const rd = [200, 230];
const prevS = [200, 230];
const wrap = (raw: number): number => {
  const g = ((raw % c.lapLength) + c.lapLength) % c.lapLength;
  return g > c.lapLength / 2 ? g - c.lapLength : g;
};
const every = Math.round(1 / FIXED_DT);
const total = Math.round(seconds / FIXED_DT);
console.log('t  sA     dA    lD_A  offA   vA   sB     dB    vB    gap  intent tgtD');
for (let i = 1; i <= total; i++) {
  game.step(idle);
  if (i % every !== 0) continue;
  game.getStates(buf);
  const row: number[] = [];
  for (let k = 0; k < 2; k++) {
    const p = prog[k].update(buf[k + 1].position.x, buf[k + 1].position.z);
    rd[k] += wrap(p.distance - prevS[k]);
    prevS[k] = p.distance;
    row.push(rd[k], p.lateral, buf[k + 1].forwardSpeed);
  }
  const ldA = lineD(rd[0]);
  const cr = probe.ais[0].craft;
  const intent = cr ? cr.craft.intent : 'classic';
  const tgt = cr ? cr.targetD : 0;
  console.log(
    `${(i * FIXED_DT).toFixed(0).padStart(3)} ${row[0].toFixed(1).padStart(7)} ${row[1].toFixed(2).padStart(6)} ${ldA.toFixed(2).padStart(6)} ${(row[1] - ldA).toFixed(2).padStart(6)} ${row[2].toFixed(1).padStart(5)} ${row[3].toFixed(1).padStart(7)} ${row[4].toFixed(2).padStart(6)} ${row[5].toFixed(1).padStart(5)} ${(row[0] - row[3]).toFixed(1).padStart(6)} ${intent} ${tgt.toFixed(2)}`,
  );
}
console.log('contacts', game.contactCount);
game.dispose?.();
