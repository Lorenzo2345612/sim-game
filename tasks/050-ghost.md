# 050 — Best-lap ghost recording and replay

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The best valid lap is recorded, stored per track and can be queried at any lap time to drive a translucent ghost car.

## Context

Pure game-layer logic in `src/game` (no `three`, no DOM; storage injected). Types `Vec3`, `Quat` from `src/core/types.ts`. Acceptance tests for this task are Vitest in `tests/unit/acceptance/`.

## Files

- `src/game/ghost.ts` — create.
- `src/render/carRenderer.ts` — modify — only add an optional way to create/tint a translucent ghost instance if the existing API cannot already do it; otherwise do not touch.
- `tests/unit/game/ghost.test.ts` — create — extra edge tests.

## Steps

```ts
export const GHOST_HZ = 30;
export type GhostSample = [number, number, number, number, number, number, number, number]; // [t, x, y, z, qx, qy, qz, qw]
export interface GhostLap { trackId: string; lapTime: number; samples: GhostSample[] }
export interface GhostStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class GhostRecorder {
  constructor(trackId: string, hz?: number);          // default GHOST_HZ
  start(): void;                                       // clears samples, t = 0
  record(dt: number, position: Vec3, rotation: Quat): void; // accumulates time; stores a sample every 1/hz s (first sample at t = 0)
  finishLap(valid: boolean, lapTime: number): GhostLap | null; // null when invalid
}
export function ghostKey(trackId: string): string;     // `ghost:<trackId>`
export function saveGhostIfFaster(storage: GhostStorage, lap: GhostLap): boolean; // true when stored (no ghost yet or faster)
export function loadGhost(storage: GhostStorage, trackId: string): GhostLap | null; // null if missing or corrupt JSON
export function ghostAt(lap: GhostLap, t: number, outPos: Vec3, outRot: Quat): void;
```

- Sampling is by accumulated time (not per call); a 10 s lap at 30 Hz yields 300 ±2 samples.
- `ghostAt`: linear position, nlerp (shortest arc) quaternion between the two neighbouring samples; `t` clamped to `[first.t, last.t]`.
- Storage: `JSON.stringify(lap)` under `ghostKey`; corrupt data → `null`, no throw. `saveGhostIfFaster`: equal time does not replace.
- Ghost rendering in `main.ts` is task 054; here only the data plus the optional renderer hook.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/050-ghost.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | recorder at 30 Hz, 10 s valid lap | `finishLap(valid)` | stored samples 300 ±2 with [t, x, y, z, qx, qy, qz, qw] |
| AT2 | invalid lap | finishLap | not stored |
| AT3 | best lap ghost, time 4.95 s | `ghostAt(4.95)` | pose interpolated between neighbouring samples ±1e-6 |
| AT4 | localStorage key `ghost:<trackId>` | save/load | round trip equal; only replaced by a faster lap |

## Acceptance criteria

- [ ] All AT rows pass; `src/game/ghost.ts` imports nothing from `three`, `window` or `document`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring to the lap timer and `main.ts` (task 054), ghost-vs-player delta, multiple ghosts, cross-session sharing.

