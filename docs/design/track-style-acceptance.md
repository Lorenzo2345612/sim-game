# M1.2e acceptance tables (planner, Opus)

Spec writers copy each table verbatim into its spec. Design: `docs/design/track-style.md`. Offsets (`offsetMeters`) are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

## 179 TrackStyle schema and parser (`src/track/trackStyle.ts`)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | raw `{version: 1}`, pointCount 100 | `parseTrackStyle(raw, 100)` | style deep-equals `DEFAULT_TRACK_STYLE`; errors `[]`; warnings `[]` |
| AT2 | raw `null` | parse | style deep-equals `DEFAULT_TRACK_STYLE`; errors `[]` |
| AT3 | `DEFAULT_TRACK_STYLE` | read | pitBuilding = `{storeys: 1, heightMeters: 4, depthMeters: 8, facade: '#b8bcc0', roof: null, doors: '#1c1c1e', accent: null, roofStyle: 'flat', glazing: 0}`; barriers.fence = `{heightMeters: 3, types: ['armco'], color: null}`; kerbs.colors null; runoffPaint.pattern 'none'; floodlights null; props `[]`; extraGrandstands `[]`; sky = `{hdri: null, fogDensityScale: 1}` |
| AT4 | pitBuilding `{storeys: 3, heightMeters: 12, facade: '#A1B2C3', roofStyle: 'folded', glazing: 0.5}` | parse | those values kept, facade lower-cased `'#a1b2c3'`; unspecified pit keys keep defaults (depthMeters 8, doors '#1c1c1e') |
| AT5 | `{version: 2}` | parse | exactly 1 error containing `version`; style deep-equals defaults |
| AT6 | pitBuilding `{storeys: 6, facade: '#ffffff'}` | parse | 1 error containing `pitBuilding.storeys`; storeys 1; facade `'#ffffff'` |
| AT7 | kerbs.colors `['#fff', '#000000']`; then `['#ff0000', '#ffffff', '#000000']` | parse each | each: 1 error containing `kerbs.colors`; kerbs.colors null |
| AT8 | top-level key `foo: 1` and pitBuilding key `bar: 2` | parse | errors `[]`; 2 warnings, one containing `foo`, one containing `pitBuilding.bar` |
| AT9 | barriers.ranges `[{start: 0, end: 100, fenceHeightMeters: 4}, {start: 90, end: 99, side: 'left', fenceHeightMeters: 5}]`, pointCount 100 | parse | 1 error containing `barriers.ranges[0]`; ranges = only the second entry |
| AT10 | `rangeContains` | `({start: 90, end: 10}, i, 100)` for i = 95, 5, 0, 10, 50; `({start: 10, end: 20}, i, 100)` for 10, 20, 21 | true, true, true, true, false; true, true, false |
| AT11 | ranges `A = {start: 0, end: 50, side: 'left'}`, `B = {start: 40, end: 60}` | `segmentOverride([A, B], seg, 100)` for seg `{start: 45, end: 70, side: 'left'}`, `{start: 45, end: 70, side: 'right'}`, `{start: 10, end: 20, side: 'left'}`, `{start: 10, end: 20, side: 'right'}` | B, B, A, null (same object references) |
| AT12 | props with 61 valid entries | parse | 1 error containing `props`; props `[]` |
| AT13 | props `[{type: 'tent', index: 5, side: 'left'}, {type: 'rocket', index: 6, side: 'left'}]` | parse | 1 error containing `props[1]`; props length 1, type 'tent', with defaults offsetMeters 10, lengthMeters 10, heightMeters 4, color null |
| AT14 | floodlights `{spacingMeters: 30}` | parse | floodlights = `{style: 'arm', heightMeters: 8, heads: 1, spacingMeters: 30, offsetMeters: 6, side: 'both', ranges: []}` |
| AT15 | floodlights `{spacingMeters: 5}`; then `{heightMeters: 41}` | parse each | 1 error each (`floodlights.spacingMeters`, `floodlights.heightMeters`); the invalid key takes its default, floodlights not null |
| AT16 | extraGrandstands `[{start: 10, end: 20, side: 'left'}]` | parse | entry = `{start: 10, end: 20, side: 'left', offsetMeters: 15, rows: 12, roof: true}` |
| AT17 | sky.hdri `'unknown_sky'`; then `'kloofendal_overcast_puresky'` | parse each | first: 1 error containing `sky.hdri`, hdri null; second: no error, hdri kept |
| AT18 | a deep-frozen input with every section | parse | does not throw; returned style shares no object with the input (mutating `style.props[0]` leaves the input unchanged) |
| AT19 | source of `src/track/trackStyle.ts` | read text | contains no `from 'three'` |
| AT20 | helper `tests/unit/acceptance/helpers/colour.ts` exporting `hsl(hex)` and `isRed, isOrange, isYellow, isGreen, isTeal, isBlue, isWhite, isLight, isDark, isCream, isGrey` per the design predicates | call | `isRed('#d0432d')`, `isGreen('#58d23a')`, `isCream('#cdb89a')`, `isWhite('#ffffff')`, `isGrey('#808080')`, `isBlue('#1f4fbf')`, `isYellow('#f2c400')`, `isTeal('#1f9e8f')` all true; `isRed('#58d23a')`, `isGreen('#d0432d')`, `isWhite('#cdb89a')` false |

## 180 Style loader, wiring, extra grandstands, debug hook

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fetch stub returning 404 | `await loadTrackStyle('monza', 2894, fetchStub)` | `{style: DEFAULT_TRACK_STYLE, loaded: false, errors: [], warnings: []}`; stub called once with `/tracks/monza.style.json` |
| AT2 | stub 200 with body `{"version":1,"foo":1}` | load | loaded true; warnings length 1; errors `[]` |
| AT3 | stub 200 with body `{not json` | load | loaded false; 1 error containing `JSON`; style = defaults; no throw |
| AT4 | stub that rejects (network error) | load | loaded false; style = defaults; no throw |
| AT5 | STRAIGHT; entry `{start: 10, end: 20, side: 'left', offsetMeters: 15, rows: 12, roof: true}` | `extraGrandstands(STRAIGHT, style)` | 1 Grandstand: lengthMeters 100 (±1e-6), rows 12, roof true, x 150 (±1e-6), z -21 (±1e-6) |
| AT6 | same entry with side 'right' | same | z = +21 (±1e-6) |
| AT7 | result of AT5 and AT6 | front direction `(-sin yaw, -cos yaw)` | dot with the unit vector from the stand to (150, 0) ≥ 0.99 for both |
| AT8 | ring of 100 points, radius 500 m, centre (0, 0); entry `{start: 95, end: 5, side: 'left', offsetMeters: 15}` | extraGrandstands | 1 stand; lengthMeters = chord(95→5) = 1000·sin(18°) = 309.0 ± 0.5; distance from the ring centre is 475.5 + 21 or 475.5 - 21 (± 1) depending on the ring's winding |
| AT9 | defaults | `createPitBuilding(track)` vs `createPitBuilding(track, DEFAULT_TRACK_STYLE)`; same for `createBarrierObject`, `createGrandstand`, `createTrackSurfaceObject` | same child count and same mesh names in the same order |
| AT10 | e2e, `?track=monza`, route `**/tracks/monza.style.json` → 404 | `__SIMGAME__.sceneStats().style` | `{id: 'monza', loaded: false, warnings: 0}` |
| AT11 | e2e, route → `{"version":1,"foo":1}` | same | `{id: 'monza', loaded: true, warnings: 1}` |
| AT12 | e2e, route → `{"version":1,"extraGrandstands":[{"start":100,"end":130,"side":"left"}]}` | count scene objects named `grandstand` (the name createGrandstand gives its group; add it if missing) | count = monza's `grandstands.length` + 1 |

## 181 Tools: `track:locate` and `check:styles`

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | STRAIGHT | `locateIndex(STRAIGHT, 152, -30)` | `{index: 15, side: 'left', distanceMeters: 30.07 ± 0.01}` |
| AT2 | STRAIGHT | `locateIndex(STRAIGHT, 152, 30)` | side 'right', index 15 |
| AT3 | monza | `trackOrigin('monza')` | [lon, lat] within 0.05° of [9.28, 45.62] |
| AT4 | monza centerline[100] unprojected with `trackOrigin('monza')` | `npm run -s track:locate -- monza <lat> <lon>` | exit 0; stdout last line parses as JSON with index 100 ± 1 and distanceMeters < 1 |
| AT5 | unknown id `nope` | track:locate | exit code ≠ 0, stderr contains `nope` |
| AT6 | temp dir with `t.json` (10-point centerline) and `t.style.json` = `{"version":1}` | `npx tsx tools/track-style/checkStyles.ts <dir>` | exit 0 |
| AT7 | same with `{"version":1,"foo":1}` | check | exit 1; output contains `t` and `foo` |
| AT8 | same with `{"version":1,"barriers":{"ranges":[{"start":0,"end":10}]}}` (index 10 ≥ 10 points) | check | exit 1; output contains `barriers.ranges[0]` |
| AT9 | dir with `u.style.json` and no `u.json` | check | exit 1; output contains `u` |
| AT10 | repo as-is | `npm run -s check:styles` | exit 0 |

## 182 Pit building and grandstand styling

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, DEFAULT style | `createPitBuilding(track, style)` | mesh `pit` material colour `#b8bcc0`; door material `#1c1c1e`; `userData.garageCount` unchanged from before the task; no mesh named `pitGlass` or `pitRoof` |
| AT2 | pitBuilding `{storeys: 3, heightMeters: 12, depthMeters: 15}` | create | mesh `pit` bounding-box height ≥ 12 - 0.01 and depth 15 ± 0.01 (local Z extent); `userData.storeys` 3 |
| AT3 | pitBuilding `{facade: '#ffffff', doors: '#333333'}` | create | `pit` colour `#ffffff`; every `garageDoor` colour `#333333` |
| AT4 | pitBuilding `{glazing: 0.4, storeys: 2, heightMeters: 9}` | create | a mesh `pitGlass` exists; its height = 0.4 × (9 - first-storey height) ± 0.05 where first-storey height = 9 / 2; its material is transparent or has metalness ≥ 0.5 |
| AT5 | roofStyle each of `canopy`, `folded`, `sail`, `curved` | create | a mesh `pitRoof` exists; its top (world bbox max Y) ≥ pit top; for `flat` with roof colour set: `pitRoof` exists with that colour |
| AT6 | accent `#cc0000` | create | a mesh `pitAccent` with colour `#cc0000` |
| AT7 | any style from AT2-AT6 | create | building near face stays at `widthMeters/2 + 10` m from the chord (±0.05), so the building never overlaps the track |
| AT8 | grandstands `{structure: '#cccccc', roof: '#ffffff', seats: ['#1f4fbf', '#f2c400'], roofStyle: 'sail'}` | `createGrandstand(g, load, style)` | structure meshes `#cccccc`; roof mesh `#ffffff`; a seat mesh/InstancedMesh with instance colours drawn only from the two seat colours, both used; roof mesh named `standRoof` with `userData.roofStyle === 'sail'` |
| AT9 | DEFAULT style | createGrandstand | identical mesh names, counts and colours to calling without style |
| AT10 | dispose after AT2-AT8 | `disposeGrandstand` / group traversal dispose | every geometry and material created is disposed (spy on dispose) |

## 183 Kerb colours and run-off paint

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | STRAIGHT with kerbs `[{0,20,left},{40,60,left}]`, DEFAULT style | `createTrackSurfaceObject(strips, {style, track})` | exactly 1 mesh named `kerbs` (as today) |
| AT2 | kerbs.colors `['#ff0000', '#00ff00']` | create | every kerb material has `userData.stripeColors` = `['#ff0000', '#00ff00']` |
| AT3 | kerbs.colors default; ranges `[{start: 35, end: 70, side: 'left', colors: ['#f2c400', '#1f4fbf']}]` | create | 2 kerb meshes (`kerbs`, `kerbs:1`); the one whose geometry spans x 400..600 has stripeColors `['#f2c400', '#1f4fbf']`; the other uses the renderer default |
| AT4 | AT3 | count triangles | sum of triangles across kerb meshes = triangles of the single default mesh in AT1 |
| AT5 | runoffs `[{0,20,left,'runoff',8}]`, runoffPaint `{pattern: 'stripes', colors: ['#d0432d', '#ffffff'], stripeMeters: 2}` | create | a mesh `runoffPaint` exists with `userData.pattern 'stripes'`, `userData.colors` as given, `userData.stripeMeters 2`; the `runoff` mesh no longer contains those triangles (triangle total of runoff + runoffPaint equals the default runoff count) |
| AT6 | runoffPaint pattern `'none'` (default) | create | no `runoffPaint` mesh |
| AT7 | gravel run-off segment with a paint range covering it | create | gravel is never painted: no `runoffPaint` mesh; gravel triangle count unchanged |
| AT8 | runoffPaint default `none`, ranges `[{start: 0, end: 20, side: 'left', pattern: 'solid', colors: ['#58d23a']}]` | create | `runoffPaint` mesh, pattern 'solid', colors `['#58d23a']` |
| AT9 | kerb and paint uniforms | inspect `material.userData` and the shader uniforms after `onBeforeCompile` with a stub shader | stripe uniforms equal the linear-space conversion of the hex colours (±1e-3) |
| AT10 | physics | `buildTrackSurfaces(track)` before/after | identical output (rendering only; surfaces and grip unchanged) |

## 184 Palette tints, edge lines, sky

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | DEFAULT style | `createSurfaceMaterial(kind, load, macro, style)` for asphalt, grass, gravel | material `color` is white (1,1,1) as today |
| AT2 | palette `{asphalt: '#808080', grass: '#c0d080', gravel: '#e0c090'}` | create | each material `.color.getHexString()` equals the given hex (in sRGB) |
| AT3 | edgeLines `{color: '#f2c400'}` | `createTrackMarkingsObject(strips, style)` | marking material colour `#f2c400`; `registerWhitePaint` not called for it (not white) |
| AT4 | DEFAULT style | createTrackMarkingsObject | colour unchanged from today (linear 0.7, 0.7, 0.7) and still registered as white paint |
| AT5 | sky `{hdri: 'kloofendal_overcast_puresky'}` for track monza | `envNameFor('monza', style)` | `'kloofendal_overcast_puresky'`; with default style → `ENV_TABLE.monza` |
| AT6 | sky `{fogDensityScale: 2}` | `fogDensityFor('monza', style)` | `2 × FOG_TABLE.monza.density` (±1e-12); default → unchanged |
| AT7 | e2e `?track=monza`, route style `{"version":1,"sky":{"fogDensityScale":2}}` | `scene.fog.density` via `__SIMGAME__.sceneStats()` (add `fogDensity` to sceneStats) | 2 × the value without the style (±1e-9) |

## 185 Barrier colours and fences

Fixture: STRAIGHT with barriers `[{0,20,left,armco,8},{30,50,left,wall,8},{60,80,right,tyres,8},{85,95,right,foam,8}]`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | DEFAULT style | `createBarrierObject(track, load, style)` | mesh `fence` exists; `userData.fenceMeters` = armco length only (200 ± 1); fence height 3 m (bbox Y extent above rail base 3 ± 0.01) |
| AT2 | fence `{heightMeters: 5, types: ['armco', 'wall']}` | create | fenceMeters = 400 ± 2; fence top 5 m above each barrier base (±0.01) |
| AT3 | fence `{heightMeters: 0}` | create | no `fence` mesh; fenceMeters 0 |
| AT4 | DEFAULT fence; ranges `[{start: 60, end: 80, side: 'right', fenceHeightMeters: 4}]` | create | fenceMeters = 200 + 200 (±2): tyres segment gets a 4 m fence even though tyres is not in types |
| AT5 | ranges `[{start: 0, end: 20, side: 'left', fenceHeightMeters: 0}]` | create | fenceMeters 0 (armco fence removed there) |
| AT6 | fence color `'#2e8b57'` | create | fence material colour `#2e8b57` |
| AT7 | concrete `{color: '#e8e8e8', bandColor: '#f2c400'}` | create | wall material colour `#e8e8e8`; a mesh `wallBand` exists with colour `#f2c400`, height 0.3 ± 0.01, along the 200 m wall only |
| AT8 | armco `{color: '#9aa0a6'}` | create | armco material colour `#9aa0a6` |
| AT9 | tyres `{beltColor: '#1f4fbf'}` | create | tyre instance colours alternate the existing white with `#1f4fbf` (linear ±1e-3) instead of red |
| AT10 | foam `{colors: ['#d0432d', '#ffffff']}` | create | foam blocks use only those two colours, both present |
| AT11 | DEFAULT style | create with and without style | identical mesh names, counts, colours, instance counts |
| AT12 | physics | barrier colliders before/after any style | identical (fence and band are render only) |

## 186 Floodlights (`src/render/floodlights.ts`, added to the scene in `main.ts`)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | floodlights null | `createFloodlights(STRAIGHT, style)` | returns null |
| AT2 | `{spacingMeters: 20, side: 'left', heightMeters: 8, offsetMeters: 6, ranges: [{start: 0, end: 99}]}` on STRAIGHT (range walks indices forward, 990 m, no closing chord) | create | `userData.poles` = floor(990 / 20) + 1 = 50; every pole base at z = -(6 + 6) ± 0.01 (left, halfWidth 6 + offset 6); pole tops at elevation + 8 ± 0.01 |
| AT3 | as AT2 with side 'both' | create | poles 100; half at z ≈ -12, half at z ≈ +12 |
| AT4 | ranges `[{start: 0, end: 49}]`, spacing 20, side 'left' | create | poles only at x ≤ 490; count 25 ± 1 |
| AT5 | heads 6, style 'mast', heightMeters 30 | create | `userData.heads` = poles × 6; head meshes are instanced (≤ 3 draw objects total in the group) |
| AT6 | any pole | placement | no pole within `widthMeters/2 + 1` m of any centerline point (checked against all points, so poles never stand on a hairpin's other leg); poles that would violate it are skipped |
| AT7 | terrain present | create on monza with a floodlight style | every pole base y within 0.5 m of the terrain/elevation at its position |
| AT8 | dispose | call returned `dispose()` | all geometries and materials disposed |
| AT9 | e2e `?track=monza`, route style `{"version":1,"floodlights":{"spacingMeters":40}}` | `__SIMGAME__.sceneStats().floodlights` | > 0; without the route: 0 |
| AT10 | no allocations per frame | source | floodlights add nothing to the per-frame loop (static meshes only) |

## 187 Trackside props (`src/render/trackProps.ts`, added in `main.ts`)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | props `[]` | `createTrackProps(STRAIGHT, style)` | null |
| AT2 | `{type: 'footbridge', index: 50, lengthMeters: 30, heightMeters: 6, color: '#2e8b57'}` | create | one child named `prop:footbridge`; spans the track: its bbox covers z from < -6 to > +6 at x = 500 ± 1; lowest deck point ≥ elevation + 5.5 (clear of cars); colour `#2e8b57` |
| AT3 | `{type: 'marshalPost', index: 20, side: 'right', offsetMeters: 8}` | create | `prop:marshalPost` centre at x 200 ± 1, z between 6 + 8 - 1 and 6 + 8 + 3 (outside the edge) |
| AT4 | each of `tent`, `scoreboard`, `billboardRow`, `tower` beside the track (offset 10, side left) | create | one named child per prop; none intersects the asphalt (every bbox corner at least widthMeters/2 m from every centerline point, footbridge excepted) |
| AT5 | `billboardRow` length 40 | inspect | it carries no text texture: materials have no `map` or a plain colour map only |
| AT6 | prop with `index` on a hairpin such that the offset lands on the other leg | create | that prop is skipped and `userData.skipped` counts it |
| AT7 | 60 props | create | ≤ 12 draw objects (props of the same type are instanced or merged) |
| AT8 | dispose | `dispose()` | all geometries and materials disposed |
| AT9 | e2e monza with a footbridge route style | `__SIMGAME__.sceneStats().props` | 1; without: 0 |

## 188-205 per-circuit style files (data only)

Common rows (every circuit task, `tests/unit/acceptance/NNN-<id>-style.test.ts`):

| ID | Given | When | Then |
|---|---|---|---|
| C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| C6 | `npm run -s check:styles` | run | exit 0 |

Signature rows (Sn), from each research doc's Top 10; colour predicates from the design doc:

| Task | id | Signature rows |
|---|---|---|
| 188 | monza | S1 kerbs.colors has one isRed and one isWhite. S2 runoffPaint has ≥ 2 ranges, one with an isGreen colour. S3 props include a footbridge with an isGreen colour. S4 pitBuilding storeys ≥ 3, glazing ≥ 0.3, roof isCream. S5 ≥ 4 marshalPost props with isOrange colour. S6 palette.gravel isCream or isLight |
| 189 | spa | S1 a runoffPaint range with stripes whose colors include isRed, isYellow and a dark (black) colour. S2 fence color isGreen. S3 grandstands.seats include isBlue. S4 pitBuilding storeys 2, facade isGrey. S5 sky.hdri `kloofendal_overcast_puresky` |
| 190 | silverstone | S1 pitBuilding roofStyle 'folded', accent isRed, doors isDark. S2 grandstands.roof isWhite, seats include isBlue. S3 a tyres beltColor isOrange or isRed. S4 ≥ 2 footbridge props. S5 sky.hdri overcast |
| 191 | budapest | S1 kerbs.outerStrip isGreen. S2 kerb range with an isOrange colour (T6-T9). S3 palette.grass not isGreen-saturated: s ≤ 0.45. S4 pitBuilding glazing ≥ 0.2, facade isWhite or isLight. S5 grandstands.seats include isBlue |
| 192 | spielberg | S1 a runoffPaint range with isRed and isWhite stripes (T1). S2 kerbs.outerStrip or a kerb range isGreen. S3 pitBuilding glazing ≥ 0.4, facade isGrey. S4 extraGrandstands ≥ 2 |
| 193 | mexico | S1 kerbs.outerStrip isGreen. S2 runoffPaint stripes isRed + isWhite. S3 barriers.concrete.color isGreen (green-wrapped walls). S4 pitBuilding storeys 3, accent isYellow. S5 grandstands.roofStyle 'truss', roof isDark |
| 194 | daytona | S1 fence heightMeters ≥ 6 and types include 'wall'. S2 runoffPaint colours include isBlue and isWhite. S3 barriers.concrete.bandColor isBlue or concrete.color isWhite. S4 a tower or scoreboard prop. S5 grandstands.seats ≥ 3 colours. S6 floodlights non-null, style 'mast' |
| 195 | fontana | S1 grandstands.seats include isRed and isYellow. S2 pitBuilding roof isRed. S3 a scoreboard or tower prop with isRed colour. S4 fence heightMeters ≥ 4, types include 'wall'. S5 palette.grass isGreen |
| 196 | elkhart | S1 a kerb range with colours isRed + isYellow. S2 a kerb range with both colours isGrey (concrete rumble). S3 ≥ 3 footbridge props. S4 palette.gravel isLight or isCream. S5 extraGrandstands `[]` and ≥ 3 tent props |
| 197 | braselton | S1 kerbs.colors include isBlue and isYellow, or a kerb range with them. S2 barriers.concrete.color isLight and fence heightMeters ≥ 3.5 with types including 'wall'. S3 ≥ 1 footbridge prop. S4 floodlights non-null. S5 ≥ 3 marshalPost props with isGreen colour |
| 198 | cleveland | S1 palette.asphalt isLight or isGrey with l ≥ 0.5 (concrete runway). S2 fence types include 'wall', heightMeters ≥ 3.5. S3 extraGrandstands ≥ 2. S4 no floodlights |
| 199 | detroit | S1 fence types include 'wall', heightMeters ≥ 3.5. S2 runoffPaint pattern 'none' and no ranges. S3 ≥ 2 footbridge props. S4 extraGrandstands ≥ 2 and palette.gravel null |
| 200 | baku | S1 runoffPaint colours include isGreen and isRed. S2 fence heightMeters 4-5, types include 'wall'. S3 pitBuilding facade isWhite or isLight. S4 palette.asphalt isDark |
| 201 | singapore | S1 floodlights non-null, style 'arm', heightMeters 6-9, spacingMeters 15-25. S2 fence heightMeters 4-5, types include 'wall'. S3 barriers.concrete.bandColor isYellow, color isWhite. S4 pitBuilding roofStyle 'curved', roof isTeal or isGreen. S5 grandstands.seats include isBlue and isYellow |
| 202 | lasvegas | S1 floodlights non-null. S2 fence heightMeters 4-5, types include 'wall'. S3 edgeLines.color isBlue. S4 pitBuilding storeys ≥ 4, facade isDark or isWhite |
| 203 | bahrain | S1 grandstands.roofStyle 'sail', roof isWhite. S2 runoffPaint colours include isCream and isBlue. S3 floodlights style 'mast', heightMeters 25-30, heads ≥ 6, spacingMeters 50-70. S4 pitBuilding facade isCream, storeys 2. S5 ≥ 4 tent props isWhite. S6 palette.grass isCream (sand) |
| 204 | sepang | S1 grandstands.roofStyle 'sail'. S2 edgeLines.color isBlue. S3 a runoffPaint range with isRed, isWhite, isYellow or isBlue (≥ 3 of them). S4 fence color isTeal. S5 pitBuilding facade isGrey, glazing ≥ 0.3 |
| 205 | lusail | S1 floodlights non-null, style 'mast', heightMeters 25-30, heads ≥ 4. S2 fence color isTeal or isGreen. S3 runoffPaint ranges with isOrange, isBlue and a maroon (isRed with l ≤ 0.35) colour. S4 pitBuilding storeys 2. S5 palette.grass isCream (sand) |
