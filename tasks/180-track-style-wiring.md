# 180 — Style loader, wiring, extra grandstands, debug hook

Status: pending
Phase: 1
Depends on: 179, 156, 157, 158, 159, 160, 168, 174
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`main.ts` loads `public/tracks/<id>.style.json` after the track and hands the parsed style to the render builders; extra grandstands from the style are placed; `sceneStats().style` reports the load.

## Context

Design: `docs/design/track-style.md` ("Rendering"). Types from task 179 (`ResolvedTrackStyle`, `DEFAULT_TRACK_STYLE`, `parseTrackStyle`, `ExtraGrandstand`). Existing grandstand placement for reference: `placeGrandstands` in `tools/track-builder/buildTrack.ts` (right-hand normal, yaw = `atan2(-(px-x), -(pz-z))`). This task changes no look: the style param is accepted and ignored (182-185 consume it). Touches more than 3 src files only because four signatures get one mechanical optional param.

## Files

- `src/track/trackStyleWiring.ts` — create: `loadTrackStyle`, `extraGrandstands`.
- `src/main.ts` — modify: load style after `parseTrackData`, pass `style`, add extra stands, `stats.style`.
- `src/render/pitAndStart.ts`, `src/render/grandstand.ts`, `src/render/barrierRenderer.ts`, `src/render/trackSurfaceRenderer.ts` — modify: optional param (unused: reference it with `void style` to satisfy lint); grandstand root group gets `name = 'grandstand'`.
- `tests/unit/acceptance/180-track-style-wiring.test.ts`, `tests/e2e/acceptance/180-track-style-wiring.spec.ts` — create (acceptance role).

## Steps

```ts
export interface StyleResponse { ok: boolean; json(): Promise<unknown> }
export interface LoadedTrackStyle { style: ResolvedTrackStyle; loaded: boolean; errors: string[]; warnings: string[] }
export function loadTrackStyle(id: string, pointCount: number, fetchFn?: (url: string) => Promise<StyleResponse>): Promise<LoadedTrackStyle>; // default fetchFn = global fetch
export function extraGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
```

- `loadTrackStyle` requests `/tracks/${id}.style.json` once. `!ok` or fetch rejection → `{DEFAULT_TRACK_STYLE, loaded: false, errors: [], warnings: []}`. `json()` rejection → loaded false, defaults, 1 error containing `JSON`. Otherwise `parseTrackStyle(body, pointCount)`; `loaded = errors.length === 0`; style is the parsed one. Never throws.
- `extraGrandstands`: per `style.extraGrandstands` entry (same order): chord from `centerline[start]` to `centerline[end]` (wraps); `lengthMeters` = chord length; centre = chord midpoint moved by `widthMeters/2 + offsetMeters` along the chord's right-hand normal (right = +, left = -, as `placeGrandstands`); `yaw` from the stand toward the chord midpoint as in `placeGrandstands`; `rows`, `roof` from the entry. Empty list → `[]`. Degenerate chord (length 0) → skip the entry.
- Signatures: `createPitBuilding(track, style?)`, `createGrandstand(g, loadTexture?, style?)`, `createBarrierObject(track, loadTexture?, style?)`, and `TrackSurfaceOptions` gains `style?: ResolvedTrackStyle` and `track?: TrackDataV2` (no trailing param there; 183 uses both). Without style behaviour is identical to today.
- `main.ts`: `const loadedStyle = await loadTrackStyle(trackId, track.centerline.length)` right after parsing the track; `console.warn` each error/warning; pass `loadedStyle.style` to the four builders; after the `track.grandstands` loop create the stands from `extraGrandstands(track, style)` the same way (y = `nearestElevation`). `SceneStats.style: { id: string; loaded: boolean; warnings: number }` (initial `{id: '', loaded: false, warnings: 0}`); `stats.grandstands` keeps counting `track.grandstands` only.

Conventions: `extraGrandstands` rounding none; inclusive indices; zero-length chord skipped; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fetch stub returning 404 | `await loadTrackStyle('monza', 2894, fetchStub)` | `{style: DEFAULT_TRACK_STYLE, loaded: false, errors: [], warnings: []}`; stub called once with `/tracks/monza.style.json` |
| AT2 | stub 200 with body `{"version":1,"foo":1}` | load | loaded true; warnings length 1; errors `[]` |
| AT3 | stub 200 with body `{not json` | load | loaded false; 1 error containing `JSON`; style = defaults; no throw |
| AT4 | stub that rejects (network error) | load | loaded false; style = defaults; no throw |
| AT5 | STRAIGHT; entry `{start: 10, end: 20, side: 'left', offsetMeters: 15, rows: 12, roof: true}` | `extraGrandstands(STRAIGHT, style)` | 1 Grandstand: lengthMeters 100 (±1e-6), rows 12, roof true, x 150 (±1e-6), z -21 (±1e-6) |
| AT6 | same entry with side 'right' | same | z = +21 (±1e-6) |
| AT7 | result of AT5 and AT6 | front direction `(-sin yaw, -cos yaw)` | dot with the unit vector from the stand to (150, 0) ≥ 0.99 for both |
| AT8 | ring of 100 points, radius 500 m, centre (0, 0); entry `{start: 95, end: 5, side: 'left', offsetMeters: 15}` | extraGrandstands | 1 stand; lengthMeters = chord(95→5) = 1000·sin(18°) = 309.0 ± 0.5; distance from the ring centre is 475.5 + 21 or 475.5 - 21 (± 1) depending on the ring's winding |
| AT9 | defaults | `createPitBuilding(track)` vs `createPitBuilding(track, DEFAULT_TRACK_STYLE)`; same for `createBarrierObject`, `createGrandstand`, `createTrackSurfaceObject` | same child count and same mesh names in the same order |
| AT10 | e2e, `?track=monza`, route `**/tracks/monza.style.json` → 404 | `__SIMGAME__.sceneStats().style` | `{id: 'monza', loaded: false, warnings: 0}` |
| AT11 | e2e, route → `{"version":1,"foo":1}` | same | `{id: 'monza', loaded: true, warnings: 1}` |
| AT12 | e2e, route → `{"version":1,"extraGrandstands":[{"start":100,"end":130,"side":"left"}]}` | count scene objects named `grandstand` (the name createGrandstand gives its group; add it if missing) | count = monza's `grandstands.length` + 1 |

## Acceptance criteria

- [ ] All AT rows pass; existing tests unchanged and green.
- [ ] Without a style file the scene is identical to before (AT9).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 180-
```

## Out of scope

- Using the style in any renderer (182-185), floodlights/props (186, 187), sceneStats fields other than `style`, changing `tasks`/builder/`track.json`.
