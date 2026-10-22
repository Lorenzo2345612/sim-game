# 342 — DRS HUD indicator

Status: pending
Phase: 7
Depends on: 341, 345
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The HUD shows when DRS is available and when it is open for the player car.

## Context

Design: `docs/design/ow-ladder.md`. Style like `src/ui/hudErs.ts`: a DOM element created by the HUD, no React. `main.ts` already reads telemetry each frame; RaceGame exposes `drsState(0)` (341). The e2e row loads `ow2` (345).

## Files

- `src/ui/hudDrs.ts` — create: `export class HudDrs { constructor(parent: HTMLElement); update(d: { enabled: boolean; open: boolean } | null): void; dispose(): void }`
- `src/main.ts` — modify (minimal): create `HudDrs`, call `update(race.drsState(0))` for race sessions whose car spec has `activeAero.drs`, else `update(null)`
- `tests/unit/acceptance/342-drs-hud.test.ts`, `tests/e2e/acceptance/342-drs-hud.spec.ts` — create

## Steps

1. Element `#hud-drs` with attribute `data-state`: `hidden` (null or both false), `available` (enabled, not open; text `DRS`), `open` (text `DRS OPEN`).
2. `null` hides; `dispose` removes the element.

Conventions: text exactly as above; state attribute is the contract for tests.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/342-drs-hud.test.ts` (e2e rows into `tests/e2e/acceptance/342-drs-hud.spec.ts`). Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | HudDrs in a jsdom parent | update(null) / {false,false} | `#hud-drs` data-state `hidden` |
| AT2 | same | update({enabled:true,open:false}) | data-state `available`, text `DRS` |
| AT3 | same | update({enabled:true,open:true}) | data-state `open`, text `DRS OPEN` |
| AT4 | dispose after AT3 | query | element absent |
| AT5 | e2e `/?car=ow2&track=monza&race=1` (after 345) | load | `#hud-drs` exists with data-state `hidden` at the start |

## Acceptance criteria

- [ ] All ATs pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 342-
```

## Out of scope

- Zone distance bar, sounds, steering-wheel LED, ERS HUD changes.
