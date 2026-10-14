import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

const TRACKS = ['monza', 'spa', 'silverstone'];

// Collider parity is the existing unit test 086 AT4 (createPhysicsWorld is node-only).
test.describe('103 trackside realism', () => {
  test('AT4: each track at ready has drawCalls at most 300', async ({ page }) => {
    test.setTimeout(300000);
    for (const id of TRACKS) {
      await loadGame(page, `/?track=${id}`);
      const calls = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
      expect(calls, `${id} draw calls`).toBeLessThanOrEqual(300);
    }
  });
});
