# 134 — Replay player and TV cameras

Status: pending
Phase: 2
Depends on: 047, 093, 095, 132, 133
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

After a race the results screen offers "Replay": all cars are replayed from the recorder with play/pause, speed, scrubbing, car focus and TV/chase/cockpit/orbit cameras.

## Context

Design: `docs/plans/game-features.md` section 134. Recorder: `ReplayRecorder`/`ReplaySample` (133, `src/game/replay.ts`); `RaceGame` (093) feeds it each tick from `main.ts`. Cameras: `CameraRig` modes `chase|tcam|cockpit` (`src/render/cameraRig.ts`, 047); renderers: `CarRenderer.update(state: VehicleState)` needs wheel world poses → build each replay `VehicleState` from the sample pose and `CarSpec.wheels.positions` (car-local, rotate by the sample quaternion), `wheel.rotation = wheelSpin`, front wheels `steering = −steer · spec.steering.maxAngleLow`. Track data: `TrackDataV2` (`centerline [x,z][]`, `elevation[]`, `barriers[].offsetMeters`, `widthMeters`) in `src/core/types.ts`; right normal of travel `(-dz, dx)/len`. Acceptance: Vitest `tests/unit/acceptance/134-replay-player-tv-cameras.test.ts` (AT1, AT2), Playwright `tests/e2e/acceptance/134-replay-player-tv-cameras.spec.ts` (AT3, AT4).

## Files

- `src/game/replayPlayer.ts` — create: `ReplayPlayer`, `tvCameraPositions`, `tvCameraFor`, `tvFovDeg`
- `src/ui/replayBar.ts` — create: DOM controls
- `src/ui/results.ts` — modify: "Replay" button (optional handler `onReplay`)
- `src/main.ts` — modify: record every tick, enter/leave replay mode, render replay states, hooks

## Steps

```ts
import type { TrackDataV2, Vec3 } from '../core/types';
import type { ReplayRecorder } from './replay';
export interface TvCamera { distance: number; position: Vec3 }  // distance = lap distance of the centerline foot point
export function tvCameraPositions(track: TrackDataV2): TvCamera[];
export function tvCameraFor(cameras: readonly TvCamera[], lapDistance: number): number; // index
export function tvFovDeg(distanceToCar: number): number;
export type ReplayCameraMode = 'tv' | 'chase' | 'cockpit' | 'orbit';
export class ReplayPlayer {
  constructor(recorder: ReplayRecorder, carCount: number);
  time: number; playing: boolean; speed: 0.25 | 1 | 4; focus: number; cameraMode: ReplayCameraMode;
  advance(dt: number): void; seek(fraction: number): void; focusNext(): void; focusPrev(): void;
}
```

1. `tvCameraPositions`: one camera every 250 m of lap distance, `k = 0 .. floor(length/250) − 1`, at the centreline point nearest to `250·k`; lateral = `max(barrier offset of the outer side, widthMeters/2) + 25` m on the outer side = side (left/right) whose covering barrier segment has the larger `offsetMeters` at that point (none → 0; tie → right); height = `elevation[i] + 6`.
2. `tvCameraFor`: index of the last camera with `distance <= lapDistance` (cyclic: before camera 0 → last camera); switches once when the car crosses a camera distance. `tvFovDeg = clamp(2·atan(1.5 / (0.2·distance)) in degrees, 5, 60)`.
3. `ReplayPlayer`: `advance(dt)` adds `dt·speed` when `playing`, clamps to `[startTime, endTime]` and stops playing at `endTime`; `seek(f)` sets `time = startTime + f·(endTime − startTime)` (f clamped to [0, 1]); focus wraps modulo `carCount`; defaults: time = startTime, playing true, speed 1, focus 0, mode `tv`.
4. UI `#replay-bar`: `#replay-play` (toggle), `#replay-speed-025`, `#replay-speed-1`, `#replay-speed-4`, `#replay-scrub` (range 0..1), `#replay-focus-prev`, `#replay-focus-next`, `#replay-cam-tv|chase|cockpit|orbit`, `#replay-exit`. Orbit = camera circling the focused car at 12 m, 0.2 rad/s.
5. `__SIMGAME__`: `replayTime(): number`, `replayCarPosition(car: number): Vec3` (position currently rendered), `replaySampleAt(t: number, car: number): Vec3` (recorder), `replayDuration(): number`.

Conventions: `tvCameraFor` with empty array → throws `Error`; times in seconds; positions not rounded; no per-frame allocation in replay rendering (reuse states and samples).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza.json | tvCameraPositions | count = floor(length/250) ± 1; each ≥ 20 m from the centerline |
| AT2 | distances 0, 249, 251 | tvCameraFor | index 0, 0, 1 (last camera at or behind the car); the index changes exactly once when crossing a camera position |
| AT3 | e2e replay of a 20 s recorded race | play ×4 for 5 s | `__SIMGAME__.replayTime()` advanced 20 ± 1 s; no console errors |
| AT4 | e2e scrub to 50 % | car position | equals recorder sampleAt at that time ± 0.05 m |

## Acceptance criteria

- [ ] All AT rows pass; edge tests pass (advance clamp, seek bounds, focus wrap, camera wrap before camera 0).
- [ ] Leaving the replay returns to the results screen; race tests (093–095) still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Saving/loading replays to disk, video export, slow-motion below ×0.25, replay of the single-car `Game`.
- Changing `ReplayRecorder` (133).
