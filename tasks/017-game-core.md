# 017 — Create the game core (Game) and interpolation

Status: pending
Phase: 0
Depends on: 002, 005, 008, 010, 011
Roles: coder, tester, reviewer

## Goal

`Game` ties physics, track progress and lap timer together on a fixed step; `interpolation.ts` blends two `VehicleState`s for rendering.

## Context

Read `ai/guides/architecture.md` ("Shared types", "Track data" > Spawn, "Conventions" for yaw). No `three`, no DOM. `src/game/` is the only place besides `main.ts` that combines `physics` and `track`. Signatures used from other tasks (exact):
- 002: `FIXED_DT` (`../core/constants`); `DriverInput`, `SpawnPose`, `TrackData`, `VehicleState`, `Vec3`, `Quat`, `LapEvent` (`../core/types`).
- 005 (`../track/centerline`): `cumulativeLengths(points: Point2[], closed: boolean): Float64Array`.
- 008: `new TrackProgress(centerline: Point2[])` (`../track/trackProgress`) with `readonly length`, `update(x, z): ProgressSample` (`{ index, distance, lateral }`, a reused object) and `reset()`; `new LapTimer(lengthMeters: number, sectorStartDistances: [number, number, number])` (`../track/lapTimer`) with `update(distance, time): LapEvent[]`, `reset()`, getters `lap`, `lastLapTime`, `bestLapTime`, and `currentLapTime(time): number | null`.
- 010 (`../physics/physicsWorld`, `../physics/vehicleConfig`): `initPhysics(): Promise<void>`, `createPhysicsWorld(): RAPIER.World`, `PLACEHOLDER_CAR`.
- 011 (`../physics/vehicle`): `new Vehicle(world, config, spawn)`, `setInput`, `prePhysicsStep(dt)`, `getState(out?)`, `reset(spawn)`.

## Files

- `src/core/interpolation.ts` — create
- `src/game/game.ts` — create
- `tests/unit/core/interpolation.test.ts` — create
- `tests/unit/game/game.test.ts` — create
- `tests/fixtures/circleTrack.ts` — create: `export const circleTrack: TrackData` with a circle of radius 100 m, 120 `[x,z]` points, index 0 at (100,0), `widthMeters: 12`, `lengthMeters` ≈ 2π·100, `officialLengthMeters` equal, `sectors: [0, 40, 80]`, any strings in `source`.

## Steps

1. `interpolation.ts` (types from `./types`):
```ts
export function lerpVec3(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3;
export function slerpQuat(a: Quat, b: Quat, t: number, out: Quat): Quat; // shortest path, normalized, nlerp fallback when nearly equal
export function createVehicleState(wheelCount: number): VehicleState; // zeroed, identity rotation (w=1), wheels inContact=false
export function copyVehicleState(src: VehicleState, out: VehicleState): VehicleState;
export function interpolateVehicleState(prev: VehicleState, curr: VehicleState, t: number, out: VehicleState): VehicleState;
```
   - `lerpVec3`: `out = a + (b-a)*t` per component; returns `out`. Safe when `out` is `a` or `b`.
   - `slerpQuat`: `d = a·b`; if `d < 0` use `-b` and `d = -d` (short path). If `d > 0.9995`: nlerp (`a + (b'-a)*t`, normalize). Else `θ = acos(d)`, `s = sin θ`, `wa = sin((1-t)θ)/s`, `wb = sin(tθ)/s`, `out = wa*a + wb*b'`. Always normalize at the end. No object allocation (local scalars).
   - `copyVehicleState`: in-place field copy (position, rotation, forwardSpeed, per wheel position/steering/rotation/inContact); returns `out`.
   - `interpolateVehicleState`: position lerp, rotation slerp, forwardSpeed lerp; per wheel: position lerp, steering lerp, rotation lerp, `inContact` from `curr`. No allocations.
2. `game.ts`:
```ts
export function spawnFromTrack(track: TrackData): SpawnPose;
export interface LapInfo { lap: number; currentLapTime: number | null; lastLapTime: number | null; bestLapTime: number | null }
export class Game {
  static async create(track: TrackData): Promise<Game>;
  readonly simTime: number;
  step(input: DriverInput): void;
  getPrevState(): VehicleState;
  getCurrentState(): VehicleState;
  getLapInfo(): LapInfo;
  drainEvents(): LapEvent[];
  dispose(): void;
}
```
   - `spawnFromTrack`: `N = centerline.length`; `p = centerline[N-5]`, `n = centerline[N-4]`; `dx = n[0]-p[0]`, `dz = n[1]-p[1]`; `yaw = Math.atan2(-dx, -dz)`; `position = {x: p[0], y: 0.6, z: p[1]}`.
   - `Game.create`: `await initPhysics()`, `createPhysicsWorld()`, `new Vehicle(world, PLACEHOLDER_CAR, spawn)`, `progress = new TrackProgress(track.centerline)`; `cum = cumulativeLengths(track.centerline, true)`; `lapTimer = new LapTimer(progress.length, [cum[track.sectors[0]], cum[track.sectors[1]], cum[track.sectors[2]]])`. Initialize `prev`/`current` with `createVehicleState(4)` then `vehicle.getState(current)` and copy to `prev`; `simTime = 0`. Private constructor.
   - `step(input)`: 1) `copyVehicleState(current, prev)`; 2) if `input.reset`: `vehicle.reset(spawn)`, `progress.reset()`, `lapTimer.reset()`; 3) `vehicle.setInput(input)`; 4) `vehicle.prePhysicsStep(FIXED_DT)`; 5) `world.step()`; 6) `simTime += FIXED_DT`; 7) `vehicle.getState(current)`; 8) `progress.update(current.position.x, current.position.z)`; 9) `events.push(...lapTimer.update(sample.distance, this.simTime))` where `sample` is the `ProgressSample` returned in 8.
   - `getLapInfo`: `{ lap: lapTimer.lap, currentLapTime: lapTimer.currentLapTime(simTime), lastLapTime: lapTimer.lastLapTime, bestLapTime: lapTimer.bestLapTime }`; `lap` is 0 before the first lap starts.
   - `drainEvents`: returns a copy of the queue and empties it.
   - `dispose`: `world.free()`.

## Tests

`tests/unit/core/interpolation.test.ts`:
- `interpolateVehicleState returns prev at t=0` and `returns curr at t=1` (distinct states, 4 wheels; compare position, forwardSpeed, wheel position/steering/rotation with `toBeCloseTo`).
- `interpolateVehicleState takes inContact from curr`.
- `slerpQuat output is normalized` (t=0.3 between identity and a 90° Y rotation; norm ≈ 1, 6 decimals).
- `slerpQuat takes the short path for opposite quaternions`: `a` = identity, `b = {0,0,0,-1}`; result at t=0.5 has `|w| ≈ 1`.
- `lerpVec3 returns the midpoint at t=0.5`.

`tests/unit/game/game.test.ts` (`afterEach` `game.dispose()`; timeout 20 s; use `circleTrack`):
- `spawnFromTrack positions at centerline[N-5]`: x,z ≈ centerline[N-5], y = 0.6.
- `spawnFromTrack yaw points towards centerline[N-4]`: forward `(-sin yaw, -cos yaw)` ≈ normalized direction to N-4 (4 decimals).
- `step advances simTime by FIXED_DT`: after 1 step `simTime` ≈ 1/120 (8 decimals).
- `full throttle for 120 steps gives positive forwardSpeed`.
- `reset input returns the car to spawn and lap 0`: 120 accelerating steps, then one step with `reset: true`, throttle 0: position ≈ spawn (±0.05) and `getLapInfo().lap === 0`.
- `drainEvents empties the queue`: two consecutive calls; the second returns `[]`.

## Acceptance criteria

- [ ] Tests pass; `typecheck` and `lint` clean.
- [ ] `interpolateVehicleState` and `step` allocate no objects per call (except the event spread).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering, HUD, input, multiple cars, track collision, off-track detection, sound.
- Code comments only where logic is non-obvious.
