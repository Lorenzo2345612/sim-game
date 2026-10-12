# PRD — Open-wheel racing web simulator (working name: "Apex Web")

| Field | Value |
|---|---|
| Version | 0.2 (draft) |
| Date | 2026-10-11 |
| Status | Being defined |
| Platform | Web browser (desktop first) |

---

## 1. Vision

Open-wheel racing simulator (F4/F3/F2/F1-style categories, with no license from any of them), playable in the browser without installation, that faithfully reproduces the layout of real circuits from the F1 calendar. The goal is a middle ground between arcade and simulation ("sim-cade"): believable physics, a high sense of speed, accessible controls with keyboard and gamepad, and configurable aids to raise the difficulty.

Visual style: **stylized semi-realistic** (simplified PBR, clean colors, careful lighting), prioritizing readability and performance over photorealism.

Project model: **free and non-profit** (personal project / portfolio).

## 2. Goals

1. Drive an open-wheel car on circuits with a geographically faithful layout (corner positions, lengths and approximate elevation change).
2. Attractive visual environment: asphalt, kerbs, run-off areas, walls, fences, grandstands, trees and vegetation, dynamic sky.
3. Stable performance: 60 FPS on an average laptop with a recent integrated GPU, at "medium" quality.
4. Fast initial load: less than 10 s until the player can drive, on a 50 Mbps connection.
5. Architecture that allows adding new circuits through a semi-automatic pipeline (data → mesh → scene).

### Non-goals (v1)

- Official F1 licenses, teams, drivers or sponsors.
- Real-time multiplayer (planned for later phases).
- Complex physical damage, changing weather during the race, full tire strategy.
- Full mobile support (only verification that it doesn't break).

## 3. Target audience

- F1 fans who want to try real circuits without buying a simulator.
- Casual browser players (keyboard).
- Gamepad or wheel players (Gamepad API) looking for something more demanding.

## 4. Legal considerations (blocking)

- "Formula 1", "F1", branded "Grand Prix", logos, team names, drivers and liveries are registered trademarks. **They will not be used.** The car will be a generic open-wheel car with our own liveries.
- The official names of some circuits are trademarks. **Decision:** the city/region name is used ("Monza", "Spa", "Silverstone"), without full commercial names.
- **Valid asset licenses** (non-profit project, zero budget): CC0, CC-BY, CC-BY-SA, MIT/BSD and **CC-BY-NC** (since there is no monetization). "Personal use only" or "editorial" assets are not used. If the project is monetized in the future, all NC assets must be replaced, so every NC asset is flagged as such.
- CC-BY-SA / GPL assets: require publishing derivatives under the same license. Acceptable if the asset repository is open.
- An `ASSETS_LICENSES.md` register will be kept with source, author, license, URL and NC flag for each asset, plus an in-game credits screen (a CC-BY requirement).
- Car models with sponsor logos or real liveries: reused only after **removing branding** and repainting textures.

## 5. Technical stack

### 5.1 Render engine — decision: **Three.js**

| Option | Pros | Cons |
|---|---|---|
| **Three.js** (chosen) | Huge ecosystem, lightweight, full control, WebGPU renderer available, good glTF support | More pieces to build (editor, LOD, etc.) |
| Babylon.js | More "complete" engine (built-in physics, inspector, editor) | Heavier, fewer racing examples |
| PlayCanvas | Visual editor, highly optimized | Cloud-based editor, less pipeline control |

**Decision:** plain TypeScript + HTML/CSS for UI and HUD. No React.

Renderer: `WebGLRenderer` as the baseline and `WebGPURenderer` as a progressive enhancement when available.

### 5.2 Physics — decision: **Rapier (`@dimforge/rapier3d-compat`)**

- WASM, deterministic, fast.
- Includes a *ray-cast vehicle controller* (port of Bullet's `btRaycastVehicle`) useful as a base.
- For open-wheel cars, a **custom tire model** (simplified Pacejka-style curve) and aerodynamics (downforce and drag proportional to v²) will be implemented on top, because the default controller doesn't give an open-wheel feel.
- Fixed physics step at 120 Hz (sub-stepping), render decoupled with interpolation.
- Discarded alternatives: cannon-es (no active maintenance, lower performance), Ammo.js (heavy, awkward API).

### 5.3 Rest of the stack

| Area | Technology |
|---|---|
| Language | TypeScript |
| Build | Vite |
| 3D format | glTF 2.0 / `.glb` with Draco or Meshopt compression + KTX2 (Basis) textures |
| Asset optimization | `gltf-transform` (CLI) in the pipeline |
| Audio | Web Audio API (engine synthesis/granular mixing by RPM) |
| Input | Keyboard, Gamepad API (compatible gamepads and wheels) |
| UI / HUD | Overlaid HTML/CSS, plain TypeScript |
| Local persistence | IndexedDB / localStorage (best laps, settings) |
| Tests | Vitest (logic, physics), Playwright (browser smoke tests) |
| Hosting | Static + CDN (Cloudflare Pages / Vercel / Netlify) |

## 6. Circuit data

### 6.1 Layout source

- **`bacinger/f1-circuits` repository** (MIT license): GeoJSON with the centerline of ~40 circuits from the current and historical F1 calendar (Monza, Spa, Silverstone, Suzuka, Interlagos, Monaco, Baku, Las Vegas, etc.). Includes one file per circuit and layout year.
- Limitations: centerline only, in lat/lon; it does **not** include track width, per-point elevation, kerbs, pit lane or environment.

### 6.2 Complementary data

| Data | Proposed source |
|---|---|
| Elevation | Digital elevation model (Copernicus GLO-30 or SRTM, 30 m) sampled along the centerline and smoothed |
| Track width, pit lane, run-off areas | OpenStreetMap (`highway=raceway`, `width`, `landuse` areas) under the ODbL license (requires attribution) + default values (12–15 m) + manual adjustment |
| Grandstand, building and tree positions | OSM (`building`, `natural=tree`, `landuse=forest`) + procedural placement + manual touch-up |
| Reference imagery | Orthophoto only as a reference for the designer, **not** included in the game unless explicitly licensed |

### 6.3 Circuit generation pipeline (offline tool, Node/TS)

1. Load GeoJSON → project lat/lon to local meters (ENU/UTM projection centered on the circuit).
2. Resample the centerline at regular intervals (e.g. 2 m) and smooth with a Catmull-Rom spline.
3. Add elevation from the DEM and smooth it (no steps).
4. Generate the track mesh by extrusion: asphalt, white lines, kerbs at corners (curvature detection), shoulder, run-off (gravel/asphalt), walls/barriers (Tecpro, guardrail, tires).
5. Generate surrounding terrain (heightmap) that joins the track with no gaps.
6. Place decoration: grandstands, fences, generic signs, trees (instanced), pit buildings.
7. Generate gameplay data: start line, grid, sectors, checkpoints, racing line for AI and aids, optional DRS zones.
8. Export compressed `.glb` + `track.json` (metadata).
9. Manual pass in an editor (Blender or an in-game editor) to polish iconic spots (Eau Rouge, Monaco hairpin, etc.).

Fidelity acceptance criterion: the total generated length must be within ±1% of the circuit's official length.

## 7. 3D assets

### 7.1 Open-wheel car

Requirements:
- **Generic** modern-era open-wheel car (halo, wings, exposed wheels), with no real branding.
- `.glb` format, PBR (metal/roughness), 30–80 k triangles at LOD0, with LOD1/LOD2.
- Wheels as separate nodes (spin and steering), separate steering wheel (cockpit view), detachable wings (optional, for DRS animation).
- Swappable liveries via texture/material (color masks).

Category: it doesn't have to be F1. Any open-wheel car works (F4, F3, F2, IndyCar, Formula E…) as long as it is generic, with no real liveries or names ("Tatuus", "Dallara", "IndyCar" do not appear in the game).

Verified candidates (2026-10-11, zero budget, licenses taken from their pages):

| Use | Model | Author | License | Triangles | Notes | URL |
|---|---|---|---|---|---|---|
| Placeholder (Phase 0) | Car Kit `race.glb`, `race-future.glb` | Kenney | CC0 | ~1.9k–2.1k | GLB, wheels as separate named nodes, no logos | https://kenney.nl/assets/car-kit |
| Placeholder (Phase 0) | Racing Kit `raceCarRed/Green/Orange/White` | Kenney | CC0 | ~1.4k | GLB, separate wheels | https://kenney.nl/assets/racing-kit |
| **Main car (candidate 1)** | 2010 Indycar | CarlosCG31 (Sketchfab) | CC-BY 4.0 | 18.9k | Plain white, no logos; no PBR (to be retextured) | https://sketchfab.com/3d-models/2010-indycar-6d7384aab671492abc0da25359ff8f3a |
| **Main car (candidate 2)** | Generic F1 Car (~2010) | CarlosCG31 (Sketchfab) | CC-BY | 13.9k | Plain red; remove "PIRATY" text from tires | https://sketchfab.com/3d-models/generic-f1-car-ae419541d43143fc80cf0c6e559e1bb2 |
| Alternative | Generic 2022 F1 car | mpdevteam (Sketchfab) | CC-BY | 172k | No logos; needs decimation to < 80k | https://sketchfab.com/3d-models/generic-2022-f1-car-885d67926c1f4397bebd4efd6b5a3f73 |
| Alternative (needs work) | Formula 1 Car Midpoly | LWDream (Sketchfab) | CC-BY | 131k | PBR, "game-ready", but **has real logos**: retexturing mandatory | https://sketchfab.com/3d-models/formula-1-car-midpoly-ca91852b29bb435d8d0278d9131aa775 |
| Alternative (formula base) | Speed Dreams `mp5-fmc` | Andrew Sumner | Free Art License (copyleft) | — | Formula Ford style, with driver and separate wheels; AC3D format, convert in Blender; derivatives under the same license | https://github.com/xy008areshsu/speed-dreams-2/tree/master/data/cars/models/mp5-fmc |

Discarded: models with real liveries (Alpine, McLaren-Marlboro, Firestone), rips from other games (Asphalt, GP4 mods) and all paid ones (zero budget; also, marketplace "Standard"/"Royalty Free" licenses forbid distributing the raw file, which is unavoidable on the web).

Plan (user decision 2026-10-12):
1. Phase 0: Kenney `race.glb` (CC0) as a temporary placeholder only. All Kenney assets are too toy-like for the final look and will be removed.
2. Phase 1: **chosen car = "F4 Tatuus T014 chassis" by Oriol-Plazas** (Sketchfab, CC-BY, 326k tris, untextured, no logos): https://sketchfab.com/3d-models/f4-tatuus-t014-chasis-d61ce2f877fb4bf29da381cfa4f0f3d7. Work needed: download (Sketchfab account), decimate to < 80k tris (LOD0) + LOD1/LOD2, separate wheels and steering wheel, UVs, own PBR materials with livery masks, compressed `.glb`. Never use the "Tatuus" name in game; CC-BY credit on the credits screen.
3. Fallback: CarlosCG31 "2010 Indycar" / "Generic F1 Car", or AI-assisted base (see 7.4) + own modeling.

### 7.2 Environment

Full research with licenses and URLs: `docs/research/environment-assets.md`.

| Asset | Chosen source | License |
|---|---|---|
| Trees (foreground) | EZ-Tree, procedural generator for three.js with LODs (presets Oak, Ash, Aspen, Pine) | MIT |
| Trees and bushes (mid distance), grass, ferns | Quaternius Stylized Nature MegaKit (Standard) | CC0 (keep zip with License.txt) |
| Distant trees / filler | Kenney Nature Kit + impostors | CC0 |
| Extra conifers and beeches (Spa) | LadyLionStudios Spruce / Beech Trees | CC-BY 4.0 |
| PBR textures (asphalt, gravel, grass, leaves) | Poly Haven, ambientCG | CC0 |
| Sky / HDRI | Poly Haven + Three.js `Sky` | CC0 |
| Grandstands, pit buildings, gantries, signs, base starting lights | Kenney Racing Kit, retextured | CC0 |
| Crowd | Instanced billboards generated from Kenney Mini Characters / Low Poly Audience | CC0 / CC-BY 4.0 |
| Guardrail, fences, kerbs, walls, TecPro, tire barriers, long grandstands | Generated in code along the circuit spline | own |
| Barrier textures and braking-board signs | Race Track Assets Pack (Cherk) | CC-BY 4.0 |

Technique: `@three.ez/instanced-mesh` (instancing with per-instance culling and LOD), octahedral impostors from 100–150 m, grass as cards with `alphaTest`. Budget: < 3k tris per tree up close, ~500 at mid distance.

Style note: **stylized semi-realistic** style. PBR textures (Poly Haven, ambientCG) are used with moderate saturation and detail, and medium-geometry vegetation (Quaternius / Poly Haven) with unified materials. Purely low-poly assets (Kenney) only as placeholders or for distant objects. All assets go through a common palette and material adjustment so the scene stays coherent.

### 7.3 Performance budget per scene (medium quality)

- < 300 draw calls (instancing mandatory for trees, grandstands, cones, fences).
- < 2 M visible triangles.
- Texture memory < 512 MB (KTX2).
- Download per circuit < 40 MB; car < 8 MB.

### 7.4 AI asset generation (support, not a substitute)

Research from 2026-10-11. Only tools whose outputs can be published in a free web game are used.

Approved tools:

| Tool | Type | Output license | Cost | Intended use |
|---|---|---|---|---|
| TRELLIS.2 (Microsoft) | Open image-to-3D, PBR | MIT | Free HF Space (~5 min GPU/day) or local with ≥24 GB VRAM | Bodywork base, decorative props |
| Pixal3D (TencentARC) | Open image-to-3D, PBR | MIT | Free HF Space | Alternative to TRELLIS.2 |
| SPAR3D / Stable Fast 3D (Stability) | Open image-to-3D | Stability Community (free < 1 M$ revenue) | Local with 6–11 GB VRAM | Props, rocks; SPAR3D allows quad remesh |
| TripoSG | Image-to-3D, geometry only | MIT | Local with ≥8 GB VRAM | Base geometry |
| Meshy (Free plan) | Web service | CC BY 4.0 (credit "Meshy") | 10 downloads/month (Meshy 6 Lite) | Supplement |
| FLUX.1-schnell / Qwen-Image | Text to image | Apache 2.0 | Free | Prior concept image (image-to-3D beats text-to-3D) |

Discarded or pending:
- Hunyuan3D 2.0/2.1 (open weights): its license excludes the EU, the United Kingdom and South Korea. The team is in **Mexico**, so generating with it **is allowed**. Gray area: the license also limits use of the outputs outside the territory, and a web game is downloaded by browsers in the EU. For that reason Hunyuan3D is used for sketches and tests; assets published in the game are preferably generated with MIT tools (TRELLIS.2, Pixal3D, TripoSG). If any Hunyuan3D asset is published: label it as AI-generated and review the license before publishing.
- Tripo Free (public outputs and "non-commercial", ToS not verified), Hunyuan Global (terms not verified): only after reviewing the terms.
- Sloyd Free (personal use), Rodin Free (no useful export), Spline, Kaedim, Alpha3D (no free plan): discarded.

Available compute resources:

| Resource | Capacity | What runs there |
|---|---|---|
| Laptop with RTX 5060 (8 GB VRAM, Blackwell architecture) | Free, unlimited | SPAR3D (low-VRAM mode), Stable Fast 3D, TripoSG, Hunyuan3D-2mini (shape only), quantized FLUX.1-schnell, EZ-Tree, Blender |
| RunPod (10 USD credit) | Hours of 24–48 GB GPU (a few dozen hours depending on the chosen GPU) | TRELLIS.2, Hunyuan3D-2.1 with PBR texture, Step1X-3D: planned generation batches, not exploration |
| Free Hugging Face Spaces | ~5 min GPU/day | Quick tests of TRELLIS.2, Pixal3D, Hunyuan3D-2.1 before spending credit |

Notes:
- The RTX 5060 (Blackwell, sm_120) needs PyTorch with CUDA 12.8 or later. Repositories with their own CUDA extensions (nvdiffrast, spconv, flash-attn, rasterizers) may require compiling them from source; verify before considering a model "works locally".
- RunPod spending flow: prepare all concept images beforehand, test on free Spaces, and launch a pod only for the final batch. Shut down (not just stop) the pod when done to avoid being charged for storage.

Suitability by asset:
- **Open-wheel car:** low-medium quality. Wheels fused with the suspension, asymmetry, broken wings and halo, chaotic topology. Use only as a volume base: cut in half + Mirror, wheels and suspension modeled separately, re-UV for liveries.
- **Wheels:** always by hand (separate nodes so they can rotate).
- **Trees:** better procedural with **EZ-Tree** (MIT, exports GLB with LODs): https://github.com/dgreenheck/ez-tree
- **Rocks and decorative terrain:** good quality, a strength of AI.
- **Grandstands, pit buildings, barriers, fences:** better modular in Blender, generated in code or CC0 kits.

Mandatory post-processing for every AI asset: decimate/remesh to budget (car 10–30k tris, props 200–2k), correct origin and scale, re-UV, bake to a 1–2k atlas, glTF export and `gltf-transform optimize` (meshopt/Draco + KTX2/WebP), LODs. Each generated asset is registered in `ASSETS_LICENSES.md` with its tool and license, and labeled as AI-generated in the credits.

## 8. Functional requirements

### 8.1 Game modes

| ID | Mode | Priority |
|---|---|---|
| M1 | Free practice / time trial with best-lap ghost | P0 (MVP) |
| M2 | Quick race against AI (5–20 cars) | P1 |
| M3 | Weekend: qualifying + race | P2 |
| M4 | Online multiplayer (asynchronous ghosts first, real time later) | P3 |
| M5 | Championship with several circuits | P3 |

### 8.2 Driving

- RF-01: Analog throttle, brake and steering (Xbox/PlayStation gamepad via Gamepad API) and digital with smoothing (keyboard). **MVP: keyboard + gamepad.** Wheel: P2 (no force feedback on the web). Touch/mobile: out of scope.
- RF-02: Automatic and manual shifting (paddles/keys), 8 gears.
- RF-03: Configurable aids: traction control, ABS, steering assist, racing line with braking indicator, auto-brake (casual mode).
- RF-04: Physics model: weight transfer, speed-dependent aerodynamic downforce, slipstream, DRS in defined zones, simplified tire wear (P2).
- RF-05: Surfaces with different grip: asphalt, kerb, grass, gravel (gravel slows the car).
- RF-06: Track limits: detection of all 4 wheels outside → warning / lap invalidated in time trial.
- RF-07: Reset the car to the track (key) with a time penalty.
- RF-08: Collisions with walls and other cars (physical response, no damage in v1).

### 8.3 Cameras

- RF-10: Cameras: external (chase), cockpit (with halo), T-cam (above the airbox), nose, TV/replay.
- RF-11: Speed effects: dynamic FOV, slight vibration, optional motion blur.

### 8.4 HUD and interface

- RF-20: HUD: speed, gear, RPM with shift lights, lap time, delta to best lap, sectors (purple/green/yellow), position, minimap.
- RF-21: Main menu, circuit selection (with map and data: length, corners), livery selection, settings.
- RF-22: Settings: graphics (presets + options), controls (remapping), audio, aids, units (km/h, mph).
- RF-23: Pause, session restart, timing table.

### 8.5 AI (P1)

- RF-30: AI cars that follow the racing line with variation, brake according to curvature and overtake/defend in a basic way.
- RF-31: Difficulty levels (adjusting cornering speed and mistakes).

### 8.6 Replays and ghosts

- RF-40: Recording of inputs/states for best-lap ghost (local).
- RF-41: Session replay with TV cameras (P2).
- RF-42: Export/import ghost as a file (P2), basis for online leaderboards.

### 8.7 Audio

- RF-50: Engine sound dependent on RPM and load (mix of looped samples by range, or granular synthesis).
- RF-51: Sounds for tire skid, kerb, gravel, wind, collisions, gear shifts.
- RF-52: Spatial audio for AI cars.

### 8.8 Visual environment

- RF-60: Lighting with directional sun + cascaded shadow maps (CSM) + ambient HDRI.
- RF-61: Selectable time of day (day / sunset / night for night circuits like Singapore, Las Vegas, Yas Marina) — P2.
- RF-62: Post-processing: ACES/AgX tonemapping, soft bloom, optional SSAO, antialiasing (SMAA/TAA).
- RF-63: Tire marks and smoke/dust/spark particles.

## 9. Non-functional requirements

| ID | Requirement |
|---|---|
| RNF-01 | 60 FPS at medium quality on a laptop with a modern integrated GPU (e.g. Intel Iris Xe / Apple M1); 120+ FPS on a mid-range dedicated GPU |
| RNF-02 | Input → visual response latency < 50 ms |
| RNF-03 | Compatibility: Chrome, Edge, Firefox and Safari, latest 2 versions (WebGL2 required) |
| RNF-04 | Loading: interactive menu < 3 s; playable circuit < 10 s (50 Mbps); progressive loading (track first, decoration afterwards) |
| RNF-05 | Deterministic physics with fixed step (requirement for ghosts and future multiplayer) |
| RNF-06 | Accessibility: full remapping, colorblind option for sector colors, subtitles/visual indicators for audio warnings |
| RNF-07 | Offline operation after first load (PWA + asset cache) — P2 |
| RNF-08 | No mandatory backend for the MVP |

## 10. Architecture (high level)

```
src/
  core/        game loop (fixed step), events, state manager
  physics/     Rapier integration, vehicle model, tires, aero
  render/      scene, cameras, materials, post-processing, LOD
  track/       track.json + .glb loading, checkpoints, surfaces
  ai/          racing-line following, behavior
  input/       keyboard, gamepad, wheel, mapping
  audio/       engine, effects, mixer
  ui/          HUD, menus
  replay/      recording and playback
tools/
  track-builder/   offline pipeline GeoJSON + DEM + OSM → .glb + track.json
  asset-optimize/  gltf-transform scripts (draco/meshopt, KTX2, LOD)
assets/
  cars/  tracks/  env/  audio/
```

Principles:
- Simulation separated from rendering (allows a future authoritative server).
- Circuit assets loaded on demand; one circuit = one package.
- Car configuration in data (JSON): mass, power, torque curve, aero, tires, to tune without recompiling.

## 11. Scope by phases

### Phase 0 — Technical prototype (2–3 weeks)
- Vite + Three.js + Rapier working.
- Placeholder car with basic vehicle physics.
- One circuit generated from GeoJSON: **Monza** (fast and nearly flat, a good test case) with a simple track mesh.
- Chase camera, keyboard, stopwatch.

### Phase 1 — MVP (6–8 weeks)
- Refined open-wheel physics model (aero, tires, weight transfer).
- Final or semi-final car model.
- 3 complete circuits with environment: **Monza, Spa, Silverstone**.
- Time trial with ghost, full HUD, cameras, engine audio, keyboard + gamepad.
- Graphics presets and performance target met.

### Phase 1.5 — Vehicle dynamics
- Car definition files, in-house tyre/suspension/aero model calibrated on the F4, setups (6 parameters + presets), tyre wear/temperature, fuel, HUD for tyres and fuel.

### Phase 1.6 — Car roster
- 2–3 new cars (GT3 first) with calibrated data, car selection menu.

### Phase 2 — Race
- Pit stops (limiter, box service, strategy), AI pit strategies.
- AI, quick race, grid, start with lights.
- More circuits (target 10), night circuits, replays.

### Phase 3 — Online
- Online leaderboards with ghost validation.
- Real-time multiplayer (WebRTC / WebSocket with authoritative server).

## 12. Success metrics

- Average FPS and 1st percentile per preset (optional anonymous telemetry).
- Actual load time per circuit.
- Average session duration > 15 min; % of players who complete 5+ laps.
- Difference between generated and official circuit length < 1%.

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Trademarks (F1, circuits, teams) | High | Generic car and liveries, legal review of names |
| Asset licenses incompatible with the web | High | License register, prefer CC0 / own commissions |
| Unconvincing physics | High | Custom tire model, iterate early with wheel/gamepad, debug telemetry |
| Performance on integrated GPUs | Medium | Instancing, LOD, KTX2, presets, per-scene budget |
| Incomplete circuit data (width, elevation) | Medium | DEM + OSM + manual touch-up; length validation |
| Production time per circuit | Medium | Automated pipeline, procedural decoration |
| Browser differences (Safari, Gamepad API) | Low | Test matrix, Playwright |

## 14. Decisions made and open questions

### Decisions (2026-10-11)

| Topic | Decision |
|---|---|
| Visual style | Stylized semi-realistic |
| Simulation level | Sim-cade with configurable aids |
| Monetization | Free, non-profit (CC-BY-NC allowed) |
| Open-wheel car budget | Free models only |
| Circuit names | City/region |
| MVP circuits | Monza, Spa, Silverstone |
| UI | Plain TypeScript + HTML/CSS |
| MVP controls | Keyboard and gamepad |
| Car category | Any open-wheel car (F4, F3, F2, Formula E, etc.), not necessarily F1 |
| Car roster (2026-10-12) | Multi-category: open-wheel plus closed-wheel (GT3 first, then GT4/TCR/prototypes). Real-brand free models allowed during development; de-brand (names, logos) before any public release |
| Vehicle model (2026-10-12) | Data-driven car definitions (one file per car) and an in-house vehicle model: tyre model with load, slip, temperature and wear; suspension with weight transfer; speed-dependent aero; engine torque curve, gearbox, differential; ABS/TC per car. Rapier only for collisions and ground rays |
| MVP depth (2026-10-12) | Basic first, extensible schema: all parameters live in the car file; the setup screen exposes a small subset now and more later without code changes |
| Setups MVP (2026-10-12) | 6 adjustable: front/rear wing, brake bias, final drive, front/rear anti-roll bar, ride height, tyre pressure; presets stable/balanced/aggressive; saved per car and track |
| Tyre wear and fuel (2026-10-12) | Per-wheel wear and temperature, 3 compounds (soft/medium/hard); fuel consumption with mass effect; global wear/fuel multiplier (default 1x, race presets up to 5x) |
| Pit stops (2026-10-12) | Pit lane speed limiter with penalty, pit box service (tyres, compound, fuel) with service time; damage repair out of MVP (data hooks only) |
| Damage (2026-10-12) | Out of MVP; the car file reserves fields for aero/suspension damage |
| Team location | Mexico (Hunyuan3D allowed for generation; published assets preferably made with MIT tools) |
| AI compute | Laptop RTX 5060 (8 GB) + 10 USD on RunPod + free Spaces |

### Open questions

1. Specific open-wheel car model: choose between CarlosCG31's "2010 Indycar" and "Generic F1 Car" (see 7.1) after testing them in the engine.
2. Which GT3/other models to use (research in `docs/research/car-models.md`).
3. Hosting and domain?

## 15. References

- Layouts: https://github.com/bacinger/f1-circuits (MIT)
- Three.js: https://threejs.org
- Rapier: https://rapier.rs
- glTF Transform: https://gltf-transform.dev
- Poly Haven (CC0): https://polyhaven.com
- ambientCG (CC0): https://ambientcg.com
- Kenney (CC0): https://kenney.nl
- Quaternius (CC0): https://quaternius.com
- OpenStreetMap (ODbL): https://www.openstreetmap.org
- Copernicus DEM GLO-30: https://spacedata.copernicus.eu
