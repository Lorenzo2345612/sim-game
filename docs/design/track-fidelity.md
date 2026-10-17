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

## Wave 2 — kerb, barrier, sausage and pit clearance (245–249)

User report 2026-10-17: kerbs inside the asphalt, pit building over run-off, walls on inner kerbs, fixed-length sausages invading the track. Audit: `docs/research/track-audit-kerbs.md` (offenders and root causes). Rule of thumb: on the inside of a corner nothing lateral may pass a fraction of the corner radius (run-off already clamps at 0.9 R, `INNER_CURVE_CLAMP`).

Order: 245 and 246 are render/runtime only (no JSON rebuild). 247 then 248 rebuild every track in `public/tracks/index.json` (serialised to avoid JSON conflicts). 249 adds the checks to the QA report. Deps: 245 —; 246 [235]; 247 [240, 241]; 248 [236, 247]; 249 [237, 245, 246, 247, 248].

Shared definitions:
- `R(i)` (render side) = `cornerCurvature(centerline, i).radius` from `src/track/surfaces.ts` (export it), `inner(i, side)` = that corner's side equals `side`. Builder side uses `radii()` from `tools/track-builder/corners.ts`.
- `half(side, i)` = `halfWidthAt(track, side, i)`.
- `clearance(p)` = distance from point p (XZ) to the nearest centerline sample point (any index); `halfNear(p)` = min of both half-widths at that nearest index.
- Fixture `STADIUM(R)`: closed loop, width 12, flat elevation 0, no terrain, no runoffs/barriers/sausages unless the row adds them. Straight A from (0,0) to (200,0) sampled every 2 m (endpoint excluded); semicircle centred (200,−R) from (200,0) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m, j = 0..m−1; straight B from (200,−2R) to (0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0), same m. Direction +x then turning toward −z: every bend is a left turn, inside = left. Kerbs (when the row says "kerbs") cover every index on both sides.

### 245 Kerbs never fold over the asphalt (`src/track/surfaces.ts`)
Kerb rows where `inner(i, side)`: `outer = min(half + KERB_WIDTH, 0.9·R(i))`; if `outer − half < 0.4` the row is dropped (the strip splits). Other rows unchanged. Physics surface lookup must see the same strips (verify which function it uses; if it is not `buildTrackSurfaces`, apply the same rule there).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + kerbs | `buildTrackSurfaces` | kerb strip vertex positions identical to the pre-change build (record baseline by computing with lateral half..half+1.2) — every kerb vertex lateral offset from its row's centerline point is 6 or 7.2 (±1e-6) |
| AT2 | `STADIUM(7.5)` + kerbs | build | kerb vertices within 10 m of a bend centre ((200,−7.5) or (0,−7.5)): all at distance ≥ 0.75 − 1e-6 from that centre; at least one such vertex exists |
| AT3 | `STADIUM(7)` + kerbs | build | no kerb vertex within 6.5 m of a bend centre (inner kerb dropped in both bends); outer-side kerb rows in the bends still present (vertices at 13 and 14.2 m ± 1e-6 from the centre) |
| AT4 | `STADIUM(30)`, `STADIUM(7.5)`, `STADIUM(7)` + kerbs | build | every kerb triangle centroid has `clearance ≥ 6 − 1e-6` |
| AT5 | every track in `public/tracks/index.json` | build | every kerb triangle centroid has `clearance ≥ halfNear − 0.3` |
| AT6 | source `src/track/surfaces.ts` | read | no `from 'three'` |

### 246 Barriers never fold onto the inner kerb (`src/track/barrierPath.ts`)
For non-median vertices with `inner(i, side)`: effective offset = `min(offsetMeters, 0.8·R(i))`; if `0.8·R(i) < half + KERB_WIDTH + 0.5` the vertex is dropped. Then drop any non-median vertex with `clearance < halfNear + KERB_WIDTH + 0.5` (all indices, no `NEAR_INDEX_SPAN` exemption for this test). Runs split at dropped vertices exactly as today. Median walls (155) untouched. Colliders follow `barrierRuns` (already).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + armco both sides, offset 12 | `barrierRuns` both sides | identical to the pre-change output (vertex count and x/z/y ±1e-9) |
| AT2 | `STADIUM(30)` + left armco offset 27 | barrierRuns('left') | vertices in the bends at distance 6 ± 1e-6 from the bend centre; straight vertices at offset 27 ± 1e-6 |
| AT3 | `STADIUM(8)` + left armco offset 12 | barrierRuns('left') | no vertex with `clearance < 7.7 − 1e-6`; ≥ 2 runs; right side (offset 12 outside) unchanged vs pre-change |
| AT4 | 155 median-wall fixture (existing test) | barrierRuns | unchanged vs pre-change |
| AT5 | every track in `public/tracks/index.json` | barrierRuns both sides | every non-median vertex `clearance ≥ halfNear + KERB_WIDTH + 0.5 − 1e-6` |
| AT6 | source `src/track/barrierPath.ts` | read | no `from 'three'` |

### 247 Sausage kerbs fit the corner (`tools/track-builder/sausages.ts`, `src/track/sausages.ts`, sausage renderer/colliders)
Builder (auto sausages only; overrides keep their explicit values): `length = clamp(0.5·arcLength(run.start, run.end), 6, 20)`; `offset = half(side, index) + KERB_WIDTH + 0.6` (per-index half-widths passed in from `buildTrack.ts`, fall back to widthMeters/2); drop the sausage if `offset ≥ 0.8·radii[index]`. Render and colliders: the sausage follows the offset line instead of a straight prism — sub-segments ≤ 1 m long at constant lateral `offset` from the centerline, centred on the apex index arc position, total arc length `length` measured along the centerline. Rebuild every track (only the `sausages` field may change).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | every built track | read `sausages` | every auto sausage (not matching a config override) has `6 ≤ length ≤ 20`, `offset ≥ half(side,index) + 1.8 − 1e-6`, `offset < 0.8·radii(centerline)[index]` |
| AT2 | all built tracks together | read lengths | at least 3 distinct `length` values |
| AT3 | every built track | recompute with exported `detectCorners`/`radii` | every auto sausage `length = clamp(0.5·arcLength(run.start, run.end), 6, 20)` (±1e-6), run = the corner run whose apex is the sausage index |
| AT4 | every built track | sausage footprint samples (5 along the arc × 3 across the 0.5 m width) from the new render pose function | every sample `clearance ≥ halfNear + KERB_WIDTH + 0.1` |
| AT5 | `STADIUM(30)` + a right sausage `{index: apex of bend 1, offset 7.8, length 10}` | pose samples | every sample at lateral 7.8 ± 0.05 from the nearest centerline point; arc span 10 ± 0.5 |
| AT6 | config overrides with `lengthMeters` | build | override length kept verbatim |
| AT7 | rebuilt JSONs vs pre-task | deep compare | only `sausages` differs |

### 248 Pit building clears run-off and the pit wall
Builder: run-offs on `pit.side` are clipped out of the pit window extended 50 m (arc length) before `pit.start` and after `pit.end`, before barriers are laid (so the pit wall comes in to the verge). Pit pieces (236, `pitBuildingPieces`): near-face offset = `max(current, max pit-side barrier offset over the piece's indices + 1)`. Rebuild every track (only `runoffs`, `barriers` and derived pit data may change).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT` + right gravel runoff `{0..99, width 25}` | the builder clip function | right runoffs cover exactly indices 0..4 and 36..99 |
| AT2 | AT1 output → `layoutBarriers` | right side over 10..30 | type `wall`, offset 11 |
| AT3 | `STRAIGHT` + right barrier offset 18 over 0..99 | `pitBuildingPieces` | every piece near face at distance ≥ 19 − 1e-6 from the centerline |
| AT4 | `STRAIGHT` + right barrier offset 8 | pitBuildingPieces | identical to the pre-change output |
| AT5 | every built track | pit pieces | no footprint sample (≤ 2 m grid) inside a non-grass `buildTrackSurfaces` triangle; no `barrierRuns` vertex inside a footprint |
| AT6 | rebuilt JSONs vs pre-task | deep compare | only `runoffs`, `barriers` (and fields derived from them) differ |

### 249 QA report: clearance checks
`qaReport` adds checks `kerb`, `barrier-fold`, `sausage`, `pit-clear` with the metrics of 245 AT5, 246 AT5, 247 AT4, 248 AT5 (worst value + location in metres along the lap). Violation → `fail`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + kerbs + a left sausage `{index: 0, offset 3, length 6}` (over the asphalt); `STRAIGHT` + right gravel runoff `{0..99, width 25}` (not clipped) | qaReport each | first: `sausage` check `fail`; second: `pit-clear` check `fail` |
| AT2 | `STADIUM(30)` + kerbs, armco 12, no sausages | qaReport | `kerb`, `barrier-fold`, `sausage`, `pit-clear` all `ok` |
| AT3 | CLI `npm run track:qa -- all` | run | no `fail` among these four checks on any track |
