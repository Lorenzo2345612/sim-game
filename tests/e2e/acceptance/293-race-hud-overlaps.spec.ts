import { expect, test, type Page } from '@playwright/test';

const RACE = '/?race=1&track=cleveland&ai=11&laps=3';
const HUD_SELECTOR =
  '#hud, .damage-hud, .minimap, #flags, #toasts, .hud2-panel, .tyres, .race-hud-top, #race-tower, #vsc-banner, #blue-banner';

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

async function waitSim(page: Page, t: number): Promise<void> {
  await page.waitForFunction((target) => (window.__SIMGAME__?.getSimTime() ?? 0) >= target, t, {
    timeout: 60000,
  });
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

test.describe('293 race HUD overlaps', () => {
  test('AT1: no visible HUD elements overlap at 1920x1080 at the lights and ~9 s in', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loadGame(page, RACE);
    await waitSim(page, 1.5);
    expect(await hudOverlaps(page)).toEqual([]);
    await waitSim(page, 9);
    expect(await hudOverlaps(page)).toEqual([]);
  });

  test('AT2: no visible HUD elements overlap at 1366x768 at the lights and ~9 s in', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await loadGame(page, RACE);
    await waitSim(page, 1.5);
    expect(await hudOverlaps(page)).toEqual([]);
    await waitSim(page, 9);
    expect(await hudOverlaps(page)).toEqual([]);
  });

  test('AT3: no visible HUD elements overlap at 1280x720 at the lights and ~9 s in', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadGame(page, RACE);
    await waitSim(page, 1.5);
    expect(await hudOverlaps(page)).toEqual([]);
    await waitSim(page, 9);
    expect(await hudOverlaps(page)).toEqual([]);
  });

  test('AT4: a toast sits >= 8 px above .hud2-panel with no overlaps at 9 s, all viewports', async ({ page }) => {
    test.setTimeout(360000);
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await loadGame(page, RACE);
      await waitSim(page, 9);
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.textContent = 'Track limits 1/3';
        document.querySelector('#toasts')!.appendChild(div);
      });
      const gap = await page.evaluate(() => {
        const toasts = document.querySelector('#toasts')!.getBoundingClientRect();
        const panel = document.querySelector('.hud2-panel')!.getBoundingClientRect();
        return { toastsBottom: toasts.bottom, panelTop: panel.top };
      });
      expect(gap.toastsBottom).toBeLessThanOrEqual(gap.panelTop - 8);
      expect(await hudOverlaps(page)).toEqual([]);
    }
  });

  test('AT5: no visible HUD elements overlap in practice at 1280x720 ~5 s after load', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadGame(page, '/?track=cleveland');
    await waitSim(page, 5);
    expect(await hudOverlaps(page)).toEqual([]);
  });
});
