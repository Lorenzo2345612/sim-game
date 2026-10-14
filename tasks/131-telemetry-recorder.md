# 131 — Telemetry recorder and store

Status: pending
Phase: 2
Depends on: 050, 070
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure `TelemetryRecorder` samples the player's lap every 2 m of distance, the best valid lap per track and car is stored in `localStorage`, and `deltaTrace` compares two laps.

## Context

Design: `docs/plans/game-features.md` section 131. Pure module in `src/game` (no `three`, no DOM, no `Math.random`). Storage interface and pattern as ghost laps: `GhostStorage`, `saveGhostIfFaster` in `src/game/ghost.ts`. Values come from the 070 game loop (speed, `DriverInput`, gear, rpm, lateral g). Wiring is task 132.

## Files

- `src/game/telemetry.ts` — create
- `tests/unit/acceptance/131-telemetry-recorder.test.ts` — create (acceptance worker)

## Steps

```ts
import type { GhostStorage } from './ghost';
export type Channel = 'time' | 'speed' | 'throttle' | 'brake' | 'steer' | 'gear' | 'rpm' | 'latG' | 'x' | 'z';
export const CHANNELS: readonly Channel[];
export const TELEMETRY_SPACING = 2; // m
export interface TelemetryValues { speed: number; throttle: number; brake: number; steer: number; gear: number; rpm: number; latG: number; x: number; z: number }
export interface LapTelemetry { trackId: string; carId: string; lapTime: number; spacing: 2; channels: Record<Channel, Float32Array> }
export class TelemetryRecorder {
  constructor(trackId: string, carId: string, lapLength: number);
  start(): void;                                                    // begin a lap
  record(distance: number, time: number, v: TelemetryValues): void; // distance m and time s since lap start, each tick
  finishLap(valid: boolean, lapTime: number): LapTelemetry | null;
}
export function telemetryKey(trackId: string, carId: string): string; // `telemetry:<track>:<car>`
export function saveIfBest(storage: GhostStorage, lap: LapTelemetry | null): boolean;
export function loadTelemetry(storage: GhostStorage, trackId: string, carId: string): LapTelemetry | null;
export function deltaTrace(a: LapTelemetry, b: LapTelemetry): Float32Array; // a.time[i] - b.time[i], length = min sample count
```

- Sample k is at distance `2·k` for `k = 0 .. floor(lapLength / 2) − 1`. Each sample is emitted by the first tick whose `distance >= 2·k` (1e-9 slack), interpolated linearly between the previous and the current tick (`gear`: value of the previous tick). `time` channel holds lap time at the sample.
- `finishLap` returns `null` when `valid` is false, when fewer than all samples were collected, or when `lapTime` is not finite and > 0.
- Storage: JSON `{ trackId, carId, lapTime, spacing, channels: { <name>: <base64 of little-endian Float32 bytes> } }` under `telemetryKey`. `saveIfBest` returns false for `null` or when the stored lap time is `<=` the new one (stored lap unchanged); true when stored. `loadTelemetry` returns `null` for a missing, corrupt or wrong-shaped value (never throws). Base64 via `btoa`/`atob`.

Conventions: no rounding besides float32 storage; `start()` clears the previous lap; inputs not mutated; non-finite `record` input ignored.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | constant 50 m/s for a 1000 m lap at 1/120 ticks | record | 500 samples; speed all 50 ± 1e-4; time at sample k = 2k/50 ± 1e-3 |
| AT2 | lap B = lap A at 0.9× speed | deltaTrace(B, A) | last value = lapTime B − lapTime A ± 0.01 |
| AT3 | save then load | round trip | channels equal within float32 precision (≤ 1e-6 relative) |
| AT4 | saving a slower lap / an invalid lap | saveIfBest | false, stored lap unchanged |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `src/game/telemetry.ts` has no `three` import and no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Hooking the recorder into the game loop and the telemetry screen (task 132).
- Multi-lap history, export/import files.
