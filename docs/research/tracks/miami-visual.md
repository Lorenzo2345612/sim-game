# Miami (stadium grounds circuit) - visual reference

36 local images in `.ai/refs/miami/` (git-ignored; never copied to assets/public); licences/authors/pages in `.ai/refs/miami/SOURCES.md` (CC BY, CC BY-SA, CC0, public domain; "img N" = Nth file in `ls` order). Commons has few photos of the race weekend (about 6), so most trackside detail is (est). Many images are the stadium itself, its old orange-seat form and parking lots. (data) = `public/tracks/miami.json` (5411 m, 2706 points). Colours are eyeball estimates. No series, sponsor or brand marks: the stadium and signage are described generically.

## Overall

| Item | Observation |
|---|---|
| Environment | Temporary-plus-permanent circuit in the parking lots around a large oval stadium in Miami Gardens, Florida; stadium at about 25.9580, -80.2389 inside the loop; dead-flat suburbs, canal and low houses around (img 12, 34) |
| Origin / start | origin 25.95790, -80.23727; start line idx 0 at 25.95594, -80.23970 (data) |
| Relief | flat (data elevation < 0.01 m); a short ramp/overpass feature is built from the stadium berm, not data |
| Surface | dark grey asphalt #47494d, freshly laid grey #55575a, black tyre streaks; parking-lot concrete #b0b0ac beside the track (img 31, 36) |
| Edge paint | wide painted stripes in the run-off: cyan blue #4fb4d8, white #d8d8d4 and green #3fae78 bands along the track edge (img 32) |
| Grass | sparse lawn strips #7aa04e between parking rows, planted palms (img 12, 29) |
| Stadium | oval bowl 70 m tall, white roof canopy #d4d4d0 with cable-stay masts, turquoise accents #2aa8a8 (img 3, 12, 31, 36); older form had orange seats #d85a2c (img 34, 35) |
| Sky | hot humid blue #7fb0d8, heavy white clouds, afternoon race; sub-tropical haze #bfd0d8 |
| Trees | tall royal and coconut palms #5f8a45, shrubs, no forest |

### Palette

| Item | Hex (est) |
|---|---|
| Asphalt | #47494d |
| Parking concrete | #b0b0ac |
| Grass | #7aa04e |
| Kerb | red #c8302c and white #d8d8d4 (est) |
| Run-off paint | cyan #4fb4d8, white #d8d8d4, green #3fae78 |
| Concrete wall | dark charcoal #3a3c40 or pale grey #bdbdb8 with panels (img 32) |
| Fence | #6a6e72 |
| Stadium roof | #d4d4d0 |
| Stadium accent | #2aa8a8 |
| Seats (old form) | #d85a2c |
| Concrete structure | #a8a8a2 (img 24) |

## Pit area (config: pits left, -150 to 250 m around the line)

| Item | Observation |
|---|---|
| Structure | long permanent pit building with a 3-level terraced hospitality stand above the garages, white/light grey with glass balconies and a flat roof; garage doors dark (img 31, 36; est) |
| Lane | light grey concrete pit lane, white lines, wide |
| Paddock | beside the stadium on the parking apron, a faux marina water feature and white hospitality marquees (est) |

## Grandstands (config: idx 0 right 30 m, 120 m, 16 rows, roof; 450 m right 30 m; 3800 m left 45 m)

| Location | Description |
|---|---|
| Start/finish | long tiered stand with roof across the pit straight, several levels, spectators at every rail; behind it the stadium (img 31, 36) |
| Corners | temporary scaffold stands, bare aluminium (est) |
| Stadium | sits in the infield and is its own huge stand; the track passes below its concourse ramps (img 24 shows curved concrete ramps and orange-painted walls inside) |

## Walls / fences / kerbs / run-off

| Element | Observation |
|---|---|
| Walls | concrete walls close to the track, dark charcoal with coloured sponsor-style panels (green, blue, white, img 32); fence above on steel posts, 4 m |
| Kerbs | red/white low kerbs; in places painted to match the run-off stripes |
| Run-off | asphalt run-offs with painted bands (cyan/white/green); gravel traps at a few corners (data run-offs up to 23 m, gravel 18 m left near idx 495-594) |
| Lines | white edge lines |

## Per turn / sector (positions from the centerline data)

| Sector | idx / lat, lon | Notes |
|---|---|---|
| Start/finish | idx 0 / 25.95594, -80.23970 | pit lane left, stand right |
| T1 | idx 481 / 25.95723, -80.23067 | tight turn (-120 deg) at the east end of the first straight |
| East chicane group | idx 560-713 / 25.95835, -80.23118 to 25.96006, -80.22984 | flick left-right-left, 60-106 deg changes, walls close, tight |
| Back straight | idx 713-1377 / 25.96006, -80.22984 to 25.96045, -80.24300 | long west run along the north edge |
| NW hairpin | idx 1377 / 25.96045, -80.24300 | hairpin (-145 deg), tarmac run-off, gravel |
| Slower section | idx 1446-1911 / 25.95973, -80.24194 to 25.95653, -80.23594 | chicane at idx 1824-1911 (110, -59, 51 deg) |
| Marina area / SW | idx 2200-2453 / 25.95723, -80.24096 to 25.95623, -80.24468 | five low-angle bends along the south-west, last left (-91) at idx 2453 |
| Pit straight | idx 2453-2706 / 25.95623, -80.24468 to 25.95594, -80.23970 | final stretch to the line |

## Landmarks to model as proxies

| Landmark | lat, lon | Size / look |
|---|---|---|
| Oval stadium | 25.9580, -80.2389 | 330 x 270 m, 70 m, white roof canopy with masts, turquoise accent, big roof screen |
| Parking structures | around the grounds | flat concrete, 2-3 storeys |
| Faux marina | paddock (est) | 100 x 40 m pond with white boats |
| Canal | 25.960, -80.225 (est) | 30 m wide, east side, concrete banks (img 34) |
| Pedestrian bridge into the stadium | 25.957, -80.239 | 40 m concrete ramp bridge |

## Top 10 priorities

1. Cyan/white/green painted run-off bands along the track edge.
2. Oval stadium with white canopy roof and masts in the middle of the loop.
3. Dark grey asphalt on top of parking-lot concrete.
4. Dark charcoal concrete walls with coloured generic panels; 4 m fence.
5. Terraced pit/hospitality stand with glass balconies.
6. Palm trees in lawn strips, flat sub-tropical backdrop.
7. Faux marina water in the paddock.
8. Red/white kerbs; white edge lines.
9. Low houses and a canal beyond the parking.
10. Hot hazy sky with strong clouds.
