import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

type Rgb = { r: number; g: number; b: number };

async function samplePixel(page: Page, pngBase64: string, x: number, y: number): Promise<Rgb> {
  return page.evaluate(
    async ({ png, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    },
    { png: pngBase64, px: x, py: y },
  );
}

test.describe('056 track integration', () => {
  test('AT1: ?track=monza loads monza without console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const id = await page.evaluate(() => window.__SIMGAME__!.trackId());
    expect(id).toBe('monza');
    expect(errors).toEqual([]);
  });

  test('AT2: pixel under the car at the monza start is asphalt', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const png = (await page.screenshot()).toString('base64');
    const rgb = await samplePixel(page, png, 640, 690);
    expect(rgb.r).toBeLessThan(90);
    expect(rgb.g).toBeLessThan(90);
    expect(rgb.b).toBeLessThan(90);
    expect(rgb.g - rgb.r).toBeLessThan(25);
  });

  test('AT3: at spa the car follows the elevation after 3 s of throttle', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    const { carY, trackY } = await page.evaluate(() => ({
      carY: window.__SIMGAME__!.carPosition().y,
      trackY: window.__SIMGAME__!.trackHeightUnderCar(),
    }));
    expect(Math.abs(carY - trackY)).toBeLessThan(0.8);
  });

  test("AT4: surfaceUnderCar is 'asphalt' at the monza start", async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const surface = await page.evaluate(() => window.__SIMGAME__!.surfaceUnderCar());
    expect(surface).toBe('asphalt');
  });

  test('AT5: silverstone loads with a visible HUD and reaches 30 km/h in 3 s', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=silverstone');
    const id = await page.evaluate(() => window.__SIMGAME__!.trackId());
    expect(id).toBe('silverstone');
    const hud = page.locator('#hud');
    await expect(hud).toBeVisible();
    expect(await hud.innerText()).toContain('km/h');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(30);
  });

  test('AT6: the default track without a query is monza', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/');
    const id = await page.evaluate(() => window.__SIMGAME__!.trackId());
    expect(id).toBe('monza');
  });

  test('AT7: heading increases by more than 0.2 rad when turning left', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const before = await page.evaluate(() => window.__SIMGAME__!.getHeading());
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2000);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');
    const after = await page.evaluate(() => window.__SIMGAME__!.getHeading());
    expect(after - before).toBeGreaterThan(0.2);
  });
});
