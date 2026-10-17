import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import type { TrackDataV2 } from '../../src/core/types';
import { parseTrackData } from '../../src/track/parseTrackData';
import { qaViews, type QaView } from '../../src/track/qaViews';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Same launch flags as playwright.config.ts (SwiftShader raster).
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader'];
const SHOT_TIMEOUT = 180_000;
const READY_TIMEOUT = 120_000;
const TOP_WIDTH = 1600;
const VIEW_SIZE = { width: 1280, height: 720 };
const VIEW_COUNT = 6;

function waitFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Viewport with the terrain aspect (centerline bbox + 100 m without terrain), width 1600. */
function topViewport(track: TrackDataV2): { width: number; height: number } {
  const t = track.terrain;
  let w = t?.sizeX ?? 0;
  let d = t?.sizeZ ?? 0;
  if (!t) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of track.centerline) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    w = maxX - minX + 200;
    d = maxZ - minZ + 200;
  }
  return { width: TOP_WIDTH, height: Math.max(1, Math.round((TOP_WIDTH * d) / w)) };
}

/** 50/50 average of the top shot with the satellite ground texture resized to the same frame. */
async function blend50(topPath: string, satPath: string, outPath: string): Promise<void> {
  const top = await sharp(topPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sat = await sharp(satPath)
    .resize(top.info.width, top.info.height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(top.data.length);
  for (let i = 0; i < out.length; i++) out[i] = (top.data[i] + sat.data[i]) >> 1;
  for (let i = 3; i < out.length; i += top.info.channels) out[i] = 255;
  await sharp(out, { raw: top.info }).png().toFile(outPath);
}

async function main(): Promise<void> {
  const id = process.argv[2];
  const trackPath = id === undefined ? null : join(ROOT, 'public', 'tracks', `${id}.json`);
  if (trackPath === null || !existsSync(trackPath)) {
    console.error(`Unknown track id: ${id ?? '(none)'}; usage: track:shots <id>`);
    process.exit(1);
  }
  const parsed = parseTrackData(JSON.parse(readFileSync(trackPath, 'utf8')));
  if (!('version' in parsed)) {
    console.error(`Not a v2 track: ${id}`);
    process.exit(1);
  }
  const track: TrackDataV2 = parsed;
  const views: QaView[] = qaViews(track, VIEW_COUNT);
  const outDir = join(ROOT, '.ai', 'qa', id);
  mkdirSync(outDir, { recursive: true });

  const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
  const browser = await chromium.launch({ args: ARGS });
  try {
    const page = await browser.newPage({ viewport: { ...VIEW_SIZE } });
    page.setDefaultTimeout(SHOT_TIMEOUT);
    try {
      await page.goto(`${base}/?track=${id}&quality=low`);
    } catch {
      throw new Error(`No preview server at ${base} (npm run preview, or set E2E_PORT)`);
    }
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: READY_TIMEOUT });
    const loaded = await page.evaluate(() => window.__SIMGAME__!.trackId());
    if (loaded !== id) {
      throw new Error(`Game loaded track ${loaded}, not ${id} (not in the track menu?)`);
    }

    // Top view: viewport aspect = terrain aspect so the frustum fits exactly.
    await page.setViewportSize(topViewport(track));
    await page.evaluate(() => window.__SIMGAME__!.qaCamera('top'));
    await waitFrames(page);
    const topPath = join(outDir, 'top.png');
    await page.screenshot({ path: topPath, timeout: SHOT_TIMEOUT });
    console.log('wrote top.png');

    const satPath = join(ROOT, 'public', 'textures', 'ground', `${id}.jpg`);
    if (existsSync(satPath)) {
      await blend50(topPath, satPath, join(outDir, 'top-sat.png'));
      console.log('wrote top-sat.png');
    } else {
      console.log(`no ground texture for ${id}; skipped top-sat.png`);
    }

    await page.setViewportSize({ ...VIEW_SIZE });
    for (const view of views) {
      const eye = view.eye;
      const target = view.target;
      await page.evaluate((v) => window.__SIMGAME__!.qaCamera(v), { eye, target });
      await waitFrames(page);
      await page.screenshot({ path: join(outDir, `${view.name}.png`), timeout: SHOT_TIMEOUT });
      console.log(`wrote ${view.name}.png`);
    }
    console.log(`${outDir}: ${views.length + 1} shots`);
  } finally {
    await browser.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
