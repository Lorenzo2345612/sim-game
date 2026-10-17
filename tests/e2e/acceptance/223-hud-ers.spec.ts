import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('223 ers hud', () => {
  test('AT5: ow26 shows a visible .ers inside the viewport without overlapping other HUD widgets', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&car=ow26');
    const ers = page.locator('.ers');
    await expect(ers).toBeVisible();
    await expect(page.locator('.ers-soc')).toHaveText(/^\d+%$/);
    const boxes = await page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      return {
        ers: rect('.ers'),
        others: ['.tyres', '.hud2-panel', 'canvas.minimap'].map((s) => rect(s)),
      };
    });
    const e = boxes.ers!;
    expect(e.left).toBeGreaterThanOrEqual(0);
    expect(e.top).toBeGreaterThanOrEqual(0);
    expect(e.right).toBeLessThanOrEqual(1280);
    expect(e.bottom).toBeLessThanOrEqual(720);
    for (const o of boxes.others) {
      if (!o) continue;
      const intersects = e.left < o.right && o.left < e.right && e.top < o.bottom && o.top < e.bottom;
      expect(intersects).toBe(false);
    }
    expect(errors).toEqual([]);
  });

  test('AT6: f4 hides the .ers widget', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza&car=f4');
    await expect(page.locator('.ers')).toBeHidden();
  });
});
