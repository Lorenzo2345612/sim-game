import { expect, test, type Page } from '@playwright/test';

const RACE = '/?race=1&track=cleveland&ai=5&laps=3';
const HUD_SELECTOR =
  '#hud, .damage-hud, .minimap, #flags, #toasts, .hud2-panel, .tyres, .race-hud-top, #race-tower, .race-tower-head, #tower-view, #vsc-banner, #blue-banner';

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

async function loadGame(page: Page): Promise<void> {
  await page.goto(RACE);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

async function raceAfterLights(page: Page, after: number): Promise<void> {
  await page.waitForFunction(() => (window.__SIMGAME__?.startLights() ?? -1) > 0, undefined, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SIMGAME__?.startLights() === 0, undefined, { timeout: 60000 });
  await advanceSim(page, after);
}

async function advanceSim(page: Page, seconds: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction((t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t, t0 + seconds, {
    timeout: 60000,
  });
}

function towerView(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('race-tower')?.dataset.view ?? '');
}

async function hudOverlaps(page: Page): Promise<{ a: string; b: string; area: number }[]> {
  return page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const name = (el: Element): string => el.id || el.className.toString() || el.tagName;
    const out: { a: string; b: string; area: number }[] = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i];
        const b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 0 && h > 0) out.push({ a: name(a), b: name(b), area: w * h });
      }
    }
    return out;
  }, HUD_SELECTOR);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('306 tower views', () => {
  test('AT7: key T cycles the tower to TYRES and two more presses return to GAP', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceAfterLights(page, 3);
    await page.keyboard.press('KeyT');
    expect(await towerView(page)).toBe('tyres');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#race-tower .tyre')].filter((el) =>
          /^[SMHIW]$/.test(el.textContent ?? ''),
        ).length >= 4,
      undefined,
      { timeout: 10000 },
    );
    const letters = await page.evaluate(
      () =>
        [...document.querySelectorAll('#race-tower .tyre')]
          .map((el) => el.textContent ?? '')
          .filter((t) => /^[SMHIW]$/.test(t)).length,
    );
    expect(letters).toBeGreaterThanOrEqual(4);
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyT');
    expect(await towerView(page)).toBe('gap');
    expect(errors).toEqual([]);
  });

  test('AT8: clicking #tower-view switches to the tyres view without HUD overlaps', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceAfterLights(page, 3);
    await page.click('#tower-view');
    expect(await towerView(page)).toBe('tyres');
    await advanceSim(page, 0.5);
    expect(await hudOverlaps(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
