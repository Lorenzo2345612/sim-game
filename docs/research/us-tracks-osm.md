# US circuits from OSM: Fontana infield, Cleveland Burke, Detroit

Queried Overpass (overpass-api.de, needs a real `User-Agent`; it is flaky, small bboxes and retries work) on 2026-10-14. Raw output in `/tmp/osmq/` (not kept). Lengths below are computed from the geometry (equirectangular, metres).

## How existing tracks are built (shape to deliver)

- `tools/track-builder/tracks.json`: per-track entry (`id`, `geojson`, `dem`, `widthMeters`, `maxGrade`, `biome`, `grandstands`, `pit`, ...). The centerline is `assets/source/tracks/<geojson>.geojson` (FeatureCollection, one LineString, `properties.length`).
- OSM tracks (Daytona, Elkhart, Spielberg, Braselton...) = `highway=raceway` ways joined into that LineString by hand/script; raw ways kept in `assets/source/osm/<id>.json` as `{source, license, ways:[{id, name, coords:[[lon,lat],...]}]}` (build input, not shipped; drop `name` in anything committed). Gravel/barriers come from `<id>-areas.json`.
- Elevation: `npm run fetch:dem` (`tools/dem/fetchDem.ts`) clips Copernicus GLO-30 (S3 `copernicus-dem-30m`) to bbox + 600 m margin into `assets/source/dem/<id>.json`. Same approach for all three new tracks. Street circuits (Detroit) are flat (176-184 m); Fontana and Burke are near flat.
- Licences: OSM = ODbL 1.0, attribution "(c) OpenStreetMap contributors", add a row to `ASSETS_LICENSES.md` like the existing OSM rows. Copernicus DEM = free worldwide use. Wikipedia text used only for facts (CC BY-SA, not copied).

## 1. Auto Club Speedway (Fontana) infield road course

- Source: OSM `highway=raceway` ways (`sport=motor`, mostly `source=bing_imagery_0.06m_200701`). **Current OSM no longer has them**: the oval/infield ways were deleted after demolition began (Oct 2023). Overpass attic snapshots: 2022-01-01 -> 43 raceway ways, 2023-06-01 -> 43, 2024-06-01 -> 8 (only the leftover 776285756-760 Exotics Racing 1.2 mi kart-style loop at -117.5073,34.0850, plus 355478205 fragment). So historic data works with `[date:"2023-06-01T00:00:00Z"]`.
- Bbox (2022, full complex): lon -117.5100..-117.4900, lat 34.0850..34.0940 (oval about 1.7 km x 0.8 km; dragway 100607893 north-east, ignore).
- Way IDs (2022 snapshot):
  - Oval (not wanted): 7002869 (1273 m), 355478193 (650), 355478205 (1303, south front stretch), 37693708 (272, west turn), 355478207 (1226, long inner diagonal), 355478190 pit lane (826), 355491394 and 355478208 (closed loops, Exotics/other, ignore).
  - Infield candidates: 355478191 (628, from oval east end -117.4935,34.0894 to infield -117.4995,34.0909) -> 355478202 (229) -> 631877882 (81) -> 355478192 (358) -> 355478206 (189) -> 355478195 (144) -> 355478196 (95) -> 355478197 (255) -> 355478198 (85) -> 37693699 (172) -> 7386028 (92), plus cross-links 355478211 (268), 355478201 (61), 631877881 (32), 37693701 (97), 355478194/203/204 (159/38/349), 631874924/26 (23/42), 37693702 (192), 37693704 (308), 359206369, 631913716.
- The infield is a tangle of overlapping links (multiple alternative layouts: 1.2/2.2 mi variants, Wikipedia: infield reconfigured for a multipurpose road course in 2001). I could not unambiguously extract one loop: the naive chain (infield links + oval front stretch 355478205 + 355478207 + 37693708) gives 5.1 km, too long. Official length not verified (Wikipedia has no figure in the extract). A person must pick the loop on a plot of the 2022 snapshot; expect a ~3.2-3.6 km result.
- Hand-drawing: choose the layout and trim, pit lane (355478190, still 826 m, usable), chicanes/hairpin links where ways overlap. Roval 2024 infield does not exist in OSM.
- Elevation: Copernicus GLO-30 (flat, about 340 m, only the banking is not in a 30 m DEM).

## 2. Cleveland Burke Lakefront Airport (CART Grand Prix, 3.389 km after 1997 remeasure)

- Source: OSM `aeroway=runway|taxiway` (nothing tagged raceway). Full bbox lon -81.6925..-81.6690, lat 41.5120..41.5240 (queried with 41.50..41.54, -81.70..-81.66).
- Runways (asphalt): 06L/24R id **37683807** (2007 m, 46 m wide, -81.69205,41.51414 -> -81.67164,41.52377); 06R/24L id **37683821** (1559 m, 30 m wide, -81.69159,41.51276 -> -81.67572,41.52022). Parallel taxiway G **374446715** (2172 m), 66 m from 06R/24L; 06L/24R is 152 m from 06R/24L. Cross taxiways: B 37683825 (394 m) + 374618362-66, 374596313, 1009126553-54; C 37683893 (57) + 374618357-60, 1009126555-56; D 37683925 (80) + 374618353-56, 605942188/90; E 37683937 (70) + 374611925/28/31, 605942191/92; F 374611920 (248), 374611923; H 448345537 (245); A 465321918 (253), 374596314, 374611911/14, 374582295.
- Likely course (from Wikipedia: two long parallel straights, T1 about 135 deg right at the end of the front straight, wide runways, later layout removed the old T1-T2 combination): front and back straights on 06R/24L (37683821) and 06L/24R (37683807) trimmed to roughly 1.3-1.5 km each, joined by hand-drawn turns at both ends. Alternative pairing 37683821 + taxiway G (66 m apart) cannot hold a hairpin, so a chicane/long link would be needed. Exact start/finish, chicane positions and cut points are not in OSM; verify against a diagram (Wikipedia has no layout text) before building.
- Rough length: two 1.35 km straights + two ~0.35 km hairpin links = ~3.4 km, consistent with the official 3.389 km.
- Gaps to hand-draw: both end turns (hairpin/135 deg corner and chicanes), connection onto cross taxiways, pit lane (not mapped), the removed T1-T2 of the pre-1997 layout (not needed).
- Elevation: Copernicus GLO-30, flat lakefront (about 175-180 m).

## 3. Detroit Grand Prix downtown circuit (2023+, official ~2.645 km)

- Source: only `highway=raceway` way is the pit lane **1288811774** ("Detroit Grand Prix Pit Lane", 293 m, oneway, -83.03709,42.32983 -> -83.03447,42.33140). The loop is ordinary street ways (`highway=tertiary|secondary|trunk|unclassified`); OSM also has no event closure geometry.
- Bbox: lon -83.0420..-83.0280, lat 42.3280..42.3365. Wikipedia: the 2023 circuit "focuses mostly on Atwater Street and East Jefferson Avenue" with ten corners (the F1/CART circuit of 1982-91 is a different layout around the Renaissance Center / Woodward).
- Candidate loop (counter-clockwise on a map: Jefferson out, Riopelle link, Atwater back, Beaubien link), about 2.16 km of straight sections before corner geometry:
  - East Jefferson Ave (east-bound carriageway, in order): 90546624, 1379247797, 453835473, 219846871, 422037773, 507295710, 401422981, 422037770 (820 m, from -83.0390,42.3309 to -83.0308,42.3348; west-bound twin 119410886 etc.).
  - Riopelle St: 68304752 + 8735420 (304 m, -83.0308,42.3348 -> -83.0291,42.3323).
  - Atwater St (west-bound): 443384408, 913566523, 107559843, 443384413, 334443397, 1324281406, 1446468572, 1446468573 (840 m, -83.0291,42.3323 -> -83.0383,42.3285).
  - Beaubien St link: 8759335 (192 m, -83.0380,42.3287 -> -83.0392,42.3302).
  - Other nearby streets: Franklin St 107561927 (386 m), 52637838; Rivard St 1288811773, 68304728, 776856866; Bates St 475334648, 8750465; Brush St 46274624.
- Whether this is exactly the 2023 course is not verified: the sum (about 2.2 km + corner links) is 0.4 km short of 2.645 km, so the real loop probably extends farther east/west along Jefferson/Atwater, and which Riopelle/Rivard/Franklin links form T1/T9 must be checked against an official map. The Wikipedia extract gives no turn-by-turn.
- Gaps: corner radii (street ways are centrelines of two carriageways; use the middle of the Jefferson pair), chicane geometry, pit lane (use 1288811774 as is), start/finish placement.
- Elevation: flat, 176-184 m (Wikipedia); use Copernicus GLO-30 as for other tracks (urban DSM includes buildings, so flatten/canopy-filter like the street circuits already in the repo: `canopyRadiusCells`).

## Next steps

1. Re-run the queries with `out geom` and `[date:"2023-06-01T00:00:00Z"]` for Fontana; write `assets/source/osm/{fontana,cleveland,detroit}.json` in the existing `{source, license, ways:[{id, coords}]}` shape (no `name`).
2. Pick the loops by plotting (render-preview skill), join into `assets/source/tracks/us-{fontana,cleveland,detroit}.geojson`, add `tracks.json` entries, `npm run fetch:dem`, add ODbL rows to `ASSETS_LICENSES.md`.
