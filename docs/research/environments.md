# Research: environment types (city, desert, tropical) (2026-10-13)

Scope: CITY (Baku, Singapore Marina Bay, Las Vegas Strip), DESERT (Sakhir, Lusail, Las Vegas outskirts), TROPICAL (Sepang, Singapore). Complements `realism-assets.md`, `environment-assets.md`, `track-textures.md`, `osm-runoff.md` (nothing repeated: Concrete034, Fence003, Kenney Racing Kit, Kenney Nature Kit, EZ-Tree, Stylized Nature MegaKit are already known).

Method: ambientCG API (`api/v2/full_json`, sizes of `1K-JPG` zips), Poly Haven API (`api.polyhaven.com`), Sketchfab search API (`api.sketchfab.com/v3/search`, flagged "API"; downloads need login), Overpass (raw output in `.ai/scratch/osm-city/`, git-ignored, untrusted, parsed with `python3 -I`). License pages fetched with WebFetch where stated. Only three small Kenney zips were downloaded, into `/tmp/envdl-kenney/` (17 MB), to list model names and count triangles; nothing was executed and nothing was copied into the repo.

## 1. PBR textures (all CC0)

License verified on the asset's own page: ambientCG Facade001, Bricks083, Ground093A ("All assets are released under the Creative Commons CC0 license"); Poly Haven coral_fort_wall_01, dry_ground_01, concrete_pavement_02 (CC0). Others in the tables: same site-wide terms, "page not fetched". ambientCG maps: colour, normal (GL), roughness, AO/displacement (1K zip). Poly Haven 1K via `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/<id>/<id>_<map>_1k.jpg` (diff 0.9-1 MB each).

### Facades (glass curtain wall / modern)

| Name | URL | Author | License | 1K zip | Fit |
|---|---|---|---|---|---|
| **Facade001** (glass, reflective) | https://ambientcg.com/a/Facade001 | ambientCG | CC0 (verified) | 2.9 MB | Generic glass tower; smallest |
| Facade005 / Facade006 / Facade002 / Facade003 / Facade004 (glass, reflective) | https://ambientcg.com/a/Facade005 (same pattern) | ambientCG | CC0 (site-wide) | 4.1 / 3.0 / 3.1 / 3.3 / 3.6 MB | Colour variants of glass curtain wall for Singapore/Vegas |
| **Facade018A** / Facade019A / Facade020A (skyscraper, A/B/C = colour variants) | https://ambientcg.com/a/Facade018A | ambientCG | CC0 (site-wide) | 7.0-7.7 MB | Dense skyscraper grid with floor lines: Marina Bay / Strip towers |
| Facade009 / 011 / 007 / 008 (glass, night, windows lit?) | https://ambientcg.com/a/Facade009 | ambientCG | CC0 (site-wide) | 5.3 / 6.1 / 6.2 / 6.2 MB | Night variants (check emissive map if a night mode is added) |
| Poly Haven concrete_tile_facade | https://polyhaven.com/a/concrete_tile_facade | Charlotte Baglioni | CC0 (category-level; page not fetched) | ~1 MB/map | Casino/podium cladding |

### Concrete, plaster, brick, old-city stone

| Name | URL | Author | License | 1K zip | Fit |
|---|---|---|---|---|---|
| Concrete046 (plain white-grey wall), Concrete045 (modern pattern) | https://ambientcg.com/a/Concrete046 | ambientCG | CC0 (site-wide) | 6.0 / 5.6 MB | Generic office/parking blocks (Concrete034 already in repo) |
| **PaintedPlaster004** (clean yellow), Plaster001 (stucco), PaintedPlaster017 (white) | https://ambientcg.com/a/PaintedPlaster004 | ambientCG | CC0 (site-wide) | 6.7 / 7.4 / 4.7 MB | Low-rise apartments (Baku boulevard, Sakhir, Lusail) |
| **Bricks083** (medieval sandstone, beige) | https://ambientcg.com/a/Bricks083 | ambientCG | CC0 (verified) | 5.2 MB | **Baku old-city walls and Maiden Tower** |
| Bricks084 (sandstone, yellow), Bricks100 (beige medieval), Bricks043/044 (beige) | https://ambientcg.com/a/Bricks084 | ambientCG | CC0 (site-wide) | 5.1 / 4.8 / 8.7 / 8.9 MB | Old-city building variants |
| **coral_fort_wall_01 / _02** (coastal limestone fort wall) | https://polyhaven.com/a/coral_fort_wall_01 | Dimitrios Savva (photo), Rico Cilliers (processing) | CC0 (verified) | 0.97 MB diff 1K | **Best fit for Baku walls/Shirvanshah palace** (warm limestone); 01 verified, 02 category-level |
| castle_wall_slates, castle_brick_07, brown_brick_02 (sandy yellow) | https://polyhaven.com/a/castle_wall_slates | Rob Tuytel | CC0 (category-level) | ~1 MB/map | Alternatives for old city stone |
| Rock055 (beige wall rock), Tiles143 / Tiles142 (limestone slabs), Travertine001 | https://ambientcg.com/a/Rock055 | ambientCG | CC0 (site-wide) | 4.7 / 5.1 / 5.1 / 3.5 MB | Wall base, casino plinth, plazas |
| Bricks060 (white), Bricks072 (modern yellow, 3.9 MB), Bricks051 (red) | https://ambientcg.com/a/Bricks072 | ambientCG | CC0 (site-wide) | 7.9 / 3.9 / 7.5 MB | Brick (Sepang/Singapore shophouse; secondary) |

### Pavement / sidewalk

| Name | URL | Author | License | Size | Fit |
|---|---|---|---|---|---|
| **concrete_pavement_02** (city sidewalk) | https://polyhaven.com/a/concrete_pavement_02 | Charlotte Baglioni | CC0 (verified) | ~1 MB diff 1K | **Sidewalk/verge in all cities** |
| concrete_tiles_02 (sidewalk tiles), concrete_pavers, checkered_pavement_tiles | https://polyhaven.com/a/concrete_tiles_02 | Charlotte Baglioni / Amal Kumar | CC0 (category-level) | ~1 MB/map | Boulevard promenade |
| PavingStones143 (modern grey small), PavingStones099, Tiles038 | https://ambientcg.com/a/PavingStones143 | ambientCG | CC0 (site-wide) | 5.5 / 7.2 / 4.9 MB | Plaza/pedestrian |
| PavingStones142 (dark medieval), PavingStones150 (beige cobble), Poly Haven cobblestone_floor_0x | https://ambientcg.com/a/PavingStones150 | ambientCG | CC0 (site-wide) | 8.5 / 5.3 MB | Baku old-city streets |

### Sand, desert ground, dry shrub ground

| Name | URL | Author | License | Size | Fit |
|---|---|---|---|---|---|
| **Ground093A** (coastal/desert beige, dry) + B, C (dunes) | https://ambientcg.com/a/Ground093A | ambientCG | CC0 (verified) | 5.7 / 5.1 / 5.1 MB 1K | **Sakhir/Lusail base sand** (A and B/C blend) |
| Ground097, Ground098, Ground092A, Ground101 (fine, light) | https://ambientcg.com/a/Ground097 | ambientCG | CC0 (site-wide) | 5.3 / 6.1 / 6.0 / 5.8 MB | Sand colour variants |
| **dry_ground_01**, dry_ground_rocks | https://polyhaven.com/a/dry_ground_01 | Rob Tuytel | CC0 (verified) | ~1 MB diff 1K | **Dry scrub ground** (Vegas outskirts) |
| Ground031 (cracked dry desert soil), Ground080 (brown sand), Ground102 (compressed dry), Rock029 (orange desert rock) | https://ambientcg.com/a/Ground031 | ambientCG | CC0 (site-wide) | 10.3 / 6.9 / 8.4 / 9.6 MB | Scrub patches, Vegas rock |
| dense_sand, gravelly_sand, cracked_red_ground, dirt_aerial_02, coast_sand_01 | https://polyhaven.com/a/dense_sand | Dimitrios Savva / Dario Barresi / Amal Kumar / Rob Tuytel | CC0 (category-level) | ~1 MB/map | Alternatives; coast_sand for Caspian shore |

### Water normal map

No CC0 water normal map exists in ambientCG (only Ice00x, not usable) or Poly Haven. Candidates found, none usable without further checks:

| Name | URL | License | Verdict |
|---|---|---|---|
| ggbot Y2K Texture Pack (has an "ocean" 1024 texture + normals per its update log) | https://ggbot.itch.io/y2k-texture-pack | CC0 1.0 per search snippet, page not fetched | license unverified; stylized |
| three.js `examples/textures/waternormals.jpg` | https://github.com/mrdoob/three.js/tree/dev/examples/textures | not stated for the file; not in the npm package | license unverified |
| Summer Engine "lake water normal map" | https://www.summerengine.com/pt/asset-store/lake-water-normal-map-ddc9bf78 | CC0 but AI-generated (Grok) | Rejected: provenance |

Recommendation: generate our own seamless normal map offline (2-3 octaves of tileable simplex noise or summed sines, 512x512, same approach as `tools/assets/macroNoise.py`); project-owned CC0, no license risk. Two scrolling layers in the shader give the animated look.

## 2. 3D models

All tris counted by reading the GLB JSON header of the downloaded Kenney files; Sketchfab tris from the API (`faceCount`), license from the API field, all require a free Sketchfab login to download (flag). Sketchfab search with `license=cc0` returned nothing downloadable for these queries; every hit is CC-BY (or CC-BY-SA where marked), so attribution lines in `ASSETS_LICENSES.md` are required.

### Buildings (kits)

| Name | URL | Author | License | Formats | Tris | Fit |
|---|---|---|---|---|---|---|
| **Kenney City Kit (Commercial) 2.1** (verified on page + License.txt in zip: CC0) | https://kenney.nl/assets/city-kit-commercial (zip 4.1 MB) | Kenney | CC0 | GLB/FBX/OBJ; 1 material + 1 shared PNG | skyscraper-a..e 1.2-1.9k; building-a 1.25k; building-n 4.4k; low-detail-building-a..n/wide 156-190 | Distant filler, LOD1 for skyline; stylized colour palette (no photo facade), so use only as far LOD or retexture with the PBR facades above |
| Kenney City Kit (Roads) (CC0, zip 2.9 MB) | https://kenney.nl/assets/city-kit-roads | Kenney | CC0 | GLB | light-square 60, light-curved 92, construction-barrier 60, construction-fence 136, road-straight-barrier 24, sign-highway 180, traffic-light 212, electricity-pole, bridge-pillar | **Street lamps, signs, traffic lights, small barriers** as InstancedMesh (very cheap) |
| Kenney City Kit (Suburban) (CC0, 3.0 MB zip; not opened) | https://kenney.nl/assets/city-kit-suburban | Kenney | CC0 | GLB | not counted | Houses for Sepang/Lusail edges (optional) |
| Low-poly City Buildings | https://sketchfab.com/3d-models/none-e0209ac5bb684d2d85e5ade96c92d2ff | smooth998 | CC-BY (API) | glTF | 7.2k (pack) | Not needed |

Procedural buildings (section 4) replace kit buildings for everything within ~600 m of the track.

### Palms, shrubs

| Name | URL | Author | License | Formats | Tris | Fit |
|---|---|---|---|---|---|---|
| **Exotic palms lowpoly style** (5 variants: ordinary, stooped, old, young, very young) | https://opengameart.org/content/exotic-palms-lowpoly-style | FabinhoSC | CC0 (verified on page) | .blend + .fbx in zip (0.94 MB), gradient texture; convert to GLB | not listed (low; check) | **Mid/far palms** (coconut-like), all variants separate trunk/leaf parts = easy LODs |
| Low poly strange palm trees (4 variants) | https://opengameart.org/content/low-poly-strange-palm-trees | FabinhoSC | CC0 (verified) | .blend + .fbx (198 KB zip) | not listed | Far filler (strange silhouette) |
| Palm tree v2 low poly edition | https://opengameart.org/content/palm-tree-v2-low-poly-edition | Julius, Yughues | CC0 (verified) | zip 1.4 MB, formats not stated; 512 px texture | 451 polys | Cheap palm LOD |
| **Arabic Palmtree** | https://sketchfab.com/3d-models/none-d76f0654b92d4cf994b528555525219b | gelmi.com.br | CC-BY (API) | glTF via login | 1.8k | **Date palm** (Sakhir/Lusail/Vegas) |
| Coconut Tree Low poly | https://sketchfab.com/3d-models/none-8c5d6b661b2f4c37834d87cd187eb907 | Nodeaxis Interactive | CC-BY (API) | login | 1.6k | **Coconut palm** (Sepang/Singapore) |
| Coconut Palm / Date Palm / Curly Palm | https://sketchfab.com/3d-models/none-26e787f2ff2e4c0fb004c3b0210805a3 , https://sketchfab.com/3d-models/none-11acf710e6c149daa8d6fb8cdc5d087f | evolveduk | CC-BY (API) | login | 7.4k / 10.0k / 4.5k | LOD0 for near palms (same author, consistent set), or impostor source |
| Palm Tree Pack LOWPOLY | https://sketchfab.com/3d-models/none-fd439b0f82c34497aabb21c68ad2fb34 | EFX | CC-BY (API) | login | 8.9k (pack) | Alternative |
| **Low Poly Desert Shrub - Dry Bush** | https://sketchfab.com/3d-models/none-7d0076e00a4b48fa8e1f42d6e3384fc1 | marishka1611 | CC-BY (API) | login | 72 | Desert scrub, tiny |
| Kenney Nature Kit: cactus_short 116, cactus_tall 122, plant_bush 32, rock_largeA 80 tris (verified: zip License.txt CC0; no palm models in the kit) | https://kenney.nl/assets/nature-kit | Kenney | CC0 | GLB | as listed | Cactus/bush/rock filler for Vegas outskirts |
| Poly Haven shrub_sorrel_01 (3.3k), shrub_03 (17k) | https://polyhaven.com/a/shrub_sorrel_01 | Rico Cilliers | CC0 (category-level) | glTF | 3.3k / 17k | Realistic ground shrub (tropical/Vegas) |

Poly Haven models checked and rejected for weight: street_lamp_01/02 (20-30k), concrete_road_barrier (43-81k), modular_chainlink_fence (89k), island_tree_* (1.8-4.8M).

### Street furniture, barriers, billboards

| Name | URL | Author | License | Tris | Fit |
|---|---|---|---|---|---|
| Kenney City Kit (Roads): light-square, light-curved, traffic-light, sign-highway | (above) | Kenney | CC0 | 60-212 | Lamps/signs; stylized flat colour: acceptable at 100+ m, retexture or tint for near |
| **Concrete Jersey Barrier with Fence** (JeffK) | https://sketchfab.com/3d-models/none-85c3967de8c24357acc4371339e73c2e | JeffK | CC-BY (API) | 248 | **Street-circuit wall with debris fence** in one mesh; instance along the edge spline |
| Jersey Barrier Low Poly (PolyDavid) / Simple Jersey Barrier (Blender3D) | https://sketchfab.com/3d-models/none-96d2274864624218afdb3d5c51dee25d , https://sketchfab.com/3d-models/none-3064d9fb498c459e8f94e621dc7e9936 | PolyDavid / Blender3D | CC-BY (API) | 796 / 804 | Plain concrete block |
| Modern Chinese Street Lamp / Low-Poly Lamp Post | https://sketchfab.com/3d-models/none-ce9d029fe1c14d01b9193b2c31f7c484 , https://sketchfab.com/3d-models/none-c466684e819a4428b6d8ed50537615e4 | Cyrus_JS / Memorie | CC-BY (API) | 1.9k / 1.3k | Singapore-style lamp (higher quality than Kenney) |
| Metal road billboard single sided / Metal Billboard Advertising Single Sided | https://sketchfab.com/3d-models/none-6534d76c592d4a0da374d3861e2d506a , https://sketchfab.com/3d-models/none-33c164cf9e4346d1b48eb0c49cb2643f | Frice / JoTrain | CC-BY (API) | 860 / 1.7k | Billboard frame; content = generated generic ad texture (no brands) |
| Tyre wall, catch fence texture (Fence003) | see `realism-assets.md` | | | | Already researched |

Recommendation for barriers: generate in code (box extrusion with Concrete034/PH `concrete_slab_wall_02` + Fence003 opacity plane on posts), as `environment-assets.md` already advised; a Jersey profile extruded along the edge is ~12 tris/m. Use the JeffK model only as shape reference.

## 3. OSM data (Overpass, queried 2026-10-13, ODbL, attribution required)

Query: all features within 600 m of the track polyline (`around` with the centerline thinned to ~250 m points; 14-21 points per track). Mirrors: overpass-api.de timed out on Baku/Bahrain/Lusail (504) several times; private.coffee and kumi.systems worked as fallback. Raw: `.ai/scratch/osm-city/{baku,singapore,lasvegas,bahrain,lusail,baku-walls}.json`.

| Item (within 600 m) | Baku | Singapore Marina Bay | Las Vegas Strip | Bahrain (Sakhir) | Lusail |
|---|---|---|---|---|---|
| Building ways (+ relations) | 1,221 (+~87 with other tags) | 829 (+15 rel) | 649 (+11 rel) | 226 | 205 |
| `building:part` | 17 | 560 | 90 | 7 | 0 |
| With `height` or `building:levels` (ways) | 616 (47%): 604 levels, 16 height | 740 (89%): 702 height | 212 (33%): 189 levels, 62 height | ~0 | ~0 |
| Parts with height/levels | 15 | 556 | 70 | n/a | n/a |
| Tallest tagged | City Tower 1 (50 lvl), Hilton 25, Marriott 20 | One Raffles Place 283 m, many 280 m | Trump Intl 211 m, Palazzo 196, Encore 192, Wynn 187, Cosmopolitan 184 | none | none |
| Estimated extrude tris (walls + fan roof) | ~26k | ~37k (ways + parts) | ~33k | ~4k | ~3k |
| Footprint area | | 0.90 km2 | 2.0 km2 | | |
| Roads (`highway`, excl. footway/steps/service): primary / secondary / trunk | 87 / 48 / 49 | 218 / 121 / 78 (+12 motorway) | 178 / 170 | (service 353, tertiary 17) | (motorway 6, service 360, construction 76) |
| Footway / pedestrian / steps | 1,223 / 57 / 176 | 763 / 157 / 119 | 1,779 / 9 / 146 | few | few |
| Water | 50 `natural=water` ways + 2 relations + 2 coastline ways (Caspian) | Marina Reservoir (relation 9542146), Singapore River (relation 9569901), Dragonfly lake, 13 small | 23 small (Fountains of Bellagio way 22971030 24,503 m2, Lake of Dreams, lagoons); no coastline | 3 | none |
| Trees (`natural=tree` nodes) | 346 | 449 (2 tagged palm) | 161 (38 tagged palm) | 1,109 (no species) | 1,508 (no species) |
| Parks/grass | landuse=grass 294, leisure=park 63 | grass 26, park 15 | grass 8, park 8 | grass 39, garden 66 | grass 53, garden 31 |
| Sand/scrub | none | scrub 6 | bare_rock 1 | `natural=sand`: 26 ways + 4 rel, 0.40 km2 (largest 17 ha) | 105 ways + 21 rel, 0.67 km2 (largest 18 ha) |
| Walls (`barrier=wall`) | 15 ways + 7 retaining + 1 city_wall; 2.7 km total | 5 | 19 | 112 ways, 15 km | 187 ways, 17.6 km |

Landmarks found:

| Landmark | OSM id / tags | Usable data |
|---|---|---|
| **Maiden Tower (Baku)** | way 299418016: `historic=castle`, `building=yes`, `building:levels=9`, wikidata Q842822; footprint 213 m2, perimeter 72 m | Footprint only (a ~16 m round-ish tower; 9 levels ~ 29.5 m). Needs a proxy cylinder with a buttress |
| Baku old-city walls | No dedicated `historic=city_walls`. `barrier=city_wall` way 299450006 (354 m, = Shirvanshah palace outline), `barrier=wall` ways of 751, 246, 208, 205, 141 m; Shirvanshah Palace way 299450008 and Khans Palace way 1411050899 (`historic=castle`); 3 caravanserais (`historic=caravanserai`, `building=historic`); 265 old-city building footprints (78 with levels, none with height) | Extrude walls ~8-10 m with a limestone material; old-city buildings 2-3 levels default |
| Baku skyline | Hilton (25 lvl), Marriott (20), Four Seasons (9), City Tower 1 (50), Tower 3 (34); Flame Towers only a `tourism=attraction` polygon (way 340060268, 10,279 m2) with no height | Heights from tags; Flame Towers needs a proxy |
| Baku boulevard / Caspian | coastline ways 287035247, 1528410534; 5 `man_made=pier`; 346 trees; parks 63 | Water plane to the coast side, boulevard promenade pavement |
| Marina Bay Sands | ways 172307471/172307472 (`building=hotel`, `height=193`, 55 levels) plus the third tower and Shoppes relation 2298319 (height 15), casino node 3390540477 | Three towers extruded from OSM; the SkyPark ship shape is NOT mapped: hand-placed proxy (a 340 m long boat-shaped slab on top) |
| Singapore others | Esplanade (way 256163011/12, h=35), The Fullerton Hotel (25 m), Singapore Flyer (way 51761904, `height=0`: override ~ 165 m wheel proxy), Raffles City, Merlion Park way | Heights available |
| Las Vegas casinos | Bellagio 120 m (34 lvl), Paris (Eiffel Tower replica way 27831699, 165 m), Venetian Tower 145 m, Park MGM 110 m, Treasure Island (`amenity=casino`, no height), Aria (20 m, wrong), Cosmopolitan 184 m, Encore 192 m, Wynn 187 m, Trump 211 m, Fountains of Bellagio water polygon | Heights for the towers; ~67% of ways have no height: default by type/area |

Findings for the desert tracks: OSM has no surrounding scrub or desert polygons (`natural=sand` polygons are the run-off traps, mapped near the circuit, 17-18 ha max, as in `osm-runoff.md`). Desert ground = a global default fill; use the polygons only as sand run-off. Buildings are few and low (grandstands 9 at Sakhir, carports, `building=yes`): hand-place pit/paddock/grandstand blocks. The 1,109/1,508 untagged tree nodes are landscaping (likely palms): use them as palm positions in Sakhir/Lusail.

Data size: the five query results total 11.4 MB raw JSON (`out geom`); a pre-baked per-track `env.json` with only buildings (footprint, height, kind), water, walls, trees would be ~0.3-1 MB.

## 4. Recommended approach

1. **Offline `tools/env-builder` (build-time, not runtime)**: Overpass query per track (600 m `around` the centerline plus the same query as above), project lon/lat into the track's local metres (same projection as `track.json`), write `public/tracks/<id>.env.json` with `{buildings:[{ring, height, kind}], walls:[{line, height, kind}], water:[ring], trees:[[x,z,kind]], landmarks:[...]}`. Tracks stay deterministic and offline; OSM (ODbL) attribution goes into `ASSETS_LICENSES.md` and the credits screen.
2. **Building heights**: `height` tag, else `building:levels * 3.3 m` (+ 1.2 m roof), else part heights, else defaults by `building` kind and footprint area (hotel/casino/commercial/office 25-60 m scaled by `sqrt(area)`, apartments 9-20 m, house/garage/carport 3-4 m, `yes` 8-14 m), jittered by a hash of the OSM id (deterministic). Overrides table for known wrong values (Singapore Flyer `0`, Aria `20 m`). Drop footprints < 25 m2; skip features within 8 m of the centerline.
3. **Façades per environment type**: CITY-glass (Facade001/005 + Facade018A/020A for towers > 80 m), CITY-concrete (Concrete046/045, PaintedPlaster004 for low-rise), CITY-stone for Baku old city (Bricks083/PH coral_fort_wall_01, limestone Tiles143 plinths), DESERT low-rise plaster (Plaster001, beige), TROPICAL (PaintedPlaster, Bricks072). UVs in world metres (u = edge length / 6 m, v = height / 3.3 m) so one 1K tileable set serves any footprint; roofs use a concrete/roof material. Randomise tint per building via vertex colours (no extra draw calls).
4. **Landmarks**: (a) Baku walls: extrude `barrier=wall|city_wall` ways 8-10 m, limestone, with a simple crenellation strip texture (alpha/normal) rather than geometry; Maiden Tower: hand-placed proxy (cylinder 11 m radius, 29.5 m high, a half-cylinder buttress, ~400 tris) at the OSM footprint centroid; Palace/Khans Palace footprints extruded 8-12 m. (b) Marina Bay Sands: keep the three OSM towers (193 m), add a SkyPark proxy box (~340 x 38 x 8 m, boat-shaped hull, ~100 tris) at 190 m. (c) Vegas: OSM towers plus proxies for the Eiffel replica (lattice impostor plane), Bellagio fountains (water polygon, flat reflective, animated normal), Sphere is out of the 600 m radius (not found in data). (d) Flame Towers: 3 flame-shaped proxies by `height~180 m`.
5. **Water**: planes from OSM polygons (Singapore reservoir/river, Baku Caspian beyond the coastline, Bellagio fountains). For coastlines, build the water polygon by clipping a large quad with the coastline (OSM coastline has water on the right side). One `ShaderMaterial`/`MeshStandardMaterial` with the generated normal map, two scrolling layers, a fresnel-tinted colour and sky reflection from the existing PMREM (no planar reflection pass; cost = 1 draw call).
6. **Ground per type**: PARKLAND (existing), DESERT (Ground093A/B/C blend with PH dry_ground_01 as macro variation, sand run-off polygons already handled by `osm-runoff.md`), CITY (concrete_pavement_02 sidewalks + PavingStones/Concrete034 plaza from `highway=pedestrian|footway` polygons buffered; asphalt for roads outside the track), TROPICAL (existing grass + a wet/dark variant, palms).
7. **Props (all InstancedMesh, positions in `env.json` or generated along road edges)**: street lamps (Kenney light-square/-curved; 60-90 tris) every ~35 m on the outside of kerbs; jersey barrier + debris fence generated in code along the circuit edge (street circuits: Baku, Singapore, Vegas); palms: 2-3 LODs (CC0 FabinhoSC for far, CC-BY gelmi/Nodeaxis for mid, optional impostor billboard beyond 150 m), shrubs/cactus (Kenney cactus 120 tris, Dry Bush 72 tris); billboards (860-tri frame + generated generic ad atlas, no brands).
8. **Performance budget (target ≤ 300 draw calls total, current tracks use ~100-150 per `realism-assets.md` assumptions; verify with `renderer.info`)**:

| Group | Draw calls | Note |
|---|---|---|
| Buildings | ~30-40 | Chunk the env into 200 m cells (ChunkedMerge: `BufferGeometryUtils.mergeGeometries` per material per cell); ~6 materials x 6 visible cells; frustum culling per cell; no per-building meshes. Total ~35k tris per track, so even unculled it is cheap (vertex cost negligible) |
| Landmarks | ~10 | Proxies share the facade materials |
| Water | 1-3 | |
| Ground / sidewalks | ~5-10 | |
| Props (lamps, barriers, palms x LOD, shrubs, billboards) | ~20-30 | One InstancedMesh per model/LOD, 1 material each |
| Existing (car, track, crowd, sky, post) | ~100-150 | |

   Texture memory: 6 facade sets x (colour + normal + roughness) at 1K, KTX2 or WebP via `tools/asset-optimize` (~3 MB GPU each with mips), shared across the three city tracks. Lazy-load per track. Do not use displacement maps. Facade shader: normal + ORM only, no parallax.
9. **Suggested order**: (1) env-builder + extrusion with heights and the Concrete/Facade materials (largest visual win); (2) water; (3) palms and sand for the desert; (4) landmarks; (5) street props. Treat Sepang (not queried here: run the same Overpass query before building its `env.json`) as TROPICAL with palms and the existing parkland ground.

## Top picks

1. Facades: ambientCG Facade001 / Facade018A / Facade020A (glass + skyscraper), PaintedPlaster004, Concrete046.
2. Old city: ambientCG Bricks083 + Poly Haven coral_fort_wall_01 (CC0, verified).
3. Pavement: Poly Haven concrete_pavement_02 (CC0, verified).
4. Desert: ambientCG Ground093A/B/C (CC0, verified) + Poly Haven dry_ground_01 (verified).
5. Water normals: generate our own; no verified free source.
6. Palms: FabinhoSC CC0 "Exotic palms" (verified, convert FBX to GLB) for far/mid; CC-BY gelmi "Arabic Palmtree" (date) and Nodeaxis "Coconut Tree Low poly" (coconut) for near.
7. Props: Kenney City Kit (Roads) for lamps/signs/traffic lights, Kenney Nature Kit for cactus, barriers generated in code (JeffK jersey+fence as reference only).
8. Buildings: procedural OSM extrusion (Singapore 89% have heights, Baku 47%, Vegas 33%); Kenney City Kit (Commercial) only as far LOD.

## Rejected / caveats

| Item | Reason |
|---|---|
| DOSCH Water V2, Unity "Ultimate Nature Pack" (Black Horizon) | Paid |
| Summer Engine water normals | AI-generated provenance |
| three.js waternormals.jpg, ggbot Y2K ocean | License unverified |
| Poly Haven models (lamps, barriers, fences, island trees) | 20k to 4.8M tris |
| Sketchfab CC-BY assets | Need login to download and attribution lines; do not install until chosen; verify the license again on the model page in a browser (WebFetch does not render Sketchfab) |
| Kenney City Kit buildings for near-field | Stylized flat colour clashes with the PBR direction; use only far |
| OSM-derived `height` for Singapore Flyer (`0`), Aria (`20 m`) | Wrong: override table |
| Baku Flame Towers, Singapore Flyer wheel, MBS SkyPark, Vegas Eiffel/Sphere | Not in OSM with usable geometry: need proxies |
| Real brand names | Casino/hotel names in OSM tags (Bellagio, Hilton, Marriott, Four Seasons, Wynn...) must not be displayed or texture-mapped; the env.json should drop `name` tags |
