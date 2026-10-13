import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function pixel(page: Page, png: string, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ({ png, x, y }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    },
    { png, x, y },
  );
}

async function throttle(page: Page, ms: number): Promise<void> {
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowUp');
}

test.describe('057 F4 car in the game', () => {
  test('AT3: monza, 3 s throttle: no console errors, speed > 30 km/h, car pixel differs from sky', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await throttle(page, 3000);
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(30);
    const png = (await page.screenshot()).toString('base64');
    const car = await pixel(page, png, 640, 600);
    const sky = await pixel(page, png, 640, 40);
    expect(Math.max(...car.map((v, i) => Math.abs(v - sky[i])))).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });

  test('AT4: spa, 3 s throttle: the car rides on the track', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    await throttle(page, 3000);
    const d = await page.evaluate(() => {
      const g = window.__SIMGAME__!;
      return Math.abs(g.carPosition().y - g.trackHeightUnderCar());
    });
    expect(d).toBeLessThan(0.8);
  });
});
