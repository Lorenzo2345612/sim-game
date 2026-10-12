import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

export const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

export function setup(argv) {
  const [baseUrl, outDir] = argv.slice(2);
  if (!baseUrl || !outDir) {
    console.error('usage: node <script> <baseUrl> <outDir>');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  return { baseUrl: baseUrl.replace(/\/$/, ''), outDir };
}

export async function openGame(browser, url, errors = []) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const ready = await page
    .waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 })
    .then(() => true, () => false);
  return { page, ready };
}

// Calls every zero-arg getter on __SIMGAME__; returns plain values.
export const snapshot = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const [k, v] of Object.entries(window.__SIMGAME__ ?? {})) {
      try {
        out[k] = typeof v === 'function' ? (v.length === 0 ? v() : '[fn]') : v;
      } catch (e) {
        out[k] = `[error: ${e.message}]`;
      }
    }
    return JSON.parse(JSON.stringify(out));
  });

export const save = (outDir, name, data) => writeFileSync(`${outDir}/${name}`, JSON.stringify(data, null, 2));
export { chromium };
