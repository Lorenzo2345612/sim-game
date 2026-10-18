import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function openQuickRace(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#menu .menu-panel')).toBeVisible({ timeout: 60000 });
  await page.locator('#quick-race').click();
  await expect(page.locator('#qr-panel')).toBeVisible();
}

function neuralToggle(page: Page) {
  return page.locator('#qr-panel').getByText(/neural/i).first();
}

test.describe('269 evolved neural driver e2e', () => {
  test('AT10: neural AI toggle is visible for monza+f4 and hidden for silverstone+f4', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await openQuickRace(page);
    await page.selectOption('#qr-track', 'monza');
    await page.selectOption('#car-picker', 'f4');
    await expect(neuralToggle(page)).toBeVisible();
    await page.selectOption('#qr-track', 'silverstone');
    await page.selectOption('#car-picker', 'f4');
    await expect(neuralToggle(page)).toBeHidden();
  });
});
