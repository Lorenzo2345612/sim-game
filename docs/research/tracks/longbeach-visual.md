# Long Beach (downtown street circuit) - visual reference

38 local images in `.ai/refs/longbeach/` (git-ignored; never copied to assets/public); licences/authors/pages in `.ai/refs/longbeach/SOURCES.md` (CC BY, CC BY-SA, CC0, public domain; "img N" = Nth file in `ls` order). Two layout maps are included (img 20, 21 old layouts); no track data exists in `public/tracks/` yet, so positions are lat/lon (est, about 100-150 m) and indices must be found later with `npm run track:locate -- longbeach <lat> <lon>`. Trackside furniture is well covered by a set of road-level photos of the circuit (img 9-16, files named after the corners). Colours are eyeball estimates. No series, sponsor or brand marks: signage is described as generic red/white banners and coloured panels.

## Overall

| Item | Observation |
|---|---|
| Environment | Temporary street circuit on public roads of downtown Long Beach, California, between the waterfront (Rainbow Harbor, marina) and the convention complex; about 3.2 km (1.97 mi) with ~11 turns; flat |
| Centre | about 33.7645, -118.1910 (est) |
| Relief | flat, sea level; a short downhill dip on one avenue (img 10 "downhill", est) and an underpass beneath the convention centre approach (img 16) |
| Surface | mixed: light concrete city roads #b4b2ac with dark rubber lines and patches of dark asphalt #55575a; yellow centre lines #d8b82a under the race paint (img 9, 10, 13) |
| Edge paint | thin pale blue edge lines #4a78c8 and red/white painted kerbs along some medians (img 11, 12) |
| Trees | tall slender fan palms #5f8a3f in rows, rounded shade trees #5a7a40 (img 6-9, 28-30) |
| Buildings | white/cream apartment towers 15-35 floors (#d8d2c4, #c8c0b0) with balconies; mid-rise offices beige #c0b49a; parking structures; dome of the arena with a pale blue whale mural #8fb8d8 (img 37) |
| Water | marina #3f84aa, white yachts and masts, reflective (img 17, 28, 32); breakwater and beach seen from the hotel roof (img 38) |
| Sky | clear California blue #80aed8, light smog haze #c8d0d4, strong afternoon sun, low-ish sun angle |
| Race overlay | huge red-and-white banner gantries across the track, tall grey catch fences, pedestrian bridge covered in generic yellow panels (img 29, 31, 37) |

### Palette

| Item | Hex (est) |
|---|---|
| Road concrete | #b4b2ac |
| Asphalt patches | #55575a |
| Rubber streaks | #3a3c40 |
| Kerb | red #c8302c, white #d8d8d4 (img 6, 11) |
| Edge line (blue) | #4a78c8 |
| Concrete wall | white-grey #c8c8c4 with red/white lower band (img 6) |
| Catch fence | #7a7e82 black-grey mesh |
| Banner arches | red #c8302c with white lettering (generic) |
| Grandstand | bare aluminium #b4b8bc, bench rows (img 7, 8) |
| Footbridge | yellow #d8b82a on grey steel #6a6e72 (img 37) |
| Marina water | #3f84aa |
| Palms | #5f8a3f |
| Village roofs | dark red #8a3a30, accent green #5fb070 (img 33-36) |

## Pit area

| Item | Observation |
|---|---|
| Location | on the wide road along the waterfront side of the start/finish straight, left of the line, approx 33.7640, -118.1895 (est) |
| Structure | temporary: low pit wall in white concrete blocks with a tall catch fence behind, garages as white tents or modular two-storey containers behind (img 12 shows rubber streaks along the pit lane), flat roofs, hospitality tents with red/white stripes |
| Lane | the road itself, dark rubber streaks on light concrete (img 12) |

## Grandstands

| Location | Description |
|---|---|
| Start/finish and main stand | long tiered temporary stands of bare aluminium benches with continuous handrails, no roof or simple tent roof, 25-30 rows (img 7, 8, 29, 31) |
| Hairpin and Shoreline curve | stands above the fence with views over the harbour (img 6) |
| Hospitality | white peaked tents on hotel roofs and on the plaza (img 38); red/white striped canopies |

## Walls / fences / kerbs / run-off

| Element | Observation |
|---|---|
| Walls | concrete road-block walls, white-grey, 1 m, with a red/white painted band and generic ad panels in red, green, blue, yellow (img 6, 8) |
| Fence | tall catch fence 4-5 m on steel posts, dark mesh, hangs above the wall and leans inwards; fan-shaped pedestrian fences (img 6, 7, 31) |
| Kerbs | red/white low painted kerbs on corner insides, raised red/white medians (img 11, 15) |
| Run-off | none; tyre barriers at the hairpin and the exits (est); escape lanes use closed side streets |
| Lines | pale blue edge lines, white grid box, painted words on the road at the start (img 15) |

## Per turn / sector (approximate positions; layout clockwise from 2009)

| Turn / zone | lat, lon (est) | Notes |
|---|---|---|
| Start/finish straight (Shoreline Drive) | 33.7650, -118.1890 | wide road, pit lane on the harbour side, stand opposite, red/white banner gantry (img 16) |
| Turn 1 (right) | 33.7648, -118.1865 | tight right after a 0.5 km straight, tyre wall, grandstand |
| Seaside Way section | 33.7627, -118.1890 | straight with the convention centre / arena to one side (img 14, 37) |
| Pine Avenue / Linden dip | 33.7655, -118.1925 | narrow avenue with apartment buildings, downhill dip and yellow-lined road (img 9, 10) |
| Hairpin | 33.7640, -118.1905 | slow 180 deg corner in front of a stand (img 5) |
| Back straight | 33.7632, -118.1935 | wide avenue, palms, blue edge line, pedestrian bridge (img 11, 12) |
| Under the convention complex | 33.7640, -118.1930 | short dark tunnel-like passage below the plaza (img 16) |
| Shoreline curve | 33.7610, -118.1915 | fast curve near the harbour edge, palms, yachts beyond (img 15, 28) |

## Landmarks to model as proxies

| Landmark | lat, lon (est) | Size / look |
|---|---|---|
| Arena dome | 33.7635, -118.1885 | circular dome 50 m diameter, pale blue marine mural (img 37) |
| Convention complex and plaza | 33.7650, -118.1920 | 3 storeys, concrete, covered plaza above the road |
| Harbour village | 33.7612, -118.1893 | low timber houses with dark red roofs, green and pink lit gables, lighthouse tower 15 m (img 33-36) |
| Marina | 33.7600, -118.1900 | 200 x 100 m basin, white yachts with masts (img 17, 32) |
| Apartment towers | north of the track | 20-35 floors, white, cream balconies (img 8, 9, 30) |
| Pedestrian bridge | 33.7640, -118.1905 (est) | 40 m steel truss, yellow generic panels (img 37) |

## Top 10 priorities

1. Light concrete road surface with dark rubber streaks and yellow centre lines.
2. Tall fan palms in rows along the track.
3. Concrete road-block walls with a red/white band and 4-5 m catch fence.
4. Bare-aluminium scaffold grandstands, long and tiered.
5. Red/white banner gantries across the track and the yellow pedestrian bridge.
6. Cream/white apartment towers 20-35 floors on one side.
7. Marina and yachts on the other side; harbour village with red roofs.
8. Arena dome with a pale blue mural.
9. Red/white kerbs and pale blue edge lines.
10. Flat, no run-off, tyre stacks at the hairpin.
