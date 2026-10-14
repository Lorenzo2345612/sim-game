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
| 065 | Vehicle model on Rapier (part 1) | pending | 058, 059, 060, 061, 062, 063, 064, 033, 045, 054, 057 |
| 066 | Calibration suite and F4 tuning | pending | 058, 065, 169 |
| 067 | Car setups (pure) | done | 058 |
| 068 | Setup screen | done | 058, 067, 044, 054 |
| 069 | HUD tyres and fuel widget | pending | 048, 065, 169 |
| 070 | Integrate the new vehicle model in the game | pending | 054, 057, 058, 065, 169, 066, 067, 068, 069 |
| 071 | Generic car asset pipeline | done | 053 |
| 072 | GT3 car definitions | done | 058, 071 |
| 073 | Car registry and selection | pending | 070, 044, 072 |
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
| 093 | Multi-car race game | pending | 008, 043, 065, 169, 070, 073, 087, 088, 089, 090, 091, 092 |
| 094 | Race HUD and AI car rendering | pending | 057, 092, 093, 119 |
| 095 | Quick race menu and results | pending | 044, 073, 092, 093, 094 |
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
| 106 | Add Mexico City, Daytona, Lusail, Sakhir, Braselton, Elkhart Lake and Sepang to the game | pending | 044, 099, 102, 141, 143, 155 |
| 107 | Car sound data | done | 058, 072 |
| 108 | Engine synth DSP core | done | - |
| 109 | Engine AudioWorklet and EngineAudio integration | pending | 107, 108, 054, 070 |
| 110 | Audio effects | pending | 109 |
| 111 | Audio mix | pending | 110 |
| 112 | Prototype models through the car pipeline | in progress | 071, 075 |
| 113 | Prototype CarSpecs from the lab files | pending | 112, 072, 058 |
| 114 | Car selection and credits list the prototypes | pending | 113, 073, 074 |
| 115 | Cockpit data per car (eye, steering wheel anchor, lock) | pending | 058, 066, 072, 107, 113 |
| 116 | Animated steering wheel in cockpit view | pending | 047, 054, 115 |
| 117 | Virtual rear-view mirror | pending | 047, 054, 070, 099, 105, 111 |
| 118 | Cockpit head motion and FOV setting | pending | 047, 115, 117 |
| 119 | Livery data, palette and storage | done | 072 |
| 120 | Paint materials in the car pipeline and livery shader | pending | 075, 112, 119 |
| 121 | Race number decals | pending | 120 |
| 122 | Livery editor screen | pending | 044, 073, 074, 106, 114, 120, 121 |
| 123 | Driving line overlay coloured by action | pending | 088, 093, 118 |
| 125 | Assist presets and braking assist | pending | 054, 057, 070, 088, 089, 122, 123 |
| 126 | Driving school lessons | pending | 123, 125, 044, 143 |
| 127 | Track limits strikes | pending | 092, 093 |
| 128 | Yellow and blue flags | pending | 092, 093 |
| 129 | Virtual safety car | pending | 088, 092, 093 |
| 130 | Penalty book, HUD messages and wiring of rules | pending | 089, 092, 093, 094, 095, 127, 128, 129 |
| 131 | Telemetry recorder and store | pending | 050, 070 |
| 132 | Telemetry screen (charts and delta) | pending | 044, 095, 126, 130, 131 |
| 133 | Replay recorder (all cars) | pending | 093 |
| 134 | Replay player and TV cameras | pending | 047, 093, 095, 132, 133 |
| 135 | Time of day presets | pending | 093, 099, 106, 130 |
| 136 | Night lighting: floodlights, headlights | pending | 102, 103, 135 |
| 137 | Rain and track wetness model, wet compounds | pending | 058, 115 |
| 138 | Wet visuals: rain, wet road, spray | pending | 080, 136, 137 |
| 139 | Weather in races: config, forecast HUD, grip wiring, AI pace | pending | 078, 093, 130, 135, 137, 138 |
| 140 | Builder: paved run-offs at heavy-braking corners, chicane escape roads, foam barrier placement | done | 098, 142 |
| 141 | Render and colliders for escape roads and foam block barriers | in progress | 140, 103 |
| 142 | Kerbs on every corner with entry/exit extensions | done | 098 |
| 143 | Distance-to-corner boards (builder data + rendering) | in progress | 140 |
| 144 | Damage model (pure) | done | 058 |
| 145 | Contact impacts from Rapier into the damage model | pending | 070, 093, 144 |
| 146 | Damage effects on the vehicle (aero, toe, grip, lost wheel) | pending | 070, 144 |
| 147 | Debris: detached wings and wheels as physics bodies | pending | 145, 146 |
| 148 | Damage HUD, setting, pit repair time, AI reaction | pending | 094, 145, 146 |
| 149 | Sausage kerb placement (builder) | pending | 140 |
| 150 | Sausage kerb render and colliders | pending | 141, 149 |
| 151 | Performance harness and budgets | pending | 093 |
| 152 | Render cost: draw calls, culling, shadows | pending | 151 |
| 153 | Simulation cost with 16 cars | pending | 151 |
| 154 | Adaptive quality (dynamic resolution, auto preset) | pending | 151 |
| 155 | Close parallel sections: per-index half-widths and shared median wall | pending | 140, 141, 142, 143 |
| 156 | Environment type per track: ground palette and vegetation | pending | 081, 101, 106 |
| 157 | City bake from OSM: buildings, old-city walls, water | pending | 106 |
| 158 | City renderer: buildings, facades, water | pending | 099, 157 |
| 159 | Street-circuit trackside: walls, sidewalks, lamps, billboards | pending | 141, 157 |
| 160 | Landmark proxies | pending | 158 |
| 161 | Fix minimap stretched to full screen and engine audio playing while paused | done | - |
| 162 | Speed-dependent rolling drag on grass and gravel | pending | 065, 169 |
| 163 | Surface feedback signal (pure) | done | - |
| 164 | Camera shake from surfaces | done | 163 |
| 165 | Gamepad rumble | done | 164 |
| 166 | Dirty tyres | pending | 065, 169, 162 |
| 167 | Surface particles (stones, dust, grass clippings) | pending | 165, 065, 169 |
| 168 | Add Fontana, Cleveland and Detroit to the game | pending | 106, 155, 156 |
| 169 | Vehicle model swap-in and old-test migration | pending | 065 |
