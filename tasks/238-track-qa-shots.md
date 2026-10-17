# 238 — Track QA screenshots

Status: pending
Phase: 1
Depends on: 233
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11

## Goal

`npm run track:shots -- <id>` writes a top-down view, a top-down view blended with the satellite ground texture, and 7 named close-up views of one track, so the planner can compare the rendered track with reality.

## Context

Design: `docs/design/track-fidelity.md` ("238"). Not parallel with 237: both modify `package.json`. Uses `groundHeightAt` (233, `src/track/ground.ts`). Playwright 1.64 and `sharp` 0.35.5 are already installed; browser args as in `playwright.config.ts` (swiftshader). Coordinates: x east, z south (north is −Z), so the top view has screen-up = −Z. `src/track/qaViews.ts` must stay pure (no `three`).

## Files

- `src/track/qaViews.ts` — create. `src/main.ts` — modify: `qaCamera` in `window.__SIMGAME__` and its type.
- `tools/track-qa/shots.ts` — create (CLI). `package.json` — modify: script `"track:shots": "tsx tools/track-qa/shots.ts"`.
- `tests/unit/acceptance/238-track-qa-shots.test.ts` (AT1-3, AT6) and `tests/e2e/acceptance/238-track-qa-shots.spec.ts` (AT4-5) — create.

## Steps

```ts
export interface QaView { name: string; eye: [number, number, number]; target: [number, number, number] }
export function qaViews(track: TrackDataV2, count: number): QaView[]
// main.ts, inside __SIMGAME__ and the Window type:
qaCamera(view: 'top' | { eye: [number, number, number]; target: [number, number, number] } | null): QaCameraInfo
export interface QaCameraInfo { kind: 'chase' | 'top' | 'view'; orthographic: boolean; left: number; right: number; top: number; bottom: number }
```

1. `qaViews`: first `{name: 'start', eye, target}`: eye = `centerline[0] − 30·t` with t = normalized `centerline[1] − centerline[0]`, eye y = `elevation[0] + 6`, target = index 0 at its elevation. Then up to `count` corners (`corner1`, `corner2`… in lap order). Curvature at index i = |heading change between arclength s−10 and s+10| / 20 (closed lap). Pick the max-curvature index, then repeatedly the next max whose lap distance (circular arclength) is ≥ 150 m from every chosen apex; stop at `count` or when the best curvature < 1e-4 /m; ties → lowest index. Apex = centre (by arclength) of the contiguous indices around the pick with curvature ≥ 0.98·max. Eye = point 40 m back along the centerline polyline from the apex, moved 15 m to the outside of the turn (away from the turn centre), eye y = `groundHeightAt(track, ex, ez) + 8`; target = apex x/z at `elevation[apex]`. `count ≤ 0` or non-integer: floor, clamp at 0.
2. `qaCamera('top')`: orthographic camera at height above the scene looking along −Y, screen-up −Z, frustum the smallest rectangle with the viewport aspect that contains the terrain bounds (`originX ± sizeX/2`, `originZ ± sizeZ/2`), or the centerline bbox + 100 m per side without terrain; `#hud` gets `display: none`. A view object: perspective camera, fov 60, at `eye` looking at `target`, `#hud` hidden. `null`: restores the chase camera/rig and `#hud` display. While a QA view is active the frame loop skips the camera rig update and renders with `renderer.render(scene, qaCamera)` (post-processing and mirror bypassed). Returns the `QaCameraInfo` now active (`left/right/top/bottom` are 0 unless orthographic).
3. `shots.ts <id>`: starts nothing itself (uses `E2E_PORT` or `http://localhost:4173`); opens `?track=<id>&quality=low`, waits `__SIMGAME__.ready`, per shot calls `qaCamera`, waits two animation frames, screenshot timeout 180 s; writes `.ai/qa/<id>/top.png` (viewport aspect = terrain aspect, width 1600), `top-sat.png` (top blended 50/50 via `sharp` with `public/textures/ground/<id>.jpg` resized to the frame; skipped when the texture is missing) and `<name>.png` per `qaViews(track, 6)` view (1280×720). Track JSON from `public/tracks/<id>.json`. Unknown id exits 1.

Conventions: distances in metres; apex spacing `≥ 150` inclusive; `top` frustum covers the bounds (extra margin allowed only on the axis the aspect forces); no input mutated; no new objects per frame in main.ts.

Fixtures: `ARC`: centerline `[200·cos(2πi/200), −200·sin(2πi/200)]`, i = 0..199, widthMeters 12, elevation 0, no terrain. `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no terrain.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `ARC` | `qaViews(track, 0)` | exactly 1 view `start`; eye 30 m from centerline[0] (±0.5) along −tangent, eye y 6 (±1e-6) |
| AT2 | `STRAIGHT` with a 90° corner inserted (fixture built in the test: 50 points along +x, a radius-30 quarter arc, 50 points along +z, closed by a far loop) | `qaViews(track, 1)` | the corner view's target within 5 m of the arc midpoint |
| AT3 | any track | `qaViews(track, 6)` | ≤ 7 views; corner apexes pairwise ≥ 150 m apart along the lap |
| AT4 | e2e `?track=monza&quality=low` | `qaCamera('top')` then render | active camera is orthographic; `left/right/top/bottom` cover the terrain sizeX × sizeZ (±1 m); HUD root `display: none` |
| AT5 | e2e same page | `qaCamera(null)` | chase camera active again, HUD visible |
| AT6 | sources | read `src/track/qaViews.ts` | no `from 'three'` |

## Acceptance criteria

- [ ] Table rows pass; `npm run track:shots -- monza` (with the preview server up) writes `top.png`, `top-sat.png` and 7 view PNGs under `.ai/qa/monza/`.
- [ ] Existing `__SIMGAME__` keys unchanged; `package.json` has `track:shots` exactly as in Files.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 238-
```

## Out of scope

- Per-track tuning of views, automatic image comparison, QA of the pause/menu UI, hiding `HudTyres`/`HudErs` DOM roots (see questions), wave-2 data changes.

## Planner-authorised test edits

None. Checked: `tests/unit/edge/070-dynamics-integration.test.ts` and `054-gameplay-integration.test.ts` only require listed `__SIMGAME__` keys to be present; adding `qaCamera` does not break them.

## Questions for the planner

- AT4/AT5 need a readable result: `qaCamera` returns `QaCameraInfo` (my addition; no extra `__SIMGAME__` method). Confirm.
- `postProcessing.ts` binds a `PerspectiveCamera`; QA views bypass post-processing (flat render) to avoid touching a 3rd src file. Confirm.
- Hiding only `#hud`: `HudTyres`/`HudErs` (mounted on `document.body`) stay visible in shots. Hide them too?
- AT4 "cover sizeX × sizeZ" read as: `left ≤ minX + 1`, `right ≥ maxX − 1`, `top`/`bottom` likewise (aspect may add margin).

## Planner answers

- Confirmed: `qaCamera` returns `QaCameraInfo`.
- Confirmed: QA views render without post-processing.
- Hide every HUD element in QA mode, including `HudTyres` and `HudErs`.
- Confirmed: AT4 coverage reading as written (±1 m, aspect margin allowed).
