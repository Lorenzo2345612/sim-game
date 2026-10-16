import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

async function waitSim(page: Page, seconds: number, timeout = 180000): Promise<void> {
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction(
    (target) => {
      const g = window.__SIMGAME__;
      return !!g && g.getSimTime() >= target;
    },
    t0 + seconds,
    { timeout },
  );
}

async function throttle(page: Page, seconds: number): Promise<void> {
  await page.keyboard.down('ArrowUp');
  await waitSim(page, seconds);
  await page.keyboard.up('ArrowUp');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('114 prototype selection', () => {
  test('AT1: the car picker lists LMP2 A and Hypercar A after the GT3 entries', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    const picker = page.locator('#car-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option', { hasText: /^LMP2 A$/ })).toHaveCount(1);
    await expect(picker.locator('option', { hasText: /^Hypercar A$/ })).toHaveCount(1);
    const options = await picker.locator('option').evaluateAll((els) =>
      els.map((el) => ({
        value: (el as HTMLOptionElement).value,
        name: (el as HTMLOptionElement).textContent?.trim() ?? '',
      })),
    );
    const iLmp2 = options.findIndex((o) => o.name === 'LMP2 A');
    const iHyper = options.findIndex((o) => o.name === 'Hypercar A');
    const lastGt3 = options.reduce((end, o, i) => (o.value.startsWith('gt3-') ? i : end), -1);
    expect(lastGt3).toBeGreaterThanOrEqual(0);
    expect(iLmp2).toBeGreaterThan(lastGt3);
    expect(iHyper).toBeGreaterThan(lastGt3);
  });

  test('AT2: /?track=monza&car=hyper-a loads hyper-a, passes 40 km/h in 3 s, no console errors', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await loadGame(page, '/?track=monza&car=hyper-a');
    expect(await page.evaluate(() => window.__SIMGAME__!.carId())).toBe('hyper-a');
    await throttle(page, 3);
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });
});
