import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 160 adds landmarks to SceneStats; the global declaration only gains it once implemented.
type Debug160 = {
  sceneStats(): { landmarks?: number };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('160 landmarks', () => {
  test('AT2: sceneStats().landmarks is 2/2/1 on singapore/baku/lasvegas, no console errors', async ({ page }) => {
    test.setTimeout(240000);
    const cases: [string, number][] = [
      ['singapore', 2],
      ['baku', 2],
      ['lasvegas', 1],
    ];
    for (const [track, expected] of cases) {
      const errors: string[] = [];
      const onConsole = (m: { type(): string; text(): string }): void => {
        if (m.type() === 'error') errors.push(m.text());
      };
      const onPageError = (e: Error): void => {
        errors.push(e.message);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      await loadGame(page, `/?track=${track}`);
      const landmarks = await page.evaluate(
        () => (window.__SIMGAME__ as unknown as Debug160).sceneStats().landmarks ?? -1,
      );
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      expect(landmarks).toBe(expected);
      expect(errors).toEqual([]);
    }
  });
});
