import { readFileSync, readdirSync } from 'node:fs';
import { parseTrackData } from '/home/blort/dev/sim-game/src/track/parseTrackData';
import { buildTrackSurfaces, halfWidthAt } from '/home/blort/dev/sim-game/src/track/surfaces';
const dir = '/home/blort/dev/sim-game/public/tracks/';
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const t: any = parseTrackData(JSON.parse(readFileSync(dir + f, 'utf8')));
  if (t.version !== 2) continue;
  const cl = t.centerline, n = cl.length, cell = 25, g = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = Math.floor(cl[i][0]/cell)+','+Math.floor(cl[i][1]/cell); (g.get(k) ?? g.set(k, []).get(k)!).push(i); }
  const onAsphalt = (x: number, z: number) => { const gx = Math.floor(x/cell), gz = Math.floor(z/cell);
    for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) for (const i of g.get((gx+a)+','+(gz+b)) ?? []) {
      const d = Math.hypot(cl[i][0]-x, cl[i][1]-z); if (d < Math.min(halfWidthAt(t,'left',i), halfWidthAt(t,'right',i)) - 1) return i; }
    return -1; };
  const res: Record<string, { tris: number; idx: Set<number> }> = {};
  for (const s of buildTrackSurfaces(t)) { if (s.surface === 'asphalt' || s.surface === 'kerb') continue;
    const p = s.positions, ind = s.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) { const a=3*ind[k], b=3*ind[k+1], c=3*ind[k+2];
      const i = onAsphalt((p[a]+p[b]+p[c])/3, (p[a+2]+p[b+2]+p[c+2])/3);
      if (i >= 0) { const r = res[s.surface] ??= { tris: 0, idx: new Set() }; r.tris++; r.idx.add(Math.round(i/25)*25); } } }
  const out = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { tris: v.tris, near: [...v.idx].sort((a,b)=>a-b).slice(0, 15) }]));
  console.log(t.id, (t.escapeRoads ?? []).length, JSON.stringify(out));
}
