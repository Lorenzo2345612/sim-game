# Tasks

Generated from `tasks/tasks.json` by `orchestrator.py readme`; do not edit by hand.

| # | Title | Status | Depends on |
|---|---|---|---|
| 001 | Create the project scaffold | done | - |
| 002 | Create shared types and constants | done | 001 |
| 003 | Implement the fixed-step loop | done | 002 |
| 004 | Project lon/lat coordinates to local metres | done | 002 |
| 005 | Smooth and resample the centerline | done | 004 |
| 006 | Generate public/tracks/monza.json with the track-builder | done | 002, 004, 005 |
| 007 | Build the track ribbon geometry | done | 004 |
| 008 | Track progress and lap timer | done | 002, 004, 005 |
| 009 | Implement keyboard input | done | 002 |
| 010 | Create the Rapier physics world and car config | done | 002 |
| 011 | Implement the physics vehicle (Rapier raycast vehicle) | done | 002, 010 |
| 012 | Create the base Three.js scene | done | 002 |
| 013 | Render the track (asphalt and start line) | done | 002, 007, 012 |
| 014 | Render the car (Kenney model) | done | 002 |
| 015 | Chase camera | done | 002 |
| 016 | Create the speed and lap-time HUD | done | 002 |
| 017 | Create the game core (Game) and interpolation | done | 002, 005, 008, 010, 011 |
| 018 | Integrate everything in main.ts (browser game) | done | 002, 003, 006, 007, 009, 012, 013, 014, 015, 016, 017 |
| 019 | Add the Playwright e2e test | done | 018 |
| 020 | Fix invisible track and off-screen HUD in the browser game | done | 019 |
| 021 | Local progress dashboard for the AI pipeline | done | - |
| 022 | Add TrackData v2 types and Phase 1 constants | done | - |
| 023 | Add inverse projection unprojectXZ | done | - |
| 024 | Fetch DEM windows for the three tracks | done | 023 |
| 025 | DEM sampling and centerline elevation profile | done | 022, 023, 024 |
| 026 | Detect radii, kerbs and run-offs | done | 022 |
| 027 | Lay out barriers | done | 022 |
| 028 | Build the terrain heightfield | done | 022, 023, 024, 025 |
| 029 | Place trees deterministically | done | 022 |
| 030 | Generate TrackData v2 for Monza, Spa and Silverstone | done | 022, 024, 025, 026, 027, 028, 029 |
| 031 | Build track surface geometry from TrackData v2 | done | 022 |
| 032 | Terrain, surface and barrier colliders | done | 022, 031 |
| 033 | Per-wheel surface grip and drag | done | 022, 032 |
| 034 | Invalidate laps when all wheels leave the track | done | 033 |
| 035 | Fetch CC0 track textures | done | 024 |
| 036 | Render the terrain mesh | done | 022 |
| 037 | Render track surfaces with textures | done | 022, 031, 035 |
| 038 | Render barriers | done | 022 |
| 039 | Instanced procedural trees with LOD | done | 022, 035 |
| 040 | Procedural grandstands with crowd | done | 022 |
| 041 | Pit building, start gantry and start lights | done | 022 |
| 042 | Sky, fog per track and car-following shadows | done | - |
| 043 | Load a TrackData v2 world into the game | done | 056, 038, 039, 040, 041, 042 |
| 044 | Track selection and pause menu | done | 043 |
| 045 | Six-speed gearbox with rpm and limiter | done | 033 |
| 046 | Gamepad input and input merging | done | 022 |
| 047 | T-cam and cockpit cameras with switching | done | - |
| 048 | HUD v2 with gear, rpm, sectors, delta and invalid lap | done | - |
| 049 | Minimap | done | - |
| 050 | Best-lap ghost recording and replay | done | - |
| 051 | Engine and tyre audio | done | - |
| 052 | Graphics presets and FPS overlay | done | - |
| 053 | F4 car model pipeline (offline asset build) | done | - |
| 054 | Wire gameplay features into the game | done | 034, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052 |
| 055 | Phase 1 end-to-end checks on three tracks | done | 054 |
| 056 | Load TrackData v2 tracks into the game (terrain, surfaces, physics) | done | 030, 032, 033, 034, 035, 036, 037 |
| 057 | Use the F4 car in the game and remove the Kenney placeholder | done | 053, 056 |
| 058 | CarSpec type, loader and F4 data | done | - |
| 059 | Tyre forces | done | 058 |
| 060 | Tyre temperature, wear and pressure | done | 058 |
| 061 | Suspension, anti-roll and aero | done | 058 |
| 062 | Powertrain: engine, launch rpm, differential, generalised gearbox | done | 058, 045 |
| 063 | Brakes, ABS/TC and fuel | done | 058 |
| 064 | Implicit wheel solver | done | 058, 059 |
| 065 | Vehicle model on Rapier (part 1) | done | 058, 059, 060, 061, 062, 063, 064, 033, 045, 054, 057 |
| 066 | Calibration suite and F4 tuning | done | 058, 065, 169 |
| 067 | Car setups (pure) | done | 058 |
| 068 | Setup screen | done | 058, 067, 044, 054 |
| 069 | HUD tyres and fuel widget | done | 048, 065, 169 |
| 070 | Integrate the new vehicle model in the game | done | 054, 057, 058, 065, 169, 066, 067, 068, 069 |
| 071 | Generic car asset pipeline | done | 053 |
| 072 | GT3 car definitions | done | 058, 071 |
| 073 | Car registry and selection | done | 070, 044, 072 |
| 074 | Credits screen | done | 044 |
| 075 | Car pipeline: textures and wheel nodes; build gt3-d | done | 071 |
| 076 | GT3 D definition | done | 072, 075 |
| 077 | Add grass verges beside the track surfaces | done | - |
| 078 | Add reverse gear | done | 054 |
| 079 | Remove tree canopy from the DEM before building tracks | done | - |
| 080 | PBR surface materials with anti-tiling for track strips | done | 077 |
| 081 | Terrain splat material with track-distance mown stripes | done | 080 |
| 082 | Painted track markings (edge lines, start/finish line) | done | 080 |
| 083 | Textured barriers (armco, concrete, tyres) | done | 080, 043 |
| 085 | Smooth the track elevation profile and limit its grade | done | 079 |
| 086 | Continuous barriers (no gaps between segments) | done | 043, 077 |
| 087 | Racing line (minimum curvature) | done | - |
| 088 | Speed profile and car limits | done | 087, 058 |
| 089 | AI driver controller | done | 087, 088 |
| 090 | AI traffic decisions and difficulty | done | 089 |
| 091 | Start sequence and grid | done | - |
| 092 | Race classification | done | - |
| 093 | Multi-car race game | done | 008, 043, 065, 169, 070, 073, 087, 088, 089, 090, 091, 092 |
| 094 | Race HUD and AI car rendering | done | 057, 092, 093, 119, 207 |
| 095 | Quick race menu and results | done | 044, 073, 092, 093, 094, 171 |
| 096 | Close the gaps at kerb and run-off segment ends | done | 077 |
| 097 | Keep the terrain below every track surface strip | done | 096, 085 |
| 098 | Gravel traps from OpenStreetMap, run-off rule only for real corners | done | 097 |
| 099 | HDRI sky, image-based lighting, neutral tone mapping, fog from horizon | done | 042 |
| 100 | Bake realistic tree LODs with EZ-Tree (offline tool) | done | - |
| 101 | Tree field uses baked LODs | done | 100, 039 |
| 102 | Satellite colour on distant terrain | done | 081 |
| 103 | Real-size tyre walls, W-beam armco with posts, catch fences | done | 083, 086 |
| 104 | Crowd sprite atlas and seated crowd | done | 040 |
| 105 | Post-processing tiers: bloom, LUT, SMAA (GTAO high only) | done | 099 |
| 106 | Add Mexico City, Daytona, Lusail, Sakhir, Braselton, Elkhart Lake and Sepang to the game | done | 044, 099, 102, 141, 143, 155 |
| 107 | Car sound data | done | 058, 072 |
| 108 | Engine synth DSP core | done | - |
| 109 | Engine AudioWorklet and EngineAudio integration | done | 107, 108, 054, 070 |
| 110 | Audio effects | done | 109 |
| 111 | Audio mix | done | 110 |
| 112 | Prototype models through the car pipeline | done | 071, 075 |
| 113 | Prototype CarSpecs from the lab files | done | 112, 072, 058 |
| 114 | Car selection and credits list the prototypes | done | 113, 073, 074 |
| 115 | Cockpit data per car (eye, steering wheel anchor, lock) | done | 058, 066, 072, 107, 113 |
| 116 | Animated steering wheel in cockpit view | done | 047, 054, 115 |
| 117 | Virtual rear-view mirror | done | 047, 054, 070, 099, 105, 111 |
| 118 | Cockpit head motion and FOV setting | done | 047, 115, 117 |
| 119 | Livery data, palette and storage | done | 072 |
| 120 | Paint materials in the car pipeline and livery shader | done | 075, 112, 119 |
| 121 | Race number decals | done | 120 |
| 122 | Livery editor screen | done | 044, 073, 074, 106, 114, 120, 121 |
| 123 | Driving line overlay coloured by action | done | 088, 093, 118 |
| 125 | Assist presets and braking assist | done | 054, 057, 070, 088, 089, 122, 123 |
| 126 | Driving school lessons | pending | 123, 125, 044, 143 |
| 127 | Track limits strikes | done | 092 |
| 128 | Yellow and blue flags | done | 092 |
| 129 | Virtual safety car | done | 088, 092 |
| 130 | Penalty book, HUD messages and wiring of rules | done | 089, 092, 093, 094, 095, 127, 128, 129 |
| 131 | Telemetry recorder and store | done | 050, 070 |
| 132 | Telemetry screen (charts and delta) | pending | 044, 095, 126, 130, 131 |
| 133 | Replay recorder (all cars) | done | - |
| 134 | Replay player and TV cameras | pending | 047, 093, 095, 132, 133 |
| 135 | Time of day presets | pending | 093, 099, 106, 130 |
| 136 | Night lighting: floodlights, headlights | pending | 102, 103, 135 |
| 137 | Rain and track wetness model, wet compounds | done | 058, 115 |
| 138 | Wet visuals: rain, wet road, spray | pending | 080, 136, 137 |
| 139 | Weather in races: config, forecast HUD, grip wiring, AI pace | pending | 078, 093, 130, 135, 137, 138 |
| 140 | Builder: paved run-offs at heavy-braking corners, chicane escape roads, foam barrier placement | done | 098, 142 |
| 141 | Render and colliders for escape roads and foam block barriers | done | 140, 103 |
| 142 | Kerbs on every corner with entry/exit extensions | done | 098 |
| 143 | Distance-to-corner boards (builder data + rendering) | done | 140 |
| 144 | Damage model (pure) | done | 058 |
| 145 | Contact impacts from Rapier into the damage model | done | 070, 093, 144 |
| 146 | Damage effects on the vehicle (aero, toe, grip, lost wheel) | done | 070, 144, 145 |
| 147 | Debris: detached wings and wheels as physics bodies | done | 145, 146 |
| 148 | Damage HUD, setting, pit repair time, AI reaction | done | 094, 145, 146 |
| 149 | Sausage kerb placement (builder) | done | 140 |
| 150 | Sausage kerb render and colliders | done | 141, 149 |
| 151 | Performance harness and budgets | done | 093 |
| 152 | Render cost: draw calls, culling, shadows | done | 151 |
| 153 | Simulation cost with 16 cars | done | 151 |
| 154 | Adaptive quality (dynamic resolution, auto preset) | done | 151 |
| 155 | Close parallel sections: per-index half-widths and shared median wall | done | 140, 141, 142, 143 |
| 156 | Environment type per track: ground palette and vegetation | done | 081, 101, 106 |
| 157 | City bake from OSM: buildings, old-city walls, water | done | 106 |
| 158 | City renderer: buildings, facades, water | done | 099, 157 |
| 159 | Street-circuit trackside: walls, sidewalks, lamps, billboards | done | 141, 157 |
| 160 | Landmark proxies | done | 158 |
| 161 | Fix minimap stretched to full screen and engine audio playing while paused | done | - |
| 162 | Speed-dependent rolling drag on grass and gravel | done | 065, 169 |
| 163 | Surface feedback signal (pure) | done | - |
| 164 | Camera shake from surfaces | done | 163 |
| 165 | Gamepad rumble | done | 164 |
| 166 | Dirty tyres | done | 065, 169, 162 |
| 167 | Surface particles (stones, dust, grass clippings) | done | 165, 065, 169 |
| 168 | Add Fontana, Cleveland and Detroit to the game | done | 106, 155, 156 |
| 169 | Vehicle model swap-in and old-test migration | done | 065 |
| 170 | Prototype B variants (LMP2 B, Hypercar B) - needs design | blocked | 112, 113, 114 |
| 171 | Track select menu redesign | done | 106 |
| 172 | Lighting calibration: one sun, tamer whites and bloom | done | 106 |
| 173 | Pit building only along the straight | done | 106 |
| 174 | Track banking (cross-slope) + Daytona | done | 106, 155 |
| 175 | Fontana banking data | done | 168, 174 |
| 176 | Fix track surface/barrier overlaps (grey patches, grass on track, guardrails crossing) | done | 173 |
| 177 | Clamp HDRI values below half-float max (black lit surfaces on half-float GPUs) | done | 099 |
| 178 | Auto-mode reverse (standstill brake engages reverse) | done | 065 |
| 179 | TrackStyle schema, defaults and parser | done | - |
| 180 | Style loader, wiring, extra grandstands, debug hook | done | 179, 156, 157, 158, 159, 160, 168, 174 |
| 181 | Tools: `track:locate` and `check:styles` | done | 179 |
| 182 | Pit building and grandstand styling | done | 180 |
| 183 | Kerb colours per segment and run-off paint | done | 180 |
| 184 | Palette tints, edge-line colour and sky overrides from the track style | done | 180, 183, 156, 157, 158, 159, 160, 168, 174, 175 |
| 185 | Barrier colours, wall band and configurable catch fence from the track style | done | 180 |
| 186 | Floodlight poles along the track from the track style | done | 180, 182, 184 |
| 187 | Generic trackside props from the track style | done | 180 |
| 188 | Monza track style data | done | 181 |
| 189 | Spa track style data | done | 181, 188 |
| 190 | Silverstone track style data | done | 181, 188 |
| 191 | Budapest track style data | done | 181, 188 |
| 192 | Spielberg track style data | done | 181, 188 |
| 193 | Mexico City track style data | done | 181, 188 |
| 194 | Daytona style file (data only) | done | 181, 188 |
| 195 | Fontana style file (data only) | done | 181, 188, 168 |
| 196 | Elkhart Lake style file (data only) | done | 181, 188 |
| 197 | Road Atlanta (Braselton) style file (data only) | done | 181, 188 |
| 198 | Cleveland style file (data only) | done | 181, 188, 168 |
| 199 | Detroit style file (data only) | done | 181, 188, 168 |
| 200 | Baku style data (`baku.style.json`) | done | 181, 188 |
| 201 | Singapore style data (`singapore.style.json`) | done | 181, 188 |
| 202 | Las Vegas style data (`lasvegas.style.json`) | done | 181, 188 |
| 203 | Bahrain style data (`bahrain.style.json`) | done | 181, 188 |
| 204 | Sepang style data (`sepang.style.json`) | done | 181, 188 |
| 205 | Lusail style data (`lusail.style.json`) | done | 181, 188 |
| 206 | Painted strip outside the kerbs | done | 180, 183 |
| 207 | UI polish: shared theme, HUD and menus | done | - |
| 208 | Tyre HUD details and dirt tuning | done | - |
| 209 | Setup panel v2, tyre compound choice and setup overlay | done | 208 |
| 210 | Reverse speed cap and gamepad trigger deadzone | done | - |
| 211 | Fontana Sports Car Course (oval + infield layout) | done | 174 |
| 212 | Ghost delta goes wild from the second lap | done | - |
| 213 | Consistent tyre compounds for GT3, LMP2 and Hypercar | done | - |
| 214 | Track conditions: asphalt abrasion and track temperature | done | - |
| 215 | Hybrid and active-aero contract | done | - |
| 216 | ERS energy model | done | 215 |
| 217 | Active-aero zones from the centerline | done | - |
| 218 | Active-aero state and aero blend | done | 215 |
| 219 | Hybrid and active aero in the vehicle and game | done | 215, 216, 217, 218 |
| 220 | Overtake and ERS mode controls | done | 215 |
| 221 | OW-26 car definition and calibration | done | 219 |
| 222 | Per-car RPM range in the HUD | done | - |
| 223 | ERS and active-aero HUD widget | done | 219, 221 |
| 224 | OW-26 3D model through the car pipeline | done | 221 |
| 225 | Expert AI must not spin; difficulty orders pace | done | 093 |
| 226 | Engine sound spec types, parser and CarSound.synth | done | - |
| 227 | EngineVoice core: pulse train, exhaust tubes, DC block, soft clip, slew | done | 226 |
| 228 | EngineVoice layers: intake, block, muffling, turbo, whine, limiter, crackle | done | 227 |
| 229 | Wire EngineVoice into the worklet, EngineAudio and main | done | 228 |
| 230 | Mixer: cockpit bus, master dynamics, smooth camera switch | done | - |
| 231 | Per-car engine synth data | done | 226 |
| 232 | Offline engine render tool | done | 227 |
| 233 | Shared ground-height sampler | done | - |
| 234 | Grandstands and props grounded on terrain with plinths | done | 233 |
| 235 | Barriers, colliders and boards follow the ground | done | 233 |
| 236 | Pit building split into grounded pieces along the pit lane | done | 234 |
| 237 | Track QA report CLI: clearance, relief, layout checks | done | 235, 236 |
| 238 | Track QA camera and screenshot tool | done | 233 |
| 239 | Turbo transients: blow-off/bypass valve, surge flutter, wastegate, spool-down | done | 228, 231, 244 |
| 240 | Smooth bank transitions on ovals (auto ramp, smoothstep) | done | - |
| 241 | Ermita de Guadalupe street circuit: 5 layouts | done | - |
| 242 | Synthetic village buildings (plaster row houses, tanks) | done | 241 |
| 243 | Dry arroyo channel and bridges | done | 241 |
| 244 | Engine voice timbre v2.1 (approved preview) | done | 228, 231 |
| 245 | Kerbs never fold over the asphalt (radius cap, split strips) | done | - |
| 246 | Barriers never fold onto the inner kerb | done | 235 |
| 247 | Sausage kerbs fit the corner (length, offset, curved render/colliders) | done | 240, 241 |
| 248 | Pit building clears run-off and the pit wall | done | 236, 247 |
| 249 | QA report: kerb, barrier-fold, sausage, pit-clear checks | done | 237, 245, 246, 247, 248 |
| 250 | Bollard placement | done | 248 |
| 251 | Knock-over bollards at runtime | done | 250 |
| 252 | Expert AI drives spin-free on monza and spa | done | 225, 254 |
| 253 | Run-off paint uses only the country's flag colours | done | - |
| 254 | Weight distribution and rear grip (stable OW-26 rear) | done | 146, 239 |
| 255 | Per-car weight distribution and tyre widths | done | 254, 252 |
| 256 | Fix two test failures on master after the 247 merge | done | - |
| 257 | Drop the stale track-hash test in 243 | done | 243 |
| 258 | Frenet race view and track corridor | done | - |
| 259 | Sampling lane planner | done | 258 |
| 260 | Racecraft intents (attack, defend, rejoin) | done | 258 |
| 261 | RaceGame scenario starts and contact counter | done | - |
| 262 | Racecraft AI drives the race | waiting decision | 259, 260, 261, 268, 323 |
| 263 | RL race environment over RaceGame | pending | 262 |
| 264 | RL env server (Node) and Python client | pending | 263 |
| 265 | PPO trainer with behaviour-cloning warm start | pending | 264, 266 |
| 266 | Policy network and learned driver in TS | pending | 263 |
| 267 | Learned vs racecraft evaluation and difficulty gate | pending | 266 |
| 268 | AI driving regressions: barrier climbing, off-track, stuck recovery | done | - |
| 269 | Evolved neural AI opponents (opt-in, experimental) | done | - |
| 270 | Neural driver v2: kerb line, track limits, tyre inputs, setup genes | done | 269 |
| 271 | Neural racecraft training: overtakes, defence, contact faults, mixed fields | blocked | 272 |
| 272 | Neural trainer: reference-lap target line and speed profile | blocked | 270 |
| 273 | Expert AI spin-free in 3-car traffic (silverstone) | done | 252 |
| 274 | Weekend formats and points tables | done | - |
| 275 | Weekend controller (grid rules, points, standings) | pending | 274 |
| 276 | RaceConfig gridOrder | done | - |
| 277 | Qualifying classification | done | - |
| 278 | RaceGame timed sessions (practice, qualifying) | pending | 276, 277 |
| 279 | Session result adapters | pending | 274, 275, 277 |
| 280 | Quick weekend UI (menu, hub, session HUD) | pending | 274, 275, 276, 278, 279 |
| 281 | Electric powertrain math | done | - |
| 282 | Attack mode rules | done | - |
| 283 | CarSpec awd + electric block | pending | 281 |
| 284 | AWD electric drive in VehicleModel | pending | 281, 282, 283 |
| 285 | Electric voice | done | - |
| 286 | Electric OW car, HUD and AI power | pending | 284, 285 |
| 287 | Decouple 269 POST9 from published models | done | 269 |
| 288 | Residual neural AI in the game | done | 269, 270 |
| 289 | Yellow-flag cap must not freeze the field behind a stopped car | done | 130 |
| 290 | Overtake log and grid positions in RaceGame | done | 289 |
| 291 | Results screen: grid, places gained, overtakes and race recap | done | 290 |
| 292 | Current, last and best lap times in the race HUD | done | 093 |
| 293 | Remove race HUD overlaps (damage panel, flags, toasts) | done | - |
| 294 | Race control messages, penalty announcement and tower tag in the race HUD | done | 293 |
| 295 | Per-nationality name lists and seeded grid generator | done | - |
| 296 | Driver names in the race UI | done | 291, 294, 295 |
| 297 | Master red: 250 AT9 baseline and baku barrier fold (249 AT3) | done | - |
| 298 | No yellow flags from the standing start | done | 289 |
| 299 | Low-ramp sausage kerb collider | done | - |
| 300 | Verge and runoff strips must not fold over the inner kerb | done | - |
| 301 | No kerb-zone steps on any track | done | 300 |
| 302 | Race minimap: all cars and sector flag colours | done | 298 |
| 303 | Yellow-flag alert: flashing lights, banner, sector-clear notice | done | 302 |
| 304 | Race results: penalties added, running cars not DNF | done | 303 |
| 305 | Yellow overtake: 10 s to give the position back | in progress | 304 |
| 306 | Timing tower views: gap, tyres, laps | pending | 305 |
| 307 | Passing cars in trouble under yellow is legal | pending | 305 |
| 308 | Yellow flags: minimum duration and continuous spin cause | pending | 307 |
| 309 | Yellow flags: 3 s countdown before a sector turns yellow | pending | 308 |
| 310 | Yellow countdown in race HUD and minimap | pending | 309 |
| 311 | Penalty caps and disqualification in PenaltyBook and RaceClassification | done | - |
| 312 | Race: black-flagged cars are disqualified and leave the track | pending | 311, 304, 305, 306, 309 |
| 313 | Black flag in race control, announcements and results | pending | 312, 296, 304 |
| 314 | Incident car may be passed under yellow; yellow clears 3 s after the threat | pending | 305, 309 |
| 315 | Results: overtakes in their own tab, with a legend | done | 296 |
| 316 | Grandstands follow the track and never sit on it | done | - |
| 317 | City bake: buildings allowed up to the local barrier, not the lap's farthest one | done | - |
| 318 | Grandstands at the main corners, not only on the start straight | in progress | 316 |
| 319 | Surrounding buildings for every circuit | in progress | 317 |
| 320 | Ermita river with water (streams stay dry) | done | - |
| 321 | Blue flags: lapped cars yield without leaving their fight; player penalty | pending | 314 |
| 323 | Master green after the car tyre colliders | done | - |
