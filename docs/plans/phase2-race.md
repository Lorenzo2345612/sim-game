# Phase 2+ plan (2026-10-13)

Closed design for spec writers. Acceptance tables below are the Opus contract: copy them verbatim into the specs.

Milestones: M1.2 gets bugfix 086. New milestones after M1.6: M2.1 (087–095, specs now), M2.2, M2.3, M2.4, M3.x, M4.x (breakdown only; specs written when M2.1 is running, because they build on its code).

New layers: `src/ai` (core, track; pure, no Rapier, no three) and `src/race` (core, track; pure). `src/game` wires them.

Shared conventions: lateral offsets are metres along the RIGHT normal of the centerline (`[-dz, dx]/len`, as `rightNormalAt` in `src/physics/trackColliders.ts`), positive = right. Distances along the lap in metres from the start line. g = 9.81. Deterministic: no `Math.random` in `src/ai` / `src/race`; randomness from a seeded mulberry32 passed in.

---

## 086 — Continuous barriers (M1.2, bugfix, deps 043, 077)

Bug: `addBarrierWalls` (trackColliders.ts) and `createBarrierObject` (barrierRenderer.ts) build each `BarrierSegment` separately, so between a segment's last index e and the next segment's first index e+1 there is no wall (2 m hole), and when offsets differ (e.g. 11 → 25 m, 54 such boundaries on Monza left) the hole is up to 14 m wide. The user drove through one.

Design: new pure `src/track/barrierPath.ts`:
```ts
export interface BarrierVertex { index: number; x: number; z: number; y: number; type: BarrierSegment['type'] }
/** Per side, consecutive barrier vertices; a new run starts only where coverage really stops (no segment covers the index). */
export function barrierRuns(track: TrackDataV2, side: Side): BarrierVertex[][];
```
Vertex at index i = centerline[i] + side sign · offset(segment covering i) · rightNormal(i); y = elevation[i]. A run continues across segment boundaries when next.start === (end + 1) mod n (the connecting quad goes diagonally from offset A to offset B). A run covering the whole ring is closed (last vertex connects back to the first). Both colliders and renderer build their quads from `barrierRuns`; the quad between two vertices takes the type of the second vertex. Tyre stacks keep their own visual style; only geometry continuity changes.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | ring fixture R 100, N 120, width 12; left barriers [0..59] offset 10 and [60..119] offset 20 | barrierRuns(track,'left') | exactly 1 run of 120 vertices, closed; vertex 59 at radial distance 110 ± 1e-6, vertex 60 at 120 ± 1e-6 |
| AT2 | same fixture, left barriers [0..39] and [60..119] (indices 40..59 uncovered) | barrierRuns | exactly 1 run of 100 vertices starting at index 60 and ending at index 39 (wrap joined), not closed |
| AT3 | same fixture as AT1 in a Rapier world via addTrackColliders | horizontal ray from the centre-line point halfway between indices 59 and 60 (and between 119 and 0), y 0.5, pointing outward along the left normal, length 40, filtered to non-surface colliders (surfaceOf = null) | hits, toi in [10 − 0.5, 20 + 0.5] |
| AT4 | public/tracks/monza.json, spa.json, silverstone.json with addTrackColliders | for every centerline index i and both sides: ray from the midpoint of i and i+1 at elevation + 0.5, along the side's normal, length 45, filtered to surfaceOf = null | hits for 100 % of samples |
| AT5 | AT1 fixture | createBarrierObject | the barrier geometry has a triangle using a vertex at (index 59, radius 110) and one at (index 60, radius 120) (± 1e-3) |

---

## 087 — Racing line (M2.1, complex, deps nothing)

`src/ai/racingLine.ts`:
```ts
export interface RacingLine { offsets: Float64Array; points: Float64Array /* x,z interleaved */; dist: Float64Array /* cumulative, dist[0]=0 */; length: number }
export function computeRacingLine(centerline: [number, number][], halfWidth: number, margin?: number /* 1.0 */, iterations?: number /* 600 */): RacingLine;
export function mengerCurvature(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number; // signed, 1/m, + = turning right
```
Minimum curvature line: minimise Σκᵢ² (κ = Menger curvature of consecutive points of the closed offset path) over the lateral offsets by projected gradient descent: gradient per offset by central finite difference (h 0.01 m, only the 3 affected terms), step accepted only if the objective decreases (halve the step otherwise, double after a success, initial step 0.5 m), offsets clamped to ±(halfWidth − margin). Start from offsets 0. Closed loop.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | circle R 100, N 120, halfWidth 6, margin 1 | computeRacingLine | constant radius (max − min ≤ 0.05) within [95, 105] (K1999) |
| AT2 | rounded square: 4 straights 200 m + 4 arcs R 30 (90°), spacing 2 m, halfWidth 6, margin 1 | same | at each arc midpoint the line is ≥ 4.5 m towards the corner inside; at 40 m before each arc start it is ≥ 3.5 m towards the outside; max |κ| along the line ≤ 0.022 1/m (centerline 0.0333) |
| AT3 | monza.json | same | every |offset| ≤ 5 + 1e-9; max |κ| of the line ≤ 0.9 · max |κ| of the centerline |
| AT4 | monza.json twice | same | outputs byte-identical |
| AT5 | monza.json | timed | < 3 s in Node |
| AT6 | mengerCurvature of (0,0),(1,0),(2,0) / of three points on a circle R 50 turning right | call | 0 / +0.02 ± 1e-9 |

## 088 — Speed profile and car limits (M2.1, complex, deps 087, 058)

`src/ai/speedProfile.ts`:
```ts
export interface CarLimits { muLat: number; muLong: number; aeroK: number /* 1/m: extra normal accel = aeroK·v² */; dragK: number /* 1/m: decel = dragK·v² */; powerPerMass: number /* W/kg */; vMax: number /* m/s */ }
export function cornerSpeed(kappa: number, lim: CarLimits): number;
export function speedProfile(line: RacingLine, lim: CarLimits): Float64Array; // m/s per point
export function carLimitsFromSpec(spec: CarSpec, fuelKg: number): CarLimits;
```
- cornerSpeed = sqrt(muLat·g / (|κ| − muLat·aeroK)) when |κ| > muLat·aeroK, else vMax; capped at vMax.
- Friction circle: available long. grip a_g(v,κ) = muLong·(g + aeroK·v²)·sqrt(max(0, 1 − (v²|κ| / (muLat·(g + aeroK·v²)))²)).
- Forward pass: a = min(a_g, powerPerMass / max(v, 1)) − dragK·v²; v₊² = v² + 2·a·ds. Backward pass: decel = a_g + dragK·v². Result = min(corner, forward, backward). Closed loop: start both passes at the point of minimum corner speed and go around twice.
- carLimitsFromSpec: muLat = muLong = 0.95 · medium mu0; aeroK = 0.5·1.225·(claFront + claRear)/(massKg + fuelKg); dragK = 0.5·1.225·cda/(massKg + fuelKg); powerPerMass = 0.9 · max over torqueCurve of torque·rpm·2π/60 / (massKg + fuelKg); vMax = top speed where power = drag (solve 0.9·Pmax = 0.5·1.225·cda·v³). Field names per `src/physics/carSpec.ts`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | κ 0.01, muLat 1.5, aeroK 0, vMax 100 | cornerSpeed | sqrt(1.5·9.81·100) = 38.361 ± 0.01 |
| AT2 | κ 0.01, muLat 1.5, aeroK 0.003 | cornerSpeed | sqrt(14.715/0.007) = 45.849 ± 0.01 |
| AT3 | κ 0.004, muLat 1.5, aeroK 0.003 | cornerSpeed | vMax |
| AT4 | circle R 100 line (087 AT1 fixture), muLat 1.5, aeroK 0, power high | speedProfile | all speeds = cornerSpeed(1/105) ± 0.5 % |
| AT5 | rounded square (087 AT2), limits muLat=muLong 1.6, aeroK 0.002, dragK 0.0004, powerPerMass 400, vMax 80 | speedProfile | min speed inside the arcs; for every consecutive pair, (v₁² − v₂²)/(2ds) ≤ a_g + dragK·v₁² + 1e-6 when braking and (v₂² − v₁²)/(2ds) ≤ min(a_g, P/max(v₁,1)) − dragK·v₁² + 1e-6 when accelerating; no speed above cornerSpeed(κᵢ) + 1e-9 |
| AT6 | public/cars/f4.json, fuel 0 | carLimitsFromSpec | all fields finite and > 0; vMax in [55, 85] m/s |

## 089 — AI driver controller (M2.1, complex, deps 088)

`src/ai/aiDriver.ts`:
```ts
export interface AiObservation { x: number; z: number; yaw: number; speed: number } // yaw per architecture guide, speed = forward m/s
export interface AiParams { speedScale: number; lookaheadTime: number; minLookahead: number; maxLookahead: number; wheelbase: number; maxSteerAngle: number; kp: number; kb: number }
export const DEFAULT_AI_PARAMS: AiParams; // 1, 0.6 s, 8 m, 45 m, 2.6 m, 0.35 rad, 0.5, 0.25
export class AiDriver {
  constructor(line: RacingLine, speeds: Float64Array, params?: Partial<AiParams>);
  setLateralOffset(m: number): void;   // added to the line offset; slewed at 1.5 m/s
  setSpeedCap(v: number | null): void;
  reset(obs: AiObservation): void;      // global nearest-point search
  update(obs: AiObservation, dt: number, out: DriverInput): DriverInput; // local search ±50 points, no allocation
}
```
- Pure pursuit: nearest point projection s on the (offset) line; target = point at s + L, L = clamp(speed·lookaheadTime, min, max); ld = distance car→target; α = angle from car forward to target (positive = target to the right); δ = atan(2·wheelbase·sin α / ld); steer = clamp(δ / maxSteerAngle, −1, 1) (DriverInput steer + = right).
- Speed: target = min(speeds at the projection index + 0.3 s preview, cap) · speedScale; err = target − speed; throttle = clamp(kp·err, 0, 1), brake = clamp(−kb·err, 0, 1); never both > 0. reset = false.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | straight line along −Z, car on it heading −Z, speed 20 | update | steer 0 ± 1e-6 |
| AT2 | same line, car 2 m to the LEFT of it, heading −Z, speed 20 | update | steer = atan(2·2.6·(2/√148)/√148)/0.35 = 0.2004 ± 0.005 (positive) |
| AT3 | target speed 30, speed 20 / 32 | update | throttle 1, brake 0 / throttle 0, brake 0.5 |
| AT4 | rounded square (087 AT2) with 088 profile (muLat 1.5), speedScale 0.9; kinematic bicycle test model: x' = −v·sin(yaw), z' = −v·cos(yaw), yaw' = −v·tan(steer·0.35)/2.6, v' = 8·throttle − 12·brake (clamped ≥ 0), 120 Hz | 1 lap | lap completed; max lateral error from the line < 1.0 m |
| AT5 | setLateralOffset(3) then 4 s on a straight (AT4 model) | update | settles 3 ± 0.2 m right of the line; offset never changes faster than 1.5 m/s |

## 090 — Traffic and difficulty (M2.1, complex, deps 089)

`src/ai/traffic.ts`:
```ts
export interface CarTrafficState { distance: number; lateral: number; speed: number } // distance along lap, lateral from centerline (+ right)
export interface TrafficDecision { offset: number; speedCap: number | null }
export function trafficDecision(self: CarTrafficState, others: readonly CarTrafficState[], lapLength: number, halfWidth: number, lineOffsetAhead: number, curvatureAhead: number): TrafficDecision;
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export function difficultyParams(d: Difficulty): { speedScale: number; mistakesPerLap: number }; // 0.86/0.4, 0.93/0.2, 0.98/0.08, 1.0/0
```
Rules (gap = other.distance − self.distance wrapped to (−L/2, L/2]):
- Blocking car: 0 < gap < 25, |other.lateral − (lineOffsetAhead)| < 2.5, self.speed > other.speed + 0.5. Pass side: inside of the next corner (sign of curvatureAhead: + = right) if other.lateral ∓ 3.0 fits within ±(halfWidth − 1); else the other side if it fits; offset = other.lateral ± 3.0 minus lineOffsetAhead. If neither fits: offset 0, speedCap = other.speed.
- Alongside: |gap| < 5 and |lateral diff| < 2.2 → offset moves 1.0 m away from that car.
- Otherwise offset 0, speedCap null. Nearest blocking car wins.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | no others | call | offset 0, speedCap null |
| AT2 | other 15 m ahead, same lateral 0, slower by 5, curvatureAhead +0.01, halfWidth 6 | call | offset +3.0 ± 1e-9 (inside = right) |
| AT3 | same but other.lateral +2, halfWidth 5.5 (right pass 5 > 4.5 does not fit) | call | offset −1.0 ± 1e-9 (left pass), speedCap null |
| AT4 | other ahead 15 m, slower, lateral 0, halfWidth 3 (nothing fits) | call | offset 0, speedCap = other.speed |
| AT5 | other at gap −3 (alongside), lateral +1.5, self 0 | call | offset −1.0 |
| AT6 | other ahead across the start line (self 5780, other 10, L 5788.4) | call | treated as gap 18.4 (blocking rule applies) |
| AT7 | difficultyParams for each level | call | table values exactly |

## 091 — Start sequence and grid (M2.1, simple, deps nothing)

`src/race/startSequence.ts` and `src/race/grid.ts`:
```ts
export type StartPhase = 'grid' | 'lights' | 'hold' | 'go';
export class StartSequence { constructor(rng: () => number); update(dt: number): void; readonly phase: StartPhase; readonly lights: number; readonly goTime: number | null; }
export function gridSlots(track: TrackDataV2, count: number, spacing?: number /* 8 */): SpawnPose[];
export function isJumpStart(movedMeters: number, phase: StartPhase): boolean; // > 0.5 m before 'go'
```
- Timeline: 'grid' 2 s; 'lights' lights 1..5 come on at 1 s intervals (light k at 2 + k − 1 s); 'hold' random in [0.2, 3.0] s = 0.2 + 2.8·rng(); then 'go', lights 0, goTime = time of go.
- Grid slot k (0 = pole): distance behind the line d = 6 + spacing·k along the centerline (wrapping back from index 0, interpolated), lateral = (k even ? +1 : −1)·widthMeters/4 (pole on the right), yaw along the track direction, y = interpolated elevation + 0.6.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rng → 0.5 | update in 1/120 steps | lights 0 until 2 s, 1 at 2 s, 5 at 6 s; 'go' at 6 + 0.2 + 1.4 = 7.6 s ± 1/120; lights 0 after |
| AT2 | rng → 0 / → 0.999999 | same | go at 6.2 / ≈ 9.0 s ± 1/120 |
| AT3 | closed rectangle loop 200 × 100 m, spacing 2 m, index 0 at (0, 0) on a long side driving towards −Z, the 50 points before index 0 at (0, +2k), flat, width 12, count 3 | gridSlots | slot 0 at 6 m behind, x +3; slot 1 at 14 m, x −3; slot 2 at 22 m, x +3 (± 1e-6); yaw facing −Z |
| AT4 | moved 0.6 in 'hold' / 0.6 in 'go' / 0.4 in 'lights' | isJumpStart | true / false / false |

## 092 — Race classification (M2.1, complex, deps nothing)

`src/race/classification.ts`:
```ts
export interface Standing { car: number; position: number; lap: number; distance: number; finished: boolean; totalTime: number | null; /* finish crossing time, race start = time 0 */ penalty: number; gapToLeader: number | null; lastLap: number | null; bestLap: number | null }
export class RaceClassification {
  constructor(carCount: number, laps: number, lapLength: number);
  update(car: number, lapDistance: number, time: number): void; // lapDistance from TrackProgress
  addPenalty(car: number, seconds: number): void;
  standings(): readonly Standing[]; // sorted by position; reused array
  readonly finished: boolean;       // every car finished or retired
  retire(car: number): void;
}
```
- Cars start behind the line: the first crossing (lapDistance jumps from > 0.9·L to < 0.1·L) starts lap 1 at time t; each later crossing completes a lap only if the car passed 0.5·L since the previous crossing (no reverse cheating). Lap times interpolate the crossing time linearly between samples.
- race distance = (lap − 1)·L + lapDistance. Position: finished cars first by (totalTime + penalty), then running cars by race distance desc, then retired.
- Chequered flag once the leader completes `laps`; every other car finishes at its next crossing.
- gapToLeader (s): time the car reached its current race distance minus time the leader reached that distance (leader's distance→time history sampled every 50 m; linear interpolation). Leader 0.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 2 cars, 2 laps, L 1000; race starts at time 0; car 0 constant 50 m/s, car 1 constant 40 m/s, both from lapDistance 990 | feed samples at 1/120 s until finished | car 0 lap times 20.0 ± 0.01, totalTime 40.2 ± 0.01, position 1; car 1 lap times 25.0 ± 0.01, totalTime 50.25 ± 0.01, position 2 |
| AT2 | AT1 at time 15 s | standings | car 1 gapToLeader = 15 − (race dist 590 reached by car 0 at 11.8+0.2=12.0) → 3.0 ± 0.05 s |
| AT3 | car crosses the line, reverses back across, crosses again | update | lap counted once |
| AT4 | 2 cars finish 0.5 s apart, the first with addPenalty 5 | standings | the penalised car is 2nd |
| AT5 | AT1 at time 45 | standings / finished | car 0 finished, car 1 not finished, `finished` false; after 50.25 s `finished` true |

## 093 — Multi-car game (M2.1, complex, heavy, deps 065/070, 089, 090, 091, 092)

`src/game/raceGame.ts`: `RaceGame` = `Game`'s single-car flow generalised: `RaceConfig { trackId; carId; laps; aiCount (0–15, default 11); difficulty; seed }`; N `Vehicle`s on the grid from `gridSlots` (player last grid slot by default); per tick per AI car: TrackProgress → trafficDecision → AiDriver.update → setInput; all cars held (brake 1, throttle allowed) until StartSequence 'go'; jump starts +5 s; classification; car-to-car collisions on (chassis collision groups; cars never collide with their own wheel rays); a car stuck (speed < 1 m/s for 5 s after go) respawns on the line at its progress, AI only. Exposes `getStates(out)`, `standings()`, `startLights()`. `__SIMGAME__` gains `raceStandings()`, `carCount()`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node, monza, aiCount 5, difficulty medium, seed 1, player input zero | 60 s sim | all 5 AI cars moved > 1 km; no NaN; no car below the terrain |
| AT2 | same, before go | step | every car within 0.5 m of its grid slot |
| AT3 | aiCount 11 | 120 ticks timed in Node | < 2.0 s wall time |
| AT4 | same seed twice | 30 s | identical standings and positions (± 1e-9) |
| AT5 | e2e `/?race=1&track=monza&ai=5` | 20 s after go | `raceStandings()` has 6 entries, positions 1..6 unique; no console errors |

## 094 — Race HUD and AI car rendering (M2.1, simple, deps 093)

AI cars rendered with the car renderer (one per car, liveries with different `livery` colours from a fixed palette of 16); start lights wired to the existing `createStartLights().setLights(n)`; HUD: position "P3/12", lap "Lap 2/5", tower with top 10 + player (position, short name "AI 1".., gap "+1.234" or "+1 lap"), hidden outside races.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e race ai=5, during 'lights' with 3 lights | `__SIMGAME__.startLights()` and DOM | 3; gantry shows 3 red lights (sceneStats().startLightsOn = 3) |
| AT2 | e2e 10 s after go | DOM | `#race-tower` has 6 rows, player row highlighted; `#race-pos` matches raceStandings |
| AT3 | e2e | `sceneStats().cars` | 6 |

## 095 — Quick race menu and results (M2.1, simple, deps 093, 044)

Menu gains "Quick race": track, car, laps (1–50, default 5), opponents (0–15, default 11), difficulty (default medium). Results overlay after the player finishes or the race ends: position, total time, best lap, penalties per car; buttons "Restart" and "Menu". Query params `?race=1&ai=N&laps=N&diff=…` for tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e menu | choose Quick race, Spa, 1 lap, 3 opponents, start | URL/state has race with 3 AI; `raceStandings()` 4 entries |
| AT2 | e2e `?race=1&laps=1&ai=1` with a test hook `__SIMGAME__.finishRaceNow()` | call | `#results` visible with 2 rows sorted by position; Restart restarts with the same config |

---

## Later milestones (breakdown; specs when M2.1 runs)

- **M2.2 Pits and strategy**: pit lane geometry (builder: lane at half + 5.5 m with 150 m entry/exit tapers, pit wall, outer barrier moved out, boxes every 12 m); pit lane controller (60 km/h limiter, speeding +5 s, box detection); pit service (tyres 3.0 s for four, fuel 2.5 L/s, + 1.0 s jack; total = max(tyres, fuel) + 1); soft/hard compounds for every car; fuel mixture modes lean/standard/rich (power ×0.94/1/1.03, fuel ×0.85/1/1.08) via `Vehicle.setMixture`; per-lap consumption telemetry persisted per track+car+compound; strategy predictor (stints, fuel out lap, tyre cliff lap, total time with fuel-mass and wear time losses, pit loss); planner screen comparing 3 plans; live strategy panel (avg L/lap, laps of fuel, target L/lap, lift-and-coast hint, box this lap, edit next stop); AI strategy via the predictor; integration.
- **M2.3 Learned AI**: headless multi-car Node runner with JSONL stdio bridge; Python imitation (from 089 AI) + PPO trainer (local RTX 5060, RunPod CPU pod for long runs), weights to JSON; TS MLP inference as an `AiDriver` variant; evaluation harness (lap time, offs, consistency) — used for hard/expert only if it beats 089.
- **M2.4 Light damage**: damage state from contact impulses (front/rear wing, 4 suspension corners, punctures) → aero scale, toe/steer pull, puncture grip; repair time at pit; detached wing visuals and HUD icon.
- **M3.1 Weekend**: practice and qualifying sessions (timed, grid by best lap), weekend flow, championship points and standings.
- **M3.2 Career**: profile and save; series definitions (junior open-wheel, GT3, higher categories) with teams (performance, budget, reputation needed); season flow; contract offers from reputation and results; promotion; R&D points and upgrade tree (engine, aero, chassis, reliability) as capped CarSpec multipliers; career screens.
- **M4.1 Online leaderboards**: accounts, ghost upload, validation by deterministic replay, per track+car boards. Needs the hosting decision (PRD §14 open question 4).
- **M4.2 Real-time races**: lobby, signalling, WebRTC state sync with interpolation, rating (Glicko-2) and safety rating, splits by rating.
- **M4.3 Admin events**: event scheduler (series, track, class, practice/quali/race durations, start times, split size), registration, results and standings.
