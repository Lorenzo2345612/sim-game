import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 073 extends window.__SIMGAME__ with carId(); the global declaration in
// src/main.ts only gains it when the task is implemented.
type Debug073 = { carId(): string };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

function carId(page: Page): Promise<string> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug073).carId());
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

test.describe('073 car selection', () => {
  test('AT1: the start menu car picker lists 4 cars in index order with default f4', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    const picker = page.locator('#car-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveCount(4);
    const values = await picker.locator('option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    expect(values).toEqual(['f4', 'gt3-a', 'gt3-b', 'gt3-c']);
    const names = await picker
      .locator('option')
      .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).textContent?.trim() ?? ''));
    expect(names).toEqual(['F4', 'GT3 A', 'GT3 B', 'GT3 C']);
    await expect(picker).toHaveValue('f4');
  });

  test('AT2: pick GT3 B and Monza, start: carId is gt3-b, no console errors, 3 s throttle over 30 km/h', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await page.goto('/');
    const picker = page.locator('#car-picker');
    await expect(picker).toBeVisible();
    await picker.selectOption('gt3-b');
    await page.locator('#menu button[data-track="monza"]').click();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    expect(await carId(page)).toBe('gt3-b');
    await throttle(page, 3);
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  test('AT3: after a reload the menu preselects GT3 B', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    const picker = page.locator('#car-picker');
    await expect(picker).toBeVisible();
    await picker.selectOption('gt3-b');
    await page.reload();
    await expect(page.locator('#car-picker')).toHaveValue('gt3-b');
  });

  test('AT4: ?car=gt3-c&track=spa starts directly with carId gt3-c and the car rides the track', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?car=gt3-c&track=spa');
    expect(await carId(page)).toBe('gt3-c');
    await throttle(page, 3);
    const d = await page.evaluate(() => {
      const g = window.__SIMGAME__!;
      return Math.abs(g.carPosition().y - g.trackHeightUnderCar());
    });
    expect(d).toBeLessThan(0.8);
  });
});
