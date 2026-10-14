# 161 — Fix minimap stretched to full screen and engine audio playing while paused

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The minimap is a 160 px square in the top-right corner, and the pause menu silences all game audio until the game resumes.

## Context

User report on the M1.3 build.
- **Minimap:** `index.html` has a global rule `canvas { width: 100vw; height: 100vh; }`, so it also stretches the minimap canvas created in `src/ui/minimap.ts` over the whole screen.
- **Audio:** pausing (Escape) only stops calling `engineAudio.update`. The `AudioContext` keeps playing at the last gain.

## Files

- `index.html` — modify — scope the full-screen rule to the game canvas (`#game`).
- `src/ui/minimap.ts` — modify — set the canvas CSS size explicitly (`width`/`height` = `size` px).
- `src/audio/engineAudio.ts` — modify — add `setPaused`.
- `src/main.ts` — modify — call `engineAudio.setPaused(true)` when the pause menu opens and `setPaused(false)` on resume. Expose `audioPaused()` on `window.__SIMGAME__`.
- `tests/unit/audio/engineAudio.test.ts` — modify — coder-owned unit tests for `setPaused`.

## Steps

```ts
// EngineAudio
setPaused(paused: boolean): void; // true -> ctx.suspend(); false -> ctx.resume()
get paused(): boolean;
// window.__SIMGAME__
audioPaused(): boolean; // engineAudio?.paused ?? false
```

1. `setPaused(true)`:
   - Calls `ctx.suspend()` and sets `paused`.
   - Repeated calls with the same value are no-ops: no extra suspend or resume calls.
   - Promise rejections are swallowed, as in `resume()`.
2. While paused, neither `update(...)` nor `resume()` resumes the context. `setPaused(false)` clears the flag and calls `ctx.resume()`.
3. After `dispose()`, `setPaused` is a no-op.
4. In `main.ts`:
   - Every path that sets `paused = true` (Escape, or opening the pause menu) calls `setPaused(true)`.
   - `resume()` calls `setPaused(false)`.
   - Restart and quit from the pause menu leave the audio either paused or disposed. It never plays behind the menu.
5. Minimap: the canvas is 160 × 160 CSS px, `top: 12px; right: 12px`, whatever the global CSS says.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | e2e `/?track=monza`, viewport 1280 × 720, ready | read the bounding rect of every `canvas` except `#game` | exactly 1 such canvas; width 160 ± 1 and height 160 ± 1; right edge ≥ 1280 − 24; top ≤ 24 |
| AT2 | e2e same page | read the `#game` bounding rect | width 1280 ± 1, height 720 ± 1 |
| AT3 | unit: EngineAudio with a fake context counting `suspend`/`resume` calls | `setPaused(true)` twice | suspend calls = 1; `paused` true |
| AT4 | unit: same, paused | `update(6000, 1, [0, 0, 0, 0])` then `resume()` | resume calls = 0 |
| AT5 | unit: same, paused | `setPaused(false)` | resume calls = 1; `paused` false |
| AT6 | e2e ready | press Escape / press Escape again | `audioPaused()` true / false |

## Acceptance criteria

- [ ] AT1–AT6 pass; the existing minimap and audio tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test tests/e2e/acceptance/161-*.spec.ts
```

## Out of scope

- Minimap styling, rotation or zoom.
- New sounds and volume settings.
