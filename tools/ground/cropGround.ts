import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { bboxCenter, unprojectXZ, type LonLat } from '../../src/track/geo';

const SIZE = 2048;
const SCENE = 'assets/source/ground/ermita-s2.jpg';
const BOUNDS = 'assets/source/ground/ermita-s2.json';
const OUT_DIR = 'public/textures/ground';

interface Bounds {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

interface RegistryEntry {
  id: string;
  geojson: string;
}

function softShoulder(x: number): number {
  return x <= 200 ? x : 200 + 45 * Math.tanh((x - 200) / 45);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

async function crop(id: string): Promise<void> {
  const registry = JSON.parse(readFileSync('tools/track-builder/tracks.json', 'utf8')) as RegistryEntry[];
  const entry = registry.find((e) => e.id === id);
  if (!entry) throw new Error(`cropGround: unknown track id ${id}`);
  const track = JSON.parse(readFileSync(join('public/tracks', `${id}.json`), 'utf8')) as {
    terrain: { originX: number; originZ: number; sizeX: number; sizeZ: number };
  };
  const { originX, originZ, sizeX, sizeZ } = track.terrain;
  const geo = JSON.parse(
    readFileSync(join('assets/source/tracks', `${entry.geojson}.geojson`), 'utf8'),
  ) as { features: { geometry: { coordinates: LonLat[] } }[] };
  const coords = geo.features[0]?.geometry.coordinates;
  if (!coords || coords.length === 0) throw new Error(`cropGround: ${entry.geojson}.geojson: no coordinates`);
  const origin = bboxCenter(coords);

  const sidecar = JSON.parse(readFileSync(BOUNDS, 'utf8')) as {
    bounds: Bounds;
    widthPx: number;
    heightPx: number;
  };
  const { lonMin, latMin, lonMax, latMax } = sidecar.bounds;
  const scene = sharp(SCENE);
  const meta = await scene.metadata();
  const srcW = meta.width ?? sidecar.widthPx;
  const srcH = meta.height ?? sidecar.heightPx;
  const src = await sharp(SCENE).raw().toBuffer();
  const stride = src.length / (srcW * srcH);

  // Pixel-centre grid: local x only moves lon, local z only moves lat.
  const fx = new Float64Array(SIZE);
  for (let u = 0; u < SIZE; u++) {
    const x = originX - sizeX / 2 + ((u + 0.5) / SIZE) * sizeX;
    const lon = unprojectXZ([x, 0], origin)[0];
    fx[u] = clamp(((lon - lonMin) / (lonMax - lonMin)) * srcW - 0.5, 0, srcW - 1);
  }
  const fy = new Float64Array(SIZE);
  for (let v = 0; v < SIZE; v++) {
    const z = originZ - sizeZ / 2 + ((v + 0.5) / SIZE) * sizeZ;
    const lat = unprojectXZ([0, z], origin)[1];
    fy[v] = clamp(((latMax - lat) / (latMax - latMin)) * srcH - 0.5, 0, srcH - 1);
  }

  const out = new Float32Array(SIZE * SIZE * 3);
  for (let v = 0; v < SIZE; v++) {
    const y0 = Math.floor(fy[v]);
    const ty = fy[v] - y0;
    const y1 = Math.min(y0 + 1, srcH - 1);
    for (let u = 0; u < SIZE; u++) {
      const x0 = Math.floor(fx[u]);
      const tx = fx[u] - x0;
      const x1 = Math.min(x0 + 1, srcW - 1);
      const o = (v * SIZE + u) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * srcW + x0) * stride + c];
        const p10 = src[(y0 * srcW + x1) * stride + c];
        const p01 = src[(y1 * srcW + x0) * stride + c];
        const p11 = src[(y1 * srcW + x1) * stride + c];
        const top = p00 + (p10 - p00) * tx;
        const bottom = p01 + (p11 - p01) * tx;
        out[o + c] = top + (bottom - top) * ty;
      }
    }
  }

  const hist = new Array<number>(256).fill(0);
  let sum = 0;
  for (let i = 0; i < out.length; i += 3) {
    hist[Math.min(255, Math.max(out[i], out[i + 1], out[i + 2]) | 0)] += 1;
    sum += out[i] + out[i + 1] + out[i + 2];
  }
  const total = out.length / 3;
  let cum = 0;
  let p99 = 255;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= 0.99 * total) {
      p99 = v;
      break;
    }
  }
  const mean = sum / out.length;
  const gain = Math.min(1, p99 > 0 ? 230 / p99 : 1, mean > 0 ? 112 / mean : 1);

  const pixels = Buffer.allocUnsafe(SIZE * SIZE * 3);
  for (let i = 0; i < out.length; i++) {
    pixels[i] = clamp(Math.round(softShoulder(out[i] * gain)), 0, 255);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${id}.jpg`);
  await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality: 85 })
    .toFile(path);
  console.log(`${id}: ${path} (gain ${gain.toFixed(3)}, p99 ${p99}, mean ${mean.toFixed(1)})`);
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('usage: tsx tools/ground/cropGround.ts <trackId>...');
  process.exitCode = 1;
} else {
  Promise.all(ids.map(crop)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
