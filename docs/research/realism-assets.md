# Research: realistic look (sky, trees, ground, crowd, trackside, post) (2026-10-13)

Goal: move from "stylized/childish" to realistic at 60 fps on an iGPU. Complements `environment-assets.md` and `track-textures.md` (not repeated unless a pick is replaced). Nothing was downloaded into the repo; only HEAD checks (HTTP 200 + size), API JSON, thumbnails in /tmp.

License verification: Poly Haven and ambientCG pages fetched (CC0 stated on the page; ambientCG: "All assets are released under the Creative Commons CC0 license"). Sketchfab pages do not render in WebFetch, so the license/author/tris come from the same data Sketchfab serves at `https://api.sketchfab.com/v3/models/<uid>` (flagged "API"). Quality judged from thumbnails.

## 1. Sky (HDRI) - Poly Haven, all CC0, no attribution needed

Use 2K for background (4.3-7 MB), 1K for PMREM/IBL if memory matters. URL pattern `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/<1k|2k>/<id>_<1k|2k>.hdr` (HTTP 200 confirmed).

| Name | Page | Author | License | 1K / 2K size | Look | Fit |
|---|---|---|---|---|---|---|
| **kloofendal_48d_partly_cloudy_puresky** | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | Greg Zaal, Jarod Guest (edit) | CC0 | 1.4 / 5.5 MB | Pure sky (no ground), blue with cumulus, midday, high contrast | **Monza** (sun, dry). 3D terrain + haze supplies the horizon |
| **kloofendal_overcast_puresky** | https://polyhaven.com/a/kloofendal_overcast_puresky | Greg Zaal, Jarod Guest | CC0 | 1.2 / 4.3 MB | Pure sky, uniform overcast, low contrast, 6 EV | **Silverstone** (overcast) and **Spa** (grey day); smallest file |
| **misty_pines** | https://polyhaven.com/a/misty_pines | Greg Zaal | CC0 | 1.8 / 7.1 MB | Misty conifer forest, soft light, low contrast | **Spa** mood/IBL (green-grey tint, fog). Horizon has real trees: use for IBL, or as background only if our own forest is hidden behind fog |
| belfast_open_field | https://polyhaven.com/a/belfast_open_field | D. Savva, J. Guest | CC0 | 1.6 / 6.5 MB | Overcast, grass field, low hills, few trees, open sky | **Silverstone** alt (flat open). Gives real horizon colour for fog matching |
| hausdorf_clear_sky | https://polyhaven.com/a/hausdorf_clear_sky | G. Wronkowski | CC0 | 1.5 / 6.2 MB | Bright sun, clear blue, dry field + distant forest, 24 EV, 5400K | **Monza** alt (hard sun, parkland edge) |
| niederwihl_forest | https://polyhaven.com/a/niederwihl_forest | Adrian Kubasa | CC0 | 1.8 / 7.4 MB | Overcast forest clearing, obstructed sky | IBL only for Spa forest sections (sky not visible) |

Notes: "pure sky" variants have no ground/horizon objects, so they do not clash with our terrain and trees; real-horizon HDRIs (misty_pines, belfast, hausdorf) are best used to colour fog/IBL. Overcast HDRIs have low EV (6): use `scene.environmentIntensity` and sun-light intensity per track instead of trusting the file exposure (forum reports overcast looking too bright when tone-mapped naively). More options: ~59 "(Pure Sky)" files at https://polyhaven.com/hdris/skies.

## 2. Trees

| Name | Page | Author | License | Format / size | Tris | Fit |
|---|---|---|---|---|---|---|
| **EZ-Tree** (generator) | https://github.com/dgreenheck/ez-tree , npm `@dgreenheck/ez-tree` 1.1.0 | Daniel Greenheck | MIT (code); bark = ambientCG CC0; leaf PNGs = MIT (per `src/app/public/textures/LICENSE.md`) | npm 23.9 MB unpacked (dev); runtime textures are loaded by URL, copy `Bark0xx_1K-JPG` + `leaves/*.png` into our `public/` | adjustable; `generateLODs()` (40% / 20% tris), `createGeometry(detail)` for own instancing | **Best option.** Leaf textures are real photographed branches with alpha (oak oak.png 1024², pine = spruce sprig; ash, aspen); thumbnails reviewed: realistic, not cartoon. Presets oak/ash/aspen/pine/bush x3 sizes. Build per-species LOD0/1/2 once, bake to GLB, instance |
| Leaf PNGs inside EZ-Tree | https://github.com/dgreenheck/ez-tree/tree/main/src/app/public/textures/leaves | same | MIT (photo origin not stated: flag) | Git LFS: `https://media.githubusercontent.com/media/dgreenheck/ez-tree/main/src/app/public/textures/leaves/oak.png` (238 KB; pine 304 KB, ash 181 KB, aspen 142 KB) | - | Ready cards |
| ambientCG LeafSet024 (beech-like leaves, 9 per sheet, opacity+normal) | https://ambientcg.com/a/LeafSet024 | ambientCG | CC0 | `https://ambientcg.com/get?file=LeafSet024_1K-JPG.zip` 4.7 MB | atlas | Single-leaf atlas for plane/beech canopy cards (replace EZ-Tree leaf map via `leaves.type` custom map) |
| ambientCG LeafSet005 (hornbeam/beech sprigs) | https://ambientcg.com/a/LeafSet005 | ambientCG | CC0 (site-wide; page not fetched) | `...LeafSet005_1K-JPG.zip` 3.3 MB | atlas | Alt leaf cards |
| ambientCG LeafSet019 (cypress/juniper sprigs) and PineNeedles001 | https://ambientcg.com/a/LeafSet019 , https://ambientcg.com/a/PineNeedles001 | ambientCG | CC0 (PineNeedles001 page fetched; 019 site-wide) | 5.5 MB / 4.1 MB 1K | atlas | Conifer sprigs for Spa cards |
| Poly Haven Bark Platanus | https://polyhaven.com/a/bark_platanus | Dimitrios Savva | CC0 | 1K diff 0.9 MB `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_platanus/bark_platanus_diff_1k.jpg` (+nor_gl, rough, AO same pattern) | - | **Plane tree trunk (Monza, Silverstone)**. Real plane bark (flaking), 1.5 m wide |
| Poly Haven Pine Bark / Knotted Pine Bark | https://polyhaven.com/a/pine_bark | D. Savva | CC0 | 1K diff 0.84 MB | - | Spa conifer trunk. Also `jolcham_oak_bark_01` (Charlotte Baglioni) for oak |
| Realistic Tree (hair-card canopy) | https://sketchfab.com/3d-models/realistic-tree-d989c0f801d847b9a74992ec4ddcfdfc | Daniel | CC-BY (API) | glTF via Sketchfab download (login needed) | 19.9k | Realistic broadleaf; use as LOD0 close-up or impostor source |
| Petiolate oak tree | https://sketchfab.com/3d-models/petiolate-oak-tree-748ebed1c5f244bb8f470c4ad5557431 | Georgeous | CC-BY (API) | login | 27.4k | Dense oak; impostor source only (has exposed roots) |
| Spruce tree | https://sketchfab.com/3d-models/spruce-tree-7a5db417827244d98827459bce0cc944 | Georgeous | CC-BY (API) | login | 10.4k | Realistic spruce for Spa mid-LOD / impostor source |
| Poplar tree - hight texture low-poly | https://sketchfab.com/3d-models/poplar-tree-hight-texture-low-poly-model-ec7c1d301bbc43dca5fe5f0650148d13 | T_i_a_D | CC-BY (API) | login | 5.8k (variant 1: 3.3k) | Lombardy-poplar silhouette (Monza); better than stretched aspen |
| Quaternius Stylized Nature MegaKit | in `environment-assets.md` | | CC0 | | | Now **demoted to far filler**: its flat-shaded look is what reads "childish" |
| Tree-It generator | in `environment-assets.md` | | | | | unchanged |
| itch.io "Tree sprites" (klamtii) | https://klamtii.itch.io/tree-sprites | klamtii | custom permissive ("copy, modify, distribute, commercial ok"); not a CC licence: license unverified in formal terms | trees.zip 5.8 MB, CGI renders, conifer/hardwood/birch/dead | 2D | Possible cheap far billboards; resolution unseen. Low priority |

Rejected for runtime: Poly Haven `fir_tree_01` (8M tris, 478 MB .bin), `pine_tree_01` (17M tris, 1.3 GB), jacaranda/island trees (also million-tri geometry-nodes assets). CC0 but only usable as offline impostor-bake sources. Alter 49 "ProForest" tree pack (CC0 per a 2019 article, 100k-600k tris, 734 MB, Gumroad link possibly dead): not verified on its own page.

Impostors: no free photo-based billboard/impostor atlas with a valid licence was found (searches: OpenGameArt, itch, Fab). Bake our own from the EZ-Tree / Sketchfab LOD0 above with `octahedral-impostor` (MIT, agargaro) or an 8-view flipbook (project-owned output). Rule stays: mesh < 15-30 m, simplified 30-100 m, impostor beyond; cards use `alphaTest` (no sorting), `alphaToCoverage` if MSAA is on.

## 3. Distant ground colour

| Name | Page | Author | License | Size | Fit |
|---|---|---|---|---|---|
| **Sentinel-2 L2A True-Colour (TCI), 10 m/px** | License notice: https://ewds.climate.copernicus.eu/licences/ec-sentinel ; STAC: https://earth-search.aws.element84.com/v1 (collection `sentinel-2-l2a`) | ESA / European Union (Copernicus) | Free, full and open (reproduce, adapt, combine, commercial ok). Credit: "Contains modified Copernicus Sentinel data 2025" | Whole tile COG, public S3, no account. Monza (32TNR, 13 Aug 2025, 1.4% cloud): https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/32/T/NR/2025/8/S2C_32TNR_20250813_0_L2A/TCI.tif (337 MB). Spa (31UGR, 11 Aug 2025, 0.005% cloud): https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/31/U/GR/2025/8/S2A_31UGR_20250811_1_L2A/TCI.tif (308 MB). Silverstone (30UXC, 12 Jul 2025, 0.24%): https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/30/U/XC/2025/7/S2C_30UXC_20250712_0_L2A/TCI.tif (117 MB) | **Recommended for 300 m - 10 km.** It is a COG: crop 10-20 km around the circuit with `gdal_translate -projwin` over `/vsicurl/`, resample to 2048², colour-grade offline, ship ~1-2 MB JPG/KTX2. Gives real field/forest/urban patches matching OSM. Too coarse (10 m) below ~300 m |
| EOX Sentinel-2 cloudless | https://cloudless.eox.at | EOX | 2016 = CC BY 4.0 (some sources say BY-SA); 2018-2025 = CC BY-NC-SA; conflicting statements | WMTS | Not needed: raw Sentinel-2 above has no NC clause. Avoid 2018+ layers |
| USGS NAIP / aerial | - | USGS | public domain | - | US only: not applicable |
| National aerial (Lombardia AGEA, Wallonia SPW, UK OS/EDINA) | - | - | restricted/institutional or unverified | - | Rejected: licences are not open |
| Existing: Grass008 / Grass003 / Grass005 + forest_ground_05 (see `track-textures.md`) | | ambientCG / Poly Haven | CC0 | | Near ground (0-300 m); multiply by the satellite colour map beyond 150-300 m |
| Poly Haven `grass_path_2`, `grass_path_3`, `gravelly_sand`, `dirt_floor` | https://polyhaven.com/textures/terrain | Rob Tuytel etc. | CC0 (category-level; pages not fetched) | 1K ~ 1 MB/map | Optional dirt/field-edge variation |

Technique: terrain shader = tiling detail (grass/dirt, 2 scales, hash-rotated to kill repetition) x low-frequency satellite albedo (grayscale-normalised so detail keeps brightness, tinted by satellite colour) with distance blend; fade to fog colour sampled from the HDRI horizon. Macro noise is project-generated (see `track-textures.md`).

## 4. Crowd

No realistic CC0/CC-BY crowd atlas, billboard sheet or low-poly photo-based audience was found (OpenGameArt, itch, Sketchfab API search with cc0/by filters, Fab). Checked and rejected: Loic Norgeot "Lowpoly People" (CC-BY, 20-140k tris, stylized), "Background People for Blender" (CC-BY, 60k tris, animated, too heavy), Soccorpia (pixel art), Fab Stadium Crowd Generator (paid), CGTrader packs (paid/unclear), historical public-domain crowd photos (B/W, unusable).

| Option | Source | License | Fit |
|---|---|---|---|
| **Generate our own atlas offline (recommended)** | Render 8-16 seated/standing poses from Quaternius Universal Base Characters (https://quaternius.com/packs/universalbasecharacters.html, CC0 per page; remember the "no redistribution of individual assets" notice in `environment-assets.md`) with muted clothing palettes, into a 2048² RGBA atlas; instanced quads with per-instance tint, 30-50% empty seats | CC0 source, project-owned output | Realistic proportions, zero licence risk; ~2 tris per spectator |
| Kenney Mini Characters / Low Poly Audience | in `environment-assets.md` | CC0 / CC-BY | Stylized: it is the source of the current "block crowd" look; do not use for the realism pass |
| Procedural far crowd | project shader | own | Beyond 40 m: no sprites, a noise texture of 4-6 desaturated clothing colours + skin dots, darkened toward the tier floor (fake AO), on the stand quad |

Rules: desaturate the palette (S < 0.45), mostly dark/neutral clothing with few bright accents, slight random scale/rotation, billboards face camera only around the Y axis, `alphaTest` not blending, one InstancedMesh per stand section.

## 5. Trackside

| Item | Name | Page | Author | License | Size | Tris | Fit |
|---|---|---|---|---|---|---|---|
| Tyre wall | **Low-Poly Tires** (CommonSpence) | https://sketchfab.com/3d-models/low-poly-tires-ee5c23e22d754841ab101fa3f6f55a9e | CommonSpence | CC-BY (API) | login | 8.0k for ~40 tyres, i.e. ~200 per tyre, with tread | Extract one tyre, instance it: 3-4 rows x spline = thousands of tyres via `InstancedMesh`; tint black/dark grey, painted sidewall bands (plain white/blue, no brands); wall far LOD = flat quad with baked normal. Current "oversized" look: real tyre = 0.65 m dia x 0.30 m wide, stack height 3-4 tyres |
| Tyre wall | Tire Stack (TymonG) | https://sketchfab.com/3d-models/tire-stack-d6fe2865a37947f0b6661c14878242f1 | TymonG | CC-BY (API) | login | 28 | PSX low-poly: far LOD only |
| Tyre rubber | ambientCG Rubber004 | https://ambientcg.com/a/Rubber004 | ambientCG | CC0 | 1K 8 MB | - | Normal/roughness for the rubber (black gym-floor rubber, not tread); tread must come from geometry/model |
| Armco / guardrail | Metal032 (already in repo) + extruded W-beam profile in code | https://ambientcg.com/a/Metal032 | ambientCG | CC0 | 3.7 MB | generated | Keep: real armco is plain galvanised, add dirt/grime vertex colour. No usable free armco model found (the CC-BY "Guard Rail" hits are pedestrian/wooden barriers: rejected) |
| Catch fence | **ambientCG Fence003** (silver diamond wire mesh, with Opacity map) | https://ambientcg.com/a/Fence003 | ambientCG | CC0 | `https://ambientcg.com/get?file=Fence003_1K-JPG.zip` 6.7 MB (maps: colour, normal, rough, opacity, metalness, displacement) | 1 quad per bay | Fence on a plane + posts (instanced cylinders), `alphaTest`; one 1K tile covers ~95 cm so repeat. Fence001 = same mesh in dark green (7.3 MB) |
| Catch fence (model) | Chain Link Fence Low Poly Version | https://sketchfab.com/3d-models/chain-link-fence-low-poly-version-f7d34687536a45108fac3bf1a1055ee2 | Kain Hunter | CC-BY (API) | login | 2.4k | Realistic thumbnail; alternative to the texture approach; Modular Chain Link Fence Set (FrodoUndead, CC-BY, 3.1k) also fits |
| Banner fabric (no ads) | Poly Haven stretch_poplin / terlenka / rough_linen | https://polyhaven.com/a/stretch_poplin | Rico Cilliers (proc.), colormass (photo) | CC0 | 1K diff 0.49 MB `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/stretch_poplin/stretch_poplin_diff_1k.jpg` | quad | Plain woven look for plain-colour banners/hoardings; tint per instance, no text. ambientCG Fabric036 (CC0, 9.6 MB 1K) alt |
| Grandstand metal frame/roof | ambientCG CorrugatedSteel009 (dark grey) | https://ambientcg.com/a/CorrugatedSteel009 | ambientCG | CC0 | 1K 4 MB | - | Roof and fascia |
| Grandstand seats | ambientCG Plastic011 (grey smooth) | https://ambientcg.com/a/Plastic011 | ambientCG | CC0 | 1K 4 MB | - | Seat colour via per-instance tint |
| Grandstand structure | Seating / Bleacher (Baskot) | https://sketchfab.com/3d-models/seating-bleacher-6e0e88fa79c84ae082ef06908ca77650 | Baskot | CC-BY (API) | login | 632 | Real steel stepped frame; generate long stands in code with this profile. "Low poly stadium/sports arena seats" (anDDDres, CC-BY, 3.9k) for seat rows |
| Concrete wall / run-off | Concrete030/034 (repo) | `track-textures.md` | | CC0 | | | unchanged |

## 6. Post-processing (three 0.186.1, built-in addons only, MIT)

Verified in `node_modules/three/examples/jsm/postprocessing`: `EffectComposer`, `RenderPass`, `GTAOPass`, `SSAOPass`, `SAOPass`, `UnrealBloomPass`, `LUTPass`, `OutputPass`, `SMAAPass`, `FXAAPass`, `BokehPass`, `TAARenderPass`. Cost figures are estimates for a 1080p Intel Xe/AMD iGPU; no measured third-party iGPU numbers exist (search found none): measure with `EXT_disjoint_timer_query_webgl2` before committing.

| Pass | Use? | Estimated iGPU cost | Notes |
|---|---|---|---|
| Native tone mapping (`renderer.toneMapping`) | **Always** | ~0 | Switch ACES (hue-shifts, over-saturates reds) to `NeutralToneMapping` or `AgXToneMapping` for a realistic look; no composer required |
| `OutputPass` | When a composer is used | ~0.2 ms | Does tone mapping + sRGB at the end of the chain; put LUT/SMAA after it |
| `UnrealBloomPass` | Medium+, subtle | ~1-1.5 ms (5-mip HalfFloat chain from half-res) | strength 0.15-0.25, radius 0.4, threshold ~0.9 (only sun glare, kerb highlights, headlights). Realistic = barely visible |
| `LUTPass` | Medium+, cheap | ~0.2-0.3 ms | Needs a 3D LUT (`LUTCubeLoader` / `LUT3dlLoader`). Generate a project-owned .cube (slight desaturation, soft contrast, per-track tint) to avoid third-party LUT licences |
| `SMAAPass` | Medium+ if composer MSAA is off | ~0.7-1.2 ms | Composer drops canvas MSAA: either give `EffectComposer` a `WebGLRenderTarget` with `samples: 4` (bandwidth cost) or use SMAA. Prefer SMAA on iGPU. Foliage with `alphaToCoverage` needs MSAA to look good |
| `GTAOPass` | **High tier only** | ~3-6 ms + a second full scene render | It re-renders the scene with an override normal material into `normalRenderTarget` (see `GTAOPass._renderOverride`): doubles draw calls/tris and **ignores alphaTest cards (trees/fences render as solid quads in the normal pass)**. Mitigation: `setGBuffer(depth, normals)` with a shared G-buffer, or restrict AO to layers without foliage. Use `samples: 8-12`, `radius` 0.5-1 m |
| `SSAOPass` / `SAOPass` | No | similar or worse | Superseded by GTAO; SAO documented as very expensive full-screen |
| `BokehPass` / DoF / TAA / SSR | No | - | Costly, little benefit in a racing view |

Practical alternative to SSAO on iGPU (higher realism per ms): baked/vertex AO on barriers, kerbs and grandstands, a soft contact-shadow blob under the car and tyre walls, and CSM (`three/addons/csm/CSM.js`, 2 cascades, 2048 maps) for crisp near shadows.

### Render settings list

1. `renderer.toneMapping = NeutralToneMapping` (or AgX), `outputColorSpace = SRGBColorSpace`; `toneMappingExposure` per track (Monza ~1.0, overcast tracks ~0.8).
2. Sky: `RGBELoader` 2K `.hdr` -> `PMREMGenerator.fromEquirectangular` -> `scene.environment`; `scene.background` the same texture (or the 1K one); `environmentIntensity` 0.6-1.0; one `DirectionalLight` aligned to the sun in the HDRI (sun direction measured once per HDRI), disable for overcast (ambient only + weak fill).
3. Fog: `FogExp2`, density 0.0006-0.0012 (Spa/Silverstone), 0.0004 (Monza); fog colour = HDRI horizon colour, so distant satellite terrain melts into the sky.
4. Shadows: CSM 2 cascades, 2048, `maxFar` ~200 m, `PCFSoftShadowMap`; shadow only the car, barriers, grandstands and trees within 80 m; trees beyond cast none.
5. Pixel ratio: `min(devicePixelRatio, 1.5)` default, adaptive scale 0.75-1.0 driven by frame time (dynamic resolution is the biggest iGPU lever).
6. Tiers: LOW = no composer; MEDIUM = composer (render target `HalfFloatType`) -> bloom (subtle) -> `OutputPass` -> LUT -> SMAA; HIGH = + GTAO (shared G-buffer, foliage excluded).
7. Foliage: `alphaTest 0.5` + `alphaToCoverage` only when MSAA active; mipmaps + anisotropy 4 on leaf atlases, premultiplied-edge-dilated PNG to avoid white halos; wind in the vertex shader.
8. Textures: KTX2 (BasisU) 1K for ground/leaves, 2K for hero asphalt only; HDR kept as .hdr (or converted to RGBE PNG/KTX2 with a pipeline script).
9. Instancing: one `InstancedMesh` per species per LOD, per-instance culling (`@three.ez/instanced-mesh`), impostors beyond 100-150 m.

## Recommended set per track

| | Sky | Trees | Distant ground | Trackside |
|---|---|---|---|---|
| **Monza** (flat, parkland, sunny) | kloofendal_48d_partly_cloudy_puresky (alt hausdorf_clear_sky), light haze | EZ-Tree oak/ash with bark_platanus + LeafSet024 cards; Sketchfab poplar (T_i_a_D) as columnar accent; impostors beyond 120 m | Sentinel-2 32TNR crop (dry, mixed green) over Grass008/003 | Tyre wall (instanced), Fence003 catch fence, plain-fabric banners, steel grandstands |
| **Spa** (forest, cloudy) | kloofendal_overcast_puresky + misty_pines for IBL/fog tint | EZ-Tree pine (spruce-sprig texture) + PineNeedles001/LeafSet019 cards; Georgeous spruce / MegaKit Pine as mid LOD; pine_bark; dense, tall, dark | Sentinel-2 31UGR (dark forest green) over forest_ground_05 | Same set; wetter/darker materials (roughness -0.1) |
| **Silverstone** (open, overcast) | kloofendal_overcast_puresky (alt belfast_open_field) | Few isolated EZ-Tree oaks/ash, hedges with leaf cards, lots of grass cards | Sentinel-2 30UXC crop (flat farmland, lighter) over Grass005/008 | Same set, long armco, Fence003 |

## Top recommendations

1. Replace cone trees with EZ-Tree (photo leaf cards + ambientCG/Poly Haven bark) baked to 3 LODs + impostors; demote Quaternius/Kenney to far filler.
2. Use pure-sky HDRIs (Poly Haven CC0, 2K, 4-5 MB) for IBL and background, with fog colour taken from the horizon; switch to Neutral/AgX tone mapping.
3. Colour the far terrain with Sentinel-2 TCI crops (free, open, attribution line) multiplied over tiling grass/forest-floor, fading into fog.
4. Build the crowd as a self-generated desaturated sprite atlas (from CC0 Quaternius characters) with empty seats and far-field noise; no free realistic atlas exists.
5. Fix trackside scale and material: instanced real-size tyre (~0.65 m) walls with rubber normal map, ambientCG Fence003 wire mesh, plain galvanised armco; keep post-processing to subtle bloom + LUT + SMAA, GTAO high tier only (it doubles the scene pass and breaks on alpha-tested foliage).
