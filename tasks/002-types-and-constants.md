# 002 — Create shared types and constants

Status: done
Phase: 0
Depends on: 001
Roles: coder, tester, reviewer

## Goal

`src/core/types.ts` and `src/core/constants.ts` exist with the exact content of `ai/guides/architecture.md` ("Shared types" and "Constants"), so the other tasks import them.

## Context

Copy literally; do not rename, reorder or add fields. No dependencies (`core` layer).

## Files

- `src/core/types.ts` — create
- `src/core/constants.ts` — create
- `tests/unit/core/constants.test.ts` — create

## Steps

1. Create `src/core/types.ts` with EXACTLY:

```ts
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** Normalised driver controls. steer: -1 = full left, +1 = full right. */
export interface DriverInput { throttle: number; brake: number; steer: number; reset: boolean }

export interface SpawnPose { position: Vec3; yaw: number }

export interface WheelState {
  /** Wheel centre in world space. */
  position: Vec3;
  /** Steering angle in radians as applied to Rapier (positive = left). */
  steering: number;
  /** Accumulated spin angle around the axle in radians (Rapier wheelRotation). */
  rotation: number;
  inContact: boolean;
}

export interface VehicleState {
  position: Vec3;
  rotation: Quat;
  /** Signed speed along the car's forward axis, m/s (negative when reversing). */
  forwardSpeed: number;
  wheels: WheelState[]; // order: front-left, front-right, rear-left, rear-right
}

/** Output of tools/track-builder, served from public/tracks/<id>.json. */
export interface TrackData {
  id: string;                 // "monza"
  name: string;               // "Monza" (city/region name, never the commercial name)
  widthMeters: number;        // 12
  lengthMeters: number;       // length of the resampled closed centerline
  officialLengthMeters: number;
  /** Closed centerline [x, z] in metres, ~2 m spacing, index 0 = start/finish line, last point NOT repeated. */
  centerline: [number, number][];
  /** Centerline indices where sectors 1, 2, 3 start. sectors[0] is always 0. */
  sectors: [number, number, number];
  source: { dataset: string; license: string; url: string };
}

export type LapEvent =
  | { type: 'lapStarted'; lap: number; time: number }
  | { type: 'sectorCompleted'; lap: number; sector: number; sectorTime: number }
  | { type: 'lapCompleted'; lap: number; lapTime: number; isBest: boolean };
```

2. Create `src/core/constants.ts` with EXACTLY:

```ts
export const FIXED_DT = 1 / 120;          // s
export const MAX_STEPS_PER_FRAME = 8;     // avoid spiral of death
export const GRAVITY = -9.81;             // m/s², Y axis
export const AIR_DENSITY = 1.225;         // kg/m³
export const MS_TO_KMH = 3.6;
```

3. Create `tests/unit/core/constants.test.ts` (imports from `../../../src/core/constants`), three tests:
   - `FIXED_DT is 1/120` → `toBeCloseTo(1/120, 10)`
   - `MAX_STEPS_PER_FRAME is 8` → `toBe(8)`
   - `MS_TO_KMH is 3.6` → `toBeCloseTo(3.6, 10)`

## Acceptance criteria

- [ ] Both files match the blocks above.
- [ ] The 3 tests pass; typecheck and lint without errors.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Additional types or constants (`PLACEHOLDER_CAR` belongs to task 010).
- `export default`, barrel `index.ts`.
