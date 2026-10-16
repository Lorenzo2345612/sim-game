import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Rect = { x: number; y: number; right: number; bottom: number };

const HUD_SELECTORS = ['.tyres', '.hud2-panel', '.hud-panel', 'canvas.minimap'];

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function openSetupPanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('#menu').getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.locator('#setup-panel')).toBeVisible();
}

test.describe('209 setup panel v2', () => {
  test('AT5: pause → Setup shows 8 sliders and 3 compound buttons with medium pressed on fresh storage', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await openSetupPanel(page);
    await expect(page.locator('#setup-panel input[type="range"][data-setup]')).toHaveCount(8);
    await expect(page.locator('#setup-panel button.compound-btn')).toHaveCount(3);
    const pressed = page.locator('#setup-panel button.compound-btn[aria-pressed="true"]');
    await expect(pressed).toHaveCount(1);
    await expect(pressed).toHaveAttribute('data-compound', 'medium');
  });

  test('AT6: Increase Rear wing once sets the slider to 6 and shows a +1 delta', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await openSetupPanel(page);
    await page.getByRole('button', { name: 'Increase Rear wing', exact: true }).click();
    const value = Number(await page.locator('#setup-panel input[data-setup="rearWing"]').inputValue());
    expect(value).toBe(6);
    await expect(page.locator('#setup-panel')).toContainText('+1');
  });

  test('AT7: the soft compound survives Apply and a page reload', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await openSetupPanel(page);
    await page.locator('#setup-panel').getByRole('button', { name: 'Soft', exact: true }).click();
    await page.locator('#setup-panel').getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    await page.reload();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    await expect(page.locator('.tyres-compound')).toHaveText('S');
    await openSetupPanel(page);
    await expect(page.locator('#setup-panel button.compound-btn[data-compound="soft"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('AT8: KeyI toggles the setup HUD inside the viewport without overlapping other HUD boxes', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await page.keyboard.press('KeyI');
    const hud = page.locator('#setup-hud');
    await expect(hud).toBeVisible();
    await expect(hud).toContainText('Medium');
    const data = await page.evaluate((selectors: string[]) => {
      const toRect = (el: Element): Rect => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
      };
      const hudEl = document.querySelector('#setup-hud');
      const others: { sel: string; rect: Rect }[] = [];
      const counts: Record<string, number> = {};
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        counts[sel] = found.length;
        for (const el of found) others.push({ sel, rect: toRect(el) });
      }
      return { hud: hudEl ? toRect(hudEl) : null, others, counts };
    }, HUD_SELECTORS);
    expect(data.hud, '#setup-hud missing').not.toBeNull();
    const box = data.hud!;
    for (const sel of HUD_SELECTORS) expect(data.counts[sel], `${sel} missing`).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(1280);
    expect(box.bottom).toBeLessThanOrEqual(720);
    for (const other of data.others) {
      const overlaps =
        box.x < other.rect.right &&
        other.rect.x < box.right &&
        box.y < other.rect.bottom &&
        other.rect.y < box.bottom;
      expect(overlaps, `#setup-hud overlaps ${other.sel}`).toBe(false);
    }
    await page.keyboard.press('KeyI');
    await expect(hud).toBeHidden();
    expect(errors).toEqual([]);
  });
});
