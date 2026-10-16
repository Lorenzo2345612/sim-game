# 223 — ERS and active-aero HUD widget

Status: pending
Phase: 3
Depends on: 219, 221
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Cars with ERS show a battery/flow/mode/active-aero widget; other cars show none.

## Context

Style and caching: copy `src/ui/hudTyres.ts` / `hudTyres.css` (glass panel, 207 tokens in `theme.css`; writes only on change via cached last values; children created once in the constructor). `ErsTelemetry` is in `src/physics/hybridTypes.ts` (215); telemetry from `game.getTelemetry()` fields `ers?`, `aero?` (219). Existing widgets: `.tyres` (208), `.hud2-panel`, minimap canvas: no overlap at 1280×720 and 1920×1080 (check their CSS positions and pick a free corner).

## Files

- `src/ui/hudErs.ts`, `src/ui/hudErs.css` — create.
- `src/main.ts` — modify: create `HudErs(document.body)` next to `HudTyres`, import the css, `update(...)` each frame where `hudTyres.update` runs, `dispose()` with the session.
- `tests/unit/acceptance/223-hud-ers.test.ts`, `tests/e2e/acceptance/223-hud-ers.spec.ts` — create (from the table).

## Steps

```ts
import type { ErsTelemetry } from '../physics/hybridTypes';
export type HudErsData = ErsTelemetry & { aeroStraight: boolean | null };
export class HudErs { constructor(container: HTMLElement, doc?: Document); update(data: HudErsData | null): void; dispose(): void }
```

- Root `div.ers` appended to container. `null` → root class `hidden` (display none); non-null removes it.
- Children (created once): `.ers-bar` (style transform `scaleY(socFrac)` `toFixed(2)`, clamped 0–1), `.ers-soc` text `"62%"` (rounded), `.ers-mode` text `CHG`/`BAL`/`ATK` with class `mode-charge|balance|attack`, `.ers-ot` class `active` when overtake, `.ers-flow` class `deploy` (powerW > 1000) / `harvest` (< −1000) / `idle`, `.ers-clip` class `active` when clipping, `.ers-lap` text `` `${((deployCapJ − lapDeployJ)/1e6).toFixed(1)} MJ` ``, `.ers-aero` text `X` (true) / `Z` (false) / empty (null).
- main.ts: pass `{...telemetry.ers, aeroStraight: telemetry.aero ? telemetry.aero.blend >= 0.5 : null}` or `null` without allocating per frame (reuse one data object).

Conventions: non-finite numbers render as 0; each cached write skipped when the value is unchanged; no element creation in `update`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fake DOM | update {socFrac 0.624, powerW 280000, mode balance, overtake false, clipping false, lapDeployJ 2e6, lapHarvestJ 0, deployCapJ 8.5e6, aeroStraight true} | `.ers-soc` "62%", `.ers-bar` "scaleY(0.62)", `.ers-mode` "BAL" + `mode-balance`, `.ers-flow` `deploy`, `.ers-lap` "6.5 MJ", `.ers-aero` "X", `.ers-ot` without `active` |
| AT2 | AT1 then powerW −175000, clipping true, overtake true, mode charge, aeroStraight false | update | `.ers-flow` `harvest`; `.ers-clip` `active`; `.ers-ot` `active`; "CHG" + `mode-charge` only; "Z" |
| AT3 | same data twice | update | zero writes on the second call; no element created during updates |
| AT4 | update(null) | — | root has `hidden` |
| AT5 | e2e `/?track=monza&car=ow26`, ready | read | `.ers` visible, `.ers-soc` matches /^\d+%$/, box inside 1280×720 and not intersecting `.tyres`, `.hud2-panel`, minimap canvas; no console errors |
| AT6 | e2e `/?track=monza&car=f4`, ready | read | `.ers` hidden |

## Acceptance criteria

- [ ] AT1–AT6 pass; 208 tyre HUD tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 223-
```

## Out of scope

Overtake/ERS key hints text, setup panel, sounds, changing `.tyres`/`hud2` layout, ERS physics, per-lap history graphs.
