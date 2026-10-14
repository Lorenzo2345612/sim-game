import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('078 reverse gear', () => {
  test('AT6: holding ArrowDown 3 s at the monza start reverses the car and the HUD shows R', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const start = await page.evaluate(() => ({
      pos: window.__SIMGAME__!.carPosition(),
      heading: window.__SIMGAME__!.getHeading(),
    }));
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(3000);
    const result = await page.evaluate((s) => {
      const p = window.__SIMGAME__!.carPosition();
      // Projection of the displacement on the forward heading (heading 0 faces -Z).
      const projected = (p.x - s.pos.x) * -Math.sin(s.heading) + (p.z - s.pos.z) * -Math.cos(s.heading);
      return {
        speedKmh: window.__SIMGAME__!.getSpeedKmh(),
        projected,
        hudGear: document.querySelector('.hud2-gear')?.textContent ?? '',
      };
    }, start);
    await page.keyboard.up('ArrowDown');
    expect(result.speedKmh).toBeGreaterThan(3);
    expect(result.projected).toBeLessThan(-1);
    expect(result.hudGear).toBe('R');
    expect(errors).toEqual([]);
  });
});
