// Cheap AT4 probe for task 262: `npx tsx scripts/dev/262-at4.mts rc|classic [seconds]`
// Runs the 262 AT4 grid (7 AIs, two columns, player frozen off track) and prints contactCount every 10 s.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCorridor, corridorAt } from '../../src/ai/raceView';
import { computeRacingLine } from '../../src/ai/racingLine';
import { FIXED_DT } from '../../src/core/constants';
import type { TrackDataV2 } from '../../src/core/types';
import { createVehicleState } from '../../src/core/interpolation';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';

const mode = process.argv[2] ?? 'rc';
const seconds = Number(process.argv[3] ?? 60);
const root = process.cwd();
const json = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const track = parseTrackData(json('public/tracks/monza.json')) as TrackDataV2;
const spec = parseCarSpec(json('public/cars/f4.json'));
const n = track.centerline.length;
const hl = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'left', i));
const hr = Array.from({ length: n }, (_, i) => halfWidthAt(track, 'right', i));
const line = computeRacingLine(track.centerline, track.widthMeters / 2, 2.4, undefined, hl, hr);
const c = buildCorridor(track, line, new Float64Array(n));
const halfLeft0 = corridorAt(c, 0, { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 }).halfLeft;
const nAI = 7;
const starts = [{ s: 0, d: -(halfLeft0 + 8), v: 0 }];
const speedScales = [1];
for (let k = 0; k < nAI; k++) {
  starts.push({ s: 100 - 8 * k, d: k % 2 === 0 ? -2 : 2, v: 0 });
  speedScales.push(0.9 + (k * 0.1) / (nAI - 1));
}
const game = await RaceGame.create(track, spec, {
  trackId: 'monza', carId: 'f4', laps: 3, aiCount: nAI, difficulty: 'expert', seed: 1,
  scenario: { starts, speedScales, frozen: [0] },
  ...(mode === 'classic' ? { classicTraffic: true } : {}),
} as Parameters<typeof RaceGame.create>[2]);
const buf = Array.from({ length: nAI + 1 }, () => createVehicleState(4));
const pg = game as unknown as { traffic: { distance: number; lateral: number; speed: number }[]; craftTrack: { offs: Float64Array } | null };
let prevC = 0;
const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
const t0 = Date.now();
const total = Math.round(seconds / FIXED_DT);
const every = Math.round(10 / FIXED_DT);
for (let i = 1; i <= total; i++) {
  game.step(idle);
  if (i * FIXED_DT >= Number(process.env.W0 ?? 1e9) && i * FIXED_DT <= Number(process.env.W1 ?? 0) && i % 60 === 0) console.log(`w ${(i * FIXED_DT).toFixed(1)} ` + pg.traffic.slice(1).map((t, k) => `${k + 1}:${t.distance.toFixed(0)}/${t.lateral.toFixed(1)}/${t.speed.toFixed(0)}`).join(' '));
  if (game.contactCount > prevC) {
    prevC = game.contactCount;
    if (prevC <= 12) console.log(`t=${(i * FIXED_DT).toFixed(2)} C#${prevC} ` + pg.traffic.slice(1).map((t, k) => `${k + 1}:${t.distance.toFixed(0)}/${t.lateral.toFixed(1)}/${t.speed.toFixed(0)}`).join(' '));
  }
  if (i % every === 0) console.log(`t ${Math.round(i * FIXED_DT)} s contacts ${game.contactCount}`);
}
console.log(`${mode} done: contacts ${game.contactCount}, wall ${((Date.now() - t0) / 1000).toFixed(1)} s`);
game.dispose?.();
