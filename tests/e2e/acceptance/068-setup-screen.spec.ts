import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type SetupRange = { min: number; max: number; step: number; default: number };
type CarSpecJson = {
  setup: Record<string, SetupRange>;
  presets: Record<string, Record<string, number>>;
};
type SliderState = { key: string; min: number; max: number; step: number; value: number };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function fetchSpec(page: Page): Promise<CarSpecJson> {
  return page.evaluate(async () => {
    const res = await fetch('/cars/f4.json');
    return (await res.json()) as CarSpecJson;
  });
}

async function openSetupPanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('#menu').getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.locator('#setup-panel')).toBeVisible();
}

async function sliderStates(page: Page): Promise<SliderState[]> {
  return page.locator('#setup-panel input[type="range"][data-setup]').evaluateAll((els) =>
    els.map((el) => {
      const input = el as HTMLInputElement;
      return {
        key: input.dataset.setup ?? '',
        min: Number(input.min),
        max: Number(input.max),
        step: Number(input.step),
        value: Number(input.value),
      };
    }),
  );
}

async function setSlider(page: Page, key: string, value: number): Promise<void> {
  await page
    .locator(`#setup-panel input[type="range"][data-setup="${key}"]`)
    .evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

test.describe('068 setup screen', () => {
  test('AT1: pause → Setup shows 8 sliders with the spec min/max/step and saved-or-default values', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const spec = await fetchSpec(page);
    await openSetupPanel(page);
    const sliders = await sliderStates(page);
    expect(sliders).toHaveLength(8);
    const byKey = new Map(sliders.map((s) => [s.key, s]));
    for (const [key, range] of Object.entries(spec.setup)) {
      const s = byKey.get(key);
      expect(s, `slider ${key} is missing`).toBeDefined();
      if (!s) continue;
      expect(s.min).toBeCloseTo(range.min, 6);
      expect(s.max).toBeCloseTo(range.max, 6);
      expect(s.step).toBeCloseTo(range.step, 6);
      expect(s.value).toBeCloseTo(range.default, 6);
    }
  });

  test('AT2: setting the rear wing to 7 and Apply keeps 7 after a page reload', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await openSetupPanel(page);
    await setSlider(page, 'rearWing', 7);
    await page.locator('#setup-panel').getByRole('button', { name: 'Apply', exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    await openSetupPanel(page);
    const value = Number(
      await page.locator('#setup-panel input[type="range"][data-setup="rearWing"]').inputValue(),
    );
    expect(value).toBeCloseTo(7, 6);
  });

  test('AT3: clicking Stable sets every slider to presets.stable', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const spec = await fetchSpec(page);
    await openSetupPanel(page);
    await page.locator('#setup-panel').getByRole('button', { name: 'Stable', exact: true }).click();
    const sliders = await sliderStates(page);
    const stable = spec.presets.stable;
    expect(sliders).toHaveLength(Object.keys(stable).length);
    const byKey = new Map(sliders.map((s) => [s.key, s]));
    for (const [key, value] of Object.entries(stable)) {
      const s = byKey.get(key);
      expect(s, `slider ${key} is missing`).toBeDefined();
      if (!s) continue;
      expect(s.value).toBeCloseTo(value, 6);
    }
  });

  test('AT4: Esc in the setup panel closes it, returns to the pause menu and logs no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await openSetupPanel(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#setup-panel')).toBeHidden();
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
