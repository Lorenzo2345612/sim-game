import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

interface AudioStats {
  running: boolean;
  engine: 'worklet' | 'oscillator';
  firingHz: number;
}

interface Debug109 {
  audioStats(): AudioStats;
}

const CYLINDERS = (
  JSON.parse(readFileSync(join(process.cwd(), 'public', 'cars', 'f4.json'), 'utf8')) as {
    sound: { cylinders: number };
  }
).sound.cylinders;

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function startAudioAndThrottle(page: Page): Promise<void> {
  await page.mouse.click(640, 360);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowUp');
}

test.describe('109 engine worklet', () => {
  test('AT1: after click and 2 s throttle audioStats is running worklet with firingHz = rpm*cylinders/120 ± 1', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await startAudioAndThrottle(page);
    await page.waitForFunction(
      () => (window.__SIMGAME__ as unknown as Debug109).audioStats().engine === 'worklet',
      undefined,
      { timeout: 15000 },
    );
    const { stats, rpm } = await page.evaluate(() => {
      const g = window.__SIMGAME__!;
      return {
        stats: (g as unknown as Debug109).audioStats(),
        rpm: g.telemetry().rpm,
      };
    });
    expect(stats.running).toBe(true);
    expect(stats.engine).toBe('worklet');
    expect(Math.abs(stats.firingHz - (rpm * CYLINDERS) / 120)).toBeLessThanOrEqual(1);
  });

  test('AT3: the whole run completes without console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await startAudioAndThrottle(page);
    expect(errors).toEqual([]);
  });
});
