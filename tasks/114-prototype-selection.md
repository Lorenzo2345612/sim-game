# 114 — Car selection and credits list the prototypes

Status: pending
Phase: 1
Depends on: 113, 073, 074
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The car picker offers the two prototypes (LMP2 A, Hypercar A; B variants are task 170) after the GT3 entries, and the credits panel attributes their models.

## Context

Picker and `?car=` wiring: `tasks/073-car-selection.md` (`public/cars/index.json`, `car-picker`, `window.__SIMGAME__.carId()`). Credits: `tasks/074-credits.md` (generated from `ASSETS_LICENSES.md`, CC-BY rows only, neutral asset text, never the source title). The 2 licence rows were added by 112 (LMP2 car A source, Hypercar A source); B variants moved to task 170. Tests: e2e `tests/e2e/acceptance/114-prototype-selection.spec.ts`.

## Files

- `public/cars/index.json` — modify: append, in this order after the existing entries, `{id:"lmp2-a",name:"LMP2 A",category:"lmp2"}`, `hyper-a`/"Hypercar A" (category "hypercar")
- `public/credits.json` — regenerate with `npm run build:credits` and commit
- `tests/e2e/acceptance/114-prototype-selection.spec.ts` — create (acceptance worker)
- Planner-authorised minimal edit: the 073 acceptance test row that pins the picker to exactly 4 cars → 6 cars (f4, gt3-a, gt3-b, gt3-c, lmp2-a, hyper-a)

## Steps

1. Edit `index.json` only; do not change `src/` unless the picker fails to render the new entries (then minimal fix in `src/ui/menu.ts`).
2. Run `npm run build:credits`; the 2 new entries must appear (112 rows).
3. Credits "title" is the neutral Asset text of 074 (e.g. "LMP2 car A source"), not the Sketchfab model title.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e car selection | list | includes LMP2 A, Hypercar A after the GT3 entries |
| AT2 | e2e `/?track=monza&car=hyper-a` | ready | car loads; 3 s throttle > 40 km/h; no console errors |
| AT3 | credits screen | text | exactly 2 new lines: "LMP2 car A source" by mosigana and "Hypercar A source" by supranakamura, each with "CC-BY 4.0" and its source URL |

## Acceptance criteria

- [ ] AT1–AT3 pass; 073 and 074 tests still pass (update nothing else; 073 AT1 counts 4 cars and must be reconciled by the planner if it fails).

## Verification

```
npm run build:credits
npm run typecheck
npm run lint
npm test
npx playwright test 114-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

Dynamics changes, per-car setup storage, car stats display, model or pipeline changes, editing `ASSETS_LICENSES.md`.

## Planner-authorised test edits

- `tests/e2e/acceptance/073-car-selection.spec.ts` line with `toHaveCount(4)`: change to `toHaveCount(6)` (f4, gt3-a, gt3-b, gt3-c, lmp2-a, hyper-a). Nothing else in that file.
