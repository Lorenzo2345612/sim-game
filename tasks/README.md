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

## Waves

- Wave 1: 001
- Wave 2: 002
- Wave 3: 003, 004, 009, 010, 012, 014, 015, 016
- Wave 4: 005, 007, 011
- Wave 5: 006, 008, 013
- Wave 6: 017
- Wave 7: 018
- Wave 8: 019
