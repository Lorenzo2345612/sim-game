// Local mirror of a Modal training run: syncs the `simgame-evolve` volume every 2 min and serves the evolve viewer
// (chart, per-generation table, saved models; no live car positions) on 127.0.0.1.
// Usage: npx tsx scripts/modal/watch.mts --track monza [--port 8790]
import { execFileSync } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrackData } from '../../src/track/parseTrackData';
import { halfWidthAt } from '../../src/track/surfaces';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const trackId = arg('track', 'monza'), PORT = Number(arg('port', '8790'));
const root = join(import.meta.dirname, '../..'), cache = '/tmp/simgame-modal';
mkdirSync(cache, { recursive: true });
const track: any = parseTrackData(JSON.parse(readFileSync(join(root, `public/tracks/${trackId}.json`), 'utf8')));
const cl: [number, number][] = track.centerline, left: number[][] = [], right: number[][] = [];
for (let i = 0; i < cl.length; i++) {
  const a = cl[(i - 1 + cl.length) % cl.length], b = cl[(i + 1) % cl.length];
  const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1, rx = -tz / l, rz = tx / l;
  const hr = halfWidthAt(track, 'right', i), hl = halfWidthAt(track, 'left', i);
  right.push([cl[i][0] + rx * hr, cl[i][1] + rz * hr]); left.push([cl[i][0] - rx * hl, cl[i][1] - rz * hl]);
}
let history: any[] = [], models: Record<string, any> = {};
const clients = new Set<ServerResponse>();
const send = (ev: string, d: unknown) => { for (const c of clients) c.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`); };
function sync(): void {
  try {
    const runs = execFileSync('modal', ['volume', 'ls', 'simgame-evolve', 'runs'], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim().replace(/^runs\//, '')).filter((s) => s.startsWith(`${trackId}-`)).sort();
    const last = runs[runs.length - 1];
    if (!last) return;
    for (const rel of [`runs/${last}/history.json`, `models/${trackId}-f4-residual/index.json`]) {
      execFileSync('modal', ['volume', 'get', '--force', 'simgame-evolve', rel, join(cache, rel.replace(/\//g, '_'))], { stdio: 'ignore' });
    }
    const h = JSON.parse(readFileSync(join(cache, `runs_${last}_history.json`), 'utf8'));
    const mf = join(cache, `models_${trackId}-f4-residual_index.json`);
    const m = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')).models ?? {} : {};
    for (const g of h.slice(history.length)) send('gen', g);
    history = h; models = m; send('models', models);
    console.log(`${new Date().toLocaleTimeString()} ${last}: ${history.length} gens, ${Object.keys(models).length} models`);
  } catch (e) { console.log(`sync failed: ${(e as Error).message.split('\n')[0]}`); }
}
createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ left, right, trackId: `${trackId} (Modal)`, carId: 'f4', pop: 100, elite: 5, history, models })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(join(root, 'scripts/evolve/viewer.html')));
}).listen(PORT, '127.0.0.1', () => console.log(`viewer: http://127.0.0.1:${PORT}`));
sync();
setInterval(sync, 120_000);
