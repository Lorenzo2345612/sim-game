# 148 — Damage HUD, setting, pit repair time, AI reaction

Status: pending
Phase: 2
Depends on: 094, 145, 146
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The player sees damage on a HUD widget, can turn damage off or visual-only, repair time is computable for the pit service, and AI cars slow down when damaged.

## Context

M2.4, design `docs/plans/late-features.md` ("148"). Read the current code first: this task runs after 145 (`DamageMode`, `Vehicle.damageMode`, `?damage=`), 146 (`Vehicle.getDownforce`, effects only in `'full'`) and 094 (race HUD, `src/ui/hudV2.ts`); adapt file names to what exists, keep the public contract. The M2.2 pit service may not exist: wire `repairTime` / AI pit only if it does; otherwise only export the pure function. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e in `tests/e2e/acceptance/148-damage-hud.spec.ts`.

## Files

- `src/physics/damage.ts` — modify: add `repairTime`, `widgetColour`, `damageSpeedScale`, `loadDamageMode`.
- `src/ui/damageHud.ts` — create: DOM widget.
- `src/main.ts` — modify: mount widget in race mode, damage mode from storage/query, `__SIMGAME__.debugDamage(patch: Partial<DamageState>): void` (merges into the player's `damage`).
- `src/game/raceGame.ts` — modify: AI speed scale × `damageSpeedScale(car.damage)`.
- `tests/unit/acceptance/148-damage-hud.test.ts`, `tests/e2e/acceptance/148-damage-hud.spec.ts` — create (acceptance worker).

## Steps

```ts
export function repairTime(state: DamageState): number;           // seconds
export type WidgetColour = 'green' | 'yellow' | 'red' | 'black';
export function widgetColour(value: number, detached: boolean): WidgetColour;
export function damageSpeedScale(state: DamageState): number;     // 1 − 0.2·max part value
export function loadDamageMode(storage: KeyValueStorage): DamageMode; // key 'damage' inside SETTINGS_KEY JSON; default 'full'
```

1. `repairTime` = 3 s per wing with value > 0 + 8 s per corner with suspension > 0 + 4 s per wheel punctured or detached.
2. `widgetColour`: detached → black; value < 0.2 green; < 0.6 yellow; else red.
3. Widget: six elements `#damage-fw`, `#damage-rw`, `#damage-fl`, `#damage-fr`, `#damage-rl`, `#damage-rr`, each with class equal to its `WidgetColour`; updated each frame only when the colour changes; hidden when mode is `'off'`. Corner value = suspension (black if detached).
4. `damageSpeedScale`: max over frontWing, rearWing, suspension[i]; detached counts 1. Applied to the AI `speedScale`.
5. If the pit service exists: AI pits on the next lap when any part ≥ 0.6, and the stop duration includes `repairTime`.
6. `damage: 'visual'` = debris and widget but no performance effects (already in 146).

Conventions: `value` clamped to [0, 1] first; invalid stored mode → `'full'`; thresholds as written (`< 0.2`, `< 0.6`).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | frontWing 0.3, suspension [0, 0.5, 0, 0], puncture[1] | repairTime | 3 + 8 + 4 = 15 |
| AT2 | part values 0.1 / 0.4 / 0.7 / detached | widgetColour | green / yellow / red / black |
| AT3 | setting visual, frontWing 1 | front downforce | unchanged (undamaged) |
| AT4 | e2e race with `__SIMGAME__.debugDamage({frontWing: 1})` | DOM | `#damage-fw` has class red; no console errors |

## Acceptance criteria

- [ ] AT1–AT4 pass (AT4 in `tests/e2e/acceptance`).
- [ ] With `?damage=off` the widget is not in the DOM or is hidden.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e -- 148
```

## Out of scope

- Building the pit service; damage model/effects/debris changes; a settings menu screen (query + storage only).
- README, tasks.json, milestones.json.
