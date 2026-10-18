import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

type Debug148 = {
  debugDamage(patch: { frontWing?: number }): void;
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('148 damage HUD', () => {
  test('AT4: debugDamage frontWing 1 gives #damage-fw class red and no console errors', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await expect(page.locator('#damage-fw')).toBeAttached();
    await page.evaluate(() => {
      (window.__SIMGAME__ as unknown as Debug148).debugDamage({ frontWing: 1 });
    });
    await expect(page.locator('#damage-fw')).toHaveClass('red');
    expect(errors).toEqual([]);
  });
});
