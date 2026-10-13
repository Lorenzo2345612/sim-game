# Car models research (2026-10-12, asset-scout)

Source: Sketchfab API records (downloadable flag set). License verified on page only for Mercedes SLS GT3; the rest API-verified (HTTP 429 blocked page fetches). Separate wheels, interior and PBR are unverified: inspect before choosing. URL: `https://sketchfab.com/models/<id>`. "Rip" = description says it comes from a game (Real Racing 3, CSR, Asphalt): CC label is the uploader's claim; avoid.

## GT3 (CC-BY 4.0 unless noted)

| # | Model (id) | Author | Tris | GLB / textures | Logos | Notes |
|---|---|---|---|---|---|---|
| 1 | 2018 McLaren 720S GT3 (`905a74cf57f844a4b414980f42d9fc41`) | No Limits | 40.7k | 1.8 MB, none | none | clean, needs materials/livery; provenance unknown |
| 2 | Low Poly Audi R8 GT3 (`d71e1fce9acd4adb93c5ca927fee9531`) | Mauro3D | 23.4k | 1.4 MB, none | none | stylized low-poly, good for LOD/AI cars |
| 3 | 2022 Porsche 911 GT3 RSR (`6370209fd29e4752b53fea3dcceeea13`) | No Limits | 124k | 6.8 MB, none | none | decimate to ~60k |
| 4 | Lamborghini Huracán GT3 (`6700aa37025449918b9a680b5ba093f9`) | JUSTGAME | 106.7k | 7.8 MB, 15 tex ≤2k | sponsors baked | most detail; repaint livery |
| 5 | BMW M4 GT3 (`cb6ce32d23e549a289dcc264008abcda`) | kevin | 170k | 7.0 MB, none | BMW grille | good shape, decimate |
| 6 | Low Poly BMW Z4 GT3 Stylized (`98cf1e3ff1dc4064b7f5535aeb540f20`) | 3DVice | 12.6k | 52 MB, 13 tex 4k | BMW, numbers | cartoony |
| 7 | Mercedes SLS GT3 (`5ec93bea4816494cbe3e7333bbfca5f6`) | Dave Love | 176k | — | unknown | page-verified CC-BY 4.0 |

Backups: Ferrari 488 GT3 (`bb14ee3833564f349a317d704a506cd3`, rip), Huracán GT3 2015 (`3e229d0e0f1a43bfa33748c485e56939`, rip), Audi R8 LMS (`18686ee8ea0b493da1ad006185ae5bc7`, 59k), heavy sim-like sets 300–490k (Mercedes-AMG GT3 EVO `458f9b78ab784b82a360f9efa4a8ab67`, Ferrari 296 GT3 `e6760847bb2d4b579d43cf916f348526`, Aston Martin Vantage GT3 `fbd3494e950c40ecb536f1335296345d`).

## GT4

| # | Model (id) | Author | Tris | Notes |
|---|---|---|---|---|
| 1 | 2022 Lotus Emira GT4 (`440775785e97483ebe7f34ceb9d63794`) | Silyboy | 36.3k | 10 MB, 4 tex 2k; not marked as rip |
| 2 | Porsche Cayman GT4 (`9b8689f0825147808d1006ddd486f68d`) | Mona x Supercars | 50k | provenance unknown |
| 3 | BMW M4 F82 GT4 (`950f5b87902643a3b6127b639c4ef937`) | Ddiaz Design | 64.8k | rip |

## Touring (TCR/DTM/BTCC)

| # | Model (id) | Author | Tris | Notes |
|---|---|---|---|---|
| 1 | Cherrier Vivace TCR (`09c31fb53b4040998ce51ced412307fb`) | akyolefe319 | 133.7k | fictional brand; 70 MB, 4k textures: heavy reduction |
| 2 | BMW M4 DTM 2017 (`40ecf3aaba714fe19d3043065536681c`) | InReality Solutions | 22.8k | dense livery |
| 3 | Volvo 850 BTCC (`06514b837a664db3be7260df12832d22`) | marksform | 20.8k | plain, simple interior |

## Prototypes (LMP/LMDh)

| # | Model (id) | Author | Tris | Notes |
|---|---|---|---|---|
| 1 | KatAttak KA01 LMP2 (full `6044bd804bed4ac4b9f0c782c5c3459b`, body `5ae1275afe494b7a827a2dcb417a5be1`, wheels `66f9b9730f2443b38d49c4baf3455902`) | mosigana | 233k | original, brandless, separate wheels |
| 2 | Le Mans Prototype (`8f711f4dc62648fb8b9d5b3c6c1ec931`) | mudkipz321 | 41.9k | own design, generic livery |
| 3 | Cadillac V-Series.R LMDh (`efe600b0b1694e2aae055f35db3aaeda`) | supranakamura | 77k | white, real shape |

## Other single-seaters

| # | Model (id) | Author | Tris | Notes |
|---|---|---|---|---|
| 1 | Generic Formula Car (`46e0805e009a42f297405d943d6ce22e`) | CarlosCG31 | 16.6k | generic, no logos |
| 2 | Formula F211 (`cada3b67c43744adadee21adcabc4fc4`) | CarlosCG31 | 36.9k | generic |
| 3 | Formula E Nissan Gen2 (`46d13900441840c18b9222fa05c73f74`) | CLeN | 13.3k | logos baked |

## Caveats

CC-BY needs an in-game credit per model. CC-BY-NC-SA rips: last resort only. Real car shapes/logos must be de-branded before public release (PRD §14). Expect Blender-free fixes via our gltf-transform pipeline (task 053 pattern) for wheel splitting.

## Prototypes (LMP2, Hypercar) (2026-10-13, asset-scout)

Method: Sketchfab search API (`downloadable=true`) plus `/v3/models/<uid>` for license, faces and material counts. Page fetch returns empty (JS), so licenses are API-verified, not page-verified. Nothing downloaded: Sketchfab downloads need login, so wheel separability is unverified for every row ("by material" = only inferable from material count; inspect GLB node/material names first). Tris = API `faceCount` (triangles). Download URL = page URL (click Download, glTF/GLB or source format). Many LMDh/LMP2 uploads are game rips with a CC label (MattDoesBlender, kilianhoffmann13, Dave Love, vecarz, LMP12, VuckyZ, bluspycrab "Asphalt Legends"); all of those above 150k tris anyway and excluded.

### LMP2 (closed cockpit)

Sketchfab has almost no clean LMP2 under 150k. No Dallara P217, Gibson 015S or Norma found.

| Name | Page | Author | License | Tris | Format | Wheel separability | Notes |
|---|---|---|---|---|---|---|---|
| Ligier Js Px (`72432f51423d429e93f4981563d76fb8`) | https://sketchfab.com/3d-models/ligier-js-px-72432f51423d429e93f4981563d76fb8 | Kerdak123 | CC-BY 4.0 | 137.5k | Sketchfab glTF (1 material, no textures) | Unknown; single material so split by quadrant (task 071) | Right class (tags lmp2, ligier), closed cockpit; real-brand shape; author notes some dark parts; at tri limit, simplify to 70k |
| Oreca 07 body (`87787e39269a49159fd11f39efa7ea53`) | https://sketchfab.com/3d-models/oreca-07-body-87787e39269a49159fd11f39efa7ea53 | MattDoesBlender | CC-BY 4.0 | 74.3k | glTF (3 materials, 3 tex) | "body" only: wheels likely absent or separate upload, unverified | Right car, no description: probable game rip (provenance unknown). Full Oreca 07 variants by same author are 350-725k (rejected) |
| KatAttak KA01 LMP2 Full / Body / Wheels (`6044bd80...`, `5ae1275a...`, `66f9b973...`) | https://sketchfab.com/3d-models/katattak-ka01-lmp2-prototype-full-6044bd804bed4ac4b9f0c782c5c3459b | mosigana | CC-BY 4.0 | 233k full, 151k body, 41k wheels | glTF | Yes (separate wheels upload) | Original brandless design (already in the table above). Body 151k + wheels 41k each need heavy decimation; best legal-safety option |
| Le Mans Prototype (`8f711f4dc62648fb8b9d5b3c6c1ec931`) | https://sketchfab.com/3d-models/le-mans-prototype-8f711f4dc62648fb8b9d5b3c6c1ec931 | mudkipz321 | CC-BY 4.0 | 41.9k | glTF | Unknown | Own design based on Porsche 919 (LMP1, open-ish); description allows commercial use; good low-poly fallback, not closed-cockpit LMP2 |
| Lumin TSX-8 LM prototype Custom (`48591cb890954cb6975d71813eae8ded`) | https://sketchfab.com/3d-models/48591cb890954cb6975d71813eae8ded | Substep | CC-BY 4.0 | 38.8k | glTF | Unknown | Fictional name; not inspected further |

### Hypercar / LMDh

| Name | Page | Author | License | Tris | Format | Wheel separability | Notes |
|---|---|---|---|---|---|---|---|
| 2023-2026 Cadillac V-Series.R LMDH (`efe600b0b1694e2aae055f35db3aaeda`) | https://sketchfab.com/3d-models/2023-2026-cadillac-v-seriesr-lmdh-hypercar-efe600b0b1694e2aae055f35db3aaeda | supranakamura | CC-BY 4.0 | 77.4k | glTF (18 materials, no textures) | Probable by material (18 mats), unverified | Already in list; right poly budget, white livery, real shape/logos to remove |
| 2023-2026 Ferrari 499P (`359b41f7c14941c8bceafbc3ac98c537`) | https://sketchfab.com/3d-models/2023-2026-ferrari-499p-359b41f7c14941c8bceafbc3ac98c537 | supranakamura | CC-BY 4.0 | 32.3k | glTF (12 mats, 5 tex) | Unknown | Very light, good instancing/AI candidate; same author as Cadillac so consistent style; may lack detail |
| 2021 Peugeot 9x8 (`74f339dcb0c04d439c52c14a96b2ab8f`) | https://sketchfab.com/3d-models/2021-peugeot-9x8-74f339dcb0c04d439c52c14a96b2ab8f | Drifter Models | CC-BY 4.0 | 106k | glTF | Unknown | Wingless LMH, distinctive; alternative |
| Peugeot 9X8 2023 (`b531cef880af4fdbbbc46096871f0555`) | https://sketchfab.com/3d-models/peugeot-9x8-2023-peugeot-le-mans-2023-1008-b531cef880af4fdbbbc46096871f0555 | MattDoesBlender | CC-BY 4.0 | 110.7k | glTF | Unknown | No description, game-rip style naming (provenance unknown) |
| Alpine A480 Le Mans Hypercar (`ecf9e90dd9c34f6c8b3578973c051a22`) | https://sketchfab.com/3d-models/alpine-a480-le-mans-hypercar-ecf9e90dd9c34f6c8b3578973c051a22 | JUSTGAME | CC-BY 4.0 | 83.4k | glTF (7 mats, 1 tex) | Unknown | LMP1-era (LMH-like) shape; JUSTGAME models are low-poly game conversions |
| BMW M Hybrid V8 (`19be670d781c40929e135f6c34e4151f`) | https://sketchfab.com/3d-models/bmw-m-hybrid-v8-19be670d781c40929e135f6c34e4151f | bluspycrab | CC-BY 4.0 | 95k | glb + blend + textures in archive | Unknown (blend included) | Tagged Ripped / Asphalt Legends: rip, avoid unless nothing else |
| Acura ARX-06 (`50cd62b850a04eaaacfbcb8c72f8d74a`) | https://sketchfab.com/3d-models/50cd62b850a04eaaacfbcb8c72f8d74a | VuckyZ | CC-BY 4.0 | 37.5k | glTF | Unknown | Real Racing 3 rip, avoid |

### Rejected

| Model | Reason |
|---|---|
| Peugeot 9X8 (Ddiaz, `442e1579...` 83k, `0f86d9bd...` 94k), Porsche 919 (Ddiaz `daf65582...` 41k), BMW M Hybrid V8 RR3 (VuckyZ `259eab8c...`), Audi R15 OUTPISTON | CC-BY-NC-SA (NC; Ddiaz sets are game rips) |
| Oreca 07 `ed6f3727`, `20e9d780`, `6a64a865`, `08b298c8`, `4871fa74` (725k, 352k, 666k, 357k, 357k); `oreca 07.7z` upload (CC-BY-NC-SA) | Over 150k tris |
| Porsche 963 (all 290k-1M), Ferrari 499P (Dave Love/vecarz/MattDoesBlender 130k-1.9M, body-only 130k has no wheels), Toyota GR010 (all 358k+), BMW M Hybrid V8 (400k+), Cadillac (Dave Love/others 440k+), Lamborghini SC63 (257k), Genesis GMR-001 (283k+), Peugeot 9X8 EVO (349k+) | Over 150k tris; many game rips. Decimating to 70k is possible but quality and provenance risk |
| Ligier JS P217/Oreca 07 from other platforms | Not searched beyond Sketchfab (cgtrader/Free3D/TurboSquid-free license terms generally rejected) |

### Top picks

- LMP2: Ligier Js Px (Kerdak123, 137.5k, CC-BY) for the right class and closed cockpit. Safer legal alternative: KatAttak KA01 (original design, separate wheels, heavy decimation). Oreca 07 body (74k) only if its GLB turns out to include wheels.
- Hypercar/LMDh: Cadillac V-Series.R (supranakamura, 77k) and Ferrari 499P (supranakamura, 32k), both CC-BY, same author so a consistent pair.
- Next step before choosing: open each GLB in a viewer, check wheel nodes/materials, existence of interior and logos.

### Class data (for CarSpec calibration)

| Parameter | LMP2 (Oreca 07 / Ligier JS P217) | LMDh (Porsche 963, Cadillac V-Series.R) | LMH (Toyota GR010, Ferrari 499P) |
|---|---|---|---|
| Min mass (no fuel/driver) | 930 kg | 1030 kg (BoP-adjustable) | 1040 kg GR010; 1030 kg 499P |
| Power | 450 kW (603 hp) 4.2 L Gibson GK428 V8 NA, 536 hp from 2021 (restricted) | 500 kW (about 680 PS) combined; 963: 4.6 L twin-turbo V8 + 50 kW MGU; V-Series.R 5.5 L NA V8 | 500 kW max combined; GR010 3.5 L V6 TT 500 kW + 200 kW front motor (AWD only above about 190 km/h); 499P 3.0 L V6 TT 500 kW + 200 kW front motor |
| Length x width | 4745 x 1895-1900 mm | 5100 x 2000 mm (max regs; 963: 5100/2000) | GR010 4900 x 2000 mm |
| Height | 1045-1050 mm | about 1050-1150 mm | GR010 1150 mm |
| Wheelbase | 3005 mm (Oreca), 3010 mm (Ligier) | 3150 mm common (963: 3148) | not found (assume 3000-3150; check FIA Hypercar regs) |
| Track (F/R) | 1570 / 1550 mm (Oreca) | not found (assume about 1650-1700 inside 2000 mm width) | not found |
| Tyres | 30/68R18 F, 31/71R18 R; rims 12.5 in F, 13 in R | Michelin 29/71-18 F, 34/71-18 R | Michelin 29/71-18 F, 34/71-18 R |
| Top speed | about 300-330 km/h (Le Mans, low-drag trim; not sourced) | above 330 km/h per game blog only (unreliable); Le Mans trap speeds about 340 km/h | similar, about 340 km/h |
| Downforce/drag | Roughly 1000 kg at 200 km/h cited on a forum for a P217 (unverified); regs aim CL*A about 3000-3500 N-class | Regs define an aero window with downforce:drag about 4:1 (CdA about 1.0, ClA about 4.0 m2 on a forum, appendix not public). 4:1 is Motorsport Magazine | same window as LMDh (BoP-equalised) |
| Fuel tank | 75 L | about 75-90 L (not sourced) | not sourced |

Treat track widths, top speeds and downforce as estimates until a primary source (FIA LMDh regs PDF, manufacturer data sheets) is read; no reliable published downforce in kg at 250 km/h was found.

Sources:
- https://en.wikipedia.org/wiki/Oreca_07
- https://en.wikipedia.org/wiki/Ligier_JS_P217
- https://en.wikipedia.org/wiki/Gibson_GK428_engine
- https://tdsracing.fr/en/voitures (tyre sizes)
- https://lemansultimate.com/?p=1574
- https://en.wikipedia.org/wiki/Porsche_963
- https://en.wikipedia.org/wiki/Ferrari_499P
- https://en.wikipedia.org/wiki/Cadillac_V-Series.R
- https://en.wikipedia.org/wiki/Toyota_GR010_Hybrid
- https://racer.com/2020/09/18/imsa-reveals-more-lmdh-technical-regulations/ (1030 kg, 5.1 m, 2.0 m, 3.15 m, 500 kW)
- https://fia.com/sites/default/files/lmdh-technical-regulations-2024.10.22.pdf (not read in full)
- https://motorsportmagazine.com/articles/sports-cars/le-mans-hypercar-latest-entries-rules-and-specs-for-the-new-sports-car-category (4:1 window)
- https://redlib.ssps.io/r/wec/comments/1ja2o7d/hypercar_downforce (forum, unverified)
