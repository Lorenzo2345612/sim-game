import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const FIRST_LED_RPM = 14200 * 0.8;

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('222 hud rpm range', () => {
  test('AT4: ow26 first LED lights only at 11360 rpm and above, without console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&car=ow26');
    await page.keyboard.down('ArrowUp');
    const samples = await page.evaluate(async () => {
      const out: { rpm: number; ledOn: number; barShift: boolean }[] = [];
      const t0 = window.__SIMGAME__!.getSimTime();
      while (window.__SIMGAME__!.getSimTime() - t0 < 1.5) {
        await new Promise((r) => requestAnimationFrame(r));
        const rpm = window.__SIMGAME__!.telemetry().rpm;
        const leds = [...document.querySelectorAll('.hud2-led')];
        out.push({
          rpm,
          ledOn: leds.filter((e) => e.classList.contains('on')).length,
          barShift: document.querySelector('.hud2-rpm-bar')?.classList.contains('shift') ?? false,
        });
      }
      return out;
    });
    await page.keyboard.up('ArrowUp');
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((s) => s.rpm > 0)).toBe(true);
    for (const s of samples) {
      if (s.rpm < FIRST_LED_RPM) {
        expect(s.ledOn).toBe(0);
        expect(s.barShift).toBe(false);
      }
    }
    expect(errors).toEqual([]);
  });
});
