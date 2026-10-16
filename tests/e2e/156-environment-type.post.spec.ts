import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Stats156 = { environmentType: string; treeSpecies: string[] };

async function loadStats(page: Page, track: string, errors: string[]): Promise<Stats156> {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?track=${track}`);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  return page.evaluate(() => {
    const stats = window.__SIMGAME__!.sceneStats();
    return { environmentType: stats.environmentType, treeSpecies: stats.treeSpecies };
  });
}

test.describe('156 environment post gaps', () => {
  test('sepang loads the tropical environment with palm-coconut instances and no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    const stats = await loadStats(page, 'sepang', errors);
    expect(stats.environmentType).toBe('tropical');
    expect(stats.treeSpecies).toContain('palm-coconut');
    expect(errors).toEqual([]);
  });

  test('baku loads the city environment with palm-date and oak instances and no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    const stats = await loadStats(page, 'baku', errors);
    expect(stats.environmentType).toBe('city');
    expect(stats.treeSpecies).toEqual(expect.arrayContaining(['palm-date', 'oak']));
    expect(errors).toEqual([]);
  });
});
