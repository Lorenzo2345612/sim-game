# 133 — Replay recorder (all cars)

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure `ReplayRecorder` stores the pose of every car at a fixed rate in preallocated ring buffers and returns interpolated samples at any recorded time.

## Context

Design: `docs/plans/game-features.md` section 133. Pure module in `src/game` (no `three`, no DOM, no `Math.random`); types `VehicleState`, `Vec3`, `Quat` from `src/core/types.ts`. Car index = `RaceGame` index (093). Wiring into the game and the player is task 134. Memory: default `hz` is 20 (30 Hz would need ~50 MB for 16 cars × 3600 s; the limit is 32 MB = 32·2^20 bytes).

## Files

- `src/game/replay.ts` — create
- `tests/unit/acceptance/133-replay-recorder.test.ts` — create (acceptance worker)

## Steps

```ts
import type { VehicleState } from '../core/types';
export interface ReplaySample { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; speed: number; steer: number; wheelSpin: number }
export class ReplayRecorder {
  constructor(carCount: number, hz?: number /* 20 */, maxSeconds?: number /* 3600 */);
  record(time: number, states: readonly VehicleState[], steers: ArrayLike<number>): void; // each tick, time in s since race start, steers in -1..1
  sampleAt(t: number, car: number, out: ReplaySample): ReplaySample;
  readonly byteLength: number;  // total typed-array bytes allocated
  readonly startTime: number;   // time of the oldest kept frame
  readonly endTime: number;     // time of the newest frame
}
```

- Frames are at times `k / hz`. A frame is emitted by the first `record` call with `time >= k/hz` (1e-9 slack); its values are interpolated to exactly `k/hz` between the previous and the current call (linear for position/speed/steer/spin, normalised lerp for the quaternion).
- Per car per frame: position Float32 ×3, quaternion Int16 ×4 (components × 32767, normalised first), speed Float32 (`forwardSpeed`), steer Int8 (`round(steer·127)`), wheel spin Float32 (`wheels[0].rotation`). Capacity = `hz · maxSeconds` frames (ring buffer; older frames are overwritten).
- `sampleAt`: `t` clamped to `[startTime, endTime]`; interpolates the two neighbouring frames (linear; quaternion slerp, shortest path, renormalised); writes and returns `out`. Before any frame exists → all zeros with identity quaternion.
- `record` allocates nothing after construction (reuse scratch fields); `byteLength` for 16 cars, 3600 s, default `hz` must be `<= 32·2^20`.

Conventions: `car` out of range → `RangeError`; non-finite `time` ignored; `time` not increasing → ignored; steer stored clamped to [−1, 1]; inputs not mutated; no rounding on sample output.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | car moving x = 10·t | record 10 s, sampleAt(3.35) | x = 33.5 ± 1e-3 |
| AT2 | rotating 90°/s about Y | sampleAt mid-sample | angle error ≤ 0.2° |
| AT3 | 16 cars, 3600 s | allocated bytes | ≤ 32 MB; record() allocates nothing (no new arrays) |
| AT4 | record past maxSeconds | sampleAt(0) | returns the oldest kept sample (ring buffer), no throw |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `src/game/replay.ts` has no `three` import and no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Playback, cameras, UI (task 134); persistence to storage; recording wheel positions or damage.
