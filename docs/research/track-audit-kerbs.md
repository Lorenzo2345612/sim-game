# Track audit: kerbs, pit building, inner barriers, sausages

Scope: 19 built tracks in `public/tracks/*.json` (monza ... fontana-roval). Scripts: `/tmp/trackaudit/audit.ts` (all four checks), `/tmp/trackaudit/bar2.ts` (barrier proximity), raw output `/tmp/trackaudit/result.json`. Run from repo root: `npx tsx /tmp/trackaudit/audit.ts`.
Visual confirmation: `npm run track:shots silverstone` failed immediately (`window.__SIMGAME__.qaCamera is not a function`, stale dev build/harness), so everything below is geometric, not visual.

Common mechanism: kerbs, runoffs and verge are laid as lateral ribbons along the per-index normal (`rightNormal`, central difference) at constant offsets from the centerline. Nothing in the builder or `buildTrackSurfaces` checks the offset against the local corner radius for kerbs (runoff and verge do, `INNER_CURVE_CLAMP`, surfaces.ts:12/308/578), or against other track parts.

## 1. Kerbs inside the asphalt

Metric: sample the kerb at lateral half+0.02/0.6/1.18 m on every kerb row; depth = how far inside any asphalt row (own or other) the point lies. Flag > 0.3 m.

| track | kerb rows | rows > 0.3 m | worst (kerb id, side, distance-along, depth) |
|---|---|---|---|
| lasvegas | 2452 | 42 (18 far-owner) | #33 left @5107 m, 6.99 m; #10 left @2162-2173, 5.44; #5 right @1492-1504, 4.85 |
| singapore | 3109 | 24 (6 far) | #12 right @1950 m, 5.95; #18 right @2853, 2.30; #17 left @2745-3003, 2.24 |
| baku | 2189 | 11 | #4 left @598 m, 1.94; #19 right @2764, 1.02 |
| detroit | 1199 | 10 | #11 left @1338 m, 0.83; #16 @1742, 0.54 |
| fontana | 1265 | 5 | #4 left @502 m, 0.62 |
| all others (monza, spa, silverstone, bahrain, ...) | - | 0 | not reproduced |

Rows with kerb inner edge beyond the corner radius (R < half + 1.2, same side as the turn): lasvegas 21, singapore 26, baku 9, detroit 14, fontana 8, fontana-roval 9 (kerb rows exist there but no overlap above 0.3 m), bahrain 6, mexico 1. These coincide with the overlap rows.

Root cause:
- `src/track/surfaces.ts:551-552` kerb latInner/latOuter = `half`, `half + KERB_WIDTH` with no curvature cap. On the inner side of a corner with R < ~7.2 m (12 m track) the ribbon passes the centre of curvature, folds, and sweeps over the asphalt of the same corner (near-owner) or of the opposite leg of a hairpin (far-owner, lasvegas/singapore).
- `surfaces.ts:466` `exempt = asphalt || kerb` in `filterStripTriangles`: kerb triangles are never removed when they land on asphalt, unlike runoff/verge strips.
- `tools/track-builder/corners.ts:131` `detectKerbs` paints inside kerbs `[start-15, end+15]` for every run with R < `CORNER_RADIUS` (250), including radii that physically cannot hold a 1.2 m kerb beside a 12 m road; no check of R vs half-width. City centerlines have 2 m sampling and radii of 2-8 m at hairpins, so they trigger it.
- Parkland/permanent circuits show 0 overlap, so for those the report may be a different cause (satellite ground texture vs. the 12-16 m nominal width, or z-order/y-fighting, KERB_Y 0.04 vs ASPHALT_Y 0.02), not covered by this geometric audit.

Fix:
- Builder rule: drop (or split the kerb segment) for rows where side == turn side and `R(i) < half(i) + KERB_WIDTH + 0.5`; R from the 5-index radius used by `corners.ts`.
- Render guard (defence in depth): in `buildTrackSurfaces` clamp kerb latOuter to `0.9 * R` like runoff (surfaces.ts:578) and drop rows where `0.9R <= half`; remove the `kerb` exemption for triangles whose centroid is inside `asphaltOwner(margin 0.3)`.

Acceptance checks (fixtures: hairpin with centerline R 4 m and R 30 m, width 12; plus built `lasvegas`, `singapore`, `baku`, `detroit`, `fontana`):
- For every kerb row and sample f in {0.02, 0.5, 0.98}: asphalt depth <= 0.3 m; count of violating rows == 0 on all built tracks.
- No kerb row where side == turn side and R < half + 1.2.
- Hairpin R 4 m: kerb ribbon vertices all satisfy lateral <= 0.9 R.

## 2. Pit building overflowing onto run-off

Metric: per pit row, building near face = `widthMeters/2 + 10` vs outer extent of asphalt + kerb + widest runoff on the pit side. Overlap = extent - face (> 0.3 m).

| track | pit rows | overlapping rows | worst overlap | surface | barrier inside building footprint (rows) |
|---|---|---|---|---|---|
| silverstone | 127 | 127 (all) | 27.6 m @5858 m | gravel | 101 |
| lusail | 180 | 81 | 22.4 m @5231 | gravel | 74 |
| detroit | 148 | 32 | 21.3 m @94 | runoff | 0 |
| fontana | 110 | 59 | 20.8 m @80 | runoff | 25 |
| cleveland | 280 | 25 | 11.0 m @3246 | gravel | 3 |
| spa | 191 | 6 | 9.2 m @6702 | gravel | 6 |
| others (13) | - | 0 | - | - | - |

Root cause: `src/render/pitAndStart.ts:72` `near = track.widthMeters / 2 + EDGE_OFFSET` (10 m) is a constant; the building is a straight box from the chord start->end at `near..near+depth` (pitAndStart.ts:107). The builder (`tools/track-builder/buildTrack.ts` pit block, `barriers.ts:33`) places the pit-side `wall` barrier at `half + kerb + runoffWidth + 1` ignoring the building, and the runoff detection (`corners.ts` gravel extents/fallback) ignores the pit window. So the box lies inside the runoff band and the wall ends up behind or inside it. Also ignores per-index `halfWidth`.

Fix:
- Builder: no runoffs on the pit side inside the pit window (clip `runoffs` against `pit.start..end` + 20 index margin on `pit.side`, or cap their width to `<= EDGE_OFFSET - 1`), then `layoutBarriers` produces the wall at about half+5 and the building behind it.
- Render: `near = max(half + 10, barrierOffset(pit side, max over pit rows) + 1)` computed per pit window, so the building always sits behind the pit wall.

Acceptance checks:
- For all pit rows: building near face >= max(asphalt+kerb+runoff outer extent) + 1 m (overlap rows == 0 on all built tracks).
- Pit-side barrier offset over the pit window < building near face (0 rows with barrier inside footprint).
- Fixture: straight 400 m, runoff width 25 on pit side across the pit window -> builder output has no runoff there or the face offset >= 26 m.

## 3. Walls/barriers on the inner kerb of corners

Findings (barrier vertices from `barrierRuns`):
- Barrier vertices closer to the centerline than their nominal offset by > 2 m (inside of tight corners, the offset line folds toward the track): singapore 186, fontana 146, lasvegas 102, detroit 90, fontana-roval 80, mexico 79, sepang 75, baku 65, cleveland 64, bahrain 49, others 0-34 (lusail, elkhart: 0). Typical: offset 27 m in an R 10-20 m corner puts the fold 8 m from the centerline, i.e. 1.5 m from the kerb outer edge.
- Vertices within 1.5 m of a kerb outer edge: detroit 19, bahrain 7, baku 6, lasvegas 5, singapore 5, fontana 4, spielberg 4, cleveland 1. Nearly all are far-index neighbours (the fold of the same corner hits the kerb of the other leg). Barrier vertices on bare asphalt: 0 (the 0.3 m drop test works).
- Barrier minimum nominal gap to kerb outer edge is always >= 4.8 m, so layout itself is not the culprit; the fold is.
- Worst: bahrain left @2578-2594 (armco 13.5 m offset, R 8.2, dist 0.12 m to kerb), detroit left @1740 (armco 12 m, R 4, 0.18 m), spielberg right @1340 (tyres 23.5 m, 0.16 m), baku left @602 (wall, 0.62 m).

Root cause:
- `tools/track-builder/barriers.ts:33-36` offset = half + kerb + (runoff or `VERGE_WIDTH`) + `BARRIER_GAP`, never capped by the corner radius; `src/track/barrierPath.ts:61-71` `vertexAt` places each vertex at `offsetMeters` along its own normal. `surfaces.ts` caps verge/runoff at 0.8-0.9 R but the barrier is not, so on the inner side the barrier polyline crosses the corner centre and loops back over the kerb.
- `barrierPath.ts:93-106` `crossesTrack` only drops vertices within `halfWidthAt + 0.3` of a far index centerline point: kerb band (half .. half+1.2) is not protected, and `NEAR_INDEX_SPAN = 5` exempts the own corner.

Fix:
- Builder: on the inside of a corner (side == turn side) cap `offset <= 0.8 R(i)`; where `0.8 R < half + KERB_WIDTH + 1`, omit the barrier (hairpin inner side has no barrier) and split the run.
- `crossesTrack`: use reach `halfWidth + KERB_WIDTH + 1.0` and also test near indices when the vertex is closer to the centerline than 0.8 x offset.

Acceptance checks:
- For all barrier vertices: distance to the nearest centerline point >= offset - 0.5 m (closer-than-nominal count == 0), or vertex dropped.
- Distance from any barrier vertex to any kerb outer edge point >= 1.5 m (0 offenders).
- Fixture: hairpin R 6 m, width 12, barriers on the inner side: no vertex with dist(centerline) < half + KERB_WIDTH + 1.

## 4. Sausage kerbs: fixed length and invasion

Findings: all 148 sausages across the 19 tracks have `length: 6` (lengths set = {6}), offset = `widthMeters/2 + 1.2 + 0.6`, independent of local radius and of corner/kerb length (corner runs 12-88 m, kerb segments 88-412 m). `tracks.json` has no sausage overrides.

Sausages whose 6 x 0.5 m footprint overlaps asphalt (depth in m):

| track | sausages | overlapping > 0.1 m | worst |
|---|---|---|---|
| lasvegas | 10 | 5 | 6.95 m @5103 m (R 2) ; 2.5 @2168 ; 4.29 @1960 |
| singapore | 36 | 7 | 2.04 @522 (R 2) |
| detroit | 7 | 3 | 1.94 @2230 (R 5); 1.21 @2344 |
| fontana | 14 | 2 | 1.83 @500 (R 6); 1.37 @522 |
| baku | 9 | 1 | 1.25 @2766 (R 3) |
| fontana-roval | 12 | 3 | 0.85 @1414 |
| mexico | 13 | 1 | 0.42 @2070 |
| others (12) | - | 0 | - |

Root cause:
- `tools/track-builder/sausages.ts:8` `SAUSAGE_LENGTH = 6`, applied at :102 and :109; no relation to the chicane/corner run length or to the kerb it should replace.
- `sausages.ts:92` `offset = widthMeters/2 + KERB_WIDTH + CLEARANCE` uses nominal width, not `halfWidth` per index, and ignores curvature: for R < offset (hairpin/apex R 2-6 m on city layouts) the point lies past the centre of curvature, over the opposite leg. `detectChicanes` threshold is R < 80 m, so many "chicanes" are hairpins.
- Render (`src/track/sausages.ts:30-48` `sausagePose`, `sausageRenderer.ts`) draws a straight prism tangent at the apex index; on R 10 m the ends deviate toward the track by `3^2 / (2 (R - offset))` or more.
- The kerb (`detectKerbs`) already overlays the same inside; the sausage is positioned 0.6 m outside the kerb outer edge with no check that kerb exists there (all 148 do have a kerb, so no floating cases).

Fix:
- Builder: length = clamp(arc length of the run where R < 80, 6, 20) (or 0.5 x chicane run); apply per-run, drop the sausage if `offset >= 0.8 R(apexIndex)` and shift to `half(i) + KERB_WIDTH + 0.6` using `halfWidthAt`.
- Optional: generate the sausage as a polyline of per-index poses (curved, follows the offset line) instead of a straight prism.

Acceptance checks:
- For each sausage: footprint samples (5 along x 3 across) have asphalt depth <= 0 (0 overlaps on all built tracks).
- `offset >= halfWidth(index) + KERB_WIDTH + 0.5` and `offset <= 0.8 R(index)` for all sausages, or sausage absent.
- Length is not constant: fixture chicane with run length 40 m yields length > 6 and <= 20; length <= run length.
