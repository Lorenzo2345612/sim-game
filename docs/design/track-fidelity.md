# Track fidelity (milestone M1.11) — planner design, Opus

User report 2026-10-16: every track looks wrong — floating grandstands, sunk pits, wrong colours, odd run-offs; Monza "nothing like Monza". Priority over the content roadmap.

## Diagnosis (probe `/tmp/probe/ground.py`, 19 tracks with terrain)

- Grandstands, track props and distance boards take the centerline elevation (`nearestElevation`, `track.elevation[i]`), not the terrain under them. Stand footprints differ from that by up to −27.5/+15.7 m (daytona), ±4–9 m on braselton, fontana, sepang, spa.
- Barriers use the track plane at their offset: terrain differs by up to 11.3 m (daytona), 5–9 m on braselton, budapest, fontana, sepang, spielberg.
- The pit building is one chord box from `pit.start` to `pit.end`, sunk to the lowest sample − 0.3 m.
- Every track has exactly 3 config grandstands at ~36 m from the centerline; none come from real data. OSM area files exist for 18 tracks and hold only grass, sand/gravel and barriers.
- Style colours were written by workers without references (time budget forbade research). Run-off surfaces are heuristic (`hazards.ts`, `corners.ts`), OSM only for gravel.
- Tests check data, never the rendered result.

## Plan

Wave 1 (this file, tasks 233–238): one ground sampler; every placed object grounded (top on the highest ground of its footprint, plinth/post down to the lowest); pit building follows the pit lane; a QA report and a QA screenshot tool.
Wave 2 (after wave-1 QA output): OSM features v2 fetch for all tracks (grandstands, buildings, pit lane, paved run-off areas; planner-side data, Sonnet); builder places stands and pit from OSM with config fallback; run-off surface from OSM + Sentinel ground texture classification (planner probe first); style colours from a referenced research note per track (Sonnet research, worker applies).

Wave 2 user requirements (2026-10-17): pit lane road missing on every track (build it from OSM `pit_lane`); barrier type and distance per track (concrete walls close to the track on street circuits, not guardrail + grass everywhere; from OSM `barrier` + satellite); grandstands must never overlap the track surface (hard rule: builder pushes or drops any stand with clearance < 2 m, 237 reports it); grandstand shape follows the OSM polygon (curved/arc stands and stadium sections such as the Mexico City stadium section, not only straight boxes; Mexico has 26 OSM grandstand polygons).
Gate: a track is done only after `npm run track:qa` has no fail and the planner reviewed `track:shots` against the satellite image (skill `track-qa`, to write).

## Shared rules

- `groundHeightAt` = terrain height when the track has `terrain`, else the track-plane height at the nearest centerline point (current `nearestElevation` of `src/main.ts`, banking included).
- Grounding rule for any object with a footprint: `baseY` = max ground over the footprint, `plinthBottom` = min ground − 0.05. The object stands on `baseY`; a plinth/post fills from `plinthBottom` up to `baseY` when the gap > 0.1 m.
- Line objects (barriers, board posts) keep their current `y` and extend: bottom = `min(y, ground)`, top = `max(y, ground)` + their height.
- Local frame = three.js `rotation.y = yaw`: local (lx, lz) → world (x + lx·cos yaw + lz·sin yaw, z − lx·sin yaw + lz·cos yaw).

## Fixtures (tests)

- `RAMP` terrain: `{originX: 0, originZ: 0, sizeX: 200, sizeZ: 100, cols: 20, rows: 10}`, vertex (col j, row i) at x = −100 + 10j, z = −50 + 10i, height 0.1·x, heights column-major `j*(rows+1)+i`.
- `FLAT(h)` terrain: same grid, every height `h`.
- `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers, pit `{start: 10, end: 30, side: 'right'}`, no terrain unless the row adds one.
- `LINE`: centerline `[−90 + 2i, 0]`, i = 0..90, widthMeters 12, elevation[i] = 0.1·x_i, no banking, terrain `RAMP`.
- `ARC`: centerline point i = `[200·cos(2πi/200), −200·sin(2πi/200)]`, i = 0..199, widthMeters 12, flat elevation 0, no terrain, pit `{start: 0, end: 50, side: 'right'}` (with `rightNormalAt` = [−dz, dx] this side is the outside).

## 233 Ground sampler (`src/track/ground.ts`)

`terrainHeightAt(t: Terrain, x, z): number` (bilinear, clamped to the grid, same as `makeTerrainY`); `groundHeightAt(track: TrackDataV2, x, z): number`; `footprintGround(track, x, z, yaw, xMin, xMax, zMin, zMax, step = 2): { min: number; max: number }` (grid of samples with spacing ≤ step, edges and corners included). `main.ts` (`makeTerrainY`, `nearestElevation`) and `pitAndStart.ts` (`terrainY`) import these instead of their own copies.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `RAMP` | `terrainHeightAt` at vertex j = 3, i = 4 (x −70, z −10) | −7 (±1e-9) |
| AT2 | `RAMP` | at (5, 7) | 0.5 (±1e-9) |
| AT3 | `RAMP` | at (500, 0) and (−500, 0) | 10 and −10 (clamped, ±1e-9) |
| AT4 | `STRAIGHT` with elevation[i] = 0.5·i, no terrain | `groundHeightAt(track, 40, 3)` | 2.0 (±1e-9) |
| AT5 | `LINE` (terrain `RAMP`) | `groundHeightAt(track, 5, 7)` | equals `terrainHeightAt(RAMP, 5, 7)` (±1e-12) |
| AT6 | `LINE` | `footprintGround(track, 0, 0, 0, −10, 10, 0, 10)` | `{min: −1, max: 1}` (±1e-9) |
| AT7 | `LINE` | same with yaw = π/2 | `{min: 0, max: 1}` (±1e-9) |
| AT8 | `LINE` | `footprintGround(track, 0, 0, 0, 10, −10, 0, 10)` | throws `RangeError` |
| AT9 | sources | read `src/main.ts`, `src/render/pitAndStart.ts`, `src/track/ground.ts` | main.ts has no `function makeTerrainY` / `function nearestElevation`; pitAndStart.ts has no `function terrainY`; both import from the ground module; ground.ts has no `from 'three'` |

## 234 Grounded grandstands and track props

`src/track/placement.ts`: `GRANDSTAND_ROW_DEPTH = 0.9`; `grandstandFootprint(g): { xMin, xMax, zMin, zMax }` = `[−L/2, L/2] × [0, rows·0.9]`; `groundedBase(track, x, z, yaw, fp): { baseY: number; plinthBottom: number }` per the grounding rule. `createGrandstand(g, loadTexture?, style?, plinthHeight = 0)` adds a box `standPlinth` over the footprint from local y = −plinthHeight to 0 when plinthHeight > 0.1. main.ts puts each stand (config and style `extraGrandstands`) at `baseY` with `plinthHeight = baseY − plinthBottom`. `createTrackProps` places every prop except `footbridge` at its `baseY` (footprint from `footprintOf`, local x along the tangent, z outward in [0, depth]) and adds a plinth part under it with the same rule.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | g `{lengthMeters: 60, rows: 10}` | `grandstandFootprint(g)` | `{xMin: −30, xMax: 30, zMin: 0, zMax: 9}` (±1e-9) |
| AT2 | `LINE`, g `{x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10}` | `groundedBase(track, 0, 0, 0, grandstandFootprint(g))` | `{baseY: 1.0, plinthBottom: −1.05}` (±1e-9) |
| AT3 | g `{x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10, roof: false}` | `createGrandstand(g, stub, undefined, 2.05)` | child `standPlinth` exists; its world bbox x [−10, 10], y [−2.05, 0], z [0, 9] (±1e-6) |
| AT4 | same | `createGrandstand(g, stub, undefined, 0.05)` and with plinthHeight omitted | no `standPlinth` child |
| AT5 | every `public/tracks/<id>.json` with `terrain` (skip `*.style.json`, index) | for each grandstand, `groundedBase` | `baseY` ≥ `terrainHeightAt` at the 4 footprint corners and centre − 1e-6; `plinthBottom` ≤ each of those − 0.05 + 1e-6 |
| AT6 | source `src/main.ts` | read | uses `groundedBase(` for grandstands; no `nearestElevation(` call left |
| AT7 | `LINE`, style props `[{type: 'tent', index: 45, side: 'right', offsetMeters: 10, lengthMeters: 10}]` | `createTrackProps(track, style)` | merged prop geometry world bbox min y = −0.55 (±1e-4) (tent spans x −5..5: max ground 0.5, min −0.5) and the tent roof is above y 0.5 + 0.5·heightMeters |
| AT8 | `LINE` with terrain `FLAT(0)` and elevation 0, same prop | create | bbox min y = 0 (±1e-4): no plinth below ground |

## 235 Barriers and distance boards reach the ground

`BarrierVertex` gains `ground: number` = `groundHeightAt(track, x, z)` (equals `y` when the track has no terrain). Colliders (`src/physics/trackColliders.ts`) and barrier render (`createBarrierObject`) span bottom = `min(y, ground)` + their current bottom offset to top = `max(y, ground)` + their current top offset; foam blocks sit at `max(y, ground)`. Distance boards: face at `max(y, ground)` + `FACE_CENTRE_Y`, post from `min(y, ground)`.
Fixture `WALLED(h)`: `STRAIGHT` with barriers `[{start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8}]`, terrain `FLAT(h)` re-centred on the track (`originX: 495, sizeX: 1100, sizeZ: 200`), boards `[{index: 50, side: 'right', offset: 8, label: 100}]`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `WALLED(−3)` | `barrierRuns(track, 'right')` | every vertex `y` 0, `ground` −3 (±1e-9) |
| AT2 | `STRAIGHT` + same barriers, no terrain | barrierRuns | every vertex `ground === y` |
| AT3 | `WALLED(0)` baseline collider vertices min/max y = (b0, t0) | build colliders for `WALLED(−3)` and `WALLED(2)` | −3: min y = b0 − 3, max y = t0; +2: min y = b0, max y = t0 + 2 (±1e-5) |
| AT4 | same three fixtures | `createBarrierObject` world bbox y | −3: min = baseline min − 3, max = baseline max; +2: min = baseline min, max = baseline max + 2 (±1e-4) |
| AT5 | same three fixtures | `createDistanceBoards` face instance y | −3: equal to baseline; +2: baseline + 2 (±1e-5); post instance spans down to min(0, h) |
| AT6 | every `public/tracks/<id>.json` with terrain | barrierRuns both sides | every vertex `ground` = `terrainHeightAt(terrain, x, z)` (±1e-9) |

## 236 Pit building follows the pit lane

`pitBuildingPieces(track, style?): PitPiece[]` in `src/track/placement.ts`, `PitPiece = { x, z, yaw, length, depth, baseY, plinthBottom }`. Walk the pit range (start..end, wrapping) along the pit-side offset polyline at `halfWidthAt(side) + 10` (current `EDGE_OFFSET`); start a new piece when the heading turned more than 8° since the piece start; each piece is the chord box between its end points, depth = style `pitBuilding.depthMeters`, grounded by the grounding rule; pieces shorter than 6 m merge into the previous one. `createPitBuilding` renders every piece (facade, doors, roof, accent per piece) at its `baseY` with a plinth from `plinthBottom`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT`, default style | `pitBuildingPieces` | 1 piece, length 200 (±1e-6), depth 8, centre x 200 (±1e-6), centre z on the right side at 6 + 10 + 4 = 20 from the centerline (±1e-6) |
| AT2 | `ARC` | pieces | count ≥ 11; each piece's heading change ≤ 8° + 1e-6; for every piece the midpoint of its near (track-side) edge is ≥ 6 + 9.4 from the centerline (no overlap with the track, sagitta allowance) |
| AT3 | `ARC` | pieces | sum of piece lengths within 2 % of the offset arc length between start and end |
| AT4 | `LINE`, pit `{start: 20, end: 70, side: 'right'}` | pieces | each piece `baseY` = max and `plinthBottom` = min − 0.05 of `footprintGround` over its box (±1e-9) |
| AT5 | `STRAIGHT`, default style | `createPitBuilding` | building meshes: one facade per piece; group world bbox min y ≥ −0.06 (no 0.3 m sink) |
| AT6 | every `public/tracks/<id>.json` | pieces | at least 1 piece; every piece length ≥ 6 m or it is the only piece (overlaps with other track parts are reported by 237, not tested here) |

## 237 Track QA report (`tools/track-qa/report.ts`, `npm run track:qa -- <id|all> [--out dir]`)

`qaReport(track: TrackDataV2, osmWays: { ways: { coords: [number, number][] }[] } | null, origin: LonLat): QaReport` with `stands: { index, clearance, relief }[]`, `pit: { clearance, relief }[]` (per piece), `layout: { rmsMeters, maxMeters } | null`, `barrierMaxGap: number` (max |y − ground| over barrier vertices), `checks: { name, level: 'ok' | 'warn' | 'fail', detail }[]`. Clearance = 0 if any footprint sample (2 m grid) lies inside a non-grass surface strip triangle (`buildTrackSurfaces`, XZ; `surface` asphalt, kerb, runoff, gravel), else the min distance from the samples to strip vertices. Relief = footprint max − min. Checks: stand or pit clearance < 2 → fail; relief > 3 → warn; layout rms > 5 → warn, > 15 → fail (layout = distance from each centerline point to the nearest OSM way polyline, projected with `projectLonLat` at `origin`). CLI: origin = `bboxCenter` of the track's geojson (via `tools/track-builder/tracks.json`), ways from `assets/source/osm/<id>.json` (missing → null); writes `<out>/<id>.json` (default `.ai/qa`), prints `<id> ok|warn|fail <n fails>` per track, exit 1 if any fail.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT` + grandstand `{x: 100, z: 40, yaw: 0, lengthMeters: 20, rows: 10}` | `qaReport(track, null, [9, 45])` | stands[0].clearance = 34 (±0.5); no fail check for it; layout null |
| AT2 | `STRAIGHT` + grandstand at `z: 3` | qaReport | stands[0].clearance 0; a check with level `fail` whose name contains `stand` |
| AT3 | `STRAIGHT`, ways = the centerline unprojected at origin [9, 45] (`unprojectXZ`) | qaReport | layout.rmsMeters < 0.01 |
| AT4 | ways shifted 10 m (every point z − 10 before unprojecting) | qaReport | layout.rmsMeters 10 (±0.1); a `warn` layout check, no layout fail |
| AT5 | `WALLED(−3)` | qaReport | barrierMaxGap 3 (±1e-6) |
| AT6 | CLI `npm run track:qa -- monza --out <tmp>` | run | `<tmp>/monza.json` parses with keys id, stands, pit, layout, barrierMaxGap, checks; stdout has a line starting `monza ` |
| AT7 | source `tools/track-qa/report.ts` | read | no `from 'three'` |

## 238 Track QA screenshots (`npm run track:shots -- <id>`)

`__SIMGAME__.qaCamera(view: 'top' | { eye: [x, y, z]; target: [x, y, z] } | null)`: `'top'` switches to an orthographic camera looking straight down whose frustum covers the terrain bounds (or the centerline bbox + 100 m without terrain), the HUD root hidden; a view object sets a perspective camera (fov 60) at eye looking at target, HUD hidden; `null` restores the chase camera and HUD. Pure `qaViews(track, count): { name, eye, target }[]` in `src/track/qaViews.ts`: `start` (eye 30 m behind index 0 on the centerline, 6 m above, target index 0) plus the `count` corners of highest curvature (curvature over a ±10 m window, apexes ≥ 150 m apart), each eye 40 m back along the centerline and 15 m to the outside, 8 m above `groundHeightAt`, target = apex at its elevation. Script `tools/track-qa/shots.ts` (Playwright, swiftshader, `?track=<id>&quality=low`, screenshot timeout 180 s) writes `.ai/qa/<id>/top.png`, `top-sat.png` (top blended 50/50 with `public/textures/ground/<id>.jpg` resized to the same frame with `sharp`, skipped when no texture) and `<name>.png` per view (count 6).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `ARC` | `qaViews(track, 0)` | exactly 1 view `start`; eye 30 m from centerline[0] (±0.5) along −tangent, eye y 6 (±1e-6) |
| AT2 | `STRAIGHT` with a 90° corner inserted (fixture built in the test: 50 points along +x, a radius-30 quarter arc, 50 points along +z, closed by a far loop) | `qaViews(track, 1)` | the corner view's target within 5 m of the arc midpoint |
| AT3 | any track | `qaViews(track, 6)` | ≤ 7 views; corner apexes pairwise ≥ 150 m apart along the lap |
| AT4 | e2e `?track=monza&quality=low` | `qaCamera('top')` then render | active camera is orthographic; `left/right/top/bottom` cover the terrain sizeX × sizeZ (±1 m); HUD root `display: none` |
| AT5 | e2e same page | `qaCamera(null)` | chase camera active again, HUD visible |
| AT6 | sources | read `src/track/qaViews.ts` | no `from 'three'` |

### 240 — Smooth bank transitions on ovals

User (2026-10-17): the transition between banked and flat sections on ovals is far too abrupt. Cause: `bankProfile` (tools/track-builder/banking.ts) ramps linearly over a fixed 60 m centred on each range boundary, so Daytona goes 0 → 31° in 60 m (0.52°/m) with a slope kink at both ends.

Rule (auto mode, used by the builder): when `bankProfile` is called without the 4th argument, each range gets its own ramp `R = max(60, 7.5·|degrees|)` m (peak rate 0.2°/m with smoothstep), placed **inside** the range (full bank from `from + R` to `to − R`; zero at `from` and `to`), eased with smoothstep `f = u²(3 − 2u)`. If `2R` exceeds the span, `R = span/2`. Overlaps: larger magnitude wins (unchanged). An explicit 4th argument keeps today's behaviour exactly (linear, centred), so the existing 174 unit tests that pass `60` are unchanged. The builder calls auto mode; rebuild daytona, fontana, fontana-roval JSONs.

Fixtures: `cum = [0, 1, …, 4999]`, length 5000; range A = `{from 1000, to 2000, degrees 31, right}`; range B = `{from 3000, to 3100, degrees 31, right}`; range C = `{from 4000, to 4500, degrees 2, left}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | A, auto | bankProfile | bank[1500] = 31° ± 1e-9; bank[1000], bank[2000], bank[999], bank[2001], bank[500] = 0 ± 1e-12; bank[1000 + 232.5 rounded up = 1233] = 31° ± 1e-9 |
| AT2 | A, auto | consecutive differences over all i | max \|bank[i+1] − bank[i]\| ≤ 0.2° · 1.01 |
| AT3 | A, auto | second differences | at i = 1000 and i = 1233: \|bank[i+1] − 2·bank[i] + bank[i−1]\| ≤ 0.003° (no kink; a linear ramp gives 0.13°) |
| AT4 | A, auto | value at the ramp midpoint i = 1116 | 15.5° ± 0.3° |
| AT5 | B, auto (span 100 < 2R) | bankProfile | all finite; peak at i = 3050 equals 31° ± 1e-9 (R = 50); bank[3000] = bank[3100] = 0 |
| AT6 | C, auto | bankProfile | sign negative inside; R = 60: bank[4060] = −2° ± 1e-9; max step ≤ 1.5·2°/60 · 1.01 |
| AT7 | A with explicit `60` | bankProfile | identical to the pre-change linear centred result (bank[1000] = 15.5°, bank[970] = 0, bank[1030] = 31°) |
| AT8 | rebuilt daytona, fontana, fontana-roval JSON | per-metre bank change along the centerline (Δbank / Δs between consecutive points) | ≤ 0.2°/m · 1.05 everywhere; max \|bank\| = 31° / 11° / 14° ± 0.1° respectively |
| AT9 | — | 174 acceptance and edge tests | pass, with only the planner-authorised edit below |

Planner-authorised edit for 240: in `tests/unit/acceptance/174-track-banking.test.ts` the full-bank check margin `wrapMargin(...) < 60` (and its message "at least 60 m") becomes `< 240` / "at least 240 m" (ramps now lie inside the ranges and reach 232.5 m for 31°).
