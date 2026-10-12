# Research: vegetation, grandstands and trackside elements (2026-10-11)

Filter: CC0, CC-BY, CC-BY-SA, MIT, CC-BY-NC. Stylized semi-realistic style. "Search" = license read from the Sketchfab search results, not from the model page (check before use).

## Quaternius license notice

The pack pages say CC0, but https://quaternius.com/license.html now publishes the "Quaternius Asset License v1.0" (commercial use, no attribution, redistributing the individual assets is prohibited, changes are not retroactive). The OpenGameArt zip of the Stylized Nature MegaKit (Standard) ships a `License.txt` with CC0 1.0: keep that zip together with its license.

## Vegetation

| Asset | License | Tris | Fit | URL |
|---|---|---|---|---|
| **EZ-Tree** (procedural three.js generator) | MIT | configurable, `generateLODs()` | Very good; presets Oak, Ash, Aspen, Pine, Bush | https://github.com/dgreenheck/ez-tree |
| **Stylized Nature MegaKit** (Standard) | CC0 (zip) | CommonTree 6.3k · Pine 3.9k · Bush 900 · Grass 326 | Best of the packs; bark with normal map | https://quaternius.com/packs/stylizednaturemegakit.html |
| Kenney Nature Kit | CC0 | 60–224 | Flat low-poly: far LOD / filler | https://kenney.nl/assets/nature-kit |
| Oak / Beech / Spruce Trees FREE Low Poly (LadyLionStudios) | CC-BY 4.0 | 16k / 5k / 8k | Semi-realistic, alpha leaves; needs impostor | https://sketchfab.com/3d-models/7a689370f9ec46cea2cbc94641c225e6 |
| Oak Tree Variations With Low Poly Variants | CC-BY 4.0 | low variants as LOD | Semi-realistic | https://sketchfab.com/3d-models/a4c05606689d47b9b9ca56d563b27998 |
| Christmas tree low poly 4 lods | CC-BY (search) | 4 LODs | Fir | https://sketchfab.com/3d-models/9d5502124c954756a347d7ab07557b93 |
| Quaternius / Isa Lousberg hedges (Poly Pizza) | CC0 | — | — | https://poly.pizza/m/df8uCl1YpK |
| ambientCG LeafSet / Foliage | CC0 | textures | Grass cards and hedges | https://ambientcg.com/view?id=LeafSet010 |
| Tree-It (tool) | Freeware, output is yours | adjustable LOD | Semi-realistic | http://www.evolved-software.com/treeit/treeit |

Discarded: Poly Haven (millions of tris), Kenney/Quaternius "Ultimate Nature" flat low-poly (only fits in the distance). There are no low-poly plane trees or poplars with a valid license: use EZ-Tree (stretched Aspen = poplar; Oak/CommonTree = plane tree).

## Grandstands and crowd

| Asset | License | Tris | Notes | URL |
|---|---|---|---|---|
| Kenney Racing Kit: grandStand, grandStandCovered, …Round, Awning | CC0 | 128–1,302 | Base block to retexture | https://kenney.nl/assets/racing-kit |
| Low Poly Audience For Mobile Game | CC-BY 4.0 | 862, animated | Made for racing | https://sketchfab.com/3d-models/c8cc901ed54b4fd0b24b88d8e0276947 |
| Kenney Mini Characters | CC0 | ~723 | To generate billboard atlases | https://kenney.nl/assets/mini-characters |
| Stands/Tribunes | CC-BY 4.0 | 8.8k untextured | — | https://sketchfab.com/3d-models/9745757584ef46b7be11235af84225a9 |
| Grandstand (Catholomew) | CC-BY-NC | 89k | Heavy; mark as NC | https://sketchfab.com/3d-models/b755d45da2d94050994a2fe907b4eb2d |

Rejected: "Freebie – Lowpoly People" (CC-BY-NC-ND, modifications not allowed). Recommended crowd: instanced billboards generated from Mini Characters / Low Poly Audience with random tint.

## Trackside elements

| Asset | License | Notes | URL |
|---|---|---|---|
| Kenney Racing Kit (rest) | CC0 | boxes (pitsGarage/Office), overheadLights, gantries, barriers, rail, fences, signs, flags, bridges | https://kenney.nl/assets/racing-kit |
| Race Track Assets Pack (Cherk) | CC-BY 4.0 | PBR 2K, 563k tris: reduce; reuse textures and braking-board signs | https://sketchfab.com/3d-models/4a863e7005d647adb2f72775cf41e808 |
| TECPRO Barriers (DylanJade3D) | CC-BY (search) | 12k | https://sketchfab.com/3d-models/03701e54c27b418e9e1dfda73d69dc76 |
| Starting Lights | CC-BY (search) | 2.4k | https://sketchfab.com/3d-models/4f3bd911404a4952bedc5c9aa5f5d9e3 |
| Tire Stack | CC-BY (search) | 28 tris | https://sketchfab.com/3d-models/d6fe2865a37947f0b6661c14878242f1 |
| Concrete Barrier | CC-BY (search) | 780 | https://sketchfab.com/3d-models/1892932416e149e9931422d1bacb1e2d |

Discarded: VDrift, Stunt Rally, TORCS (GPL art); SuperTuxKart and Speed Dreams only after checking asset by asset.

**Generate in code** (extrusion along the edge spline): guardrail, mesh fence (instanced posts + alpha plane), kerbs, walls, TecPro, tire barriers, lines, long grandstands, advertising gantries.
**Download or model**: pit building (Kenney base), control tower, footbridges, starting lights, marshal posts.

## Set per circuit

- **Monza:** EZ-Tree Oak/Ash + Aspen as poplar; MegaKit CommonTree/TwistedTree at mid distance; MegaKit Bush, Grass, Fern; impostors or Kenney in the distance.
- **Spa:** MegaKit Pine + EZ-Tree Pine; LadyLionStudios Spruce/Beech; Kenney pineTall/pineRound on distant slopes.
- **Silverstone:** isolated oaks and ashes (EZ-Tree), procedural hedges with ambientCG texture, lots of grass cards, few trees.

## Rendering technique

- Instancing: `@three.ez/instanced-mesh` (MIT; per-instance culling and LOD), https://github.com/agargaro/instanced-mesh. Alternatives: native `InstancedMesh` / `BatchedMesh`.
- LOD: EZ-Tree `generateLODs()`, meshoptimizer/gltfpack (MIT), gltf-transform.
- Impostors: octahedral-impostor (MIT, in development, not on npm), https://github.com/agargaro/octahedral-impostor. Demo with ~200k trees: mesh < 15 u, simplified 15–100 u, impostor > 100 u.
- Grass: instanced cards in chunks with `alphaTest` (no transparency) and wind in the vertex shader.
- Rule: < 3k tris up close, ~500 at mid distance, impostor from 100–150 m.
