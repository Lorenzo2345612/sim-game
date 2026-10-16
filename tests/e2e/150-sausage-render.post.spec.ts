import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Debug150 = { sceneStats(): { sausages: number } };

test.describe('150 sausage render post-code gaps', () => {
  test('lusail (empty sausages) reports sceneStats().sausages 0 with no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?track=lusail');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
      timeout: 60000,
    });
    const stats = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug150).sceneStats(),
    );
    expect(stats.sausages).toBe(0);
    expect(errors).toEqual([]);
  });
});
