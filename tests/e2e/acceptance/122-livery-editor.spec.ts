import { expect, test, type Page } from '@playwright/test';
import { parseLivery, type Livery } from '../../../src/game/livery';

test.use({ viewport: { width: 1280, height: 720 } });

type Debug122 = { sceneStats(): { playerLivery: Livery } };

async function openLiveryEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu button[data-track="monza"]')).toBeVisible();
  await page.locator('#menu').getByRole('button', { name: 'Livery', exact: true }).click();
  await expect(page.locator('#livery-save')).toBeVisible();
  await page.selectOption('#livery-car', 'f4');
}

async function setLiveryAndSave(page: Page): Promise<void> {
  await page.locator('#livery-primary').fill('#ff0000');
  await page.locator('[data-pattern="stripe"]').click();
  await page.locator('#livery-number').fill('44');
  await page.locator('#livery-save').click();
}

async function diffFraction(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(async ({ pa, pb }) => {
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
    const da = await load(pa);
    const db = await load(pb);
    const pixels = da.data.length / 4;
    let diff = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      if (da.data[i] !== db.data[i] || da.data[i + 1] !== db.data[i + 1] || da.data[i + 2] !== db.data[i + 2]) {
        diff += 1;
      }
    }
    return diff / pixels;
  }, { pa: a, pb: b });
}

test.describe('122 livery editor', () => {
  test('AT1: menu → Livery, primary #ff0000, pattern stripe, number 44, Save writes livery:f4', async ({ page }) => {
    test.setTimeout(120000);
    await openLiveryEditor(page);
    await setLiveryAndSave(page);
    const raw = await page.evaluate(() => localStorage.getItem('livery:f4'));
    expect(raw).not.toBeNull();
    const livery = parseLivery(JSON.parse(raw!));
    expect(livery.primary).toBe('#ff0000');
    expect(livery.pattern).toBe('stripe');
    expect(livery.number).toBe(44);
  });

  test('AT2: after saving, starting monza applies playerLivery #ff0000 stripe 44', async ({ page }) => {
    test.setTimeout(120000);
    await openLiveryEditor(page);
    await setLiveryAndSave(page);
    await page.goto('/');
    await expect(page.locator('#menu button[data-track="monza"]')).toBeVisible();
    await page.locator('#menu button[data-track="monza"]').click();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    const { playerLivery } = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug122).sceneStats());
    expect(playerLivery.primary).toBe('#ff0000');
    expect(playerLivery.pattern).toBe('stripe');
    expect(playerLivery.number).toBe(44);
  });

  test('AT3: changing the pattern changes preview canvas pixels (≥ 1 %) within 500 ms, no console errors', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await openLiveryEditor(page);
    const canvas = page.locator('#livery-preview');
    await expect(canvas).toBeVisible();
    const before = (await canvas.screenshot()).toString('base64');
    const t0 = Date.now();
    await page.locator('[data-pattern="stripe"]').click();
    let frac = 0;
    while (Date.now() - t0 <= 500) {
      const after = (await canvas.screenshot()).toString('base64');
      frac = await diffFraction(page, before, after);
      if (frac >= 0.01) break;
      await page.waitForTimeout(50);
    }
    expect(frac).toBeGreaterThanOrEqual(0.01);
    expect(errors).toEqual([]);
  });
});
