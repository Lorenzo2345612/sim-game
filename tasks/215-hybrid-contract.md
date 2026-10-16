# 215 — Hybrid and active-aero contract

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`CarSpec` can carry optional `hybrid` and `activeAero` blocks, and `DriverInput`/`Telemetry` can carry the new optional fields. No behaviour changes.

## Context

2026-style hybrid car (research: `docs/research/f1-2026-car.md`). Types only; later tasks 216-219 consume them. Types architecture: `ai/guides/architecture.md`. No "F1"/"Formula 1"/team names in game data.

## Files

- `src/physics/hybridTypes.ts` — create
- `src/physics/carSpec.ts` — modify (`CarSpec` fields + parsing in `parseCarSpec`, using the existing `fail`/`optNum`/`num` helpers)
- `src/core/types.ts` — modify (`DriverInput`, line 5)
- `src/physics/vehicleModel.ts` — modify (`Telemetry` interface, line 61; type only, do not touch behaviour)
- `tests/unit/acceptance/215-hybrid-contract.test.ts` — create (acceptance worker)

## Steps

1. Create `src/physics/hybridTypes.ts` exporting exactly:
```ts
export type ErsMode = 'charge' | 'balance' | 'attack';
export interface HybridSpec { mgukW: number; batteryJ: number; deployJPerLap: number; harvestJPerLap: number; overtakeExtraJ: number; minSpeedMs: number; taperStartMs: number; taperEndMs: number; overtakeTaperStartMs: number; overtakeTaperEndMs: number; regenW: number; superClipW: number; liftHarvestW: number }
export interface ActiveAeroSpec { dragScale: number; downforceScale: number; transitionS: number }
export interface ErsTelemetry { socFrac: number; powerW: number; mode: ErsMode; overtake: boolean; clipping: boolean; lapDeployJ: number; lapHarvestJ: number; deployCapJ: number }
export interface AeroTelemetry { blend: number; inZone: boolean }
```
2. `CarSpec` gains `hybrid?: HybridSpec` and `activeAero?: ActiveAeroSpec` (import types from `./hybridTypes`), parsed from JSON blocks `hybrid` / `activeAero`. Absent block → property undefined (omit the key).
3. Present block: every field required, finite, > 0; extra rules: `taperStartMs < taperEndMs`, `overtakeTaperStartMs < overtakeTaperEndMs`, `dragScale` and `downforceScale` in (0, 1]. Invalid → `fail('hybrid.<field>')` / `fail('activeAero.<field>')`.
4. `DriverInput` gains `overtake?: boolean` (held) and `ersCycle?: boolean` (edge, like `shiftUp`). `Telemetry` gains `ers?: ErsTelemetry` and `aero?: AeroTelemetry` (import from `./hybridTypes`).
5. Do not edit `public/cars/f4.json`.

Conventions: all numeric checks are strict (`>`/`<`, no equality allowed where stated); invalid or non-finite input throws; the parsed block is a fresh object (JSON not mutated).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/215-hybrid-contract.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/cars/f4.json` | `parseCarSpec` | `hybrid` and `activeAero` undefined; every other field deep-equal to parsing before this task (snapshot from `git show HEAD:public/cars/f4.json` is the same file) |
| AT2 | f4 JSON + `hybrid` block with the shared constants + `activeAero` {0.7, 0.6, 0.4} | parse | `spec.hybrid` deep-equals the block; `spec.activeAero` deep-equals {dragScale 0.7, downforceScale 0.6, transitionS 0.4} |
| AT3 | AT2 JSON with, one at a time: `hybrid.mgukW` missing, `hybrid.batteryJ` = 0, `hybrid.taperEndMs` = taperStartMs, `activeAero.dragScale` = 1.2, `activeAero.transitionS` = -1 | parse | throws an Error whose message contains the field path (`hybrid.mgukW`, `hybrid.batteryJ`, `hybrid.taperEndMs`, `activeAero.dragScale`, `activeAero.transitionS`) |
| AT4 | type-level (`tsc`) | a `DriverInput` literal with only throttle/brake/steer/reset; a `Telemetry` literal without `ers`/`aero` | compiles (fields optional) |

## Acceptance criteria

- [ ] Acceptance table passes.
- [ ] `git diff --stat` shows no change to `public/cars/*.json`.
- [ ] `npm run typecheck` passes with existing tests unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Using the blocks in physics (216-219), car JSON for ow26 (221), input handling (220).
