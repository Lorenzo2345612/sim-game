# 019 — Add the Playwright e2e test

Status: pending
Phase: 0
Depends on: 018
Roles: coder, tester, reviewer

## Goal

`npm run test:e2e` opens the game in Chromium, drives for 3 s and checks that the car accelerates with no console errors.

## Context

`tests/e2e` is picked up only by Playwright (vitest has `include: ['tests/unit/**/*.test.ts']`; do not touch it). Test hook: `window.__SIMGAME__` from task 018. WebGL runs in software (SwiftShader).

## Files

- `package.json` — modify: devDependency `@playwright/test` `1.64.0` (exact) and script `"test:e2e": "playwright test"`
- `playwright.config.ts` — create
- `tests/e2e/phase0.spec.ts` — create
- `.gitignore` — modify: add `test-results/` and `playwright-report/`

## Steps

1. `npm install -D @playwright/test@1.64.0 --save-exact`, then `npx playwright install chromium`. If it fails on system dependencies, try `npx playwright install-deps chromium`. If that needs sudo and fails: set Status to `blocked` in this spec, explain the command the user must run (`sudo npx playwright install-deps chromium`), and stop.
2. `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: { baseURL: 'http://localhost:4173', headless: true },
  projects: [{
    name: 'chromium',
    use: { browserName: 'chromium', launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] } },
  }],
});
```
3. `tests/e2e/phase0.spec.ts`: one test `car accelerates in Monza without console errors`, `test.setTimeout(120000)`:
   - `errors: string[]`; `page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); })`; `page.on('pageerror', e => errors.push(e.message))`.
   - `await page.goto('/')`; `await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 })`. No `any`: if the global type is not visible to the spec, add a minimal `declare global { interface Window { __SIMGAME__?: { ready: boolean; getSpeedKmh(): number; getLap(): number; getSimTime(): number } } }` in the spec.
   - `await page.screenshot({ path: 'test-results/phase0-start.png' })`.
   - `await page.keyboard.down('ArrowUp')`; `await page.waitForTimeout(3000)` (real time is allowed in e2e); `await page.keyboard.up('ArrowUp')`.
   - `speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh())` → `expect(speed).toBeGreaterThan(50)`; sim time via `getSimTime()` → `toBeGreaterThan(2)`.
   - `await page.screenshot({ path: 'test-results/phase0-accelerating.png' })`.
   - `expect(errors).toEqual([])`.

## Acceptance criteria

- [ ] `npm run test:e2e` passes (1 test) and writes both screenshots to `test-results/`.
- [ ] `npm test` (vitest) still passes and does not run the e2e spec.
- [ ] `npm run typecheck` and `npm run lint` clean (if lint fails on `playwright.config.ts` or the spec, do not edit eslint config: report it).

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Other browsers, CI, screenshot comparison, more e2e tests, changes in `src/`.
- Code comments only where logic is non-obvious.
