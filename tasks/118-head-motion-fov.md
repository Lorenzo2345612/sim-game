# 118 — Cockpit head motion and FOV setting

Status: pending
Phase: 1
Depends on: 047, 115, 117
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The cockpit camera moves slightly with lateral and longitudinal acceleration and its FOV is configurable.

## Context

Design: `docs/plans/game-features.md` section 118. `src/render/cameraRig.ts` has `COCKPIT_FOV = 75` and cockpit mode; `src/core/settings.ts` stores `{preset}` under `SETTINGS_KEY` (other keys must be preserved when saving, see 117). G values come from the car state: finite-difference of velocity in the car frame, computed by the caller in `src/main.ts` (g = 9.81 m/s²). Head offsets are in car-frame metres (x right, z back).

## Files

- `src/render/headMotion.ts` — create (pure, no `three`).
- `src/core/settings.ts` — modify: `CockpitSettings` and `loadCockpitSettings`.
- `src/render/cameraRig.ts` — modify: `setHeadOffset(x: number, z: number): void` added to eye offset in cockpit mode; `setCockpitFov(fov: number): void` (applied when in cockpit mode).
- `src/main.ts` — modify: wire HeadMotion and settings.
- `tests/unit/acceptance/118-head-motion-fov.test.ts` — acceptance worker.

## Steps

```ts
export class HeadMotion { update(latG: number, longG: number, dt: number): { x: number; z: number } }
export interface CockpitSettings { cockpitFov: number; headMotion: boolean }
export function loadCockpitSettings(storage: KeyValueStorage): CockpitSettings;
```

1. Targets: x = clamp(-0.012·latG, -0.04, 0.04), z = clamp(0.012·longG, -0.04, 0.04) (latG + = acceleration to the right; longG + = accelerating). Output = exponential low-pass, τ = 0.15 s: `s += (target − s)·(1 − exp(−dt/τ))`. Starts at (0, 0). Returned object is a reused internal object.
2. Settings: `cockpitFov` clamped to [50, 100], default 75 when missing or not finite; `headMotion` default true when missing or not boolean. Reads the same `SETTINGS_KEY` JSON; corrupt JSON gives defaults.
3. When `headMotion` is false the rig is given offsets (0, 0).

Conventions: clamp not throw; `dt <= 0` returns current state unchanged; no rounding.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | constant latG 2, longG 0 | 2 s at 1/120 | x = −0.024 ± 1e-4, z = 0 ± 1e-9 |
| AT2 | latG 10 / longG −5 | 2 s | x = −0.04 ± 1e-4 / z = −0.04 ± 1e-4 (clamped) |
| AT3 | step latG 0 → 2 | after 0.15 s | x = −0.024·(1 − e⁻¹) ± 5e-4 |
| AT4 | settings without cockpitFov / with 120 | load | 75 / clamped 100 |

## Acceptance criteria

- [ ] AT1–AT4 pass.
- [ ] `grep -n "from 'three'" src/render/headMotion.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Settings UI controls, head look-at-apex, mirror (117), chase/T-cam changes.
