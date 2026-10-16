# Auto Club Speedway (Fontana) - road layouts and AMS2 coverage

Researched 2026-10-16. Map seen: Commons `Auto_Club_Speedway_(formerly_California_Speedway)_-_Sports_Car.svg` (north up).

## 1. Road layouts (Wikipedia "Auto Club Speedway", infobox + records table)
| Layout | Length | Turns (Wikipedia) | Years | Notes |
|---|---|---|---|---|
| Interior Road Course | 1.550 mi / 2.494 km | 17 | 2001-2023 | all infield; Super GT (JGTC) 2002-04; ours = `fontana` |
| Sports Car Course | 2.880 mi / 4.635 km | 18 on map (promo 2002: "2.8-mile, 21-turn"; lapmeta 19) | 2001/02-2023 | oval + infield; Grand-Am Rolex 2002 Grand American 400 (23 Mar 2002; pole/record Didier Theys, Dallara SP1, 1:29.322) |
| Motorcycle Course | 2.360 mi / 3.798 km | 20 | 2001-2023 | AMA Superbike 2002-2010; JGTC GT500 record 1:24.287 (Treluyer, 2004) |
| Exotics Racing course | 1.2 mi | n/a | 2014- | small separate kart-style course, not relevant |
| Oval | 2.000 mi, D-shaped, 14 deg banking | 4 | 1997-2023 | NASCAR, IndyCar/CART, ARCA |

Direction: counter-clockwise (lapmeta lists the road course as ccw; same as the oval). Note: CART/IndyCar ran the oval only.

## 2. Sports Car Course route (read from the Commons map; turn numbers are "arbitrary, assigned by the image author")
- Start/finish: on the oval front stretch (south side of the oval on the map), heading east; front stretch pits (oval pit road) used.
- T1-T2 (numbered 1, 2 on map): the oval's banked east end (oval turns 1-2), full width of the banking, lap goes north.
- Leaves oval: at the exit of oval T2 on the north side (back stretch start, near map T3), dives left (west) into the infield: T3/T4 short kink, then a straight west along the north infield to the T5 hairpin-like banked U-turn (the shaded area is a banked/paved turnaround at the west end of that straight).
- Returns east along the infield (long straight under the north one) to T6-T7-T8 (tight loop at the east), then T9-T10 chicane and west along the south-infield straight to T11, T12-T13 (kink/chicane with the dark triangles), T14-T15, T16-T17 (southwest corner).
- Rejoins oval: after T17 it merges onto the front stretch at the exit of oval T4 (southwest). Oval T3-T4 and most of the back stretch (dotted/grey) are NOT used.
- So the oval parts used: front stretch/tri-oval + turns 1-2 + the first part of the back stretch (about the east end of it, to the infield entry).
- Not independently verified in text: no prose description found. The map is the authority.

## 3. Map images
- Sports Car: https://commons.wikimedia.org/wiki/File:Auto_Club_Speedway_(formerly_California_Speedway)_-_Sports_Car.svg (CC BY-SA 3.0, Will Pittenger, 2008). Raster via `Special:FilePath/<name>?width=1200`.
- Sibling maps by the same author: `... - Interior_Circuit.svg`, `... - Motorcycles.svg`, speedway-only (oval).
- lapmeta track maps (not free, reference only): https://www.lapmeta.com/en/track/variation/101 (road course), /variation/245 (infield), /variation/914 (outfield), /variation/715 (motorcycle).

## 4. AMS2
Racin' USA Expansion Pack Pt3 (traxion.gg complete track list) lists:
- "Fontana - Auto Club Speedway Oval" 
- "Fontana - Auto Club Speedway Sports Car Course"
- "Fontana Oval Historic"
No AMS2 length given in sources; real-life 2.88 mi / 4.63 km. No "Roval" name exists; the oval-using layout is the Sports Car Course (the one above). AMS2 does not appear to ship the interior-only course (unconfirmed; check on the official AMS2 forum/Reiza page).

## 5. Local OSM data
- tracks.json `fontana` -> geojson `us-fontana` -> `assets/source/tracks/us-fontana.geojson` (single LineString, 2430 pts, length 2426 m, Interior Circuit, snapped to OSM).
- Raw ways: `assets/source/osm/fontana.json` (9 highway=raceway ways, Overpass snapshot 2023-06-01), all infield: 7386028, 355478194, 355478203, 355478197, 355478201, 355478211, 355478206, 37693702 (west end, 192 m), 355478207 (1224 m, the long southern-infield loop trace). Longitudes span -117.5068..-117.4953, lat 34.0890..34.0907.
- No oval ways present (no front stretch, no turns 1-2/3-4, no back stretch, no connectors between oval and infield, no oval pit lane). Also `assets/source/osm/fontana-areas.json` is areas only.
- Verdict: the Sports Car Course CANNOT be assembled from the local OSM; ~55 % of it (front stretch, T1-T2 banking, back-stretch entry, merge at T4) is missing. Infield part (T3-T17) is roughly the existing ways but the ways trace the interior circuit, not the exact sports-car infield (e.g. T5 banked turnaround).
- To build it: re-pull Overpass (attic 2023) for the oval `highway=raceway`/`leisure=track` ways around 34.088..34.092, -117.50..-117.49 (west end) and bbox south/east for the oval, or hand-trace from the Commons SVG (CC BY-SA 3.0 needs attribution) georeferenced via the scale bar (349 m) and the OSM oval.

## Sources
- https://en.wikipedia.org/wiki/Auto_Club_Speedway
- https://commons.wikimedia.org/wiki/File:Auto_Club_Speedway_(formerly_California_Speedway)_-_Sports_Car.svg
- https://traxion.gg/complete-automobilista-2-track-list/
- https://www.lapmeta.com/en/track/variation/101
- https://us.motorsport.com/grandam/news/scc-inaugural-race-on-new-road-course-at-california-speedway/1954456/
- https://www2020.theautochannel.com/news/2002/03/13/037168.html
