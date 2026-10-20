import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function showMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu .menu-panel')).toBeVisible();
}

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

type Box = { x: number; y: number; width: number; height: number };

async function hudBoxes(page: Page): Promise<{ label: string; box: Box }[]> {
  return page.evaluate(() => {
    const out: { label: string; box: Box }[] = [];
    const selectors = ['.hud-panel', '.hud2-panel', '.tyres', 'canvas:not(#game)'];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        out.push({ label: sel, box: { x: r.left, y: r.top, width: r.width, height: r.height } });
      }
    }
    return out;
  });
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

test.describe('207 ui polish', () => {
  test('AT1: theme tokens are defined on :root', async ({ page }) => {
    test.setTimeout(120000);
    await showMenu(page);
    const values = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const names = [
        '--ui-bg',
        '--ui-panel',
        '--ui-border',
        '--ui-text',
        '--ui-text-dim',
        '--ui-accent',
        '--ui-good',
        '--ui-warn',
        '--ui-bad',
        '--ui-radius',
      ];
      return names.map((n) => ({ name: n, value: cs.getPropertyValue(n).trim() }));
    });
    for (const v of values) expect(v.value, v.name).not.toBe('');
  });

  test('AT2: #menu background luminance is at most 0.08', async ({ page }) => {
    test.setTimeout(120000);
    await showMenu(page);
    const lum = await page.evaluate(() => {
      const menu = document.getElementById('menu');
      if (!menu) throw new Error('#menu missing');
      const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(getComputedStyle(menu).backgroundColor);
      if (!m) throw new Error('unparsable background');
      const lin = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3]));
    });
    expect(lum).toBeLessThanOrEqual(0.08);
  });

  test('AT3: no wide menu element has a background lighter than HSL 0.35', async ({ page }) => {
    test.setTimeout(120000);
    await showMenu(page);
    await expect(page.locator('button.track-card[data-track]').first()).toBeVisible();
    const offenders = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('#menu, #menu *'))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 200 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(cs.backgroundColor);
        if (!m) continue;
        const alpha = m[4] === undefined ? 1 : Number(m[4]);
        if (alpha === 0) continue;
        const max = Math.max(Number(m[1]), Number(m[2]), Number(m[3])) / 255;
        const min = Math.min(Number(m[1]), Number(m[2]), Number(m[3])) / 255;
        const lightness = (max + min) / 2;
        if (lightness > 0.35) bad.push(`${el.tagName.toLowerCase()}.${el.className} ${cs.backgroundColor}`);
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });

  test('AT4: menu text has contrast >= 4.5 and no channel above 0xe8', async ({ page }) => {
    test.setTimeout(120000);
    await showMenu(page);
    await expect(page.locator('button.track-card[data-track]').first()).toBeVisible();
    const result = await page.evaluate(() => {
      type Rgba = [number, number, number, number];
      const parse = (s: string): Rgba => {
        const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(s);
        if (!m) return [0, 0, 0, 0];
        return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      };
      const lin = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const lum = (c: Rgba): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const menu = document.getElementById('menu');
      if (!menu) throw new Error('#menu missing');
      const failures: string[] = [];
      let checked = 0;
      const els = Array.from(menu.querySelectorAll<HTMLElement>('button, .menu-title, .track-name'));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (!(el.textContent ?? '').trim()) continue;
        checked++;
        const layers: Rgba[] = [];
        for (let cur: HTMLElement | null = el; cur; cur = cur.parentElement) {
          layers.push(parse(getComputedStyle(cur).backgroundColor));
          if (cur === menu) break;
        }
        let bg: [number, number, number] = [0, 0, 0];
        for (let i = layers.length - 1; i >= 0; i--) {
          const [r2, g2, b2, a] = layers[i];
          bg = [r2 * a + bg[0] * (1 - a), g2 * a + bg[1] * (1 - a), b2 * a + bg[2] * (1 - a)];
        }
        const fg = parse(cs.color);
        const l1 = lum([fg[0], fg[1], fg[2], 1]);
        const l2 = lum([bg[0], bg[1], bg[2], 1]);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const label = `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}"`;
        if (ratio < 4.5) failures.push(`${label} contrast ${ratio.toFixed(2)}`);
        if (Math.max(fg[0], fg[1], fg[2]) > 0xe8) failures.push(`${label} channel ${cs.color}`);
      }
      return { failures, checked };
    });
    expect(result.checked).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });

  test('AT5: a keyboard-focused track card shows an outline >= 2 px or a box-shadow', async ({ page }) => {
    test.setTimeout(120000);
    await showMenu(page);
    await expect(page.locator('button.track-card[data-track]').first()).toBeVisible();
    let style: { outlineStyle: string; outlineWidth: string; boxShadow: string } | null = null;
    for (let i = 0; i < 40 && !style; i++) {
      await page.keyboard.press('Tab');
      style = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.matches('button.track-card')) return null;
        const cs = getComputedStyle(el);
        return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
      });
    }
    expect(style).not.toBeNull();
    const hasOutline = style!.outlineStyle !== 'none' && parseFloat(style!.outlineWidth) >= 2;
    const hasShadow = style!.boxShadow !== 'none';
    expect(hasOutline || hasShadow).toBe(true);
  });

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    test(`AT6: HUD boxes are inside the viewport and do not intersect at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.setViewportSize(size);
      await loadGame(page);
      const boxes = await hudBoxes(page);
      expect(boxes.some((b) => b.label === '.hud-panel')).toBe(true);
      expect(boxes.some((b) => b.label === '.hud2-panel')).toBe(true);
      expect(boxes.some((b) => b.label === '.tyres')).toBe(true);
      expect(boxes.some((b) => b.label === 'canvas:not(#game)')).toBe(true);
      for (const { label, box } of boxes) {
        expect(box.x, label).toBeGreaterThanOrEqual(0);
        expect(box.y, label).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, label).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height, label).toBeLessThanOrEqual(size.height);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlapArea(boxes[i].box, boxes[j].box), `${boxes[i].label} vs ${boxes[j].label}`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  test('AT7: HUD panels are glass: alpha 0.35-0.85, radius 6-12 px, tabular numbers', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const styles = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) throw new Error(`missing ${sel}`);
        const cs = getComputedStyle(el);
        const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(cs.backgroundColor);
        const alpha = m ? (m[4] === undefined ? 1 : Number(m[4])) : 0;
        return { alpha, radius: parseFloat(cs.borderTopLeftRadius) };
      };
      const speed = document.querySelector<HTMLElement>('.hud-speed');
      if (!speed) throw new Error('missing .hud-speed');
      return {
        hud: read('.hud-panel'),
        hud2: read('.hud2-panel'),
        numeric: getComputedStyle(speed).fontVariantNumeric,
      };
    });
    for (const s of [styles.hud, styles.hud2]) {
      expect(s.alpha).toBeGreaterThanOrEqual(0.35);
      expect(s.alpha).toBeLessThanOrEqual(0.85);
      expect(s.radius).toBeGreaterThanOrEqual(6);
      expect(s.radius).toBeLessThanOrEqual(12);
    }
    expect(styles.numeric).toContain('tabular-nums');
  });

  test('AT8: minimap stays 160 px square in the top-right corner', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const rects = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas:not(#game):not(#mirror)')).map((c) => {
        const r = c.getBoundingClientRect();
        return { width: r.width, height: r.height, top: r.top, right: r.right };
      }),
    );
    expect(rects.length).toBe(1);
    expect(Math.abs(rects[0].width - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(rects[0].height - 160)).toBeLessThanOrEqual(1);
    expect(rects[0].right).toBeGreaterThanOrEqual(1280 - 24);
    expect(rects[0].top).toBeLessThanOrEqual(24);
  });

  test('AT9: no console errors on menu and game while pressing Escape twice', async ({ page }) => {
    test.setTimeout(180000);
    const errors = captureErrors(page);
    await showMenu(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await loadGame(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('AT10: full-page screenshots of menu and HUD are saved', async ({ page }) => {
    test.setTimeout(180000);
    await showMenu(page);
    await page.screenshot({ path: 'test-results/207/menu.png', fullPage: true });
    await loadGame(page);
    await page.screenshot({ path: 'test-results/207/hud.png', fullPage: true });
  });
});
