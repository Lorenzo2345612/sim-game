import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const HUD_ROOTS = ['#hud', '.tyres', '.ers', '.minimap', '#fps-overlay'];

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza&quality=low');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function renderTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function monzaTerrain(): { minX: number; maxX: number; minZ: number; maxZ: number; sizeX: number; sizeZ: number } {
  const json = JSON.parse(readFileSync(join(process.cwd(), 'public/tracks/monza.json'), 'utf8')) as {
    terrain: { originX: number; originZ: number; sizeX: number; sizeZ: number };
  };
  const terrain = json.terrain;
  return {
    minX: terrain.originX - terrain.sizeX / 2,
    maxX: terrain.originX + terrain.sizeX / 2,
    minZ: terrain.originZ - terrain.sizeZ / 2,
    maxZ: terrain.originZ + terrain.sizeZ / 2,
    sizeX: terrain.sizeX,
    sizeZ: terrain.sizeZ,
  };
}

test.describe('238 track QA shots post-code gaps', () => {
  test('POST1: qaCamera view object hides every HUD root and null restores each original display', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page);
    for (const sel of HUD_ROOTS) {
      expect(await page.locator(sel).count(), sel).toBe(1);
    }
    for (const sel of ['#hud', '.tyres', '.ers', '.minimap']) {
      expect(await page.locator(sel).evaluate((el) => el.style.display), sel).toBe('');
    }
    expect(await page.locator('#fps-overlay').evaluate((el) => el.style.display)).toBe('none');
    const info = await page.evaluate(() =>
      window.__SIMGAME__!.qaCamera({ eye: [-100, 40, -200], target: [0, 0, 0] }),
    );
    await renderTwoFrames(page);
    expect(info.kind).toBe('view');
    expect(info.orthographic).toBe(false);
    expect([info.left, info.right, info.top, info.bottom]).toEqual([0, 0, 0, 0]);
    for (const sel of HUD_ROOTS) {
      expect(await page.locator(sel).evaluate((el) => el.style.display), sel).toBe('none');
    }
    const back = await page.evaluate(() => window.__SIMGAME__!.qaCamera(null));
    await renderTwoFrames(page);
    expect(back.kind).toBe('chase');
    for (const sel of ['#hud', '.tyres', '.ers', '.minimap']) {
      expect(await page.locator(sel).evaluate((el) => el.style.display), sel).toBe('');
    }
    expect(await page.locator('#fps-overlay').evaluate((el) => el.style.display)).toBe('none');
    expect(errors).toEqual([]);
  });

  test('POST2: qaCamera top frustum is the smallest aspect-fit rectangle over the terrain', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const idle = await page.evaluate(() => window.__SIMGAME__!.qaCamera(null));
    expect(idle.kind).toBe('chase');
    expect(idle.orthographic).toBe(false);
    expect([idle.left, idle.right, idle.top, idle.bottom]).toEqual([0, 0, 0, 0]);
    const info = await page.evaluate(() => window.__SIMGAME__!.qaCamera('top'));
    const b = monzaTerrain();
    expect(info.kind).toBe('top');
    expect(info.orthographic).toBe(true);
    expect(info.left).toBeLessThanOrEqual(b.minX + 1);
    expect(info.right).toBeGreaterThanOrEqual(b.maxX - 1);
    expect(info.top).toBeLessThanOrEqual(b.minZ + 1);
    expect(info.bottom).toBeGreaterThanOrEqual(b.maxZ - 1);
    const spanX = info.right - info.left;
    const spanZ = info.bottom - info.top;
    const aspect = 1280 / 720;
    if (b.sizeX / b.sizeZ >= aspect) expect(spanX).toBeCloseTo(b.sizeX, 6);
    else expect(spanZ).toBeCloseTo(b.sizeZ, 6);
    const mutated = await page.evaluate(() => {
      const again = window.__SIMGAME__!.qaCamera('top');
      again.left = -999999;
      return window.__SIMGAME__!.qaCamera('top').left;
    });
    expect(mutated).not.toBe(-999999);
  });

  test('POST3: track:shots monza writes top, top-sat and seven view PNGs', async () => {
    test.setTimeout(420000);
    const root = process.cwd();
    const outDir = join(root, '.ai', 'qa', 'monza');
    rmSync(outDir, { recursive: true, force: true });
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(join(root, 'node_modules', '.bin', 'tsx'), ['tools/track-qa/shots.ts', 'monza'], {
        cwd: root,
        env: { ...process.env, E2E_PORT: String(PORT) },
      });
      child.on('error', reject);
      child.on('exit', (c) => resolve(c));
    });
    expect(code).toBe(0);
    const expected = [
      'corner1.png',
      'corner2.png',
      'corner3.png',
      'corner4.png',
      'corner5.png',
      'corner6.png',
      'start.png',
      'top-sat.png',
      'top.png',
    ];
    expect(readdirSync(outDir).sort()).toEqual(expected);
    for (const f of expected) {
      const p = join(outDir, f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeGreaterThan(1000);
    }
  });
});
