# Bathurst (Mount Panorama) - visual reference

42 local images in `.ai/refs/bathurst/` (git-ignored; never copied to assets/public); licences/authors/pages in `.ai/refs/bathurst/SOURCES.md` (all CC BY, CC BY-SA or public domain; "img N" = Nth file in `ls` order). Files were renamed to drop series/sponsor words. (img) = seen in a photo; (data) = read from `public/tracks/bathurst.json` (6197 m, 3099 centerline points); (est) = my estimate or memory, check before relying on it. Colours are eyeball estimates. No series, sponsor or brand marks to be reproduced: signage is generic coloured panels.

## Overall

| Item | Observation |
|---|---|
| Environment | Public road circuit over a hill (Mount Panorama) at the edge of a country town, NSW Australia; farmland, orchards and ridge lines visible from the summit (img 5, 21, 22) |
| Origin | track origin at about -33.4487, 149.5539; start line idx 0 at -33.43963, 149.56083 (data) |
| Relief | ~170 m climb (data: elevation 0 at start, 168 m near idx 1500, back to 0). Max grade ~20% in config. Mountain section climbs about 2.0 km, Conrod descends about 1.6 km |
| Surface | dark grey asphalt #55575a, worn racing line lighter #6a6c6e, black tyre marks on braking zones (img 11, 13); pit lane light grey concrete #b4b4b0 (img 23) |
| Grass | dry mown grass #8a8f55 on slopes, greener #6f9a45 in spring (img 4), yellow-brown #a89b5c in dry weather; bare dirt/gravel #b98f62 in cut banks and the new run-off areas (img 9, 10) |
| Trees | open eucalypt (gum) woodland, grey-green foliage #6b7a55, scattered not dense; few trees close to the Mountain section walls, none on Conrod (img 18, 19) |
| Sky | big blue country sky, strong sunlight; often hazy distance #b9c4cc; ridge blue-grey #6f86a0 on the horizon (img 5) |
| Barriers | concrete walls close to the track on the mountain (right at the edge, 10-12 m from centreline in data), pale grey #b9b7b0 with blue and red panels (img 18, 4); steel catch fence above the wall; tyre stacks at a few exits (img 42) |

### Palette

| Item | Hex (est) |
|---|---|
| Asphalt | #55575a (lighter lane #6a6c6e) |
| Pit lane concrete | #b4b4b0 |
| Grass (dry / green) | #8a8f55 / #6f9a45 |
| Gravel / run-off dirt | #b98f62 |
| Kerb | red #c8302c, white #d8d8d4 |
| Edge line | white #d8d8d4 |
| Concrete wall | #b9b7b0 |
| Wall panels | red #c43a35, blue #3a6cb0, yellow #d8c42a |
| Catch fence | #7d8186 |
| Pit building | white/grey #cfd0cf, accent orange #d86e22 (control tower, img 23) |
| Eucalypt foliage | #6b7a55 |
| Ridge / haze | #6f86a0 / #b9c4cc |

## Pit area (config: pits left of start straight, idx 0-220)

| Item | Observation |
|---|---|
| Structure | modern two-storey pit/control building with garages at ground level, glazed upper floor with covered balcony, flat roof; tall rectangular control tower in orange at the pit exit end (img 23) |
| Lane | wide light-grey concrete pit lane with white lines and a painted white-edged fast lane; red/white kerbs at pit exit (img 23, 24) |
| Paddock | behind the pits: large flat grassy/dirt paddock with white marquees, long corrugated sheds and hangars with dark green/blue roofs (img 8) |
| Wall | pit wall at lane edge, low concrete + fence section; crowd fencing on the main-straight side |

## Grandstands

| Location | Description |
|---|---|
| Main straight (config idx 0, right, 45 m off, 120 m, 14 rows, roof) | permanent concrete stand with a roof, grey concrete and blue/red seats (est); a second smaller stand about 350 m later (config) |
| Hell Corner and Murray's | grass banks with temporary scaffold tiers, crowd on the grass (img 4, 1) |
| Elsewhere | mostly spectator hillsides, camping zones along Conrod, no continuous stands |

## Walls / fences / kerbs / run-off

| Element | Observation |
|---|---|
| Walls | continuous concrete walls both sides along most of the mountain: pale grey, 1 m high, panels with large generic lettering; blue wall at the Mountain summit (img 18) |
| Fence | catch fence 3-4 m on steel posts above walls on the straights; rope and timber post fence on historic photos (img 2, 3) |
| Kerbs | red/white low rumble kerbs at most corners, white bars (img 4, 12, 35-37) |
| Run-off | almost none on the mountain; tarmac and gravel run-offs at Hell Corner / Murray's and the new section (data: 29 run-off segments, 30 m wide) |
| Painting | thin yellow edge line beside the kerbs at Hell Corner and the Chase (img 4), white lines on the straight |

## Per turn / sector (positions from the centerline data; names follow lap order and are est)

| Sector | idx / lat, lon | Notes |
|---|---|---|
| Start/finish and pit straight | idx 0-239 / -33.43963, 149.56083 | flat, walls both sides, stand right, pits left |
| Hell Corner (T1) | idx 239 / -33.43904, 149.55577 | tight turn (data -89 deg) then Mountain Straight; red/white kerbs, gravel trap |
| Mountain Straight climb | idx 300-780 / -33.4401, 149.5555 to -33.4486, 149.5535 | walls and trees close, about 100 m climb |
| Bend and Cutting group | idx 798 / -33.44889, 149.55354; idx 1000-1118 / -33.4478, 149.5496 | slow 52 and 104 deg turns at the foot of the wall, tight section; walls on both sides |
| Reid Park to Sulman Park | idx 1207 / -33.45073, 149.54919 | climb continues, long left sweepers |
| Skyline and summit | idx 1500 / -33.45490, 149.54776 | highest point (elevation ~168 m), open view over the farmland valley, wall with blue boards (img 18) |
| Esses / Dipper / McPhillamy | idx 1737-1929 / -33.45602, 149.55241 to -33.45753, 149.55584 | rapid direction changes while dropping 100 m, walls tight both sides |
| Forrest's Elbow | idx 1992 / -33.45842, 149.55661 | 105 deg hairpin right, tarmac and gravel run-off, grass banks |
| Conrod Straight | idx 2000-2800 / -33.4584, 149.5566 to -33.4446, 149.5611 | 1.6 km, descending 70 m, walls both sides with fence, wide cleared strip, campsites |
| The Chase | idx 2803 / -33.44461, 149.56107; idx 2846 / -33.44400, 149.56052 | fast chicane at the end of Conrod, 70 then 38 deg, kerbs and sausage kerbs |
| Murray's Corner | idx 3083 / -33.43980, 149.56110 | final turn onto the start straight (data -89 deg), temporary-style walls |

## Landmarks to model as proxies

| Landmark | lat, lon | Size / look |
|---|---|---|
| Pit/control building | -33.4405, 149.5585 (est) | 150 x 15 m, 2 storeys, white/grey with orange tower 20 m |
| Main stand | -33.4398, 149.5595 (est) | ~120 m long, 14 rows, roof |
| Memorial tower on the summit | -33.4535, 149.5475 (est) | small stone/steel tower on the high ground; keep generic |
| Paddock sheds | behind pits (img 8) | long low sheds, dark roofs 5 m high |
| Town | north-east, ~3 km | low rooftops, a few church spires; far, treat as skyline fog |

## Top 10 priorities

1. Continuous pale concrete walls with generic blue/red panels; fence above on straights.
2. Real elevation: 170 m climb, summit open to the valley.
3. Red/white kerbs and thin yellow/white edge lines.
4. Dry grass and bare dirt banks; gravel tan at run-offs.
5. Open eucalypt woodland in grey-green, not dense.
6. Pit building with orange tower, light grey concrete pit lane.
7. Main stand with roof, scaffold tiers at the corners.
8. Wide blue sky, hazy ridge line, no urban skyline.
9. Conrod: long wide straight with campsites and a fence.
10. The Chase and Murray's with tyre stacks and sausage kerbs.
