import { expect, test, type Page } from '@playwright/test';

const RACE = '/?race=1&track=cleveland&ai=3&laps=3';
const RACE_POLE = RACE + '&grid=pole';

type Debug305 = { debugGiveBack(car: number, passed: number): void };

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

async function simAdvance(page: Page, seconds: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction((t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t, t0 + seconds, {
    timeout: 60000,
  });
}

async function raceAfterLights(page: Page, after: number, autopilot = false): Promise<void> {
  await page.waitForFunction(() => (window.__SIMGAME__?.startLights() ?? -1) > 0, undefined, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SIMGAME__?.startLights() === 0, undefined, {
    timeout: 60000,
  });
  if (autopilot) await page.evaluate(() => window.__SIMGAME__?.debugAutopilot?.(true));
  await simAdvance(page, after);
}

test.describe('305 give back', () => {
  test('AT9: give-back banner shows the owed AI and does not overlap the HUD', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, RACE_POLE);
    await raceAfterLights(page, 3, true);
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug305).debugGiveBack(0, 3));
    await page.waitForFunction(
      () => {
        const el = document.getElementById('giveback-banner');
        return el !== null && getComputedStyle(el).display !== 'none' && el.offsetWidth > 0;
      },
      undefined,
      { timeout: 5000 },
    );
    const text = await page.evaluate(() => document.getElementById('giveback-banner')!.textContent);
    expect(text).toMatch(/^GIVE THE POSITION BACK TO AI 3 · (10|9) s$/);
    const overlaps = await page.evaluate(() => {
      const r = (sel: string): DOMRect | null =>
        document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const b = r('#giveback-banner')!;
      return ['#yellow-banner', '.minimap', '#race-tower', '.race-hud-top'].map((sel) => {
        const o = r(sel);
        if (!o || o.width === 0 || o.height === 0) return false;
        return b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top;
      });
    });
    expect(overlaps).toEqual([false, false, false, false]);
    expect(errors).toEqual([]);
  });
});
