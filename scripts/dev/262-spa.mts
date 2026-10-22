import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_DT } from '../../src/core/constants';
import type { TrackDataV2 } from '../../src/core/types';
import { RaceGame } from '../../src/game/raceGame';
import { parseCarSpec } from '../../src/physics/carSpec';
import { parseTrackData } from '../../src/track/parseTrackData';
const mode = process.argv[2] ?? 'rc';
const id = process.argv[3] ?? 'spa';
const json = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'));
const track = parseTrackData(json(`public/tracks/${id}.json`)) as TrackDataV2;
const spec = parseCarSpec(json('public/cars/f4.json'));
const game = await RaceGame.create(track, spec, { trackId: id, carId: 'f4', laps: 2, aiCount: 1, difficulty: 'expert', seed: 3, ...(mode === 'classic' ? { classicTraffic: true } : {}) } as never);
const a = game as unknown as { vehicles: { getWheelSurfaces(): string[] }[]; traffic: { distance: number; lateral: number; speed: number }[] };
const drv = (game as unknown as { ais: { driver: { setLateralOffset(m: number): void; setSpeedCap?: (m: number | null) => void } }[] }).ais[0].driver;
let lastOff = 0;
const orig = drv.setLateralOffset.bind(drv);
drv.setLateralOffset = (m: number): void => { lastOff = m; orig(m); };
const BRAKE = { throttle: 0, brake: 1, steer: 0, reset: false };
let grass = 0;
let lastT = -9;
for (let s = 0; s < 400 / FIXED_DT; s++) {
  game.step(BRAKE);
  let off = 0;
  for (const surf of a.vehicles[1].getWheelSurfaces()) if (surf === 'grass' || surf === 'gravel') off++;
  const sd = a.traffic[1].distance;
  if (s % 24 === 0 && false) console.log(`  t=${(s*FIXED_DT).toFixed(1)} s=${sd.toFixed(0)} d=${a.traffic[1].lateral.toFixed(1)} off=${lastOff.toFixed(2)} v=${a.traffic[1].speed.toFixed(0)}`);
  if (s % 60 === 0 && s * FIXED_DT > 98 && s * FIXED_DT < 160) console.log(`  t=${(s*FIXED_DT).toFixed(1)} s=${sd.toFixed(0)} d=${a.traffic[1].lateral.toFixed(1)} off=${lastOff.toFixed(2)} v=${a.traffic[1].speed.toFixed(0)}`);
  if (off >= 2) { grass += FIXED_DT; const t = s * FIXED_DT; if (t - lastT > 1) console.log(`g=${grass.toFixed(1)} off=${lastOff.toFixed(2)} t=${t.toFixed(1)} s=${a.traffic[1].distance.toFixed(0)} d=${a.traffic[1].lateral.toFixed(1)} v=${a.traffic[1].speed.toFixed(0)} player s=${a.traffic[0].distance.toFixed(0)}`); lastT = t; }
  if (game.standings().every((st) => st.car === 0 || st.lap >= 3)) break;
}
console.log(mode, 'grass', grass.toFixed(1));
