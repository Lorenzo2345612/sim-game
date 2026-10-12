import { expect, test } from '@playwright/test';

test('car accelerates in Monza without console errors', async ({ page }) => {
  test.setTimeout(120000);

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.screenshot({ path: 'test-results/phase0-start.png' });

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowUp');

  const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
  expect(speed).toBeGreaterThan(50);
  const simTime = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  expect(simTime).toBeGreaterThan(2);

  await page.screenshot({ path: 'test-results/phase0-accelerating.png' });
  expect(errors).toEqual([]);
});
