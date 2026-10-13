# Track surface PBR textures (CC0)

Updated 2026-10-12. Supersedes the first ambientCG-only pass (its picks are kept below). All licenses checked on each asset's own page: ambientCG pages state "All assets are released under the Creative Commons CC0 license" (no individual author, publisher = ambientCG); Poly Haven pages show CC0 plus the named author. Nothing was downloaded into the repo; only zip/jpg HEAD checks (HTTP 200) and thumbnails in /tmp. Use NormalGL in three.js.

Maps: ambientCG 1K-JPG zip = Color, NormalGL, NormalDX, Roughness, Displacement (+ AO on some, e.g. Grass005, Gravel041, Concrete030). Poly Haven = Diffuse, nor_gl, nor_dx, Rough, AO, Displacement, ARM (AO/Rough/Metal packed), per-map JPG/PNG/EXR at 1K/2K/4K/8K. Poly Haven per-map URL pattern: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/<1k|2k>/<id>/<id>_<diff|nor_gl|rough|ao|disp|arm>_<1k|2k>.jpg` (HTTP 200 confirmed for diff of asphalt_track, clean_asphalt, asphalt_pit_lane, forest_ground_05, rough_concrete; full URL table for asphalt_track from the files API).

## Asphalt

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **asphalt_track** (PRIMARY) | https://polyhaven.com/a/asphalt_track | Dimitrios Savva | CC0 | diff, nor_gl, rough, AO, disp, ARM | 1K-8K | 1K diff https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_track/asphalt_track_diff_1k.jpg (2K: same with 2k) | Tagged racing/speedway; very dark, fine grain, slightly worn. Ideal race asphalt; may need brightening via material color |
| Asphalt010 (BACKUP, current in repo) | https://ambientcg.com/a/Asphalt010 | ambientCG | CC0 | color, normal, roughness, disp | 1K-8K | https://ambientcg.com/get?file=Asphalt010_1K-JPG.zip | Dark, clean, procedural, slightly blue-grey |
| clean_asphalt | https://polyhaven.com/a/clean_asphalt | Dimitrios Savva | CC0 | full set | 1K-8K | .../jpg/1k/clean_asphalt/clean_asphalt_diff_1k.jpg | Grey, fine, scratches, tagged race track/pit lane; lighter and smoother than asphalt_track. Good second variant (pit lane / overlay) |
| asphalt_pit_lane | https://polyhaven.com/a/asphalt_pit_lane (license by Poly Haven site-wide; page not fetched) | Dimitrios Savva | CC0 (page not fetched individually) | full set | 1K-8K | .../jpg/1k/asphalt_pit_lane/asphalt_pit_lane_diff_1k.jpg | Dark brown-black, coarse; pit lane / run-off alt |
| Asphalt033 | https://ambientcg.com/a/Asphalt033 | ambientCG | CC0 | color, normal, roughness, AO, disp | 1K-8K | https://ambientcg.com/get?file=Asphalt033_1K-JPG.zip (9.7 MB) | Charcoal granular, but brownish-olive tint; usable only if tinted |

Tyre-marked asphalt: NOT found as a PBR set on either site (ambientCG `TireTracks001` is a sand decal; Poly Haven tyre-track assets are mud/moon/sand). Recommendation: generate a project-owned grayscale rubber-line alpha/darkening decal or a "racing line" mask texture (offline script, CC0 by us) and multiply it over asphalt color and lower roughness slightly; no external asset needed.

## Grass (blend variants)

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **Grass005** (PRIMARY, current) | https://ambientcg.com/a/Grass005 | ambientCG | CC0 | color, normal, roughness, AO | 1K-8K | https://ambientcg.com/get?file=Grass005_1K-JPG.zip | Short clean lawn, saturated: desaturate slightly |
| **Grass008** (BACKUP / variant A) | https://ambientcg.com/a/Grass008 | ambientCG | CC0 | color, normal, roughness (+disp) | 1K-8K (1K JPG 10 MB) | https://ambientcg.com/get?file=Grass008_1K-JPG.zip | Finest, uniform mown field; best for far-distance and run-off |
| Grass003 (variant B, dark) | https://ambientcg.com/a/Grass003 | ambientCG | CC0 (site-wide statement; page not fetched individually) | color, normal, roughness | 1K-8K | https://ambientcg.com/get?file=Grass003_1K-JPG.zip (10.7 MB) | Darker olive, drier; good for blending patches away from the track |
| Grass006 (variant C) | https://ambientcg.com/a/Grass006 | ambientCG | CC0 | color, normal, roughness | 1K-8K | https://ambientcg.com/get?file=Grass006_1K-JPG.zip (10.4 MB) | Bright, coarse leafy; too saturated, use sparingly |

Rejected: Grass007 (weeds, twigs), Grass002 (dark, dense, shaggy), Poly Haven grass sets (leafy_grass, sparse_grass, grass_ground: wild/dead grass, not mown).

## Gravel trap

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **Gravel041** (PRIMARY, current) | https://ambientcg.com/a/Gravel041 | ambientCG | CC0 | color, normal, roughness, AO | 1K-8K | https://ambientcg.com/get?file=Gravel041_1K-JPG.zip | Fine rounded small stones, beige-grey/olive; best match |
| Gravel040 (BACKUP) | https://ambientcg.com/a/Gravel040 | ambientCG | CC0 | color, normal, roughness | 1K-8K | https://ambientcg.com/get?file=Gravel040_1K-JPG.zip (10.1 MB) | Grey slate chips, angular and a bit coarser; fewer beige tones |

Rejected: Gravel023 (white, coarse), Gravel022/026 (multicolour pebbles), Gravel024 (black), Ground091 (fine but looks like sandy concrete, not stones).

## Dirt / soil

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **Ground048** (PRIMARY) | https://ambientcg.com/a/Ground048 | ambientCG | CC0 | color, normal, roughness (+disp) | 1K-16K | https://ambientcg.com/get?file=Ground048_1K-JPG.zip (10.7 MB) | Dark brown loose soil/mulch; good for trackside dirt and verge |
| Ground104 (BACKUP) | https://ambientcg.com/a/Ground104 | ambientCG | CC0 | color, normal, roughness | 1K-8K | https://ambientcg.com/get?file=Ground104_1K-JPG.zip (9.8 MB) | Dry sandy-ochre earth, a bit strong in yellow; tint down |
| forest_ground_05 | https://polyhaven.com/a/forest_ground_05 | Charlotte Baglioni | CC0 | diff, nor_gl, rough, AO, disp, ARM | 1K-16K | .../jpg/1k/forest_ground_05/forest_ground_05_diff_1k.jpg | Fine compact dark soil, very uniform, low noise; alt for tiling-free dirt |

## Concrete (pit wall, run-off)

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **Concrete030** (PRIMARY, current) | https://ambientcg.com/a/Concrete030 | ambientCG | CC0 | color, normal, roughness, AO | 1K-8K | https://ambientcg.com/get?file=Concrete030_1K-JPG.zip (7.7 MB) | Plain grey, neutral |
| rough_concrete (BACKUP) | https://polyhaven.com/a/rough_concrete | Dimitrios Savva | CC0 | full set | 1K-8K | .../jpg/1k/rough_concrete/rough_concrete_diff_1k.jpg | Coarse cement plaster, greenish-grey, strong relief; for walls rather than surfaces |

## Kerb (painted concrete / tintable)

No red/white painted kerb or rubber kerb PBR set exists on either site (Poly Haven `painted_concrete` is green and heavily weathered, `concrete_floor_painted` is dark and rusty; both rejected). Approach: use a plain pale concrete, set red/white via vertex color or per-stripe material color (stripe pattern in UV or a project-made 2-colour mask).

| Name | Page | Author | License | Maps | Res | Download | Fit |
|---|---|---|---|---|---|---|---|
| **Concrete034** (PRIMARY) | https://ambientcg.com/a/Concrete034 | ambientCG | CC0 | color, normal, roughness, disp | 1K-16K | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip (3.7 MB) | Near-white, smooth, very small download; multiplies cleanly with red and white |
| Concrete030 (BACKUP) | https://ambientcg.com/a/Concrete030 | ambientCG | CC0 | as above | 1K-8K | see above | Grey base: tint dulls whites; use with a brighter multiplier |

## Macro-variation / anti-tiling noise

No suitable ready-made CC0 low-frequency noise texture was found on ambientCG or Poly Haven (their assets are photographic, not noise). Recommendation: generate a tileable 512x512 fbm/value-noise (grayscale, 1 channel or packed RGB for 3 scales) with an offline script in `tools/` (project-owned, no license issue), then sample at 1/20-1/50 of the material UV frequency and modulate albedo +-15% (and optionally roughness). Cheaper than any download and avoids another 1 MB texture.

## Current repo textures (public/textures, 18 MB total, source ambientCG CC0 in ASSETS_LICENSES.md)

| Dir | Source | Keep? |
|---|---|---|
| asphalt | Asphalt010 | Keep as backup/second variant; switch primary to asphalt_track if darker, finer look is wanted (A/B in-engine) |
| grass | Grass005 | Keep (primary) |
| gravel | Gravel041 | Keep (primary) |
| concrete | Concrete030 | Keep (primary pit wall/run-off) |
| metal | Metal032 | Keep (armco) |

## Top picks (new work)

1. Asphalt: asphalt_track (Poly Haven) primary, Asphalt010 existing backup, clean_asphalt for pit lane.
2. Grass: Grass005 + Grass008 + Grass003 (3-way blend).
3. Gravel: Gravel041 (keep). Dirt: Ground048. Concrete: Concrete030 (keep).
4. Kerb: Concrete034 tinted; tyre marks and macro noise: generate procedurally, not downloaded.

Budget note: three grass + one dirt at 1K JPG is about +40 MB source; target runtime KTX2 at 1K (2K for asphalt only) per PRD <512 MB texture memory. Poly Haven per-map download means no zip is needed.
