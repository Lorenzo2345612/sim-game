# Late milestones: damage, sausage kerbs, performance (2026-10-13)

User: "como las últimas" — these run after every other planned milestone (order: … M2.2b → **M2.4 Damage** → **M2.5 Sausage kerbs** → **M5 Performance**). Specs are written now but build on 070 (vehicle model on Rapier), 093 (race game), 140 (chicane detection) and M2.2 (pit service, not yet specified): workers must read the code as it exists when the task runs. Conventions as `docs/plans/phase2-race.md`. Car local frame: −Z forward, +X right, Y up; wheel order = `WHEEL_NODE_NAMES` (FL, FR, RL, RR).

| # | Milestone | Title | Deps | Cx |
|---|---|---|---|---|
| 144 | M2.4 | Damage model (pure) | 058 | complex |
| 145 | M2.4 | Contact impacts from Rapier into the damage model | 144, 070, 093 | complex |
| 146 | M2.4 | Damage effects on the vehicle (aero, toe, grip, lost wheel) | 144, 070 | complex |
| 147 | M2.4 | Debris: detached wings and wheels as physics bodies | 145, 146 | complex |
| 148 | M2.4 | Damage HUD, settings, pit repair time, AI reaction | 145, 146, 094 | simple |
| 149 | M2.5 | Sausage kerb placement (builder) | 140 | simple |
| 150 | M2.5 | Sausage kerb render and colliders | 149, 141 | complex |
| 151 | M5 | Performance harness and budgets | 093 | simple |
| 152 | M5 | Render cost: draw calls, culling, shadows | 151 | complex |
| 153 | M5 | Simulation cost with 16 cars | 151 | complex |
| 154 | M5 | Adaptive quality (dynamic resolution, auto preset) | 151 | simple |

---

## M2.4 Damage

### 144 — Damage model
`src/physics/damage.ts` (pure): `interface DamageState { frontWing: number; rearWing: number; suspension: [n,n,n,n]; puncture: [b,b,b,b]; detached: [b,b,b,b] }` (0..1 / booleans); `interface Impact { impulse: number /* N·s */; point: Vec3 /* car local */; otherCar: boolean }`; `interface CarZones { halfLength: number; halfWidth: number; hubs: Vec3[4] }`; `applyImpact(state, impact, zones, rng): DamageState` (mutates and returns). Zone: nearest hub within 0.6 m → that corner; else z < −0.6·halfLength → front wing; z > 0.6·halfLength → rear wing; else none (side pod, no damage). Part damage += clamp((J − J0)/Jk, 0, 1), capped 1: wings J0 1500, Jk 6000; suspension J0 3000, Jk 9000. Corner hit with J > 2000 → puncture with probability clamp((J − 2000)/6000, 0, 1) (rng). Detach: corner with suspension already 1 and a hit J > 9000 → detached (also sets puncture). `damageEffects(state)` → `{ aeroFront: 1 − 0.7·frontWing, aeroRear: 1 − 0.5·rearWing, toe: [0.03·s0, −0.03·s1, 0.02·s2, −0.02·s3] rad, gripScale: puncture ? 0.35 : 1 per wheel (0 if detached) }`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | zones halfLength 2.5, hubs (±0.75, 0, ∓1.37); impact J 4500 at (0, 0.3, −2.3) | applyImpact | frontWing 0.5 ± 1e-9; all else 0 |
| AT2 | impact J 1400 anywhere | applyImpact | state unchanged |
| AT3 | impact J 7500 at the FR hub + (0.1, 0, 0) | applyImpact | suspension[1] 0.5 ± 1e-9; rng returning 0.1 → puncture[1] true; rng 0.95 → false |
| AT4 | two hits J 12000 at the RL hub | applyImpact ×2 | after 1st suspension[2] = 1, detached false; after 2nd detached[2] true and puncture[2] true |
| AT5 | frontWing 1, rearWing 0.5, suspension [1,0,0,0], puncture [false,true,false,false] | damageEffects | aeroFront 0.3, aeroRear 0.75, toe[0] 0.03, gripScale [1, 0.35, 1, 1] (± 1e-9) |
| AT6 | impact at (1.0, 0, 0) (side, no hub within 0.6) | applyImpact | unchanged |

### 145 — Contact impacts
Rapier contact force events (`ActiveEvents.CONTACT_FORCE_EVENTS`, threshold 1000 N) on every car chassis; per event per car: impulse J = totalForceMagnitude · dt; point = the contact manifold's world point converted to car local (`toLocalPoint(world, carPos, carQuat, out)`); otherCar from the other collider's owner. Both cars of a car-to-car contact receive the same J. Damage off (148 setting) → events ignored.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: car at (10, 0, 5), quaternion = +90° about +Y (car forward −Z maps to world −X), world point (10, 0.3, 3) | toLocalPoint | (2, 0.3, 0) ± 1e-9 |
| AT2 | Node: f4 driven straight into a wall at 30 m/s (head-on) | 2 s | frontWing ≥ 0.5; at 5 m/s: frontWing 0 |
| AT3 | Node: two cars, car B hits stationary car A's rear at 20 m/s | 2 s | A.rearWing > 0 and B.frontWing > 0; |A.J − B.J| ≤ 1e-6·J for the first contact event |
| AT4 | damage setting off | AT2 at 30 m/s | all damage 0 |

### 146 — Effects on the vehicle
Vehicle model (070) reads `damageEffects` each step: front/rear downforce × aeroFront/aeroRear (drag unchanged); per-wheel toe added to steer angle; tyre force × gripScale; a detached wheel contributes no suspension or tyre force and its corner gets a small sliding collider (sphere r 0.12 at the hub height − wheelRadius + 0.12, friction 0.8) so the chassis drags.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node: f4 at a constant 60 m/s on a flat plane, frontWing 1 | read front downforce | 0.3 × undamaged ± 1 % |
| AT2 | suspension[0] = 1, straight line, steer 0, 30 m/s, 3 s | yaw drift | heading changes ≥ 1° (pull); with no damage < 0.1° |
| AT3 | detached[1] | full throttle 10 s on flat | top speed < 0.6 × undamaged; no NaN; chassis min y ≥ −0.05 |
| AT4 | puncture[3] | skidpad max lateral g (066 setup) | < 0.85 × undamaged |

### 147 — Debris
When a wing passes 0.95 damage (once) or a wheel detaches, spawn a dynamic Rapier body: wheel = cylinder (wheelRadius, width 0.3, mass 12 kg), front wing = box from the model's front-wing bounds or (1.6 × 0.05 × 0.4 m, 6 kg), rear wing (1.0 × 0.3 × 0.3, 5 kg); initial linear velocity = car velocity at that point, angular velocity seeded random ≤ 15 rad/s; rendered with the wheel node (hidden on the car) or a box mesh in the livery colour; collides with cars and track; despawn after 60 s or > 300 m from every car; at most 8 debris (oldest removed).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node: detach FR at 40 m/s | spawn | one debris body; initial speed 40 ± 2 m/s; car's FR wheel node hidden (render flag) |
| AT2 | 10 detach/wing events | count | ≤ 8 debris alive, oldest removed first |
| AT3 | debris left alone 61 s | step | removed |
| AT4 | a car driving through a debris wheel at 30 m/s | contact | contact event with the car (debris is a hazard); no NaN |

### 148 — HUD, settings, repair, AI
Setting `damage: 'off' | 'visual' | 'full'` (default 'full'; 'visual' = debris and HUD without performance effects). HUD damage widget: 6 parts (FW, RW, 4 corners) coloured green < 0.2, yellow < 0.6, red ≥ 0.6, black detached. `repairTime(state)` = 3 s per damaged wing (value > 0) + 8 s per corner with suspension > 0 + 4 s per punctured or detached wheel; used by the M2.2 pit service when present. AI: speedScale × (1 − 0.2·max damage); AI pits next lap when any part ≥ 0.6 (if pit service exists).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | frontWing 0.3, suspension [0, 0.5, 0, 0], puncture[1] | repairTime | 3 + 8 + 4 = 15 |
| AT2 | part values 0.1 / 0.4 / 0.7 / detached | widgetColour | green / yellow / red / black |
| AT3 | setting visual, frontWing 1 | front downforce | unchanged (undamaged) |
| AT4 | e2e race with `__SIMGAME__.debugDamage({frontWing: 1})` | DOM | `#damage-fw` has class red; no console errors |

---

## M2.5 Sausage kerbs

### 149 — Placement
`TrackDataV2.sausages?: { index: number; side: Side; offset: number; length: number }[]` (parser default []). Builder: for every chicane found by 140 (two opposite corner runs, Rmin < 80, gap < 120 m), one sausage on the inside of each corner at its apex index (index of Rmin), offset = half + KERB_WIDTH + 0.6, length 6 m; plus per-track overrides `sausages: [{ atMeters, side, offsetMeters?, lengthMeters? }]` in tracks.json.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 140 AT3 chicane fixture, width 12 | build | 2 sausages: left arc apex on the left, right arc apex on the right; offset 6 + 1.2 + 0.6 = 7.8; length 6 |
| AT2 | rounded square R 30 (no chicane) | build | [] |
| AT3 | override { atMeters 1000, side 'left' } on that square | build | one sausage at the index nearest 1000 m, offset 7.8, length 6 |

### 150 — Render and colliders
Profile: trapezoid 0.5 m wide at the base, 0.25 m at the top, 0.13 m tall, along the track tangent; yellow with black end caps; one InstancedMesh; Rapier fixed convex-hull collider per sausage (wheel raycasts hit it).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: build for one sausage on flat ground | geometry | max y − ground = 0.13 ± 1e-6; base width 0.5, length 6 (± 1e-6) |
| AT2 | Node: f4 drives across a sausage perpendicular at 25 m/s | 1 s | chassis vertical velocity peak > 1.0 m/s; with the sausage removed < 0.3 m/s |
| AT3 | e2e `/?track=monza` | ready | `sceneStats().sausages` = count in monza.json; no console errors |

---

## M5 Performance

### 151 — Harness and budgets
`__SIMGAME__.perfStats()` → `{ fps: number; frameMs: { p50, p95 }; simMs: { p50, p95 }; renderMs: { p50, p95 }; drawCalls; triangles; textures; geometries }` over the last 300 frames (ring buffer, no allocation per frame). `scripts/perf/bench.mjs <url> <out.json> [--gpu]` runs scenarios: monza start chase (10 s), spa race 16 cars (30 s), monza cockpit, lusail night (if 135 exists), spa rain (if 138 exists); writes per-scenario perfStats. Budgets in `scripts/perf/budgets.json` (medium preset, RTX-class): frame p95 ≤ 16.7 ms, sim p95 ≤ 3 ms, drawCalls ≤ 300, triangles ≤ 2.5 M.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: ring buffer with frame times 1..300 ms | percentiles | p50 150.5 ± 0.5, p95 285.5 ± 0.5 |
| AT2 | e2e `/?track=monza` 3 s | perfStats() | all fields finite; drawCalls > 0 |
| AT3 | `node scripts/perf/bench.mjs <url> out.json` (software GL allowed) | run | out.json has every scenario key with a perfStats object; exit 0 |

### 152 — Render cost
Static trackside (barriers, boards, sausages, kerb strips) merged per material per 500 m chunk; instanced fields (trees, crowd, tyres, foam) chunked into 200 m cells with per-cell frustum culling; shadow map: low none, medium 1024 single map following the camera, high 2048 + second cascade.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e monza medium preset, start | drawCalls() | ≤ 150 (was ≤ 300 budget) |
| AT2 | e2e spa, camera at start vs looking away from the track (yaw 180°) | drawCalls | looking away ≤ 0.6 × start |
| AT3 | unit: cell assignment of instances | build | every instance in exactly one cell; cells ≤ 200 m |
| AT4 | e2e screenshots before/after at monza start | pixel diff | ≤ 2 % pixels differ by > 10/255 (no visual regression) |

### 153 — Simulation cost
16-car race step: AI updates and traffic allocation-free; per-car TrackProgress local search; Rapier `integrationParameters` tuned (numSolverIterations 4 if stable); contact events filtered to chassis.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node monza race, 15 AI, 600 ticks | wall time | ≤ 2.0 ms per tick (mean) on the dev machine; ≤ 1.6× the single-car tick |
| AT2 | same, after warm-up | heap growth over 600 ticks | < 1 MB |
| AT3 | 093 AT4 determinism | rerun | still identical |

### 154 — Adaptive quality
`DynamicResolution { update(frameMs): number /* pixel ratio */ }`: target 16.7 ms; every 60 frames, if p50 > 18 ms ratio −0.1 (min 0.6), if p50 < 13 ms ratio +0.05 (max = device ratio, ≤ 1.0 on medium); `autoPreset(samples)`: after the first 5 s, p50 > 25 ms → low, > 18 → medium, else keep. Setting `adaptive: boolean` (default true).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 120 frames at 25 ms from ratio 1.0 | update | ratio 0.8 ± 1e-9 |
| AT2 | 600 frames at 10 ms from 0.6, max 1.0 | update | ratio 1.0 (capped) |
| AT3 | 300 samples at 30 ms / 20 ms / 12 ms | autoPreset | low / medium / unchanged |
