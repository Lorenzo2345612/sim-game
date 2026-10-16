import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 116 extends SceneStats with steeringWheel; the global declaration in
// src/main.ts only gains it when the task is implemented (the 054 pattern).
type Debug116 = {
  sceneStats(): { steeringWheel: { visible: boolean; angle: number } };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function steeringWheel(page: Page): Promise<{ visible: boolean; angle: number }> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug116).sceneStats().steeringWheel);
}

test.describe('116 steering wheel', () => {
  test('AT3: cockpit camera with 1 s of right steering shows the wheel at a negative angle', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await page.keyboard.press('c');
    await page.keyboard.press('c');
    expect(await page.evaluate(() => window.__SIMGAME__!.cameraMode())).toBe('cockpit');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(1000);
    const wheel = await steeringWheel(page);
    await page.keyboard.up('ArrowRight');
    expect(wheel.visible).toBe(true);
    expect(wheel.angle).toBeLessThan(0);
    expect(errors).toEqual([]);
  });

  test('AT4: with the chase camera the steering wheel is not visible', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    expect(await page.evaluate(() => window.__SIMGAME__!.cameraMode())).toBe('chase');
    const wheel = await steeringWheel(page);
    expect(wheel.visible).toBe(false);
    expect(errors).toEqual([]);
  });
});
