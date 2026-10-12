# Tasks

Specs for the workers. Create with the `plan-feature` skill from `_TEMPLATE.md`; run with the `dispatch` skill.

| # | Title | Status | Depends on | Parallel with |
|---|---|---|---|---|
| 001 | Create the project scaffold | done | - | - |
| 002 | Create shared types and constants | done | 001 | - |
| 003 | Implement the fixed-step loop | done | 002 | 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 |
| 004 | Project lon/lat coordinates to local metres | done | 002 | 003, 009, 010, 011, 012, 014, 015, 016 |
| 005 | Smooth and resample the centerline | done | 004 | 003, 007, 009, 010, 011, 012, 013, 014, 015, 016 |
| 006 | Generate public/tracks/monza.json with the track-builder | done | 002, 004, 005 | 003, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 |
| 007 | Build the track ribbon geometry | done | 004 | 003, 005, 006, 008, 009, 010, 011, 012, 014, 015, 016, 017 |
| 008 | Track progress and lap timer | done | 002, 004, 005 | 003, 006, 007, 009, 010, 011, 012, 013, 014, 015, 016 |
| 009 | Implement keyboard input | done | 002 | 003, 004, 005, 006, 007, 008, 010, 011, 012, 013, 014, 015, 016, 017 |
| 010 | Create the Rapier physics world and car config | done | 002 | 003, 004, 005, 006, 007, 008, 009, 012, 013, 014, 015, 016 |
| 011 | Implement the physics vehicle (Rapier raycast vehicle) | done | 002, 010 | 003, 004, 005, 006, 007, 008, 009, 012, 013, 014, 015, 016 |
| 012 | Create the base Three.js scene | done | 002 | 003, 004, 005, 006, 007, 008, 009, 010, 011, 014, 015, 016, 017 |
| 013 | Render the track (asphalt and start line) | done | 002, 007, 012 | 003, 005, 006, 008, 009, 010, 011, 014, 015, 016, 017 |
| 014 | Render the car (Kenney model) | done | 002 | 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 015, 016, 017 |
| 015 | Chase camera | done | 002 | 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 016, 017 |
| 016 | Create the speed and lap-time HUD | done | 002 | 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 017 |
| 017 | Create the game core (Game) and interpolation | done | 002, 005, 008, 010, 011 | 003, 006, 007, 009, 012, 013, 014, 015, 016 |
| 018 | Integrate everything in main.ts (browser game) | done | 002, 003, 006, 007, 009, 012, 013, 014, 015, 016, 017 | - |
| 019 | Add the Playwright e2e test | done | 018 | - |
| 020 | Fix invisible track and off-screen HUD in the browser game | done | 019 | - |
| 021 | Local progress dashboard for the AI pipeline | done | - | 020 |
| 022 | Add TrackData v2 types and Phase 1 constants | done | - | 023, 024, 035, 042, 047, 048, 049, 050, 051, 052 |
| 023 | Add inverse projection unprojectXZ | done | - | 022, 026, 027, 029, 031, 032, 033, 034, 036, 038, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 024 | Fetch DEM windows for the three tracks | in progress | 023 | 022, 026, 027, 029, 031, 032, 033, 034, 036, 038, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 025 | DEM sampling and centerline elevation profile | pending | 022, 023, 024 | 026, 027, 029, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 026 | Detect radii, kerbs and run-offs | pending | 022 | 023, 024, 025, 027, 028, 029, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 027 | Lay out barriers | pending | 022 | 023, 024, 025, 026, 028, 029, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 028 | Build the terrain heightfield | pending | 022, 023, 024, 025 | 026, 027, 029, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 029 | Place trees deterministically | pending | 022 | 023, 024, 025, 026, 027, 028, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 030 | Generate TrackData v2 for Monza, Spa and Silverstone | pending | 022, 024, 025, 026, 027, 028, 029 | 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 031 | Build track surface geometry from TrackData v2 | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 035, 036, 038, 039, 040, 041, 042, 046, 047, 048, 049, 050, 051, 052 |
| 032 | Terrain, surface and barrier colliders | pending | 022, 031 | 023, 024, 025, 026, 027, 028, 029, 030, 035, 036, 037, 038, 039, 040, 041, 042, 046, 047, 048, 049, 050, 051, 052 |
| 033 | Per-wheel surface grip and drag | pending | 022, 032 | 023, 024, 025, 026, 027, 028, 029, 030, 035, 036, 037, 038, 039, 040, 041, 042, 046, 047, 048, 049, 050, 051, 052 |
| 034 | Invalidate laps when all wheels leave the track | pending | 033 | 023, 024, 025, 026, 027, 028, 029, 030, 035, 036, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 035 | Fetch CC0 track textures | pending | 024 | 022, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 036, 038, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 036 | Render the terrain mesh | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 037, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 037 | Render track surfaces with textures | pending | 022, 031, 035 | 025, 026, 027, 028, 029, 030, 032, 033, 034, 036, 038, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 038 | Render barriers | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 039, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 039 | Instanced procedural trees with LOD | pending | 022, 035 | 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 036, 037, 038, 040, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 040 | Procedural grandstands with crowd | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 041, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 041 | Pit building, start gantry and start lights | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 042, 045, 046, 047, 048, 049, 050, 051, 052 |
| 042 | Sky, fog per track and car-following shadows | done | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 045, 046, 047, 048, 049, 050, 051, 052 |
| 043 | Load a TrackData v2 world into the game | pending | 022, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042 | 045, 046, 047, 048, 049, 050, 051, 052 |
| 044 | Track selection and pause menu | pending | 043 | 045, 046, 047, 048, 049, 050, 051, 052 |
| 045 | Six-speed gearbox with rpm and limiter | pending | 033 | 023, 024, 025, 026, 027, 028, 029, 030, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 046, 047, 048, 049, 050, 051, 052 |
| 046 | Gamepad input and input merging | pending | 022 | 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 047, 048, 049, 050, 051, 052 |
| 047 | T-cam and cockpit cameras with switching | in progress | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 048, 049, 050, 051, 052 |
| 048 | HUD v2 with gear, rpm, sectors, delta and invalid lap | pending | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 049, 050, 051, 052 |
| 049 | Minimap | pending | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 050, 051, 052 |
| 050 | Best-lap ghost recording and replay | pending | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 051, 052 |
| 051 | Engine and tyre audio | pending | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 052 |
| 052 | Graphics presets and FPS overlay | pending | - | 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051 |
| 053 | Integrate the F4 car model | blocked | - | - |
| 054 | Wire gameplay features into the game | pending | 034, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052 | - |
| 055 | Phase 1 end-to-end checks on three tracks | pending | 054 | - |

## Waves

Phase 0:

- Wave 1: 001
- Wave 2: 002
- Wave 3: 003, 004, 009, 010, 012, 014, 015, 016
- Wave 4: 005, 007, 011
- Wave 5: 006, 008, 013
- Wave 6: 017
- Wave 7: 018
- Wave 8: 019

Phase 1 (053 is blocked and excluded):

- Wave 1: 022, 023, 042, 047, 048, 049, 050, 051, 052
- Wave 2: 024, 026, 027, 029, 031, 036, 038, 040, 041, 046
- Wave 3: 025, 032, 035
- Wave 4: 028, 033, 037, 039
- Wave 5: 030, 034, 045
- Wave 6: 043
- Wave 7: 044
- Wave 8: 054
- Wave 9: 055
