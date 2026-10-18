import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

type PenaltyEntry = {
  car: number;
  kind: 'warning' | 'penalty';
  seconds: number;
  reason: string;
  time: number;
};

type Debug130 = {
  forceTrackLimits(count: number): void;
  raceEvents(): readonly PenaltyEntry[];
  finishRaceNow(): void;
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('130 penalty book, HUD messages and rules wiring', () => {
  test('AT3: forceTrackLimits(4) toasts warnings 1/3, 2/3, 3/3 then +5 s; raceEvents has 4 entries', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors = watchErrors(page);
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug130).forceTrackLimits(4));
    await page.waitForFunction(
      () => document.querySelectorAll('#toasts .toast').length >= 4,
      undefined,
      { timeout: 15000 },
    );
    const texts = await page.locator('#toasts .toast').allTextContents();
    expect(texts).toEqual(['Track limits 1/3', 'Track limits 2/3', 'Track limits 3/3', '+5 s']);
    const events = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug130).raceEvents());
    expect(events).toHaveLength(4);
    expect(errors).toEqual([]);
  });

  test('AT4: results after finishRaceNow show the penalty cell as 5 s (track limits) for the player', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors = watchErrors(page);
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug130).forceTrackLimits(4));
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug130).finishRaceNow());
    const results = page.locator('#results');
    await expect(results).toBeVisible();
    const playerRow = results.locator('tr', { hasText: 'You' });
    await expect(playerRow).toHaveCount(1);
    await expect(playerRow.locator('td').nth(4)).toHaveText('5 s (track limits)');
    expect(errors).toEqual([]);
  });
});
