import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Stats121 = { decals: number };
type Debug121 = { sceneStats(): Stats121 };

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('121 number decals', () => {
  test('AT3: sceneStats().decals counts 3 decal meshes on the monza car', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page);
    const { decals } = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug121).sceneStats());
    expect(decals).toBe(3);
    expect(errors).toEqual([]);
  });
});
