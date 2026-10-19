# 293 — Remove race HUD overlaps (damage panel, flags, toasts)
Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal
In a race (`/?race=1&track=cleveland&ai=11&laps=3`) three HUD pairs overlap at 1920×1080, 1366×768 and 1280×720 (measured 2026-10-19):
1. `.damage-hud` (`src/ui/damageHud.css`, fixed left 12 / top 12) covers the top-left of `#hud` (`src/ui/hud.css`): overlap 8072–11622 px².
2. `#flags` (`src/ui/raceHud.css`, top 12 / right 12) sits on the `.minimap` canvas (`src/ui/minimap.ts`, top-right): 1188–2298 px².
3. `#toasts` (`raceHud.css`, centred, bottom 14vh) overlaps `.hud2-panel` (`src/ui/hudV2.css`) at 1280×720 and 1920×1080: up to 3714 px².
After this task no visible HUD elements overlap at those viewports, in race and practice.

## Files
- `src/ui/damageHud.css`, `src/ui/raceHud.css`, `src/ui/hud.css`, `src/ui/hudV2.css`, `src/ui/minimap.ts` — modify only what is needed (CSS positions/sizes first; no new HUD elements).
- `tests/e2e/293-race-hud-overlaps.spec.ts` — create (acceptance worker).

## Steps
1. Keep each element's corner/area; fix by moving: damage panel below or beside `#hud` (not on it), flags to the left of or below the minimap, toasts above `.hud2-panel` with ≥ 8 px gap. Sizes keep scaling with the viewport.
2. "Visible HUD element" in the tests: elements matching `#hud, .damage-hud, .minimap, #flags, #toasts, .hud2-panel, .tyres, .race-hud-top, #race-tower, #vsc-banner, #blue-banner` with `display != none`, `visibility != hidden` and non-zero rect; parent/child pairs ignored.

## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | viewport 1920×1080, `/?race=1&track=cleveland&ai=11&laps=3` | at the start lights (~1.5 s after load of the race) and ~9 s after | no two visible HUD elements' bounding rects intersect (area > 0) |
| AT2 | as AT1 at 1366×768 | same | same |
| AT3 | as AT1 at 1280×720 | same | same |
| AT4 | each viewport of AT1–AT3, ~9 s into the race | the test appends `<div>Track limits 1/3</div>` to `#toasts` | `#toasts` rect bottom ≤ `.hud2-panel` rect top − 8 px, and no intersections as in AT1 |
| AT5 | 1280×720, practice (`/?track=cleveland`) | ~5 s after load | no two visible HUD elements intersect |

## Verification
```
npm run typecheck
npm run lint
npm run build
npx playwright test 293-
```

## Out of scope
- Lap-time values in race (task 292), new HUD content, theme/colour changes, menus and results screen.
