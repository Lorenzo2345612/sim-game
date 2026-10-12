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
| 033 | Per-wheel surface grip and drag | pending | 022, 032 |
| 034 | Invalidate laps when all wheels leave the track | pending | 033 |
| 035 | Fetch CC0 track textures | done | 024 |
| 036 | Render the terrain mesh | done | 022 |
| 037 | Render track surfaces with textures | done | 022, 031, 035 |
| 038 | Render barriers | done | 022 |
| 039 | Instanced procedural trees with LOD | done | 022, 035 |
| 040 | Procedural grandstands with crowd | done | 022 |
| 041 | Pit building, start gantry and start lights | done | 022 |
| 042 | Sky, fog per track and car-following shadows | done | - |
| 043 | Load a TrackData v2 world into the game | pending | 056, 038, 039, 040, 041, 042 |
| 044 | Track selection and pause menu | pending | 043 |
| 045 | Six-speed gearbox with rpm and limiter | pending | 033 |
| 046 | Gamepad input and input merging | done | 022 |
| 047 | T-cam and cockpit cameras with switching | done | - |
| 048 | HUD v2 with gear, rpm, sectors, delta and invalid lap | done | - |
| 049 | Minimap | done | - |
| 050 | Best-lap ghost recording and replay | in progress | - |
| 051 | Engine and tyre audio | in progress | - |
| 052 | Graphics presets and FPS overlay | in progress | - |
| 053 | F4 car model pipeline (offline asset build) | pending | - |
| 054 | Wire gameplay features into the game | pending | 034, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052 |
| 055 | Phase 1 end-to-end checks on three tracks | pending | 054 |
| 056 | Load TrackData v2 tracks into the game (terrain, surfaces, physics) | pending | 030, 032, 033, 034, 035, 036, 037 |
| 057 | Use the F4 car in the game and remove the Kenney placeholder | pending | 053, 056 |
