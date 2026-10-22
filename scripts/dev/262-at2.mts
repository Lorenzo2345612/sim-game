// AT2 probe: `npx tsx scripts/dev/262-at2.mts [seconds]` — frozen car at s 600, three movers.
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

const seconds = Number(process.argv[2] ?? 40);
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
  trackId: 'monza', carId: 'f4', laps: 3, aiCount: 4, difficulty: 'medium', seed: 1,
  scenario: {
    starts: [
      { s: 0, d: -(corridorAt(c, 0, sample).halfLeft + 8), v: 0 },
      { s: 200, d: lineD(200), v: 40 },
      { s: 230, d: lineD(230), v: 40 },
      { s: 600, d: lineD(600), v: 0 },
      { s: 260, d: lineD(260), v: 40 },
    ],
    frozen: [0, 3],
  },
} as Parameters<typeof RaceGame.create>[2]);
const probe = game as unknown as {
  ais: { craft?: { craft: { intent: string }; targetD: number; speedCap: number | null } }[];
  craftTrack: { lanes: Float64Array } | null;
};
const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
const buf: VehicleState[] = Array.from({ length: 5 }, () => createVehicleState(4));
const prog = Array.from({ length: 5 }, () => new TrackProgress(track.centerline));
const total = Math.round(seconds / FIXED_DT);
const every = Math.round(0.5 / FIXED_DT);
let prev = 0;
console.log('t     car1 s/d/v      car2 s/d/v      car4 s/d/v      frozen s/d     intents');
for (let i = 1; i <= total; i++) {
  game.step(idle);
  game.getStates(buf);
  const ps = [1, 2, 3, 4].map((k) => prog[k].update(buf[k].position.x, buf[k].position.z));
  if (game.contactCount > prev) {
    prev = game.contactCount;
    console.log(
      `t ${(i * FIXED_DT).toFixed(2)} CONTACT#` + prev + ' ' +
        ps.map((p, k) => `c${[1, 2, 3, 4][k]}:${p.distance.toFixed(0)}/${p.lateral.toFixed(2)}`).join(' '),
    );
  }
  if (i % every !== 0) continue;
  const intents = [0, 1, 3].map((k) => {
    const ai = probe.ais[k]?.craft;
    return ai ? `${ai.craft.intent[0]}${ai.targetD.toFixed(1)}${ai.speedCap === null ? '-' : ai.speedCap.toFixed(0)}` : 'cls';
  });
  console.log(
    `t ${(i * FIXED_DT).toFixed(1).padStart(4)} ` +
      [0, 1, 3].map((j, idx) => `c${[1, 2, 4][idx]} ${ps[j].distance.toFixed(0).padStart(4)}/${ps[j].lateral.toFixed(2).padStart(6)}/${buf[[1, 2, 4][idx]].forwardSpeed.toFixed(0).padStart(3)}`).join('  ') +
      `  fz ${ps[2].distance.toFixed(0)}/${ps[2].lateral.toFixed(2)}  ${intents.join(' ')}`,
  );
}
console.log('contacts', game.contactCount);
game.dispose?.();
