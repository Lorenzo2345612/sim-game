# 068 — Setup screen

Status: pending
Phase: 1
Depends on: 058, 067, 044, 054
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

A DOM setup panel, opened from the pause menu, to edit the eight setup values with sliders, apply presets and restart the session with the setup.

## Context

Pause menu: `src/ui/menu.ts` (task 044, class `Menu`). `Setup`, `PresetName`, `SetupStorage`, `clampSetup`, `presetSetup`, `loadSetup`, `saveSetup` from `src/physics/setup.ts` (task 067); `CarSpec`, `parseCarSpec` from `src/physics/carSpec.ts` (058). `main.ts` is also modified by 044 and 054, hence the dependencies. UI is plain DOM/CSS, no React. Wiring into the real game session is task 070; here `main.ts` fetches `/cars/f4.json` itself (`parseCarSpec`) only to build the panel, and Apply restarts the session; task 070 replaces that fetch with its car loader. Tests are Playwright in `tests/e2e/acceptance/068-setup-screen.spec.ts`.

## Files

- `src/ui/setupPanel.ts` — create
- `src/ui/menu.ts` — modify — add a "Setup" button to the pause menu (optional handler `onSetup` in `showPause`)
- `src/main.ts` — modify — create the panel with the loaded `CarSpec`, open it from pause, Apply saves and restarts

## Steps

```ts
import type { CarSpec } from '../physics/carSpec';
import type { Setup, SetupStorage } from '../physics/setup';
// menu.ts: showPause handlers gain optional onSetup?(): void (Setup button rendered only when given)
export interface SetupPanelOptions {
  spec: CarSpec; carId: string; trackId: string;
  storage: SetupStorage;
  onApply(s: Setup): void;   // called after saving
  onClose(): void;
}
export class SetupPanel {
  constructor(parent: HTMLElement, opts: SetupPanelOptions);
  open(): void; close(): void; readonly visible: boolean;
  getValues(): Setup; dispose(): void;
}
```

- Root id `setup-panel`, `display: none` when closed. Six groups with headings: Wings (front + rear), Brake bias, Final drive, Anti-roll (front + rear), Ride height, Tyre pressure: 8 `<input type="range" data-setup="<Setup key>">` with `min/max/step` from `spec.setup`, a live value label, initial values from `loadSetup`.
- Buttons: "Stable", "Balanced", "Aggressive" (set sliders to `presetSetup`), "Apply" (clamp, `saveSetup`, `onApply`, close), "Back" (close without saving).
- Esc while open closes the panel and returns to the pause menu (no game resume); no console errors.

Conventions: slider values pass through `clampSetup` on Apply; closing without Apply discards edits.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: pause → Setup | open | 8 sliders with the spec's min/max/step; values = saved or default |
| AT2 | e2e: set rear wing 7, Apply | reload page | rear wing slider shows 7 (persisted per car+track) |
| AT3 | e2e: preset Stable | click | sliders equal `presets.stable` |
| AT4 | e2e: Esc | in panel | closes panel, back to pause menu, no console errors |

## Acceptance criteria

- [ ] AT1–AT4 pass with `npm run test:e2e`; `npm test` still passes.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

Applying the setup to the physics (task 070), tyre compound picker, per-axle graphs, gamepad navigation, pause-menu redesign.
