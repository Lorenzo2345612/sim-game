import { readFileSync, readdirSync } from 'node:fs';
import { parseTrackData } from '/home/blort/dev/sim-game/src/track/parseTrackData';
import { buildTrackSurfaces, halfWidthAt } from '/home/blort/dev/sim-game/src/track/surfaces';
import { barrierRuns } from '/home/blort/dev/sim-game/src/track/barrierPath';
const dir = '/home/blort/dev/sim-game/public/tracks/';
const only = process.argv[2];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const t: any = parseTrackData(JSON.parse(readFileSync(dir + f, 'utf8')));
  if (t.version !== 2 || (only && t.id !== only)) continue;
  const T = t.terrain, x0 = T.originX - T.sizeX / 2, z0 = T.originZ - T.sizeZ / 2, sx = T.sizeX / T.cols, sz = T.sizeZ / T.rows, st = T.rows + 1;
  const th = (x: number, z: number) => {
    const fx = (x - x0) / sx, fz = (z - z0) / sz; const j = Math.min(T.cols - 1, Math.max(0, Math.floor(fx))), i = Math.min(T.rows - 1, Math.max(0, Math.floor(fz)));
    const u = fx - j, v = fz - i, h = T.heights;
    return h[j*st+i]*(1-u)*(1-v) + h[(j+1)*st+i]*u*(1-v) + h[j*st+i+1]*(1-u)*v + h[(j+1)*st+i+1]*u*v;
  };
  const strips = buildTrackSurfaces(t);
  // 1. terrain above strip (sample triangle centroid + edge midpoints)
  let poke = 0, pokeMax = 0; const pokeIdx: number[] = [];
  for (const s of strips) { const p = s.positions, ind = s.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) { const a = 3*ind[k], b = 3*ind[k+1], c = 3*ind[k+2];
      for (const [w1,w2,w3] of [[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5]]) {
        const x = w1*p[a]+w2*p[b]+w3*p[c], y = w1*p[a+1]+w2*p[b+1]+w3*p[c+1], z = w1*p[a+2]+w2*p[b+2]+w3*p[c+2];
        const d = th(x, z) - y; if (d > 0.005) { poke++; pokeMax = Math.max(pokeMax, d); }
      } } }
  // 2. barrier vertices inside the drivable track of any centerline point (not just their own)
  const cl = t.centerline, n = cl.length; let barIn = 0; const barIdx = new Set<number>();
  const hwMin = (i: number) => Math.min(halfWidthAt(t, 'left', i), halfWidthAt(t, 'right', i));
  for (const side of ['left', 'right'] as const) for (const run of barrierRuns(t, side)) for (const v of run) {
    for (let i = 0; i < n; i += 2) { const d = Math.hypot(cl[i][0]-v.x, cl[i][1]-v.z); if (d < hwMin(i) - 0.3) { barIn++; barIdx.add(v.index); break; } } }
  // 3. holes: points across the asphalt (|d| <= hw-0.5) not covered by any strip triangle in XZ
  const tris: number[][] = []; for (const s of strips) { const p = s.positions, ind = s.indices; for (let k = 0; k + 2 < ind.length; k += 3) tris.push([p[3*ind[k]],p[3*ind[k]+2],p[3*ind[k+1]],p[3*ind[k+1]+2],p[3*ind[k+2]],p[3*ind[k+2]+2]]); }
  const cell = 20, grid = new Map<string, number[][]>();
  for (const tr of tris) { const xs=[tr[0],tr[2],tr[4]], zs=[tr[1],tr[3],tr[5]];
    for (let gx=Math.floor(Math.min(...xs)/cell); gx<=Math.floor(Math.max(...xs)/cell); gx++) for (let gz=Math.floor(Math.min(...zs)/cell); gz<=Math.floor(Math.max(...zs)/cell); gz++) { const k=gx+','+gz; (grid.get(k) ?? grid.set(k, []).get(k)!).push(tr); } }
  const inside = (x: number, z: number) => (grid.get(Math.floor(x/cell)+','+Math.floor(z/cell)) ?? []).some((q) => {
    const d1=(x-q[2])*(q[1]-q[3])-(q[0]-q[2])*(z-q[3]), d2=(x-q[4])*(q[3]-q[5])-(q[2]-q[4])*(z-q[5]), d3=(x-q[0])*(q[5]-q[1])-(q[4]-q[0])*(z-q[1]);
    return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0)); });
  let holes = 0; const holeIdx: number[] = [];
  for (let i = 0; i < n; i++) { const j=(i+1)%n, dx=cl[j][0]-cl[i][0], dz=cl[j][1]-cl[i][1], L=Math.hypot(dx,dz)||1, nx=-dz/L, nz=dx/L;
    const hl = halfWidthAt(t,'left',i), hr = halfWidthAt(t,'right',i);
    for (const d of [-hl+0.5, -hl/2, 0, hr/2, hr-0.5]) { if (!inside(cl[i][0]+nx*d, cl[i][1]+nz*d)) { holes++; holeIdx.push(i); break; } } }
  console.log(JSON.stringify({ track: t.id, n, terrainPokeSamples: poke, pokeMaxM: +pokeMax.toFixed(2), barrierVertsOnTrack: barIn, barrierIdx: [...barIdx].slice(0, 12), holeIdx: holes, holeAt: holeIdx.slice(0, 12) }));
}
