import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('208 tyre hud', () => {
  test('AT8: the tyre widget shows temps, wear, compound and pressure inside the viewport with no console errors', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const data = await page.evaluate(() => {
      const texts = (sel: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(sel)).map((e) => e.textContent ?? '');
      const el = document.querySelector('.tyres');
      const box = el ? el.getBoundingClientRect() : null;
      return {
        tyreCount: document.querySelectorAll('.tyres .tyre').length,
        temps: texts('.tyre-temp'),
        wears: texts('.tyre-wear'),
        compound: document.querySelector('.tyres-compound')?.textContent ?? '',
        pressure: document.querySelector('.tyres-pressure')?.textContent ?? '',
        box: box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom } : null,
      };
    });
    expect(data.tyreCount).toBe(4);
    expect(data.temps).toHaveLength(4);
    for (const temp of data.temps) expect(temp).toMatch(/^\d+°$/);
    expect(data.wears).toHaveLength(4);
    for (const wear of data.wears) expect(wear).toMatch(/^\d+%$/);
    expect(['S', 'M', 'H']).toContain(data.compound);
    expect(data.pressure).toMatch(/^\d+\.\d psi$/);
    expect(data.box, '.tyres missing').not.toBeNull();
    expect(data.box!.x).toBeGreaterThanOrEqual(0);
    expect(data.box!.y).toBeGreaterThanOrEqual(0);
    expect(data.box!.right).toBeLessThanOrEqual(1280);
    expect(data.box!.bottom).toBeLessThanOrEqual(720);
    expect(errors).toEqual([]);
  });
});
