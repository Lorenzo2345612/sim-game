import { expect, test, type Page } from '@playwright/test';

const TRACKS = ['monza', 'spa', 'silverstone'] as const;

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('phase 1 smoke', () => {
  for (const id of TRACKS) {
    test(`${id}: loads without console errors and exceeds 50 km/h within 5 s of full throttle`, async ({ page }) => {
      // Track loading can approach the 20 s budget; the default 30 s timeout is too tight under parallel workers.
      test.setTimeout(120000);
      const errors = await collectConsoleErrors(page);

      await page.goto(`/?track=${id}`);
      await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 20000 });

      await page.keyboard.down('ArrowUp');
      let reached = false;
      try {
        await page.waitForFunction(() => window.__SIMGAME__!.getSpeedKmh() > 50, undefined, { timeout: 5000 });
        reached = true;
      } catch {
        // deadline elapsed without reaching the speed
      }
      await page.keyboard.up('ArrowUp');
      expect(reached).toBe(true);

      await page.screenshot({ path: `test-results/phase1-${id}.png` });
      expect(errors).toEqual([]);
    });
  }
});
