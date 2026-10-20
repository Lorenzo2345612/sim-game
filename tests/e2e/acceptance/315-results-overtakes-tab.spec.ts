import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const RACE_URL = '/?race=1&track=cleveland&ai=11&laps=3&seed=1';

type Debug315 = {
  startLights(): number;
  getSimTime(): number;
  finishRaceNow(): void;
};

async function loadRace(page: Page): Promise<void> {
  await page.goto(RACE_URL);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
    timeout: 90000,
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function race20sAfterGo(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window.__SIMGAME__ as unknown as Debug315).startLights() === 0 &&
      (window.__SIMGAME__?.getSimTime() ?? 0) >= 28,
    undefined,
    { timeout: 180000 },
  );
  await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug315).finishRaceNow());
  await expect(page.locator('#results')).toBeVisible();
}

function involves(line: string, name: string): boolean {
  const m = /· ([^·]+) passes ([^·]+) for P\d/.exec(line);
  return m !== null && (m[1] === name || m[2] === name);
}

test.describe('315 results overtakes tab', () => {
  test('AT2: results open on the classification tab without Passes/Lost and with 12 rows', async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors = watchErrors(page);
    await loadRace(page);
    await race20sAfterGo(page);
    await expect(page.locator('#results-tab-classification')).toHaveClass(/active/);
    const headers = await page.locator('#results .results-table th').allTextContents();
    expect(headers).not.toContain('Passes');
    expect(headers).not.toContain('Lost');
    await expect(page.locator('#results .results-table tbody tr')).toHaveCount(12);
    expect(errors).toEqual([]);
  });

  test('AT3: the overtakes tab shows its table, the legend and hides the classification', async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors = watchErrors(page);
    await loadRace(page);
    await race20sAfterGo(page);
    await page.locator('#results-tab-overtakes').click();
    const table = page.locator('#results-overtakes .results-overtakes-table');
    await expect(table).toBeVisible();
    const headers = await table.locator('th').allTextContents();
    expect(headers).toEqual(['P', 'Name', 'Clean', 'Contact', 'Rival slow/off', 'Lost']);
    await expect(table.locator('tbody tr')).toHaveCount(12);
    const legend = await page.locator('#results .results-legend').textContent();
    expect(legend).toContain('Clean: passed without contact');
    expect(legend).toContain('Contact: passed with contact');
    expect(legend).toContain(
      'Rival slow/off: passed a car that was stopped, off track or much slower',
    );
    await expect(page.locator('#results .results-table')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('AT4: at 1280×720 and 1366×768 the panel, Restart and Menu stay inside the viewport', async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors = watchErrors(page);
    await loadRace(page);
    await race20sAfterGo(page);
    await page.locator('#results-tab-overtakes').click();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      const inside = (box: { x: number; y: number; width: number; height: number }): boolean =>
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height;
      const panel = await page.locator('#results .results-panel').boundingBox();
      expect(panel).not.toBeNull();
      expect(inside(panel!)).toBe(true);
      for (const name of ['Restart', 'Menu'] as const) {
        const button = page.getByRole('button', { name, exact: true });
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(inside(box!)).toBe(true);
      }
      const overflow = await page.evaluate(
        () => (document.scrollingElement?.scrollHeight ?? 0) <= window.innerHeight,
      );
      expect(overflow).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('AT5: clicking the first overtakes row filters the recap to that car', async ({ page }) => {
    test.setTimeout(300000);
    const errors = watchErrors(page);
    await loadRace(page);
    await race20sAfterGo(page);
    await page.locator('#results-tab-overtakes').click();
    const firstRow = page.locator('#results-overtakes .results-overtakes-table tbody tr').first();
    const name = (await firstRow.locator('td').nth(1).textContent())?.trim() ?? '';
    expect(name).not.toBe('');
    const items = page.locator('#results .results-recap-item');
    const before = await items.allTextContents();
    await firstRow.click();
    const after = await items.allTextContents();
    expect(after).toEqual(before.filter((line) => involves(line, name)));
    expect(errors).toEqual([]);
  });
});
