import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type CreditEntry = { asset: string; author: string; license: string; url: string };

async function fetchCredits(page: Page): Promise<CreditEntry[]> {
  return page.evaluate(async () => {
    const res = await fetch('/credits.json');
    if (!res.ok) throw new Error(`credits.json HTTP ${res.status}`);
    return (await res.json()) as CreditEntry[];
  });
}

test.describe('074 credits screen', () => {
  test('AT3: menu → Credits shows every entry author and url; Esc closes the panel', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    const credits = await fetchCredits(page);
    expect(credits.length).toBeGreaterThanOrEqual(4);
    await page.click('#credits-btn');
    const panel = page.locator('#credits-panel');
    await expect(panel).toBeVisible();
    for (const entry of credits) {
      await expect(panel).toContainText(entry.author);
      await expect(panel).toContainText(entry.url);
    }
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
