// Contact diagnosis for task 262: `npx tsx scripts/dev/262-diag.mts [seconds]`
// Prints per-car s/d/v/intent each 2 s and every contact event.
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

const seconds = Number(process.argv[2] ?? 60);
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
} as Parameters<typeof RaceGame.create>[2]);
const probe = game as unknown as {
  ais: { craft?: { craft: { intent: string }; targetD: number; speedCap: number | null; lineRef: number } }[];
  craftNoGap: boolean;
};
const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
const buf: VehicleState[] = Array.from({ length: nAI + 1 }, () => createVehicleState(4));
const prog = Array.from({ length: nAI }, () => new TrackProgress(track.centerline));
const sample = { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
const total = Math.round(seconds / FIXED_DT);
const every2s = Math.round(2 / FIXED_DT);
let prevContacts = 0;
console.log('t    ' + Array.from({ length: nAI }, (_, k) => `A${k + 1}:s/d/v/int`.padEnd(22)).join(''));
for (let i = 1; i <= total; i++) {
  game.step(idle);
  game.getStates(buf);
  const ds: number[] = [];
  const dd: number[] = [];
  const vv: number[] = [];
  for (let k = 0; k < nAI; k++) {
    const p = prog[k].update(buf[k + 1].position.x, buf[k + 1].position.z);
    ds.push(p.distance);
    dd.push(p.lateral);
    vv.push(buf[k + 1].forwardSpeed);
  }
  if (game.contactCount > prevContacts) {
    prevContacts = game.contactCount;
    const pairs: string[] = [];
    for (let a = 0; a < nAI; a++) {
      for (let b = a + 1; b < nAI; b++) {
        const gap = ds[b] - ds[a];
        const g = ((gap % c.lapLength) + c.lapLength) % c.lapLength;
        const w = g > c.lapLength / 2 ? g - c.lapLength : g;
        if (Math.abs(w) < 8 && Math.abs(dd[a] - dd[b]) < 4) {
          pairs.push(`A${a + 1}/A${b + 1}(ds=${w.toFixed(1)},dd=${(dd[a] - dd[b]).toFixed(1)})`);
        }
      }
    }
    console.log(
      `t ${(i * FIXED_DT).toFixed(1)} CONTACT#${prevContacts} ${pairs.join(' ')} | ` +
        ds.map((s, k) => `A${k + 1} s=${s.toFixed(0)} d=${dd[k].toFixed(1)} v=${vv[k].toFixed(0)}`).join(' '),
    );
  }
  if (i % every2s !== 0) continue;
  const cr = probe.ais[0]?.craft;
  console.log(
    `t ${(i * FIXED_DT).toFixed(0).padStart(3)} ` +
      ds
        .map((s, k) => {
          const ai = probe.ais[k]?.craft;
          const tag = ai ? `${ai.craft.intent[0]}${ai.speedCap === null ? '-' : ai.speedCap.toFixed(0)}${probe.craftNoGap ? 'G' : ''}` : 'cls';
          return `${s.toFixed(0)}/${dd[k].toFixed(1)}/${vv[k].toFixed(0)}/${tag}`.padEnd(20);
        })
        .join('') +
      (cr ? ` t0=${cr.targetD.toFixed(1)} lR=${cr.lineRef.toFixed(1)}` : ''),
  );
}
console.log('contacts', game.contactCount);
game.dispose?.();
