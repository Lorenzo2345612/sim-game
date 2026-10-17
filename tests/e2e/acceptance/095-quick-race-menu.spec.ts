import { expect, test, type Page } from '@playwright/test';
import type { Standing } from '../../../src/race/classification';

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

type Debug095 = {
  raceStandings(): readonly Standing[];
  trackId(): string;
  finishRaceNow(): void;
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function positionsOf(rows: string[]): number[] {
  return rows.map((cell) => Number(cell.trim())).filter((n) => Number.isFinite(n));
}

test.describe('095 quick race menu and results', () => {
  test('AT1: menu Quick race, Spa, 1 lap, 3 opponents starts a race with 3 AI and 4 standings entries', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.goto('/');
    await expect(page.locator('#menu .menu-panel')).toBeVisible();
    await page.locator('#quick-race').click();
    await expect(page.locator('#qr-panel')).toBeVisible();
    await page.selectOption('#qr-track', 'spa');
    await page.fill('#qr-laps', '1');
    await page.fill('#qr-ai', '3');
    await page.locator('#qr-start').click();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    const state = await page.evaluate(() => ({
      trackId: (window.__SIMGAME__ as unknown as Debug095).trackId(),
      standings: (window.__SIMGAME__ as unknown as Debug095).raceStandings(),
    }));
    expect(state.trackId).toBe('spa');
    expect(state.standings).toHaveLength(4);
  });

  test('AT2: finishRaceNow shows #results with 2 rows sorted by position; Restart restarts with the same config', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?race=1&laps=1&ai=1');
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug095).finishRaceNow());
    const results = page.locator('#results');
    await expect(results).toBeVisible();
    const rows = results.locator('tr');
    await expect(rows).toHaveCount(2);
    const firstCells = await results.locator('tr td:first-child, tr th:first-child').allInnerTexts();
    const positions = positionsOf(firstCells);
    expect(positions).toEqual([1, 2]);
    await results.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.waitForFunction(
      () => {
        const el = document.getElementById('results');
        if (!el || getComputedStyle(el).display !== 'none') return false;
        const standings = (window.__SIMGAME__ as unknown as Debug095).raceStandings();
        return standings.length === 2 && standings.every((s) => !s.finished);
      },
      undefined,
      { timeout: 90000 },
    );
    const url = new URL(page.url());
    expect(url.searchParams.get('race')).toBe('1');
    expect(url.searchParams.get('laps')).toBe('1');
    expect(url.searchParams.get('ai')).toBe('1');
    const standings = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug095).raceStandings(),
    );
    expect(standings).toHaveLength(2);
  });
});
