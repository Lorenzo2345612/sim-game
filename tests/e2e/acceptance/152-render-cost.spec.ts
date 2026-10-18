import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// debugCameraYaw arrives with 152; mirrored until src/main.ts declares it (the 151 pattern).
type Debug152 = { debugCameraYaw(rad: number): void };

const BASELINE = join(__dirname, '152-baseline-monza-start.png');
const MEDIUM_SETTINGS = JSON.stringify({ preset: 'medium' });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.addInitScript((s) => localStorage.setItem('settings', s), MEDIUM_SETTINGS);
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(3000);
}

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function diffFraction(page: Page, baseline: string, current: string): Promise<number> {
  return page.evaluate(async ([a, b]) => {
    const load = async (png: string): Promise<ImageData> => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    };
    const da = (await load(a)).data;
    const db = (await load(b)).data;
    if (da.length !== db.length) return 1;
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d =
        Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        ) > 10;
      if (d) diff++;
    }
    return diff / (da.length / 4);
  }, [baseline, current]);
}

test.describe('152 render cost acceptance', () => {
  test('AT1: monza at the start on medium draws at most 150 calls', async ({ page }) => {
    test.setTimeout(120000);
    const errors = captureErrors(page);
    await loadGame(page, '/?track=monza');
    const calls = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    expect(calls).toBeLessThanOrEqual(150);
    expect(errors).toEqual([]);
  });

  test('AT2: on spa the view looking away from the track draws at most 0.6x the start view', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors = captureErrors(page);
    await loadGame(page, '/?track=spa');
    const start = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug152).debugCameraYaw(Math.PI));
    await page.waitForTimeout(1000);
    const away = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    expect(away).toBeLessThanOrEqual(0.6 * start);
    expect(errors).toEqual([]);
  });

  test('AT4: the monza start screenshot differs from the baseline in at most 2% of pixels by more than 10/255', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors = captureErrors(page);
    await loadGame(page, '/?track=monza');
    const png = await page.screenshot();
    if (process.env.UPDATE_BASELINE === '1') {
      await writeFile(BASELINE, png);
      expect(png.byteLength).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      return;
    }
    const baseline = await readFile(BASELINE);
    const frac = await diffFraction(page, baseline.toString('base64'), png.toString('base64'));
    expect(frac).toBeLessThanOrEqual(0.02);
    expect(errors).toEqual([]);
  });
});
