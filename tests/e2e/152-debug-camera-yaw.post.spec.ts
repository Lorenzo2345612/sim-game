import { expect, test, type Page } from '@playwright/test';

type Debug152 = {
  ready: boolean;
  debugCameraYaw(rad: number): void;
  debugScene?(): { camera: { matrixWorld: { elements: readonly number[] } } };
};

// World forward (0,0,-1) yawed by θ has matrixWorld third column (sinθ, 0, cosθ).
async function cameraYaw(page: Page): Promise<number> {
  return page.evaluate(() => {
    const camera = (window.__SIMGAME__ as unknown as Debug152).debugScene!().camera;
    const e = camera.matrixWorld.elements;
    return Math.atan2(e[8], e[10]);
  });
}

function near(page: Page, target: number, tolerance: number): Promise<boolean> {
  return page.waitForFunction(
    ([targetYaw, tol]) => {
      const camera = (window.__SIMGAME__ as unknown as Debug152).debugScene!().camera;
      const e = camera.matrixWorld.elements;
      const yaw = Math.atan2(e[8], e[10]);
      const d = Math.atan2(Math.sin(yaw - targetYaw), Math.cos(yaw - targetYaw));
      return Math.abs(d) < tol;
    },
    [target, tolerance] as const,
    { timeout: 30000 },
  ).then(() => true);
}

test.describe('152 debug camera yaw', () => {
  test('debugCameraYaw yaws the chase camera about world Y and 0 restores the rig pose', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?track=monza');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
      timeout: 60000,
    });

    const yaw0 = await cameraYaw(page);
    await page.evaluate(() => window.__SIMGAME__!.debugCameraYaw(Math.PI / 2));
    expect(await near(page, yaw0 + Math.PI / 2, 0.02)).toBe(true);

    await page.evaluate(() => window.__SIMGAME__!.debugCameraYaw(0));
    expect(await near(page, yaw0, 0.1)).toBe(true);
    expect(errors).toEqual([]);
  });
});
