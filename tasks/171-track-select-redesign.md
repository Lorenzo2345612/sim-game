# 171 — Track select menu redesign

Status: pending
Phase: 1
Depends on: 106
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The track select menu is a scrollable responsive grid of cards with a track outline, country and length, fits the viewport (title and Credits always visible) and uses a muted, non-bright palette.

## Context

Today `showTrackSelect` in `src/ui/menu.ts` renders 15 full-width stacked buttons plus Credits in a ~942 px panel; at 1366x768 the panel top is at -87 px and title/Credits are off-screen with no scroll. `#menu` styles are inline in `index.html`. Existing e2e selectors `#menu button[data-track=...]` must keep working. Track list: `TRACK_CHOICES` (see architecture.md).

## Files

- `tools/track-builder/buildTrackIndex.ts` — create — pure function + CLI.
- `tools/track-builder/tracks.json` — modify — add `country` (English name) per entry: monza Italy, spa Belgium, silverstone United Kingdom, mexico Mexico, daytona United States, lusail Qatar, bahrain Bahrain, braselton United States, elkhart United States, sepang Malaysia, baku Azerbaijan, budapest Hungary, singapore Singapore, lasvegas United States, spielberg Austria.
- `public/tracks/index.json` — create — generated, committed.
- `package.json` — modify — script `build:track-index`.
- `src/ui/menu.ts`, `src/ui/menu.css` (create, imported by menu.ts), `index.html` (remove `#menu` rules; pause/credits panels keep the same look).
- `tests/unit/tools/171-track-index.test.ts` — create — generator unit tests.

## Steps

```ts
export interface TrackIndexEntry { id: string; name: string; country: string; lengthKm: number; outline: Array<[number, number]>; }
export function buildTrackIndexEntry(track: unknown /* parsed track JSON */, meta: { country: string }): TrackIndexEntry;
```

1. `buildTrackIndexEntry`: `id`/`name` from the track JSON; `lengthKm` = officialLengthMeters/1000 (fallback lengthMeters), 3 decimals. `outline` = centerline x/z top-down (x right, z down), simplified with Ramer–Douglas–Peucker to ≤ 128 points (uniform decimation if still above), normalized into [0,1]² preserving aspect ratio, centred, 3 decimals.
2. CLI (`npm run build:track-index`): for every in-game track in `TRACK_CHOICES` order, read `public/tracks/<id>.json` plus `country` from `tracks.json`, write `public/tracks/index.json` (array of entries). Run it and commit the output.
3. `showTrackSelect`: fetch `/tracks/index.json`; on failure fall back to `TRACK_CHOICES` (name only, no outline, no country line). Layout: title "Select track" (`.menu-title`), CSS grid (`auto-fill`, min 200 px) of `<button class="track-card" data-track="<id>">` containing `<svg class="track-outline"><path>` (stroke only, no fill, 2 px, light grey; accent on hover/focus/selected; path closed), the name, and a line `<country> · <lengthKm with 3 decimals> km`. The grid scrolls inside `.menu-panel` (max-height ~90vh); title and `#credits-btn` always visible.
4. Keyboard: arrow keys move focus between cards by grid position (geometric nearest in that direction); Enter/Space select (button default). The last-used track keeps class `selected` and initial focus.
5. Palette: `#menu` backdrop opaque dark (alpha ≥ 0.92) with `backdrop-filter: blur(6px)`; panel #0f1318, cards #161c24, text #e6e9ee, secondary text #9aa4b2; selected/focus accent = 2 px border #f2c200, no glow/box-shadow; no #fff text or borders in the menu.

Conventions: rounding to 3 decimals via round-half-away (`Math.round(x*1000)/1000`); invalid track JSON (no centerline) throws; input not mutated; degenerate zero-extent outline throws.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit: `buildTrackIndexEntry` on `public/tracks/monza.json` with meta `{ country: 'Italy' }` | build | `id` 'monza', `country` 'Italy', `lengthKm` 5.793; `outline` has 20–128 points, every coordinate in [0,1], first point equals last or path is closed in SVG by the menu |
| AT2 | unit: `public/tracks/index.json` | read | 15 entries in TRACK_CHOICES order, ids equal TRACK_CHOICES ids, every entry has non-empty `country` and `lengthKm` > 2 |
| AT3 | e2e viewport 1366x768, `/` | track select shown | `#menu .menu-panel` rect fully inside the viewport; `.menu-title` and `#credits-btn` inside the viewport; 15 `button.track-card[data-track]` each containing `svg.track-outline path` and text matching `/\d\.\d{3} km/` |
| AT4 | e2e viewport 1920x1080, `/` | track select shown | cards laid out in ≥ 3 columns (≥ 3 distinct card `left` values); panel inside the viewport |
| AT5 | e2e `/` | scroll the grid to Spielberg and click it | `__SIMGAME__.trackId` becomes 'spielberg' after ready; `localStorage.lastTrack` = 'spielberg' |
| AT6 | e2e `/` with `lastTrack`='spa' in storage | track select shown, press ArrowRight then Enter | spa card has class `selected` and initial focus; after the keys the game loads the track whose card is right of spa in the grid |
| AT7 | e2e `/` | track select shown | computed background alpha of `#menu` ≥ 0.92; no element under `#menu` has computed `color` or `border-color` rgb(255, 255, 255); no `.track-card` has a non-'none' box-shadow |

## Acceptance criteria

- [ ] All AT rows pass; `public/tracks/index.json` regenerates identically with `npm run build:track-index`.
- [ ] Pause menu and credits behave as before; `npx playwright test 044- 106-` passes.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 171-
npx playwright test 044- 106-
```

## Out of scope

- Pause menu behaviour, credits content, other menus, new tracks, thumbnails as images, search/filter, any file not listed.
