# 315 — Results: overtakes in their own tab, with a legend

Status: pending
Phase: 2
Depends on: 296
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The results screen has two tabs, "Classification" and "Overtakes"; the overtake counts and recap move to the second tab with a legend explaining each kind, and nothing overflows the viewport.

## Context

User report: the 291 results screen shows `Passes clean/contact/gift` and the recap under the classification; "gift" is never explained and the panel overflows. Code: `src/ui/results.ts`, `src/ui/recap.ts`, `src/ui/results.css`. Overtake kinds come from `src/race/overtakeLog.ts` (`gift` = the passed car was not running or much slower).

## Files

- `src/ui/results.ts`, `src/ui/recap.ts`, `src/ui/results.css` — modify.
- `tests/unit/acceptance/315-results-overtakes-tab.test.ts`, `tests/e2e/acceptance/315-results-overtakes-tab.spec.ts` — create (acceptance worker).
- Planner-authorised edit: `tests/unit/acceptance/291-results-overtake-recap.test.ts` AT3 third expectation becomes `'L2 · 1.23 km · AI 1 passes You for P3 (rival slow or off track)'`. Nothing else.

## Steps

1. Tabs: buttons `#results-tab-classification` and `#results-tab-overtakes` (class `active` on the selected one) above the content; Classification is selected on every `show`. Without overtake data (no recap) the tabs are hidden and only the classification shows.
2. Classification tab: today's table minus the `Passes` and `Lost` columns (other columns and order unchanged).
3. Overtakes tab (`#results-overtakes`): table `.results-overtakes-table` with columns `P`, `Name`, `Clean`, `Contact`, `Rival slow/off`, `Lost`, rows in classification order; then the highlights line; then a legend `.results-legend` with exactly three lines: `Clean: passed without contact`, `Contact: passed with contact`, `Rival slow/off: passed a car that was stopped, off track or much slower`; then the recap list. Clicking a row filters the recap as today.
4. `recapLine` suffix for kind `gift` becomes ` (rival slow or off track)`; `contact` unchanged.
5. Layout: `.results-panel` max-height 90vh; only the tab content scrolls (`overflow-y: auto`); actions (Restart/Menu) always visible.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `recapLine` with kind `'gift'`, `'contact'`, `'clean'` (291 AT3 inputs) | call | suffixes ` (rival slow or off track)`, ` (contact)`, none |
| AT2 | e2e 1280×720 `/?race=1&track=cleveland&ai=11&laps=3&seed=1`, 20 s after go | `__SIMGAME__.finishRaceNow()` | `#results` visible; `#results-tab-classification.active`; classification header has no `Passes` and no `Lost`; 12 body rows |
| AT3 | as AT2 | click `#results-tab-overtakes` | `.results-overtakes-table` visible with headers `P, Name, Clean, Contact, Rival slow/off, Lost` and 12 rows; `.results-legend` text contains the three legend lines; classification table hidden |
| AT4 | as AT3, viewport 1280×720 and 1366×768 | measure | `.results-panel` bounding box inside the viewport; Restart and Menu buttons inside the viewport; `document.scrollingElement.scrollHeight <= innerHeight` |
| AT5 | as AT3 | click the first overtakes row | recap shows only events whose passer or passed is that car (as 291) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 095, 130, 291, 296 acceptance tests still pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/315- tests/unit/acceptance/291-
npm run build
npx playwright test 315- 291- 296- 095- 130-
```

## Out of scope

- Changing overtake classification rules, new statistics, charts, career persistence.
