import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrackData } from '../../src/track/parseTrackData';
import { parseCarSpec } from '../../src/physics/carSpec';
import { minTimeFor } from '../../scripts/evolve/mintime.mts';
import { computeRacingLine } from '../../src/ai/racingLine';
const R = '/home/blort/dev/sim-game';
const t: any = parseTrackData(JSON.parse(readFileSync(join(R, 'public/tracks/cleveland.json'), 'utf8')));
const sp: any = parseCarSpec(JSON.parse(readFileSync(join(R, 'public/cars/f4.json'), 'utf8')));
const mt = await minTimeFor(R, t, sp.spec ?? sp, 'f4');
const cl = t.centerline, n = cl.length, rl = computeRacingLine(cl, t.widthMeters / 2);
let diff = 0, cnt = 0, opp = 0;
for (let i = 0; i < n; i++) {
  const a = cl[(i - 1 + n) % n], b = cl[(i + 1) % n], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
  const m = (mt.pts[i][0] - cl[i][0]) * (-tz / l) + (mt.pts[i][1] - cl[i][1]) * (tx / l), k = rl.offsets[i];
  diff += Math.abs(m - k);
  if (Math.abs(k) > 4) { cnt++; if (Math.abs(m - k) > 2) opp++; }
}
console.log('mean |mintime-K1999| m', (diff / n).toFixed(2), 'K1999 trigger pts', cnt, 'of which mintime >2 m away', opp, 'n', n);
