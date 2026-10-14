# Paved run-off and energy-absorbing barriers (Monza, Spa, Silverstone)

Follow-up to `osm-runoff.md`. Overpass queried 2026-10-13 (overpass-api.de; bbox = track bbox + 0.002 lat / 0.003 lon). Raw output (untrusted, git-ignored): `.ai/scratch/osm-runoff2/{monza,spa,silverstone}.json`. Query set: `area:highway`, `highway=raceway`, `raceway=*`, `surface=asphalt|paved|concrete`, names matching escape/fuga/runoff/bus stop, `landuse`, `leisure`, `barrier`, `crash_barrier`, `material`, `description|note` matching tec/foam/tyre/tire/run, `natural=sand|shingle`. Lateral distance = min distance of polygon/way vertices to `public/tracks/<id>.json` centerline, projection = `projectLonLat` with `bboxCenter` of the source geojson (same as the track builder). "near" = within 60 m.

## 1. What OSM has

| Tag | Monza | Spa | Silverstone |
|---|---|---|---|
| `area:highway=*` | 0 | 0 | 0 |
| `crash_barrier=*` | 0 | 0 | 0 |
| tyre / TecPro / foam in any tag (`barrier`, `material`, `description`, `note`) | 0 | 0 | 0 |
| `material=*` on a barrier | `metal` (chain-link fences, 3 near) | `concrete` x1 (126871646, 4 m), `metal` x1 | `metal` x2 (far) |
| `barrier=guard_rail` near | 6 | 5 | 3 |
| `barrier=wall` / `retaining_wall` near | 6 / 0 | 62 / 5 | 45 / 0 |
| `barrier=fence` near | 13 | 48 | 76 |
| `barrier=kerb` near | 0 | 0 | 1 |
| `highway=raceway` + `area=yes` | 1 (1238685998, 72-104 m away, not run-off) | 0 | 0 |
| closed `surface=asphalt\|paved` polygons within 60 m | 0 (only parking 47+ m and `Podio` concrete 7-18 m) | 0 (parking aisles) | 1 (559444577, 30-98 m, parking) |
| `highway=raceway` ways within 3 m of centerline (main layout, named corners) | 35 | 35 | ~40 |
| `highway=raceway` ways that are alternatives or off-line (>= 8 m) | motorcycle chicane 38168756, `Raccordo Junior`, `Sopraelevata` (draft), `Ex Circuito Pirelli`, pit lane | `Kart` (23-138 m), `Moto layout`, `Support Pit Lane` | other layouts (`Stowe Circuit`, `Limestone Curves`), pit lanes |
| `raceway=escape\|runoff\|service`, name with escape / via di fuga | 0 | 0 | 0 |
| gravel/sand polygons within 60 m (from earlier doc) | 10 `natural=sand` | 8 gravel + 18 shingle ways, `note=Run-off area` | 18 `natural=sand` + 2 shingle |
| `landuse=grass` near | 12 | 54 | 82 |

Findings:

- No paved run-off or escape road is mapped anywhere (no `area:highway`, no `raceway=escape`, no named polygon). The only asphalt polygons near the track are parking lots, so the asphalt run-offs at Monza T1/Roggia, Spa La Source/Bus Stop and Silverstone (Copse, Stowe, Abbey) are not extractable from OSM.
- No barrier carries a TecPro, foam or tyre tag. Barrier kinds are only wall/fence/guard_rail/retaining_wall; many are spectator or property fences. Nothing distinguishes safety barriers.
- Useful by-products: corner names and exact apex positions. `highway=raceway` ways are split per corner and named (Monza: Variante del Rettifilo, Curva Biassono, Lesmo 1/2, Variante della Roggia, Curva Alboreto, Variante Ascari; Spa: La Source, Eau Rouge, Raidillon, Les Combes, Bruxelles, Courbe Paul Frere, Chicane (Bus Stop); Silverstone: Copse, Maggotts, Becketts, Chapel, Stowe, Vale, Club, Abbey, Luffield, Woodcote, Brooklands). Monza has two Variante del Rettifilo ways: 179968242 (note "Used only for cars races") and 38168756 (motorcycle variant), both within 8 m of the built centerline. These names can seed the per-track override list and corner labels.
- Gravel polygons do line up with the known gravel traps (earlier doc: 11/11 Monza corners, 11/20 Spa, 14/16 Silverstone). They are the only run-off type OSM provides, and where the real run-off is asphalt (Monza T1 exit, Spa La Source) OSM shows nothing or a gravel patch at the far end only.
- The current build already contains OSM-derived or fallback gravel (`RunoffSegment.surface: 'gravel' | 'runoff'`) and tyre/armco/wall barriers. Heavy-braking corners are not treated differently from other corners: the outside run-off is a constant 18 m gravel plus 26 m tyres (Spa), and at several Silverstone heavy corners there is none (below).

Current build at heavy-braking outside edges (indicative speed profile, see section 2; outside = opposite side to the turn; window = 30 samples before apex to 5 after):

| Track | s (m) | Corner (OSM name) | R (m) | Entry drop (km/h) | Outside run-off now | Outside barrier now |
|---|---|---|---|---|---|---|
| Monza | 622 | Variante del Rettifilo | 12 | 187 | gravel 15 | armco 11-12 / tyres 23 |
| Monza | 3642 | Roggia/Vialone | 22 | 169 | gravel 15 | armco 11 / tyres 22 |
| Monza | 3826 | Ascari | 38 | 50 | gravel 14 | armco 11-12 / tyres 21 |
| Spa | 240 | La Source | 13 | 177 | gravel 18 | tyres 26 |
| Spa | 6588 | Bus Stop chicane | 14 | 182 | gravel 18 | tyres 26 |
| Spa | 2850 | Bruxelles | 39 | 109 | gravel 18 | armco 12 / tyres 26 |
| Silverstone | 2690 | Vale | 19 | 147 | gravel 8 | armco 11 / tyres 15 |
| Silverstone | 3948 | Village | 23 | 116 | gravel 38 | armco 11 / tyres 45 |
| Silverstone | 4090 | The Loop | 20 | 73 | none | armco 11 |
| Silverstone | 882 | Maggotts/Becketts | 37 | 66 | none | armco 11 |

Silverstone has 5 corners with drop >= 50 km/h and no outside run-off at all; Monza and Spa heavy corners are all gravel only. Elevation is ignored by the profile, so uphill/downhill corners (Eau Rouge/Raidillon) are over-estimated.

## 2. Proposed deterministic rules

Inputs, all derivable from the track data: `R` (min radius of the corner run, `radii()` in `tools/track-builder/corners.ts`), `side` (turn side; outside = opposite), `drop` = entry speed minus corner speed from the task 088 speed profile (`cornerSpeed = sqrt(muLat g / (k - muLat aeroK))`, brake pass with friction circle), `brakeLen` = distance of the backward pass between the entry peak and the apex, current barrier `offsetMeters`.

For this research a simplified profile was used (muLat = muLong = 1.5, brake 0.9 mu g, vMax 65 m/s, accel min(7, 200/v)). Counts of corners with drop >= 40 / 70 / 100 km/h: Monza 3/2/2, Spa 7/5/5, Silverstone 8/6/3. Replace with the real 088 profile when building.

| Feature | Rule | Output |
|---|---|---|
| Heavy-braking corner | `drop >= 70 km/h` (about 20 m/s) and `R < 120 m` | gets paved run-off + foam |
| Medium-braking corner | `40 <= drop < 70 km/h` | gravel (OSM or 18 m) + tyres, as now |
| Paved run-off width | `w = clamp(10 + 0.10 * drop_kmh, 10, 30)`, rounded to 0.5 m. Examples: drop 70 -> 17 m; 120 -> 22 m; 187 -> 28.7 m | `RunoffSegment{surface:'runoff', side: outside, widthMeters: w}` |
| Paved run-off span | from `runStart - 25 samples` (50 m before turn-in) to `runEnd + 10 samples`; at least 30 m long | same segment |
| Gravel behind it | none for heavy corners; if an OSM gravel polygon overlaps the span keep it as an 8 m strip beyond the asphalt | optional |
| Precedence | paved rule replaces the gravel fallback for heavy corners; OSM gravel kept for all others; per-track override list (by `s`) beats every rule | |
| Per-track overrides | list `{atMeters, side, surface, widthMeters}` for known cases (Monza T1 left asphalt 30 m, Spa La Source outer asphalt 25 m, Silverstone Copse) | |
| Escape road (chicane) | detect chicane = two consecutive corner runs with opposite sides, gap between runs < 120 m, both `R < 80 m` (hits Rettifilo, Roggia, Ascari, Bus Stop; Silverstone Vale/Chapel excluded when `R >= 80`). Path: `A` = centerline sample 10 before run 1 start, `T` = tangent at `A`, `B` = centerline at run 2 end, `K = A + T * dot(B - A, T)`; polyline `A -> K -> B` | asphalt strip 8 m wide, `RunoffSegment` on the outside of run 1 (chord side), rejoin taper 15 deg between `K` and `B`; barriers on both sides of the strip (foam on the near-`K` end) |
| Barrier type for heavy corner | outside edge of the paved run-off: `foam` (see below) over `runStart - 15 samples .. runEnd`; behind it `armco` continues | new `BarrierSegment.type = 'foam'` |
| Foam rule (without paved) | `drop >= 40 km/h` and barrier `offsetMeters < 20` on the outside: use `foam` instead of `tyres`/`armco` there (Silverstone Maggotts/Chapel/Loop, offset 11) | `foam` |
| Tyre wall rule | keep `tyres` where gravel run-off exists and `drop < 70`; also at the far end of gravel as today (offset = edge + gravel + 1 m) | `tyres` |
| Armco | straights, sweepers `R >= 120`, inside of corners, and behind foam | `armco` |
| Barrier offset for foam | `half + kerb + w + 1 m` (same formula as `layoutBarriers` with the paved width) | |

Corner-side convention: runoffs/barriers use `rightNormal`, so side `left`/`right` is the car's left/right when travelling in track order, same as `turnSide`.

## 3. Typical real dimensions

Numbers are from general motorsport knowledge (FIA Appendix O / circuit design practice, manufacturer data) and are approximate; they were not verified online in this session.

| Item | Typical value |
|---|---|
| Modular foam block (TecPro-type): shell | rotationally moulded polyethylene shell filled with closed-cell polyurethane foam, about 1.0 m tall (stacks 1.0-1.2 m for cars), faces about 0.5-1.0 m wide |
| Wall depth | blocks interlocked and strapped in rows 1-3 deep (0.6-2.0 m), with a safety fence behind in front of armco/concrete |
| Colours | blue and red most common, white also used; often alternating colours or sponsor-coloured; yellow/black hazard marking on end blocks |
| Tyre barrier | bundles of 3-4 tyres wide, 1.0-1.5 m tall, tied with conveyor belt faces or bolted to a cable; conveyor-belt face is black/grey rubber; often painted white/red/blue stripes at the top |
| Placement | outside of fast and heavy-braking corners, in front of the rigid barrier (armco/concrete), where an impact angle is steep; at the far end of the run-off, not on the track side |
| Asphalt run-off width | tight/slow corners 10-15 m, heavy-braking corners at modern F1 tracks 20-40 m (Monza T1, Spa La Source, Silverstone Copse/Stowe exit ~ 20-30 m); sweepers commonly 10-20 m paved plus short grass |
| Escape road at a chicane | asphalt lane 8-12 m wide, straight continuation of the approach, 50-120 m long, merging by 10-15 deg taper, edged with foam blocks / tyre walls (Monza Rettifilo, Roggia; Spa Bus Stop shortcut) |
| Gravel trap | 10-20 m, 3-5 cm stones, used where cars need to be slowed (older circuits, with tyre wall beyond) |
| Spacing of guard barriers | armco or concrete wall 8-30 m from the edge in non-run-off sections (the build uses 11-12 m) |

## 4. Recommended data source per feature

| Feature | Source | Reason |
|---|---|---|
| Centerline, corner names | OSM `highway=raceway` ways (names) + built centerline | per-corner ways within 3 m, names for overrides and logs |
| Gravel/sand traps | OSM `natural=sand\|shingle`, `surface=gravel\|sand` polygons (as in `osm-runoff.md`) | mapped at all three tracks |
| Paved run-off and escape roads | rule (section 2) + per-track override list | zero OSM data; rule uses `drop`, `R`, chicane detection |
| Foam blocks | rule (section 2) + override list | no tag in OSM |
| Tyre walls | rule (gravel present, `drop < 70`) | no tag in OSM |
| Wall / armco | OSM `barrier=wall\|guard_rail\|retaining_wall` within 30 m (as in `osm-runoff.md`), else the current fallback | only safety barrier kinds OSM has |
| Fences | visual only, skip `fence_type=chain_link` in collisions | spectator/property boundaries |

## 5. Implementation notes for a later task

- Types: `BarrierSegment.type` needs `'foam'`; `RunoffSegment.surface` already has `'runoff'`, to be treated as asphalt run-off.
- Foam/tyre rendering: instanced boxes of 1.0 x 1.0 x 0.6 m, 3 colours cycling blue/red/white; tyre walls already exist in `src/render/barrierRenderer.ts`.
- Heavy-braking detection must use the task 088 speed profile (already planned), not the research profile, and should sample elevation.
- Validate against the existing 33/31/54 gravel runoff segments for Monza/Spa/Silverstone so the paved rule only replaces gravel for the heavy corners (<= 2, 5, 6 corners).
