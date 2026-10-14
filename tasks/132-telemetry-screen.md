# 132 — Telemetry screen (charts and delta)

Status: pending
Phase: 2
Depends on: 044, 095, 126, 130, 131
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

After driving laps, the pause menu and results offer "Telemetry": canvas charts of the last and best lap overlaid, a delta trace and a map with a cursor that follows the mouse.

## Context

Design: `docs/plans/game-features.md` section 132. Data and storage: `LapTelemetry`, `TelemetryRecorder`, `loadTelemetry`, `saveIfBest`, `deltaTrace` from `src/game/telemetry.ts` (131). Menu: `Menu.showPause(handlers)` in `src/ui/menu.ts` (044); results: `Results.show(rows, handlers)` in `src/ui/results.ts` (095). Canvas 2D only, no chart library, DOM without React. Conversion to km/h only in the UI. e2e: `tests/e2e/acceptance/132-telemetry-screen.spec.ts`.

## Files

- `src/ui/telemetryScreen.ts` — create
- `src/ui/menu.ts` — modify: pause panel gains a "Telemetry" action (optional handler `onTelemetry`)
- `src/ui/results.ts` — modify: "Telemetry" button (optional handler `onTelemetry`)
- `src/main.ts` — modify: create a `TelemetryRecorder` per session (player car; `start()` at each lap start, `record` each tick, `finishLap` at lap end → keep as last lap, `saveIfBest`), open/close the screen, `__SIMGAME__.injectTelemetry`

## Steps

```ts
import type { LapTelemetry } from '../game/telemetry';
export class TelemetryScreen {
  constructor(parent: HTMLElement);
  show(last: LapTelemetry | null, best: LapTelemetry | null, onClose: () => void): void;
  hide(): void;
  dispose(): void;
}
// window.__SIMGAME__.injectTelemetry(fixture: Omit<LapTelemetry, 'channels'> & { channels: Record<Channel, number[]> }): void  // sets last = best = fixture
```

1. Root `#telemetry` (`display: none` when hidden) with exactly 5 `<canvas>`: `#telemetry-speed`, `#telemetry-pedals` (throttle green, brake red), `#telemetry-gear`, `#telemetry-steer`, `#telemetry-delta` (`deltaTrace(last, best)`). X axis = distance 0..lap length. Last lap drawn solid, best lap dashed (different colours). Map = inline `<svg id="telemetry-map">` polyline from the `x`,`z` channels plus a cursor circle (not a canvas). A Close button calls `onClose`.
2. Mouse over any canvas at horizontal fraction f: sample index `round(f·(N−1))` of the last lap; `#telemetry-cursor` gets `data-distance` (metres = 2·index) and `data-speed` (km/h of that sample), visible text `<distance> m  <speed> km/h`; a vertical line is drawn on every chart and the map circle moves to that sample.
3. No lap available (`last` and `best` null) → show the text "No lap recorded" instead of charts. Only one lap available → both overlays use it; delta is a flat zero line.
4. `injectTelemetry` converts arrays to `Float32Array` and makes the "Telemetry" action open the screen with the fixture.

Conventions: charts autoscale to the data min/max (min == max → ±1); redraw only on show and cursor move; dispose removes DOM and listeners.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e after 1 lap (test hook `__SIMGAME__.injectTelemetry(fixture)`) | open Telemetry | `#telemetry` with 5 canvases; no console errors |
| AT2 | e2e mouse over the speed chart at x = 50 % | DOM | `#telemetry-cursor` shows distance ≈ 50 % of lap ± 2 % and the speed value of that sample |

## Acceptance criteria

- [ ] AT1–AT2 pass; existing menu and results e2e tests still pass.
- [ ] Opening Telemetry from the pause menu pauses nothing extra and closing returns to the pause menu.

## Verification

```
npm run typecheck
npm run lint
npx playwright test 132-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Comparing against other cars or ghosts, zoom/pan, exporting data.
- Changing `TelemetryRecorder` or the stored format (131).
