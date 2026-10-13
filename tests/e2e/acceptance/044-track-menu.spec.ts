import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('044 track selection and pause menu', () => {
  test('AT1: / without query shows the track menu and no game is running', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#menu button[data-track="monza"]')).toHaveText('Monza');
    await expect(page.locator('#menu button[data-track="spa"]')).toHaveText('Spa');
    await expect(page.locator('#menu button[data-track="silverstone"]')).toHaveText('Silverstone');
    expect(await page.evaluate(() => window.__SIMGAME__?.ready === true)).toBe(false);
  });

  test('AT2: clicking Spa starts the game with trackId spa and hides the menu', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu button[data-track="spa"]')).toBeVisible();
    await page.locator('#menu button[data-track="spa"]').click();
    await waitForGame(page);
    expect(await page.evaluate(() => window.__SIMGAME__?.trackId())).toBe('spa');
    await expect(page.locator('#menu')).toBeHidden();
  });

  test('AT3: Escape in game opens the pause menu with Resume, Restart and Change track', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/?track=monza');
    await waitForGame(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change track', exact: true })).toBeVisible();
  });

  test('AT4: after a reload the menu preselects the last chosen track', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu button[data-track="silverstone"]')).toBeVisible();
    await page.locator('#menu button[data-track="silverstone"]').click();
    await page.reload();
    await expect(page.locator('#menu button[data-track="silverstone"]')).toHaveClass(/selected/);
  });
});
