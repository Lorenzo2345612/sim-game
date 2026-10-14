# Game features: cockpit, liveries, driving school, race rules, replays/telemetry, weather (2026-10-13)

User priority (2026-10-13): these before performance and settings/remap work. Closed design for spec writers; acceptance tables are the Opus contract (copy verbatim). Conventions as `docs/plans/phase2-race.md` (lateral + = right, distances along the lap from the start line, deterministic, no `Math.random` in pure modules; seeded mulberry32 passed in). Pure modules import nothing from `three` unless they are in `src/render`.

Milestone order: … M1.7 → **M1.8 Cockpit** → **M1.9 Liveries** → M2.1 → **M2.1b Driving school** → **M2.1c Race rules** → **M2.1d Replays and telemetry** → M2.2 → **M2.2b Weather and time of day** → M2.3 …

| # | Milestone | Title | Deps | Cx |
|---|---|---|---|---|
| 115 | M1.8 | Cockpit data per car (eye, steering wheel anchor, lock) | 058, 072 | simple |
| 116 | M1.8 | Animated steering wheel in cockpit view | 115, 047, 054 | simple |
| 117 | M1.8 | Virtual rear-view mirror | 047, 054 | simple |
| 118 | M1.8 | Cockpit head motion and FOV setting | 115, 047 | simple |
| 119 | M1.9 | Livery data, palette and storage | 072 | simple |
| 120 | M1.9 | Paint materials in the car pipeline and livery shader | 119, 075 | complex |
| 121 | M1.9 | Race number decals | 120 | simple |
| 122 | M1.9 | Livery editor screen | 120, 121, 044 | simple |
| 123 | M2.1b | Driving line overlay coloured by action | 088, 093 | simple |
| 124 | — | (replaced by 143 in M1.2c: boards are static track data) | — | — |
| 125 | M2.1b | Assist presets and braking assist | 088, 070 | complex |
| 126 | M2.1b | Driving school lessons | 123, 125, 143, 044 | complex |
| 127 | M2.1c | Track limits strikes | 092, 093 | simple |
| 128 | M2.1c | Yellow and blue flags | 092, 093 | complex |
| 129 | M2.1c | Virtual safety car | 088, 092, 093 | complex |
| 130 | M2.1c | Penalty book, HUD messages and wiring of 127–129 | 127, 128, 129, 094, 095 | complex |
| 131 | M2.1d | Telemetry recorder and store | 070 | simple |
| 132 | M2.1d | Telemetry screen (charts and delta) | 131, 044 | simple |
| 133 | M2.1d | Replay recorder (all cars) | 093 | simple |
| 134 | M2.1d | Replay player and TV cameras | 133, 047 | complex |
| 135 | M2.2b | Time of day presets | 099 | simple |
| 136 | M2.2b | Night lighting: floodlights, headlights | 135, 103 | complex |
| 137 | M2.2b | Rain and track wetness model, wet compounds | 058, M2.2 compounds | complex |
| 138 | M2.2b | Wet visuals: rain, wet road, spray | 137, 080 | complex |
| 139 | M2.2b | Weather in races: config, forecast HUD, grip wiring, AI pace | 137, 138, 093 | complex |

Assets for 135/136 (planner side, asset-scout, before M2.2b): Poly Haven CC0 sunset and night HDRIs (2k).

---

## M1.8 Cockpit

### 115 — Cockpit data
`CarSpec.cockpit?: { eye: Vec3; wheel: Vec3; wheelRadius: number; lockDeg: number }` (car local frame, metres; −Z forward). Defaults when absent: eye = `COCKPIT_OFFSET` of `src/render/cameraRig.ts`, wheel = eye + (0, −0.15, −0.45), wheelRadius 0.13, lockDeg 270. Values written into `public/cars/f4.json` (open-wheel: eye from the model json's cockpit opening if present, else default; lockDeg 270) and every gt3 json (wheelRadius 0.17, lockDeg 480). `cameraRig` cockpit mode uses `cockpit.eye`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | parseCarSpec of f4.json / gt3-a.json | read cockpit | present; wheel.z < eye.z; wheel.y < eye.y; lockDeg 270 / 480 |
| AT2 | car JSON without cockpit | parseCarSpec | eye = COCKPIT_OFFSET; wheel = eye + (0, −0.15, −0.45) ± 1e-9; wheelRadius 0.13; lockDeg 270 |
| AT3 | wheelRadius 0 or 0.31, lockDeg 0 or 1081 | parseCarSpec | throws |

### 116 — Steering wheel
`src/render/steeringWheel.ts`: `createSteeringWheel(radius: number): THREE.Group` (rim torus + 3 spokes + display box; ≤ 2000 triangles; one material set shared across instances); `setSteeringWheelAngle(group, steer: number, lockDeg: number)`: rotation about the wheel's local Z = −steer · (lockDeg/2) in radians (steer + = right = clockwise seen by the driver). Visible only in cockpit mode, attached at `cockpit.wheel` facing the eye. `sceneStats().steeringWheel: { visible: boolean; angle: number }`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | createSteeringWheel(0.13) | count triangles | ≤ 2000; bounding radius in [0.12, 0.16] |
| AT2 | setSteeringWheelAngle(g, 1, 270) / (−0.5, 480) | rotation.z | −135° / +120° in radians ± 1e-9 |
| AT3 | e2e `/?track=monza`, cockpit camera, hold right 1 s | sceneStats().steeringWheel | visible true; angle < 0 |
| AT4 | e2e chase camera | sceneStats().steeringWheel | visible false |

### 117 — Virtual mirror
`src/render/mirror.ts`: second camera rendering the view behind the player car into a 512×128 render target every 2nd frame, shown as a DOM canvas `#mirror` (top centre) in cockpit and T-cam modes; setting `mirror: boolean` (default true). Pure helper `mirrorCameraPose(carPos, carQuat, out)`: position = car + rotate((0, 1.0, 0.5)), looking along car +Z (backwards); FOV 50.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: car at (10, 0, 5), identity quat | mirrorCameraPose | position (10, 1.0, 5.5) ± 1e-9; forward = (0, 0, +1) ± 1e-9 |
| AT2 | unit: car yaw 90° (quat about +Y) | same | forward = rotate((0,0,1)) ± 1e-9 |
| AT3 | e2e cockpit mode | `#mirror` | visible; its pixels' luminance std dev > 0.02 |
| AT4 | e2e chase mode / mirror setting false | `#mirror` | hidden; `renderStats().mirrorRenders` stops increasing |

### 118 — Head motion and FOV
`src/render/headMotion.ts`: `class HeadMotion { update(latG: number, longG: number, dt: number): { x: number; z: number } }` target x = clamp(−0.012·latG, −0.04, 0.04), z = clamp(0.012·longG, −0.04, 0.04) (latG + = acceleration to the right; longG + = accelerating), first-order low-pass τ = 0.15 s. Settings `cockpitFov` 50–100 (default 75) and `headMotion: boolean` (default true).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | constant latG 2, longG 0 | 2 s at 1/120 | x = −0.024 ± 1e-4, z = 0 ± 1e-9 |
| AT2 | latG 10 / longG −5 | 2 s | x = −0.04 ± 1e-4 / z = −0.04 ± 1e-4 (clamped) |
| AT3 | step latG 0 → 2 | after 0.15 s | x = −0.024·(1 − e⁻¹) ± 5e-4 |
| AT4 | settings without cockpitFov / with 120 | load | 75 / clamped 100 |

---

## M1.9 Liveries

### 119 — Livery data
`src/game/livery.ts`: `interface Livery { primary: string; secondary: string; accent: string; pattern: 'solid' | 'stripe' | 'split' | 'chevron'; number: number }` (colours `#rrggbb`, number 0–99). `LIVERY_PALETTE` (16 entries, distinct primaries; the palette 094 uses); `defaultLivery(index)` = palette[index mod 16] with number index+1 (mod 100); `parseLivery(json): Livery` (throws on bad colour/pattern/number); `loadLivery(storage, carId)` / `saveLivery(storage, carId, livery)` under key `livery:<carId>`; missing/invalid stored value → defaultLivery(0).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | LIVERY_PALETTE | inspect | 16 entries, all valid, 16 distinct primaries |
| AT2 | defaultLivery(17) | call | = palette[1] colours, number 18 |
| AT3 | parseLivery with primary '#12345g' / pattern 'dots' / number 100 | call | throws |
| AT4 | save then load (memory storage) / load with corrupt JSON | call | round-trips equal / defaultLivery(0) |

### 120 — Paint materials and livery shader
Car pipeline (`tools/car-pipeline/`): build config gains `paint: string[]` (material names that carry the livery; planner fills them per car after inspection) → output json `paintMaterials: string[]`. `src/render/liveryMaterial.ts`: `applyLivery(root: THREE.Object3D, paintMaterials: string[], livery: Livery, bounds: Box3)` patches each paint material (onBeforeCompile, shared program per pattern) with uniforms `uPrimary/uSecondary/uAccent/uPattern` and object-space position normalised by `bounds` (u = x across width 0..1, v = z along length 0..1 from nose, h = y 0..1). Pattern colour (pure, mirrored in TS for tests): `liveryColorAt(pattern, u, v, h)` → 0 primary, 1 secondary, 2 accent: solid → 0; stripe → |u − 0.5| < 0.08 ? 1 : (|u − 0.5| < 0.1 ? 2 : 0); split → h > 0.55 ? 1 : 0; chevron → v < 0.35 && |u − 0.5| < (0.35 − v) ? 1 : 0.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each `public/models/<car>.json` | read | `paintMaterials` non-empty; every name exists among the glb's materials |
| AT2 | liveryColorAt for (stripe, 0.5, 0.5, 0.5) / (stripe, 0.59, 0.5, 0.5) / (stripe, 0.8, 0.5, 0.5) / (split, 0.5, 0.5, 0.6) / (chevron, 0.5, 0.1, 0.5) / (chevron, 0.9, 0.1, 0.5) | call | 1 / 2 / 0 / 1 / 1 / 0 |
| AT3 | unit: applyLivery on a scene with materials A (paint) and B | inspect | A has the livery uniforms, B untouched; two cars with different liveries share one compiled program per pattern (program cache key) |
| AT4 | e2e monza, set player livery primary #ff0000 then #0000ff via `__SIMGAME__.setLivery` | screenshot pixel on the car body (chase cam, from `sceneStats().carScreenRect` centre) | red channel dominant then blue channel dominant |

### 121 — Number decals
`src/render/numberDecal.ts`: `numberTexture(n, fg, bg): CanvasTexture` (256², white disc with black digits by default, cached per number+colours); `decalAnchors(bounds)`: left side (min.x, 0.55·h, 0.45·len from nose) normal −X, right side mirrored normal +X, nose top (centre x, max.y, 0.12·len) normal +Y; size 0.35 m (open-wheel) — `DecalGeometry` per anchor, 3 meshes per car.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | bounds x[−0.9,0.9] y[0,1] z[−2.5,2.5] (nose at −Z) | decalAnchors | left (−0.9, 0.55, −0.25) n(−1,0,0); right (0.9, 0.55, −0.25) n(1,0,0); nose (0, 1, −1.9) n(0,1,0) (± 1e-9) |
| AT2 | numberTexture(7) twice | call | same texture object (cache) |
| AT3 | e2e monza | sceneStats().decals | 3 per car |

### 122 — Livery editor
Menu "Livery": car selector, 3 colour inputs, 4 pattern buttons, number input, live preview (turntable, the car renderer with applyLivery), Save. Player car uses the saved livery; AI cars use defaultLivery(i + 1).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e menu → Livery, set primary #ff0000, pattern stripe, number 44, Save | localStorage `livery:f4` | parses to those values |
| AT2 | e2e then start monza | `sceneStats().playerLivery` | primary #ff0000, pattern stripe, number 44 |
| AT3 | e2e editor | change pattern | preview canvas pixels change (≥ 1 % differ) within 500 ms; no console errors |

---

## M2.1b Driving school

### 123 — Driving line
`src/ai/lineActions.ts`: `lineActions(speeds: Float64Array, dist: Float64Array, length: number): Uint8Array` per point 0 throttle / 1 coast / 2 brake: brake where speeds[i+1] < speeds[i] − 0.05 m/s (over the next point, wrapping); coast where |speeds[i+1] − speeds[i]| ≤ 0.05 and speeds[i] < 0.97·max speed; else throttle. `src/render/drivingLine.ts`: ribbon 0.6 m wide, 2 cm above the surface along the racing line, vertex colours green/yellow/red; dynamic: within the next 200 m, points whose speed < car speed − 2 m/s are drawn red. Setting `drivingLine: 'off' | 'braking' | 'full'` (braking = only brake segments), default 'full' for beginners (125), else 'off'.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | speeds [50,50,40,30,30,30,40,50] (closed), dist spacing 10 | lineActions | [throttle, brake, brake, coast, coast, throttle, throttle, throttle] |
| AT2 | constant speeds = vMax | lineActions | all throttle |
| AT3 | e2e monza, drivingLine full | sceneStats().drivingLine | visible, vertex count ≥ 2 × line points |
| AT4 | e2e drivingLine off | same | not visible |

### 124 — Braking boards (REPLACED by 143, docs/plans/m1.2c-realism.md)
`brakeMarkers(speeds, dist, length): { distance: number; label: 150 | 100 | 50 }[]` for every braking zone (maximal run of brake points) whose speed drop (start − min of the zone) > 15 m/s: boards at zone start − 150/−100/−50 m (wrapped), sorted by distance. Rendered as instanced boards (1.2 × 0.8 m on 1.2 m posts, 1.5 m outside the track edge on the right side of the direction of travel… on the outside of the following corner), canvas textures "150/100/50".

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rounded square (087 AT2) with 088 profile (muLat 1.5) | brakeMarkers | 12 boards (3 per corner), each label at zone start − label ± 2 m |
| AT2 | profile with one 10 m/s drop zone | brakeMarkers | [] |
| AT3 | e2e monza | sceneStats().brakeBoards | ≥ 18 (6+ heavy braking zones) and drawCalls ≤ 300 |

### 125 — Assist presets
`src/game/assists.ts`: `type AssistLevel = 'beginner' | 'intermediate' | 'pro'`; `assistPreset(level)`: beginner {abs true, tc true, autoGear true, brakeAssist true, steerAssist 0.5, drivingLine 'full'}; intermediate {true, true, true, false, 0.2, 'braking'}; pro {false, false, false, false, 0, 'off'}. `brakeAssist(speed, targetSpeed, distanceToTarget, decel): number` = brake 0..1 needed so that speed reaches targetSpeed at the target with `decel` (m/s²) available: required = (speed² − target²)/(2·max(distance, 0.1)); brake = clamp(required/decel, 0, 1), 0 if speed ≤ target + 1. `steerAssist(input, yawRateError, k)` adds countersteer: steer − k·clamp(yawRateError, −1, 1) clamped to [−1, 1]. Preset choice in menu; aids override CarSpec aids at runtime.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | assistPreset for each level | call | table values exactly |
| AT2 | brakeAssist(60, 30, 100, 30) | call | (3600 − 900)/200/30 = 0.45 ± 1e-9 |
| AT3 | brakeAssist(30.5, 30, 50, 30) / (80, 20, 10, 30) | call | 0 / 1 |
| AT4 | steerAssist(0.2, 0.5, 0.5) / (0.9, −2, 0.5) | call | −0.05 / 1 |
| AT5 | Node: monza with the 070 vehicle, beginner preset, scripted full throttle with steering from 089 AiDriver at speedScale 1.15 (too fast) | 1 lap | no lap invalidation by all-4-wheels-off; with pro preset the same run leaves the track at least once |

### 126 — Driving school
`src/game/lessons.ts`: pure lesson state machines on `LessonState { t; speed; distance; lateral; offTrack; lapTime; stoppedInBox }`: L1 "Accelerate to 100 km/h then stop inside the box" (box = 20 m long zone at 400–420 m; pass when stoppedInBox within 30 s); L2 "Follow the line through the first chicane" (pass when |lateral − line offset| < 2 m for 90 % of samples between 600 and 1000 m and no offTrack); L3 "Brake at the 100 board" (pass when brake starts within ±20 m of the first 100 board and the corner is taken without offTrack); L4 "Complete a lap under target" (target = 1.15 × 088 profile lap time for the car; valid lap). Overlay with goal, hint, result; progress saved `school:<track>`; first launch shows a prompt offering the school (Skip remembered).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | L1 with samples reaching 28 m/s then speed 0 at 410 m by 20 s | evaluate | passed |
| AT2 | L1 stopping at 425 m / after 31 s | evaluate | failed with reason 'outside box' / 'timeout' |
| AT3 | L2 with 85 % of samples within 2 m | evaluate | failed |
| AT4 | L4 target for f4 at monza | call | 1.15 × profile lap time ± 1e-6 |
| AT5 | e2e first launch (empty storage) | `/` | `#school-prompt` visible; Skip → reload → not visible |
| AT6 | e2e start L1 | DOM | `#lesson-goal` text contains "100 km/h"; no console errors |

---

## M2.1c Race rules

### 127 — Track limits
`src/race/trackLimits.ts`: `class TrackLimits { constructor(carCount, opts?: { warnings: 3; penalty: 5; minOffSeconds: 0.25 }); update(car, wheelsOff: number /* 0..4 */, time): TrackLimitEvent | null }`. A strike = all 4 wheels off continuously ≥ minOffSeconds (one strike per excursion; a new excursion needs ≥ 1 s with < 4 wheels off). Strikes 1..warnings → `{ type: 'warning', count }`; each further strike → `{ type: 'penalty', seconds: 5 }`. Wheels "off" = lateral beyond halfWidth + kerb width (existing surface query: wheel on grass/gravel/runoff, not kerb).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 4 excursions of 0.5 s separated by 2 s | update at 1/120 | events warning 1, warning 2, warning 3, penalty 5 |
| AT2 | excursion of 0.2 s | update | no event |
| AT3 | 4 wheels off 0.5 s, back 0.5 s, off 0.5 s | update | one strike only |
| AT4 | 3 wheels off for 5 s | update | no event |

### 128 — Flags
`src/race/flags.ts`: `class FlagState { constructor(sectorBounds: number[] /* 3 sector start distances */, lapLength); update(cars: readonly FlagCar[], time): void; sectorFlag(s): 'green' | 'yellow' | 'double-yellow'; blueFor(car): boolean; overtakeUnderYellow(): { car: number; passed: number }[] }` with `FlagCar { distance /* race distance */; lapDistance; speed; offTrack; retired }`. Yellow in a sector while a car there is offTrack or speed < 5 m/s (for ≥ 1 s), double yellow if the stopped car is on track (not offTrack) for ≥ 3 s; clears 2 s after the cause leaves. Blue for car X when a car Y with race distance ≥ X + lapLength·0.5 … specifically: Y is lapping X (Y.distance − X.distance > lapLength − 200 m, i.e. Y within 200 m behind on track while ≥ one lap ahead minus) — rule: (Y.distance − X.distance) mod-free > lapLength/2 and Y is within 200 m behind X on track. Overtakes: a position swap between two running cars whose both lapDistances are in a yellow sector → reported once.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | car stopped (speed 0, offTrack true) in sector 2 for 1.5 s | sectorFlag | s2 yellow, s1/s3 green |
| AT2 | car stopped on track 3.5 s | sectorFlag | double-yellow |
| AT3 | cause leaves at t, query t + 1.9 / t + 2.1 | sectorFlag | yellow / green |
| AT4 | Y race distance 5900, X 1150, lapLength 5000 (Y 250 m behind on track) / 150 m behind | blueFor(X) | false / true |
| AT5 | two cars swap order inside a yellow sector | overtakeUnderYellow | one entry {car: overtaker, passed: other} |

### 129 — Virtual safety car
`src/race/vsc.ts`: `class Vsc { update(stoppedOnTrackSeconds: number, time): void; readonly phase: 'off' | 'deployed' | 'ending'; delta(car, lapDistance, time): number }`. Deploys when any car is stopped on track ≥ 10 s; 'ending' 5 s after the cause clears, then 'off'. Reference pace per point = 088 profile speed × 0.6; per car delta (s) = elapsed since deploy − reference time over the distance the car covered since deploy (positive = slower than reference = OK). A car whose delta < 0 for > 2 s cumulative in one deployment gets +5 s (event once).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | stopped 9.9 s / 10.0 s | phase | off / deployed |
| AT2 | constant profile 50 m/s, car at 30 m/s for 10 s after deploy | delta | 10 − 300/30 = 0 ± 1e-6 |
| AT3 | car at 35 m/s for 10 s | delta and events | delta < 0; one +5 s event |
| AT4 | cause clears at t | phase at t + 4.9 / t + 5.1 | ending / off |

### 130 — Penalty book and wiring
`src/race/penalties.ts`: `PenaltyBook` collects warnings/penalties per car with reason ('track limits', 'yellow flag overtake', 'VSC delta', 'jump start'); totals feed `RaceClassification.addPenalty`. RaceGame runs TrackLimits/FlagState/Vsc each tick; AI: blue → `setLateralOffset` 2 m toward the outside of the line and speed cap 0.95 × own target for 3 s; under VSC speed cap = 0.6 × profile; under yellow no overtakes (speed cap = car ahead's speed when within 30 m). HUD: flag icon per sector state, blue banner, VSC banner with delta, message toasts "Track limits 2/3", "+5 s". Results (095) show penalties per car with reasons. `__SIMGAME__.raceEvents()` returns the PenaltyBook entries.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: book with 3 warnings + 2 penalties (5 s each) | total(car) | 10 |
| AT2 | Node monza race, 5 AI, seed 1, force one AI stopped on track at 30 s (test hook) | run 60 s | VSC deployed by 40.1 s; every AI's delta ≥ −0.5 s; no AI penalty |
| AT3 | e2e race with `__SIMGAME__.forceTrackLimits(4)` test hook for the player | DOM | toasts for warnings 1–3 then "+5 s"; raceEvents has 4 entries |
| AT4 | e2e results after `finishRaceNow()` | `#results` | penalty column shows 5 s with reason for the player |

---

## M2.1d Replays and telemetry

### 131 — Telemetry
`src/game/telemetry.ts`: `TelemetryRecorder` samples the player car every 2 m of lap distance (interpolated between ticks): speed, throttle, brake, steer, gear, rpm, latG, x, z → `LapTelemetry { trackId; carId; lapTime; spacing: 2; channels: Record<Channel, Float32Array> }`; best valid lap per track+car stored (`telemetry:<track>:<car>`, base64 Float32). `deltaTrace(a, b)` = per sample time(a) − time(b) at the same distance.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | constant 50 m/s for a 1000 m lap at 1/120 ticks | record | 500 samples; speed all 50 ± 1e-4; time at sample k = 2k/50 ± 1e-3 |
| AT2 | lap B = lap A at 0.9× speed | deltaTrace(B, A) | last value = lapTime B − lapTime A ± 0.01 |
| AT3 | save then load | round trip | channels equal within float32 precision (≤ 1e-6 relative) |
| AT4 | saving a slower lap / an invalid lap | saveIfBest | false, stored lap unchanged |

### 132 — Telemetry screen
Pause menu and results gain "Telemetry": canvas 2D charts (no library): speed, throttle/brake, gear, steer vs distance for last lap and best lap overlaid, delta trace, minimap with a cursor following the mouse position on the charts.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e after 1 lap (test hook `__SIMGAME__.injectTelemetry(fixture)`) | open Telemetry | `#telemetry` with 5 canvases; no console errors |
| AT2 | e2e mouse over the speed chart at x = 50 % | DOM | `#telemetry-cursor` shows distance ≈ 50 % of lap ± 2 % and the speed value of that sample |

### 133 — Replay recorder
`src/game/replay.ts`: `ReplayRecorder(carCount, hz = 20, maxSeconds = 3600)` stores per car position (Float32 ×3), quaternion (Int16 normalised ×4), speed (Float32), steer (Int8), wheel spin angle (Float32) in preallocated typed arrays; `sampleAt(t, car, out)` interpolates (slerp for rotation); memory ≤ 32 MB for 16 cars × 3600 s.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | car moving x = 10·t | record 10 s, sampleAt(3.35) | x = 33.5 ± 1e-3 |
| AT2 | rotating 90°/s about Y | sampleAt mid-sample | angle error ≤ 0.2° |
| AT3 | 16 cars, 3600 s | allocated bytes | ≤ 32 MB; record() allocates nothing (no new arrays) |
| AT4 | record past maxSeconds | sampleAt(0) | returns the oldest kept sample (ring buffer), no throw |

### 134 — Replay player and TV cameras
Replay mode after a session (results "Replay"): play/pause, speed ×0.25/×1/×4, scrub bar, car focus next/prev, cameras: TV, chase, cockpit, orbit. `tvCameraPositions(track)`: every 250 m along the centerline, 25 m outside the outer side (side with larger barrier offset), 6 m above the elevation; `tvCameraFor(lapDistance)`: the camera whose position is the nearest ahead within 250 m else the previous one; FOV scales so the car spans ~20 % of screen height (fov = 2·atan(1.5 / (0.2 · distance))) clamped [5°, 60°].

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza.json | tvCameraPositions | count = floor(length/250) ± 1; each ≥ 20 m from the centerline |
| AT2 | distances 0, 249, 251 | tvCameraFor | index 0, 0, 1 (last camera at or behind the car); the index changes exactly once when crossing a camera position |
| AT3 | e2e replay of a 20 s recorded race | play ×4 for 5 s | `__SIMGAME__.replayTime()` advanced 20 ± 1 s; no console errors |
| AT4 | e2e scrub to 50 % | car position | equals recorder sampleAt at that time ± 0.05 m |

---

## M2.2b Weather and time of day

### 135 — Time of day
`TimeOfDay = 'day' | 'sunset' | 'night'`; per preset: HDRI (day = the track's current one, sunset/night = new Poly Haven HDRIs), sun direction/intensity, ambient scale, fog colour from the HDRI horizon (099). Track default: lusail and bahrain 'night', others 'day'; race config and `?tod=` override.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=lusail` | sceneStats | timeOfDay 'night'; environment = night HDRI name |
| AT2 | e2e `/?track=monza&tod=sunset` | sceneStats | timeOfDay 'sunset'; sun elevation < 15° |
| AT3 | e2e screenshot sky band at night vs day | mean luminance | night < 0.3 × day |

### 136 — Night lighting
Floodlight poles every 60 m along both sides (instanced, emissive heads) for night tracks; track and terrain shaders get an analytic "floodlit" term (illumination as a function of distance to the centerline: full on the track and run-offs, falling to 0 at 60 m) instead of real lights; player headlights (one SpotLight, no shadow) and emissive head/tail lights on every car. Budget: drawCalls ≤ 300.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit floodlit(distance) | 0 / 30 / 60 / 80 m | 1 / smoothstep value 0.5 ± 0.01 / 0 / 0 |
| AT2 | e2e lusail night | pixel under the car | luminance ≥ 0.15 (track visible) |
| AT3 | e2e | drawCalls() | ≤ 300; no console errors |

### 137 — Rain and wetness
`src/physics/weather.ts`: `class TrackWeather { constructor(seed); setRain(r: number /* 0..1 */); update(dt, lineUsage: number /* cars per minute */); readonly wetness: number }`: wetness' = 0.02·rain − (rain < 0.05 ? 0.004·(1 + 0.1·lineUsage) : 0), clamped [0, 1]. Grip multiplier `gripFactor(compound, wetness)`: slick 1 − 0.45·wetness; inter 0.93 − 0.15·|wetness − 0.5|·2; wet 0.85 + 0.05·wetness (wet compounds overheat: when wetness < 0.2, wear ×3). New compounds 'inter' and 'wet' in CarSpec tyres (values: inter mu0 = 0.93 × medium, wet 0.88 × medium in dry before the factor).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rain 1 for 50 s from dry | wetness | 1.0 ± 1e-9 (clamped after 50 s) |
| AT2 | wet 1, rain 0, lineUsage 0 | after 100 s | 0.6 ± 1e-6 |
| AT3 | gripFactor slick/inter/wet at wetness 0, 0.5, 1 | call | slick 1/0.775/0.55; inter 0.78/0.93/0.78; wet 0.85/0.875/0.9 |
| AT4 | parseCarSpec f4.json | tyres | has inter and wet |

### 138 — Wet visuals
Rain: GPU points (≤ 20 000) in a 40 m box following the camera, density ∝ rain; wet road: track and kerb shaders darken albedo by 0.35·wetness, roughness × (1 − 0.6·wetness), puddle mask from noise where wetness > 0.6; spray: per car particle trail ∝ speed·wetness (≤ 600 particles per car, 16 cars max).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=spa&rain=1` (wetness forced 1) | sceneStats | rainParticles > 0; trackWetness 1 |
| AT2 | e2e screenshot track pixel under the car dry vs wet | luminance | wet < 0.8 × dry |
| AT3 | e2e rain=1 | drawCalls | ≤ 300; no console errors |

### 139 — Weather in races
Race config `weather: 'dry' | 'wet' | 'changing'` (+ seed): 'changing' = rain schedule from the seed (one shower of 5–15 min starting 20–60 % into the race). Forecast HUD (now / +10 min). Tyre grip multiplied by gripFactor(compound, wetness) in the vehicle model; AI target speeds × sqrt(gripFactor); AI pits for inters when wetness > 0.35 and for slicks when < 0.15 (M2.2 strategy hook).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: schedule for seed 1, race 30 min | call | one shower, start in [6, 18] min, duration [5, 15] min; same seed same schedule |
| AT2 | Node: f4 on slicks, constant-radius skidpad (066 setup) wetness 0 vs 1 | max lateral g | ratio 0.55 ± 0.05 |
| AT3 | Node monza race wet, 5 AI | 60 s | AI average speed < 0.85 × dry run; no AI off-track > 2 times |
| AT4 | e2e `?race=1&weather=wet` | HUD | `#forecast` visible; no console errors |
