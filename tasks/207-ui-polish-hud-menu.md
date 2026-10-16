# 207 — UI polish: shared theme, HUD and menus

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, tester, reviewer

## Goal

The HUD and the menus share one restrained, motorsport-style look. Today they look plain and the track menu is too bright. The game logic, DOM ids and test hooks stay unchanged.

## Context

User request: "refinar la UI, que quede más bonito el HUD y el menú". Earlier complaint about the track menu: "se ve feo e incompleto, además brilla mucho".

Current UI is plain DOM + CSS without React:
- `src/ui/hud.ts` + `hud.css`: `.hud-panel`, `.hud-speed`, `.hud-lap`.
- `src/ui/hudV2.ts` + `hudV2.css`: `.hud2-panel`, rpm bar, sectors, delta, invalid badge.
- `src/ui/hudTyres.ts` + `hudTyres.css`: tyres and fuel.
- `src/ui/minimap.ts`, `src/ui/fpsOverlay.ts`.
- `src/ui/menu.ts` + `menu.css`: main, track select (`.track-grid`, `.track-card`), pause and credits.
- `src/ui/setupPanel.ts`: `#setup-panel`, inline or own styles.

Each file styles itself with its own hard-coded colours.

## Files

- `src/ui/theme.css` — new — design tokens as CSS custom properties on `:root`, plus shared classes. Imported first in `src/main.ts`.
- `src/ui/hud.css`, `hudV2.css`, `hudTyres.css`, `menu.css` — modify — use the tokens; restyle.
- `src/ui/setupPanel.ts`, `minimap.ts`, `fpsOverlay.ts`, `hud.ts`, `hudV2.ts`, `hudTyres.ts`, `menu.ts` — modify only as needed:
  - Move inline colours to classes or tokens.
  - Add wrapper elements or classes for the new layout.
- `src/main.ts` — modify — import `./ui/theme.css` before the other CSS imports. Nothing else.

## Steps

1. **Tokens.** `theme.css` defines at least these properties on `:root`:
   - `--ui-bg` (overlay backdrop), `--ui-panel` (panel fill, translucent), `--ui-panel-solid`, `--ui-border`, `--ui-text`, `--ui-text-dim`.
   - `--ui-accent` (one warm accent, e.g. amber/racing yellow), `--ui-good` (green), `--ui-warn` (amber), `--ui-bad` (red).
   - `--ui-radius`, `--ui-gap`, `--ui-font` (system sans stack), `--ui-font-num` (same stack).
   - Numbers use `font-variant-numeric: tabular-nums`.
   - Constraints: no web fonts, no external URLs, no new npm dependencies, no image assets.
   - Text colour is off-white (no channel above `#e8`). Panel fills are dark.
2. **HUD.** Every HUD panel uses the same glass-panel look:
   - `--ui-panel` background with alpha 0.35–0.85, a 1 px `--ui-border` border, radius `--ui-radius` (6–12 px), and `backdrop-filter: blur(...)` where supported.
   - Layout:
     - Speed and gear: bottom centre. The speed is a large number with a small "km/h" unit. Gear is the largest glyph. The rpm bar sits above them and runs green → amber → red over its last 15 %.
     - Lap, times, sectors and delta: top left, in one column.
     - Tyres and fuel: bottom left.
     - Minimap: top right, in a framed panel (keep the 161 size, 160 × 160 px and ≤ 24 px from the corner).
     - FPS overlay: unobtrusive.
   - Delta and sector colours use `--ui-good`, `--ui-warn` and `--ui-bad`; the invalid badge uses `--ui-bad`.
   - Sizes scale with `clamp()` so that at 1280 × 720 and 1920 × 1080 nothing overlaps and everything stays inside the viewport.
   - Per-frame updates keep writing `textContent`/style only. No new per-frame allocations and no layout thrash: set widths through `transform: scaleX` or one style write per frame, as today.
3. **Menus.** Main, track select, pause, credits and the setup panel share the panel style.
   - Backdrop: `--ui-bg`, dark (luminance ≤ 0.08) and slightly blurred. No large bright areas: no element wider than 200 px has a background with HSL lightness > 0.35.
   - Title: larger, with letter-spacing and a thin accent underline.
   - Buttons have two variants:
     - Primary: accent fill, dark text.
     - Secondary: transparent, with a border.
   - Hover: subtle raise (`translateY(-1px)`) and border accent. `:focus-visible`: 2 px accent outline. Keyboard navigation stays as today.
   - Track cards: dark card and the track outline drawn in `--ui-text-dim`, with the accent on hover and select. Name in bold, meta (length, country) dimmed. The selected card keeps the `selected` class.
   - Transitions are 120–200 ms, and none under `prefers-reduced-motion: reduce`.
4. **Keep contracts.** Every existing id, class, `data-*` attribute and text that `tests/` reference stays present. Before changing any class or attribute, run `grep -rn` on `tests/`. Behaviour, keyboard handling and `window.__SIMGAME__` are unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

Write them in `tests/e2e/acceptance/207-ui-polish.spec.ts`. Helpers: hex/rgb(a) → HSL and relative luminance (WCAG) in the spec file.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | e2e `/`, menu visible | read `getComputedStyle(document.documentElement)` | `--ui-bg`, `--ui-panel`, `--ui-border`, `--ui-text`, `--ui-text-dim`, `--ui-accent`, `--ui-good`, `--ui-warn`, `--ui-bad`, `--ui-radius` all non-empty |
| AT2 | e2e `/`, menu visible, 1280 × 720 | read the computed background of `#menu` | relative luminance ≤ 0.08 |
| AT3 | e2e `/`, menu visible, 1280 × 720 | for every element inside `#menu` that is visible, wider than 200 px and has a non-transparent background colour | its HSL lightness ≤ 0.35 |
| AT4 | e2e `/`, menu visible | for every visible text-bearing element in `#menu` (buttons, `.menu-title`, `.track-name`) | contrast ratio of its colour against the nearest opaque ancestor background (blend alpha over `#menu`) ≥ 4.5; text colour has no channel > 0xe8 |
| AT5 | e2e `/`, menu visible | press Tab until a `button.track-card` has focus | that card's computed `outline-style` ≠ `none` with width ≥ 2 px, or `box-shadow` ≠ `none` |
| AT6 | e2e `/?track=monza`, ready, 1280 × 720 and again at 1920 × 1080 | collect visible bounding boxes of `.hud-panel`, `.hud2-panel`, the tyres/fuel panel root and the minimap canvas | every box is inside the viewport; no two boxes intersect (area of intersection ≤ 1 px²) |
| AT7 | e2e `/?track=monza`, ready | read computed styles of `.hud-panel` and `.hud2-panel` | background alpha in [0.35, 0.85]; `border-top-left-radius` in [6, 12] px; `font-variant-numeric` of `.hud-speed` contains `tabular-nums` |
| AT8 | e2e `/?track=monza`, ready | read the minimap canvas rect | still 160 ± 1 px square, right edge ≥ viewport − 24, top ≤ 24 (161 AT1 holds) |
| AT9 | e2e `/` and `/?track=monza` | collect console errors while loading and pressing Escape twice | none |
| AT10 | e2e `/`, menu visible / `/?track=monza` ready | take full-page screenshots | saved to `test-results/207/menu.png` and `test-results/207/hud.png` for the reviewer (no pixel assertion) |

## Acceptance criteria

- All AT pass. The existing e2e specs `044`, `161` and `171`, the rest of `tests/e2e/acceptance/` and every unit test pass unchanged.
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass.
- No new dependencies, assets or external URLs.

## Verification

```
npm run typecheck && npm run lint && npm test
npx playwright test tests/e2e/acceptance/207-ui-polish.spec.ts tests/e2e/acceptance/044-track-menu.spec.ts tests/e2e/acceptance/161-minimap-size-and-pause-audio.spec.ts tests/e2e/acceptance/171-track-select-redesign.spec.ts
```

The coder must not edit any test file. If an existing test blocks the design, stop and escalate.

## Out of scope

- Race HUD for AI cars (094), quick race menu (095), damage HUD (148): those adopt the tokens later.
- New screens, settings, remapping, sounds, animations beyond hover/focus transitions.
- Any change to simulation, input or render code.
