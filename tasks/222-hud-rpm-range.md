# 222 — Per-car RPM range in the HUD

Status: pending
Phase: 3
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The shift LEDs and rpm bar of `HudV2` scale to the loaded car's rpm range instead of the fixed 8200/9000.

## Context

`src/ui/hudV2.ts` exports `SHIFT_LIGHT_RPM = 8200`, `HUD_MAX_RPM = 9000`, private `LED_COUNT = 15`; thresholds are built in the constructor (`ledThresholds`) and used in `update`. Those exports must stay (tests assert them). Car spec fields: `spec.gearbox.upRpm`, `spec.engine.limiterRpm`. e2e rpm hook: `window.__SIMGAME__.telemetry().rpm`.

## Files

- `src/ui/hudV2.ts` — modify.
- `src/main.ts` — modify: call `hud.setRpmRange(baseSpec.gearbox.upRpm, baseSpec.engine.limiterRpm)` right after the `HudV2` is created (the HUD is rebuilt per car load).
- `tests/unit/acceptance/222-hud-rpm-range.test.ts`, `tests/e2e/acceptance/222-hud-rpm-range.spec.ts` — create (from the table).

## Steps

```ts
class HudV2 { setRpmRange(shiftRpm: number, maxRpm: number): void }
```

- LED thresholds = `shiftRpm · (0.8 + 0.2·i/(LED_COUNT−1))`; bar percentage = `rpm/maxRpm` (clamped 0–100); `shift` class when `rpm ≥ shiftRpm`; limiter flash when `rpm ≥ maxRpm − 200·maxRpm/9000`.
- Defaults (no call) behave exactly as today (8200 / 9000, limiter at 8800).

Conventions: non-finite input or `shiftRpm ≥ maxRpm` (or ≤ 0) → call ignored, previous range kept; boundaries inclusive (`>=`).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | HudV2 fake DOM, no call | rpm 8200 | shift class on; LED thresholds as today |
| AT2 | `setRpmRange(14200, 15000)` | rpm 8200 / 14200 / 7500 | shift off / on / bar width 50 % |
| AT3 | `setRpmRange(9000, 8000)` and `(NaN, 15000)` | rpm 8200 | behaviour as defaults |
| AT4 | e2e `/?track=monza&car=ow26` | ready, full throttle in 1st gear 1.5 s (keyboard) | no LED shift state below 11360 rpm (`window.__SIMGAME__` rpm hook) and no console errors |

## Acceptance criteria

- [ ] AT1–AT4 pass; `tests/unit/ui/hudV2.test.ts` and `048-hud-v2` tests still pass unchanged.
- [ ] AT4 needs the `ow26` car (task 221) to exist; run it after 221 is done.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 222-
```

## Out of scope

New HUD elements, ERS widget (223), changing the exported defaults, LED colours/layout, audio rpm.
