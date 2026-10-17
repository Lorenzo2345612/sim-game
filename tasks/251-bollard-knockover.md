# 251 — Knock-over bollards at runtime

Status: pending
Phase: 1
Depends on: 250
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 3")

## Goal

Bollards from the track JSON are rendered, knocked over when a car hits them, and respawn after 20 s once no car is near. Purely visual: no effect on car dynamics.

## Context

Data: `track.bollards` (task 250; parser defaults `[]`). The race path runs in `startGame` in `src/main.ts`: `sim.step` (≈ line 663) wraps `raceGame.step` / `game.step` once per fixed step; `createSausages(track)` is at ≈ line 843; `car.update(interp)` per rendered frame at ≈ line 1404. Car states: `sim.getCurrentState()` (player) and, in race mode, `raceStates` filled by `raceGame.getStates(raceStates)` (index 0 = player). Yaw formula (`src/game/raceGame.ts` ≈ line 255): `forward = (−2(w·y + x·z), −1 + 2(x² + y²))` from the quaternion, `yaw = atan2(−fx, −fz)`.

## Files

- `src/track/bollards.ts` — create (no `three`).
- `src/render/bollardRenderer.ts` — create.
- `src/main.ts` — modify: create field and renderer, step in `sim.step`, update per frame, dispose.
- `tests/unit/acceptance/251-bollard-knockover.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
// src/track/bollards.ts
import type { TrackDataV2, VehicleState } from '../core/types';
export const BOLLARD_RADIUS = 0.2, BOLLARD_HEIGHT = 0.8, BOLLARD_RESPAWN_S = 20, BOLLARD_CLEAR_M = 30;
export interface BollardCar { x: number; z: number; yaw: number; vx: number; vz: number; halfLength: number; halfWidth: number }
export interface BollardField {
  readonly count: number;
  readonly homeX: Float32Array; readonly homeZ: Float32Array;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly spinAxisX: Float32Array; readonly spinAxisZ: Float32Array; readonly angle: Float32Array;
  readonly state: Uint8Array;   // 0 standing, 1 flying, 2 resting
  readonly timer: Float32Array; // seconds since leaving state 0
}
export function createBollardField(track: TrackDataV2): BollardField
export function stepBollards(field: BollardField, cars: readonly BollardCar[], dt: number): void
export function bollardCarFromState(s: VehicleState, halfLength: number, halfWidth: number, out: BollardCar): BollardCar
// src/render/bollardRenderer.ts
import type * as THREE from 'three';
export interface BollardRenderer { readonly mesh: THREE.InstancedMesh; update(): void; dispose(): void }
export function createBollardRenderer(field: BollardField): BollardRenderer
```
1. `createBollardField`: one entry per `track.bollards ?? []`, all standing, `y = groundHeightAt(track, x, z)` (`src/track/ground.ts`). The track is kept in a private WeakMap or closure, not in the interface.
2. `stepBollards`: a standing bollard whose circle (radius `BOLLARD_RADIUS`) overlaps a car OBB (`yaw` = three.js `rotation.y`, forward = −Z local, half extents `halfLength` along forward, `halfWidth` across) becomes state 1: horizontal velocity = 0.7·(car vx, vz) + 2 m/s along the normalised (bollard − car centre) (zero distance ⇒ car forward), `vy = 3`, spin 8 rad/s about the horizontal axis perpendicular to the horizontal velocity (store the axis; `angle` advances 8·dt per step). Flying: gravity 9.81, semi-implicit Euler; when `y ≤ groundHeightAt(x, z)` set y = ground, velocity 0, state 2 (lying on its side). `timer` counts from the hit; at `timer ≥ BOLLARD_RESPAWN_S` and no car centre within `BOLLARD_CLEAR_M` of the bollard's home → standing at home, ground y, velocity and angle 0, timer 0.
3. `bollardCarFromState`: yaw and velocity from `s.rotation` using the Context formula, `v = s.forwardSpeed · forward`; writes and returns `out`.
4. Renderer: one `InstancedMesh` named `bollards`, cylinder radius 0.2 height 0.8, orange with a white band (vertex colours, one shared geometry), `count = field.count`; initial matrices = standing at the field positions. `update()` rewrites matrices only for non-standing bollards (position + rotation about the spin axis by `angle`; resting = lying on its side at ground height) and also restores matrices of bollards that returned to standing, then sets `instanceMatrix.needsUpdate`. `dispose()` disposes geometry and material.
5. `main.ts`: after `createSausages`, create the field and renderer when `track` is v2 and has bollards (`scene.add(mesh)`, push the renderer to `disposables`). Declare `let bollardField: BollardField | null = null` before `sim` (near `let raceGame`), assign it where the sausages are created. In `sim.step`, after the step, fill a reused `BollardCar[]` (created once, no per-step allocation; halfLength 2.0, halfWidth 0.8 = `chassisHalfExtents` z, x) from `raceStates` (race mode, after `raceGame.getStates(raceStates)`) or `sim.getCurrentState()`, and call `stepBollards(bollardField, cars, FIXED_DT)`. Call `renderer.update()` once per rendered frame next to `car.update(interp)`.

Conventions: metres, seconds, radians; overlap test inclusive (touching counts); no `Math.random`; no allocation in `stepBollards`; cars not mutated.

## Fixtures (tests)

`STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, width 12, elevation 0, no terrain. `POSTED` = `STRAIGHT` with `bollards: [{x: 100, z: 5, index: 10, side: 'right'}]`. Car A: x 90, z 5, yaw −π/2 (forward +x), vx 20, vz 0, halfLength 2.5, halfWidth 1, advanced by the test by v·dt each step. `FIXED_DT` from `src/core/constants.ts`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `POSTED`, car A | step 2 s at `FIXED_DT` | bollard leaves state 0 at the first tick where the car front (x + 2.5) ≥ 100 − 0.2 (± 1 tick); at that tick its vx > 10; at 2 s state 2, y = ground ± 0.05, x > 100 |
| AT2 | `POSTED`, car A with z 2 (lateral gap 3 − 1 − 0.2 > 0) | step 2 s | state 0 throughout |
| AT3 | AT1, car then teleported to x 5000 after 2 s | step until 22 s + 1 tick | state 0 at the original x/z (± 1e-9) by then, not before 20 s after the hit |
| AT4 | AT1, car parked at x 120 after the hit | step to 30 s | still state 2 |
| AT5 | AT1 run twice | compare field arrays | identical |
| AT6 | AT1 | car objects before/after each `stepBollards` | unchanged (deep equal) |
| AT7 | `POSTED` field | `createBollardRenderer(field)` then a hit + `update()` | `InstancedMesh.count` = 1; instance 0 matrix differs from the initial one; `dispose()` disposes geometry and material |
| AT8 | sources | read `src/track/bollards.ts`; game loop file | no `from 'three'` in bollards.ts; the loop calls `stepBollards(` |

## Acceptance criteria

- [ ] AT1–AT8 pass.
- [ ] No track JSON changes.

## Existing tests that must still pass

All current tests (`npm test`).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Bollard sound, particles, car damage or drag, collisions with barriers or other bollards, replay sync, placement rules (250), QA report checks.
