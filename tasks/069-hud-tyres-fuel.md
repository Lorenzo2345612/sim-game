# 069 — HUD tyres and fuel widget

Status: pending
Phase: 1
Depends on: 048, 065
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

HUD widget with four tyre boxes (temperature colour, wear %) and fuel litres with estimated remaining laps.

## Context

Separate class like `HudV2` (`src/ui/hudV2.ts`, task 048): DOM injected via `container`, skip DOM writes when text/class did not change. Telemetry shape comes from `Vehicle.getTelemetry` (task 065): per-wheel `tempC`, `wear` (0..1), `fuelKg`.

## Files

- `src/ui/hudTyres.ts` — create
- `src/ui/hudTyres.css` — create
- `tests/unit/ui/hudTyres.test.ts` — create — extra edge tests

## Steps

```ts
export type TyreColour = 'blue' | 'green' | 'red';
export function tyreColour(tempC: number, optTempC: number, windowC: number): TyreColour;
export function fuelText(fuelL: number, meanLapL: number | null): string;
export interface HudTyresData {
  tempC: number[]; wear: number[];      // length 4: FL FR RL RR
  optTempC: number; tempWindowC: number;
  fuelL: number; meanLapL: number | null;
}
export class HudTyres { constructor(container: HTMLElement); update(d: HudTyresData): void; dispose(): void }
```

- DOM: element `.tyres` with four `.tyre` boxes (class `tyre-blue|tyre-green|tyre-red`, text = wear as integer %) and element `.fuel` (text = `fuelText`). Anchored bottom-left, fully inside the viewport.
- `tyreColour`: blue when `t < opt − window/2`, red when `t > opt + window/2`, else green (bounds are green).
- `fuelText`: `"<fuel 1 decimal> L · <fuel/meanLap 1 decimal> laps"`; `meanLapL` null or ≤ 0 → `"<fuel> L · —"`. Fuel < 0 shown as 0.0.

Conventions: wear % rounded half-up to integer, clamped 0..100; one decimal via `toFixed(1)`; non-finite input shown as `—`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: temps [60, 90, 120, 90], opt 90, window 40 | colour | blue, green, red, green |
| AT2 | unit: fuel 10 L, mean lap 2.5 L | text | "10.0 L · 4.0 laps"; no laps completed → "10.0 L · —" |

## Acceptance criteria

- [ ] AT1–AT2 pass (unit with the fake-element approach of task 048).
- [ ] Typecheck and lint clean.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Mounting in `main.ts` (task 070), mean-lap fuel bookkeeping, compound icons, pit logic.
