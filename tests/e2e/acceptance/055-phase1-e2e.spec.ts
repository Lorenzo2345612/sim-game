import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const TRACKS = ['monza', 'spa', 'silverstone'] as const;

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

// Fraction of the band x 0-299, y 200-280 (inclusive) with G > R and luminance < 0.5.
async function foliageFraction(page: Page, pngBase64: string): Promise<number> {
  return page.evaluate(
    async ({ png }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 200, 300, 81).data;
      let green = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255;
        const g = d[i + 1] / 255;
        const b = d[i + 2] / 255;
        if (g > r && 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5) green += 1;
      }
      return green / (300 * 81);
    },
    { png: pngBase64 },
  );
}

test.describe('055 phase 1 end-to-end', () => {
  for (const id of TRACKS) {
    test(`AT1: ${id} is ready under 20 s, drives 5 s without console errors and exceeds 50 km/h`, async ({ page }) => {
      test.setTimeout(120000);
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      const t0 = Date.now();
      await page.goto(`/?track=${id}`);
      await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 30000 });
      expect(Date.now() - t0).toBeLessThan(20000);
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(5000);
      await page.keyboard.up('ArrowUp');
      const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
      expect(speed).toBeGreaterThan(50);
      expect(errors).toEqual([]);
    });
  }

  for (const id of TRACKS) {
    test(`AT2: ${id} start screenshot shows asphalt under the car and foliage left of centre`, async ({ page }) => {
      test.setTimeout(120000);
      await loadGame(page, `/?track=${id}`);
      const png = (await page.screenshot()).toString('base64');
      const rgb = await samplePixel(page, png, 640, 690);
      expect(rgb.r).toBeLessThan(90);
      expect(rgb.g).toBeLessThan(90);
      expect(rgb.b).toBeLessThan(90);
      expect(rgb.g - rgb.r).toBeLessThan(25);
      expect(await foliageFraction(page, png)).toBeGreaterThanOrEqual(0.3);
    });
  }

  test('AT3: monza draw calls at start are at most 300', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const calls = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    expect(calls).toBeLessThanOrEqual(300);
  });

  test('AT4: spa car climbs over 10 m within 300 m of driving from the max-gradient point', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    const spa = (await (await page.request.get('/tracks/spa.json')).json()) as unknown as {
      elevation: number[];
      centerline: [number, number][];
    };
    const el = spa.elevation;
    const cl = spa.centerline;
    const n = cl.length;
    let gradIdx = 0;
    for (let i = 1; i < el.length - 1; i++) {
      if (el[i + 1] - el[i] > el[gradIdx + 1] - el[gradIdx]) gradIdx = i;
    }
    const start = await page.evaluate((i) => {
      window.__SIMGAME__!.teleportToIndex(i);
      const p = window.__SIMGAME__!.carPosition();
      return { x: p.x, y: p.y, z: p.z };
    }, gradIdx);

    // Closed-loop chase of the centerline: steer toward a point ~30 m ahead of
    // the nearest centerline index until 300 m have been covered.
    let j = gradIdx;
    let prevX = start.x;
    let prevZ = start.z;
    let lastY = start.y;
    let dist = 0;
    let leftHeld = false;
    let rightHeld = false;
    await page.keyboard.down('ArrowUp');
    for (let s = 0; s < 200 && dist < 300; s++) {
      await page.waitForTimeout(150);
      const p = await page.evaluate(() => {
        const pos = window.__SIMGAME__!.carPosition();
        return { x: pos.x, y: pos.y, z: pos.z, heading: window.__SIMGAME__!.getHeading() };
      });
      dist += Math.hypot(p.x - prevX, p.z - prevZ);
      prevX = p.x;
      prevZ = p.z;
      lastY = p.y;
      const d2 = (idx: number) => (p.x - cl[idx][0]) ** 2 + (p.z - cl[idx][1]) ** 2;
      for (let k = 0; k < 60 && d2((j + 1) % n) < d2(j); k++) j = (j + 1) % n;
      const target = cl[(j + 15) % n];
      let err = Math.atan2(-(target[1] - p.z), -(target[0] - p.x)) - p.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      const wantLeft = err > 0.04;
      const wantRight = err < -0.04;
      if (wantLeft !== leftHeld) {
        await page.keyboard[wantLeft ? 'down' : 'up']('ArrowLeft');
        leftHeld = wantLeft;
      }
      if (wantRight !== rightHeld) {
        await page.keyboard[wantRight ? 'down' : 'up']('ArrowRight');
        rightHeld = wantRight;
      }
    }
    if (leftHeld) await page.keyboard.up('ArrowLeft');
    if (rightHeld) await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');

    expect(Math.abs(lastY - start.y)).toBeGreaterThan(10);
  });
});
