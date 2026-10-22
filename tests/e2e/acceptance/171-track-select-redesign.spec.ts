import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Box = { x: number; y: number; width: number; height: number };

async function showMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu .menu-panel')).toBeVisible();
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, selector);
}

function expectInside(box: Box, viewport: { width: number; height: number }): void {
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

test.describe('171 track select redesign', () => {
  test.describe('AT3 at 1366x768', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test('AT3: panel, title and credits fit the viewport; 29 cards show outline and length', async ({ page }) => {
      test.setTimeout(120000);
      await showMenu(page);
      const cards = page.locator('button.track-card[data-track]');
      await expect(cards).toHaveCount(29);
      const viewport = page.viewportSize()!;
      expectInside(await boxOf(page, '#menu .menu-panel'), viewport);
      expectInside(await boxOf(page, '.menu-title'), viewport);
      expectInside(await boxOf(page, '#credits-btn'), viewport);
      const cardStates = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button.track-card[data-track]')).map((card) => ({
          hasPath: !!card.querySelector('svg.track-outline path'),
          text: card.textContent ?? '',
        })),
      );
      for (const card of cardStates) {
        expect(card.hasPath).toBe(true);
        expect(card.text).toMatch(/\d\.\d{3} km/);
      }
    });
  });

  test.describe('AT4 at 1920x1080', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('AT4: cards lay out in at least 3 columns and the panel fits the viewport', async ({ page }) => {
      test.setTimeout(120000);
      await showMenu(page);
      await expect(page.locator('button.track-card[data-track]').first()).toBeVisible();
      const lefts = await page.evaluate(() => {
        const distinct = new Set<number>();
        for (const card of document.querySelectorAll<HTMLElement>('button.track-card[data-track]')) {
          distinct.add(Math.round(card.getBoundingClientRect().left * 100) / 100);
        }
        return Array.from(distinct);
      });
      expect(lefts.length).toBeGreaterThanOrEqual(3);
      expectInside(await boxOf(page, '#menu .menu-panel'), page.viewportSize()!);
    });
  });

  test('AT5: scrolling the grid to spielberg and clicking it loads spielberg and sets lastTrack', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await showMenu(page);
    const spielberg = page.locator('button.track-card[data-track="spielberg"]');
    await expect(spielberg).toBeVisible();
    await spielberg.scrollIntoViewIfNeeded();
    await spielberg.click();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    expect(await page.evaluate(() => window.__SIMGAME__!.trackId())).toBe('spielberg');
    expect(await page.evaluate(() => localStorage.getItem('lastTrack'))).toBe('spielberg');
  });

  test('AT6: with lastTrack spa the spa card is selected and focused; ArrowRight then Enter loads the card to its right', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => localStorage.setItem('lastTrack', 'spa'));
    await showMenu(page);
    const spa = page.locator('button.track-card[data-track="spa"]');
    await expect(spa).toBeVisible();
    await expect(spa).toHaveClass(/selected/);
    const focusedTrack = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset?.track ?? null,
    );
    expect(focusedTrack).toBe('spa');
    const rightTrack = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('button.track-card[data-track]'));
      const spaCard = cards.find((card) => card.dataset.track === 'spa');
      if (!spaCard) throw new Error('spa card missing');
      const spaRect = spaCard.getBoundingClientRect();
      const spaX = spaRect.left + spaRect.width / 2;
      const spaY = spaRect.top + spaRect.height / 2;
      let best: { id: string; distance: number } | null = null;
      for (const card of cards) {
        if (card === spaCard) continue;
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (cx <= spaX) continue;
        const distance = Math.hypot(cx - spaX, cy - spaY);
        if (!best || distance < best.distance) best = { id: card.dataset.track!, distance };
      }
      if (!best) throw new Error('no card to the right of spa');
      return best.id;
    });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    expect(await page.evaluate(() => window.__SIMGAME__!.trackId())).toBe(rightTrack);
  });

  test('AT7: opaque dark #menu backdrop, no pure white colour or border in the menu, no card box-shadow', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await showMenu(page);
    await expect(page.locator('button.track-card[data-track]').first()).toBeVisible();
    const result = await page.evaluate(() => {
      const menu = document.getElementById('menu');
      if (!menu) throw new Error('#menu missing');
      const bg = getComputedStyle(menu).backgroundColor;
      const rgba = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(bg);
      const rgb = /rgb\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)/.exec(bg);
      const alpha = rgba ? Number(rgba[1]) : rgb ? 1 : 0;
      const whites: string[] = [];
      for (const el of Array.from(document.querySelectorAll('#menu, #menu *'))) {
        const cs = getComputedStyle(el);
        const label = `${el.tagName.toLowerCase()}#${el.id || ''}.${el.className || ''}`;
        if (cs.color === 'rgb(255, 255, 255)') whites.push(`${label} color`);
        for (const side of ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'] as const) {
          if (cs[side] === 'rgb(255, 255, 255)') whites.push(`${label} ${side}`);
        }
      }
      const shadows = Array.from(document.querySelectorAll<HTMLElement>('.track-card')).map(
        (card) => getComputedStyle(card).boxShadow,
      );
      return { alpha, whites, shadows };
    });
    expect(result.alpha).toBeGreaterThanOrEqual(0.92);
    expect(result.whites).toEqual([]);
    for (const shadow of result.shadows) expect(shadow).toBe('none');
  });
});
