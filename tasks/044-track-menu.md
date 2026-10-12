# 044 — Track selection and pause menu

Status: pending
Phase: 1
Depends on: 043
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Start screen to pick Monza, Spa or Silverstone, and an Esc pause menu with Resume / Restart / Change track; the last track is remembered.

## Context

Acceptance tests for this task are Playwright in `tests/e2e/acceptance/044-track-menu.spec.ts`. `main.ts` currently starts the game immediately (task 043 reads `?track=`). New behaviour: with `?track=<id>` present the game starts directly (keeps task 043 tests valid); without it the menu shows and no game is created until a choice. `src/ui` receives its DOM parent injected.

## Files

- `src/ui/menu.ts` — create
- `src/main.ts` — modify: start flow, pause/resume, restart, change track
- `index.html` — modify: `<div id="menu"></div>` plus menu CSS

## Steps

```ts
export interface TrackChoice { id: string; name: string }
export const TRACK_CHOICES: TrackChoice[];  // monza "Monza", spa "Spa", silverstone "Silverstone"
export const LAST_TRACK_KEY = 'lastTrack';
export class Menu {
  constructor(parent: HTMLElement, storage: { getItem(k: string): string | null; setItem(k: string, v: string): void });
  showTrackSelect(onSelect: (id: string) => void): void;
  showPause(handlers: { onResume(): void; onRestart(): void; onChangeTrack(): void }): void;
  hide(): void;
  readonly visible: boolean;
}
```

- Track select: one `<button data-track="<id>">Name</button>` per choice, text = name; the button of the id stored under `LAST_TRACK_KEY` has class `selected` and focus. Choosing stores the id.
- Pause: buttons with text "Resume", "Restart", "Change track". Esc toggles pause in game; while paused the simulation does not advance (render continues). Restart resets the car to spawn and lap state (recreate Game). Change track disposes the Game and shows the select screen (no full page reload required).
- Menu root element has id `menu`, `display: none` when hidden.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/e2e/acceptance/044-track-menu.spec.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: `/` without query | page | menu lists Monza, Spa, Silverstone; no game running |
| AT2 | click "Spa" | load | game ready with trackId 'spa'; menu hidden |
| AT3 | Esc in game | menu | pause menu with Resume / Restart / Change track |
| AT4 | last track chosen | reload `/` | menu preselects it (localStorage) |

## Acceptance criteria

- [ ] All AT rows pass with `npm run test:e2e`.
- [ ] `/?track=monza` still starts directly without the menu.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Settings screen, preset selection, gamepad menu navigation, track thumbnails, ghost or lap-history UI.
