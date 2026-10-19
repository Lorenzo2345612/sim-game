import { expect, test, type Page } from '@playwright/test';

const RACE = '/?race=1&track=cleveland&ai=5&laps=3';
const HUD_SELECTOR =
  '#hud, .damage-hud, .minimap, #flags, #toasts, .hud2-panel, .tyres, .race-hud-top, #race-tower';

type Debug294 = {
  forceTrackLimits(count: number, car: number): void;
};

test.use({ viewport: { width: 1366, height: 768 } });
test.describe.configure({ timeout: 180_000 });

async function loadGame(page: Page): Promise<void> {
  await page.goto(RACE);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// Lights out, then 6 s of simulation time after the race starts.
async function raceStarted6s(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__SIMGAME__?.startLights() ?? -1) > 0, undefined, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SIMGAME__?.startLights() === 0, undefined, {
    timeout: 60000,
  });
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction(
    (t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t,
    t0 + 6,
    { timeout: 60000 },
  );
}

// Books `count` strikes for `car`; returns the wall-clock ms of the call.
async function callForce(page: Page, count: number, car: number): Promise<number> {
  const t0 = Date.now();
  await page.evaluate(
    (a) => (window.__SIMGAME__ as unknown as Debug294).forceTrackLimits(a.count, a.car),
    { count, car },
  );
  return t0;
}

async function waitUntil(t0: number, ms: number, page: Page): Promise<void> {
  const wait = t0 + ms - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

async function blockingHits(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const rc = document.querySelector('#race-control');
    if (rc === null) return ['#race-control missing'];
    const r = rc.getBoundingClientRect();
    const out: string[] = [];
    for (const el of document.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (w > 0 && h > 0) out.push(el.id || el.className.toString());
    }
    return out;
  }, HUD_SELECTOR);
}

test.describe('294 race control penalty HUD', () => {
  test('AT6: a player penalty shows the announcement, race control and tower tag within 1 s', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceStarted6s(page);
    await callForce(page, 4, 0);
    await page.waitForFunction(() => {
      const text = (sel: string): string | null => {
        const el = document.querySelector(sel);
        if (el === null) return null;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return el.textContent ?? '';
      };
      const a = text('#penalty-announce');
      const rc = text('#race-control');
      const pen = text('.race-row.player .race-row-pen');
      return (
        a !== null &&
        a.includes('TIME PENALTY') &&
        a.includes('+5 SECONDS') &&
        a.includes('Track limits') &&
        rc !== null &&
        rc.includes('RACE CONTROL') &&
        rc.includes('FOR YOU - TRACK LIMITS') &&
        pen !== null &&
        pen.trim() === '+5s'
      );
    }, undefined, { timeout: 1000 });
    const announce = page.locator('#penalty-announce');
    await expect(announce).toContainText('TIME PENALTY');
    await expect(announce).toContainText('+5 SECONDS');
    await expect(announce).toContainText('Track limits');
    const raceControl = page.locator('#race-control');
    await expect(raceControl).toContainText('RACE CONTROL');
    await expect(raceControl).toContainText('FOR YOU - TRACK LIMITS');
    await expect(page.locator('.race-row.player .race-row-pen')).toHaveText('+5s');
    expect(errors).toEqual([]);
  });

  test('AT7: 5 s after the call the announcement is hidden, 7 s after race control is; the tag stays', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceStarted6s(page);
    const t0 = await callForce(page, 4, 0);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#penalty-announce');
        if (el === null) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.textContent ?? '').includes('+5 SECONDS');
      },
      undefined,
      { timeout: 1000 },
    );
    await waitUntil(t0, 5000, page);
    await expect(page.locator('#penalty-announce')).toBeHidden();
    await waitUntil(t0, 7000, page);
    // The panel may keep showing unrelated messages (e.g. an AI's), so only the
    // player's forced message must be gone by 7 s (planner relaxation, task 294).
    await expect(page.locator('#race-control', { hasText: 'FOR YOU - TRACK LIMITS' })).toHaveCount(0);
    await expect(page.locator('.race-row.player .race-row-pen')).toHaveText('+5s');
    expect(errors).toEqual([]);
  });

  test('AT8: an AI 2 penalty reaches race control and its tower tag, never the announcement, without HUD overlaps', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceStarted6s(page);
    await callForce(page, 4, 2);
    await page.waitForFunction(() => {
      const rc = document.querySelector('#race-control');
      if (rc === null) return false;
      const cs = getComputedStyle(rc);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = rc.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (!(rc.textContent ?? '').includes('FOR AI 2 - TRACK LIMITS')) return false;
      const a = document.querySelector('#penalty-announce');
      return (
        a === null ||
        getComputedStyle(a).display === 'none' ||
        getComputedStyle(a).visibility === 'hidden' ||
        a.getBoundingClientRect().width <= 0 ||
        a.getBoundingClientRect().height <= 0
      );
    }, undefined, { timeout: 1000 });
    expect(await page.locator('#penalty-announce').isVisible()).toBe(false);
    const ai2 = page
      .locator('.race-row')
      .filter({ has: page.locator('.race-row-name', { hasText: /^AI 2$/ }) });
    if ((await ai2.count()) > 0) {
      await expect(ai2.first().locator('.race-row-pen')).toHaveText('+5s');
    }
    expect(await blockingHits(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('AT9: warnings only toast Track limits; race control and the announcement stay hidden', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page);
    await raceStarted6s(page);
    await callForce(page, 2, 0);
    await page.waitForFunction(
      () => {
        const toasts = document.querySelector('#toasts');
        if (toasts === null) return false;
        const list = [...toasts.querySelectorAll('.toast')];
        return list.some((t) => {
          const cs = getComputedStyle(t);
          const r = t.getBoundingClientRect();
          return (
            (t.textContent ?? '').includes('Track limits') &&
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            r.width > 0 &&
            r.height > 0
          );
        });
      },
      undefined,
      { timeout: 1000 },
    );
    const trackToasts = page.locator('#toasts .toast', { hasText: 'Track limits' });
    expect(await trackToasts.count()).toBeGreaterThan(0);
    await expect(trackToasts.first()).toBeVisible();
    expect(await page.locator('#race-control').isVisible()).toBe(false);
    expect(await page.locator('#penalty-announce').isVisible()).toBe(false);
    expect(errors).toEqual([]);
  });
});
