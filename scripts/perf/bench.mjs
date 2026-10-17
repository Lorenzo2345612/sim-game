// Fixed performance scenarios against a running build.
// usage: node scripts/perf/bench.mjs <url> <out.json> [--gpu] [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SW_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const GPU_ARGS = ['--no-sandbox'];
const WARMUP_MS = 2000;
const READY_TIMEOUT_MS = 90000;

const SCENARIOS = [
  { key: 'monza-chase', path: '/?track=monza', seconds: 10 },
  { key: 'spa-race16', path: '/?race=1&track=spa&ai=15&laps=3', seconds: 30 },
  { key: 'monza-cockpit', path: '/?track=monza', seconds: 10, cockpit: true },
  { key: 'lusail-night', path: '/?track=lusail', seconds: 10, guard: (s) => s.timeOfDay === 'night' },
  { key: 'spa-rain', path: '/?track=spa&rain=1', seconds: 10, guard: (s) => s.rainParticles !== undefined },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const [baseUrl, outPath] = positional;
if (!baseUrl || !outPath) {
  console.error('usage: node scripts/perf/bench.mjs <url> <out.json> [--gpu] [--check]');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Default 30 s navigation times out under CI contention; one retry on top of the longer timeout.
async function navigate(page, url) {
  try {
    await page.goto(url, { timeout: READY_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof Error && /Timeout/.test(err.message)) {
      await page.goto(url, { timeout: READY_TIMEOUT_MS });
      return;
    }
    throw err;
  }
}

async function selectCockpit(page) {
  for (let i = 0; i < 3; i++) {
    const mode = await page.evaluate(() => window.__SIMGAME__.cameraMode());
    if (mode === 'cockpit') return;
    await page.keyboard.press('KeyC');
  }
  const mode = await page.evaluate(() => window.__SIMGAME__.cameraMode());
  if (mode !== 'cockpit') throw new Error(`cockpit camera not selected (mode=${mode})`);
}

function budgetOffenders(results) {
  const budgets = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'budgets.json'), 'utf8'));
  const checks = [
    ['frameMs.p95', budgets.frameP95Ms, (s) => s.frameMs.p95],
    ['simMs.p95', budgets.simP95Ms, (s) => s.simMs.p95],
    ['drawCalls', budgets.drawCalls, (s) => s.drawCalls],
    ['triangles', budgets.triangles, (s) => s.triangles],
  ];
  const offenders = [];
  for (const [key, stats] of Object.entries(results)) {
    for (const [field, limit, get] of checks) {
      const value = get(stats);
      if (value > limit) offenders.push(`${key}.${field} ${value} > ${limit}`);
    }
  }
  return offenders;
}

const errors = [];
const browser = await chromium.launch({ args: flags.has('--gpu') ? GPU_ARGS : SW_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));

const base = String(baseUrl).replace(/\/$/, '');
const results = {};
let failure = null;

try {
  for (const scenario of SCENARIOS) {
    await navigate(page, base + scenario.path);
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
      timeout: READY_TIMEOUT_MS,
    });
    if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
    const scene = await page.evaluate(() => window.__SIMGAME__.sceneStats());
    if (scenario.guard && !scenario.guard(scene)) {
      console.log(`skip ${scenario.key} (guard not met)`);
      continue;
    }
    if (scenario.cockpit) await selectCockpit(page);
    await sleep(WARMUP_MS + scenario.seconds * 1000);
    results[scenario.key] = await page.evaluate(() => window.__SIMGAME__.perfStats());
    console.log(`${scenario.key}: ${JSON.stringify(results[scenario.key])}`);
    if (errors.length > 0) throw new Error(`page error: ${errors[0]}`);
  }
} catch (err) {
  failure = err instanceof Error ? err.message : String(err);
} finally {
  await browser.close();
}

writeFileSync(outPath, JSON.stringify(results, null, 2));

if (failure !== null) {
  console.error(`bench failed: ${failure}`);
  process.exit(1);
}
if (flags.has('--check')) {
  const offenders = budgetOffenders(results);
  if (offenders.length > 0) {
    for (const line of offenders) console.error(`budget exceeded: ${line}`);
    process.exit(1);
  }
}
