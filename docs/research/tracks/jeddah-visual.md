# Jeddah (Corniche street circuit) - visual reference

45 local images in `.ai/refs/jeddah/` (git-ignored; never copied to assets/public); licences/authors/pages in `.ai/refs/jeddah/SOURCES.md` (CC BY, CC BY-SA, CC0, public domain; "img N" = Nth file in `ls` order). Commons has NO track-level race photos for this circuit (only maps, a radar overview and waterfront/promenade photos), so the circuit furniture below is (est) from memory and from the generic street look; the surroundings are (img). (data) = `public/tracks/jeddah.json` (6191 m, 3096 points). Colours are eyeball estimates. No series or sponsor marks: signage is generic coloured panels.

## Overall

| Item | Observation |
|---|---|
| Environment | Permanent street-style circuit along the Red Sea corniche north of Jeddah, hugging the coast; fast, narrow, walls on both sides (est) |
| Origin / start | origin 21.63773, 39.10370; start line idx 0 at 21.63042, 39.10531 (data) |
| Relief | essentially flat (data elevation < 1 m); config max grade 3% |
| Surface | dark grey asphalt #46484c, newer patches #3c3e42; light grey concrete pit lane #b4b6b8 (est) |
| Ground | sand/stone pavers on the promenade #c8bba0 (img 24), pale beach sand #d4c8a4 (img 18), no real grass except small irrigated lawns #7a9a50 |
| Sea | shallow Red Sea, turquoise #5fb5b0 over reef shelves, deep blue #2f6f9a further out (img 15, 16), rock breakwater #8e8a80 and small rocky islets with palms (img 10, 11, 14) |
| Trees | wind-bent date/fan palms #5f7f45 lined along the promenade (img 11, 24), no dense vegetation |
| Skyline | white-beige mid-rise hotel/apartment blocks 8-20 floors (#d8d2c4, #c8b898) and a few 100-200 m glass towers, one tapering blue-grey tower (img 14, 16, 18) |
| Sky | hot hazy blue #8fb4d0, strong sun; the race is at night under floodlights (est) |

### Palette

| Item | Hex (est) |
|---|---|
| Asphalt | #46484c |
| Pit lane concrete | #b4b6b8 |
| Sand / pavers | #c8bba0 |
| Promenade paving | #b8b4a8 |
| Lawn | #7a9a50 |
| Kerb | red #c8302c and white #d8d8d4 (est) |
| Concrete wall | #bdbdb8 with painted lower band #8a8d90 (est) |
| Barrier tyre belt | black #1c1c1e |
| Fence | #8f949a |
| Pit building | white #d8d8d4, glass #6a8aa0, accent teal #2a8a8a (est) |
| Palms | #5f7f45 |

## Pit area (config: pits left of start straight, -286 to 387 m around the line)

| Item | Observation |
|---|---|
| Structure | permanent pit/paddock building: long low block, 2-3 storeys (est 10 m), white/pale grey facade with large glazed upper floor and a curved/sail roof canopy shading the garages (est); garage doors dark #1c1c1e |
| Lane | wide pale concrete pit lane with painted white lines; pit exit ramps into the first corner |
| Paddock | behind the pits, white marquees and hospitality blocks (est) |

## Grandstands (config: idx 0 right 30 m off, 120 m, 16 rows, roof; 450 m right 45 m off, 80 m; 5000 m right 30 m off, 80 m)

| Location | Description |
|---|---|
| Start/finish | large covered stand opposite the pits, grey steel structure with white roof sails and dark blue seats (est) |
| Corners | temporary tiered stands with unroofed scaffold at the slow corners and the final hairpin (est) |
| Hospitality | white tented lounges, promenade-side terraces |

## Walls / fences / kerbs / run-off

| Element | Observation |
|---|---|
| Walls | continuous concrete walls right at the edge (data barriers 149 segments), pale grey with generic painted advertising panels, with tyre barrier blocks at the exit of fast corners (est) |
| Fence | catch fence 4-6 m behind walls at the fast turns |
| Kerbs | red/white flat kerbs at corner inside, yellow-white stripes at the pit exit (est) |
| Run-off | little: tarmac run-off at slow corners (data 25 run-off segments, up to 30 m, gravel 18 m on the left near idx 257-346), grey with painted chevrons (est) |
| Lines | white edge lines, a darker painted line on the racing groove |

## Per turn / sector (positions from the centerline data; turn numbering est)

| Sector | idx / lat, lon | Notes |
|---|---|---|
| Start/finish | idx 0 / 21.63042, 39.10531 | straight along the corniche, pits left, stand right |
| Turn 1-2 | idx 256-288 / 21.63477, 39.10369 to 39.10313 | left-right pair (-100 deg, +124 deg) at the end of the first straight, run-off with gravel on the left |
| Fast esses | idx 516-748 / 21.63876, 39.10290 to 21.64216, 39.10169 | series of 40-65 deg changes, walls both sides, floodlight poles |
| North hairpin region | idx 878-1233 / 21.64402, 39.10259 to 21.65009, 39.10249 | long fast run to the northmost point, then back south |
| Chicane pair | idx 1568-1612 / 21.64475, 39.10185 to 21.64438, 39.10112 | 74 and 50 deg, slower, run-off |
| Southbound sweeps | idx 2172-2282 / 21.63473, 39.10267 to 21.63303, 39.10353 | 62, 39 and 36 deg bends |
| Final hairpin | idx 2809 / 21.62545, 39.10640 | 91 deg turn at the south end, then fast return to the start (idx 3096) |

## Landmarks to model as proxies

| Landmark | lat, lon | Size / look |
|---|---|---|
| Waterfront promenade | along the west edge, ~39.100 | paved promenade 15 m, railings, palms, pergola piers (img 12, 13, 21) |
| Shallow-water piers | ~21.640, 39.095 (est) | 150 m wooden/steel piers with dark pavilion roofs (img 12, 20) |
| Round-about sculpture | by the road (img 8) | steel arc 15 m with stone ring |
| Large white tent halls | on the beach (img 16, 17) | 100 x 40 m white peaked tents |
| Tapering tower | skyline (img 14, 22) | 150 m, blue-grey glass |
| Hotels | along the road | 60-100 m, cream and white |

## Top 10 priorities

1. Narrow dark street track with continuous pale walls and tyre blocks at the fast turns.
2. Red/white kerbs and thin white lines.
3. Red Sea on the west: turquoise shallows, rocky edges, small islets with palms.
4. Promenade paving in sand #c8bba0 and rows of palms.
5. Night look with floodlight rows (geometry only here).
6. White/pale pit building with glazing and a curved roof.
7. Covered main stand, scaffold stands at the slow corners.
8. Cream/white mid-rise hotels and a few glass towers in the distance.
9. Almost flat, no grass; sand-coloured ground.
10. Pit lane in light concrete with an exit ramp to the first corner.
