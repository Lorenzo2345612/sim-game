import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 117 adds mirrorRenders to renderStats; the global declaration in
// src/main.ts only gains it once implemented (the 099/116 pattern).
type Debug117 = {
  renderStats(): { mirrorRenders: number };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function mirrorRenders(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug117).renderStats().mirrorRenders);
}

async function luminanceStdDev(page: Page, pngBase64: string): Promise<number> {
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const n = img.width * img.height;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
      sum += l;
      sumSq += l * l;
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  }, pngBase64);
}

async function toCockpit(page: Page): Promise<void> {
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__SIMGAME__!.cameraMode())).toBe('cockpit');
}

test.describe('117 virtual mirror', () => {
  test('AT3: in cockpit mode #mirror is visible with pixel luminance std dev > 0.02', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await toCockpit(page);
    const mirror = page.locator('#mirror');
    await expect(mirror).toBeVisible();
    await page.waitForTimeout(1000); // mirror renders every 2nd frame
    const png = (await mirror.screenshot()).toString('base64');
    expect(await luminanceStdDev(page, png)).toBeGreaterThan(0.02);
    expect(errors).toEqual([]);
  });

  test('AT4: in chase mode or with mirror false #mirror is hidden and mirrorRenders stops increasing', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const mirror = page.locator('#mirror');
    await loadGame(page, '/?track=monza');
    await toCockpit(page);
    await page.waitForTimeout(1000);
    await page.keyboard.press('c'); // cockpit -> chase
    expect(await page.evaluate(() => window.__SIMGAME__!.cameraMode())).toBe('chase');
    await expect(mirror).toBeHidden();
    const before = await mirrorRenders(page);
    await page.waitForTimeout(1000);
    expect(await mirrorRenders(page)).toBe(before);

    await page.addInitScript(() => localStorage.setItem('settings', JSON.stringify({ mirror: false })));
    await loadGame(page, '/?track=monza');
    await toCockpit(page);
    await expect(mirror).toBeHidden();
    const off = await mirrorRenders(page);
    await page.waitForTimeout(1000);
    expect(await mirrorRenders(page)).toBe(off);
    expect(errors).toEqual([]);
  });
});
