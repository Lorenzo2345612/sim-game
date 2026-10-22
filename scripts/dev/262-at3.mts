// AT3 probe: `npx tsx scripts/dev/262-at3.mts [seconds]` — two AIs side by side, prints d/target each 0.5 s.
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
  trackId: 'monza', carId: 'f4', laps: 3, aiCount: 2, difficulty: 'medium', seed: 1,
  scenario: {
    starts: [
      { s: 0, d: -(corridorAt(c, 0, sample).halfLeft + 8), v: 0 },
      { s: 300, d: -2.5, v: 50 },
      { s: 300, d: 2.5, v: 50 },
    ],
    speedScales: [1, 1, 1],
    frozen: [0],
  },
} as Parameters<typeof RaceGame.create>[2]);
const probe = game as unknown as {
  ais: { craft?: { craft: { intent: string }; targetD: number; speedCap: number | null } }[];
  craftTrack: { lanes: Float64Array } | null;
};
const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
const cars = (game as unknown as { ais: { driver: { setLateralOffset(m: number): void } }[] }).ais;
for (const [k, car] of cars.entries()) {
  const orig = car.driver.setLateralOffset.bind(car.driver);
  car.driver.setLateralOffset = (m: number): void => {
    if (logGap) console.log(`   setLat car${k + 1} = ${m.toFixed(2)}`);
    orig(m);
  };
}
type GapFn = (ct: { look: { lineD: number }; lanes: Float64Array }, i: number, planOff: number) => number;
const proto = Object.getPrototypeOf(game) as Record<string, unknown>;
const origGap = proto.racecraftGapOffset as GapFn;
let logGap = false;
proto.racecraftGapOffset = function (
  this: unknown,
  ct: { look: { lineD: number }; lanes: Float64Array },
  i: number,
  planOff: number,
): number {
  const before = ct.lanes[i];
  const r = origGap.call(this, ct, i, planOff);
  if (logGap && i <= 2) {
    const self = (this as { craftTrack: { views: { d: number }[] } }).craftTrack.views[i];
    console.log(
      `   gap i=${i} planOff=${planOff.toFixed(2)} ld=${ct.look.lineD.toFixed(2)} d=${self.d.toFixed(2)} lane ${before.toFixed(2)}->${ct.lanes[i].toFixed(2)} ret=${r.toFixed(2)}`,
    );
  }
  return r;
};
const buf: VehicleState[] = [createVehicleState(4), createVehicleState(4), createVehicleState(4)];
const prog = [new TrackProgress(track.centerline), new TrackProgress(track.centerline)];
const total = Math.round(seconds / FIXED_DT);
const every = Math.round(0.5 / FIXED_DT);
let prev = 0;
for (let i = 1; i <= total; i++) {
  logGap = i * FIXED_DT > Number(process.env.G0 ?? 0) && i * FIXED_DT < Number(process.env.G1 ?? 1.6) && i % Math.round(0.1 / FIXED_DT) === 0;
  game.step(idle);
  game.getStates(buf);
  const ps = prog.map((p, k) => p.update(buf[k + 1].position.x, buf[k + 1].position.z));
  const dd = ps.map((p) => p.lateral);
  const ss = ps.map((p) => p.distance);
  const vv = [buf[1].forwardSpeed, buf[2].forwardSpeed];
  if (game.contactCount > prev) {
    prev = game.contactCount;
    console.log(`t ${(i * FIXED_DT).toFixed(2)} CONTACT dd=${(dd[0] - dd[1]).toFixed(2)} A:${ss[0].toFixed(0)}/${dd[0].toFixed(2)}/${vv[0].toFixed(1)} B:${ss[1].toFixed(0)}/${dd[1].toFixed(2)}/${vv[1].toFixed(1)}`);
  }
  if (i % every !== 0 && i * FIXED_DT > 2.2) continue;
  if (i * FIXED_DT <= 2.2 && i % Math.round(0.1 / FIXED_DT) !== 0) continue;
  const lanes = probe.craftTrack?.lanes;
  const row = [0, 1].map((k) => {
    const ai = probe.ais[k]?.craft;
    const t = ai ? `${ai.craft.intent[0]} tgt=${ai.targetD.toFixed(1)} lane=${lanes ? lanes[k + 1].toFixed(2) : '?'}` : 'cls';
    return `${ss[k].toFixed(0)}/${dd[k].toFixed(2)}/${vv[k].toFixed(1)} ${t}`;
  });
  console.log(`t ${(i * FIXED_DT).toFixed(1).padStart(5)} dD=${(dd[0] - dd[1]).toFixed(2).padStart(6)}  A ${row[0]}  |  B ${row[1]}`);
}
console.log('contacts', game.contactCount);
game.dispose?.();
