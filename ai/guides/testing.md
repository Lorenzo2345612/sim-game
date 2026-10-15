# Testing guide

- Unit runner: Vitest. Files `tests/unit/**/*.test.ts`.
- E2E: Playwright. Files `tests/e2e/**/*.spec.ts`. Only for flows that need a browser (scene load, input, HUD).
- Physics is tested without render: create the Rapier world, advance N fixed steps and check state (position, velocity, angle). Initialize Rapier with `await RAPIER.init()` in `beforeAll`.
- Compare floats with `toBeCloseTo(value, digits)`, never with `toBe`.
- No `setTimeout` or real time: the game loop accepts an explicit `dt`.
- Test track data: use small fixtures in `tests/fixtures/`, not the full tracks.
- One test = one behavior. Test name in English, describes the expected behavior.
- e2e runs on headless swiftshader, which renders lit geometry black (sky only): never assert screenshot pixels of the 3D world; assert state through `__SIMGAME__` hooks. Wait on `getSimTime()`, not wall time, for driving checks.
