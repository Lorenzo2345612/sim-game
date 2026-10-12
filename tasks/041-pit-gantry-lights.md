# 041 — Pit building, start gantry and start lights

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Procedural pit-lane building, start/finish gantry and a 5-light start sequence object.

## Context

Acceptance tests for this task are Vitest in `tests/unit/acceptance/041-pit-gantry-lights.test.ts` (Node, no WebGL). Input is `TrackDataV2` (task 022; uses `centerline`, `elevation`, `widthMeters`, `pit`). Pit `start`/`end` are centerline indices (may wrap). Y of each object = `elevation` at the index it is anchored to. Side normal from the centerline tangent (left = rotate tangent 90° counter-clockwise seen from +Y).

## Files

- `src/render/pitAndStart.ts` — create
- `tests/unit/render/pitAndStart.test.ts` — create (wrapping pit range, left vs right side)

## Steps

```ts
import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
export interface StartLights { object: THREE.Group; setLights(n: number): void }
export function createPitBuilding(track: TrackDataV2): THREE.Group;
export function createStartGantry(track: TrackDataV2): THREE.Group;
export function createStartLights(track: TrackDataV2): StartLights;
```

- Pit building: one box (depth 8 m, height 4 m) whose long side follows the straight chord from `centerline[pit.start]` to `centerline[pit.end]`, its near face `widthMeters/2 + 10` m from the centerline on `pit.side`. `group.userData.garageCount` = number of garage-door boxes (dark, inset on the near face, one per 15 m of length, min 10; if the range is shorter, the count is still 10 with smaller spacing).
- Gantry: two pillars outside the track edges at `centerline[0]` plus a cross beam spanning the full track width (beam length ≥ `widthMeters`), top at ≥ 6 m, perpendicular to the tangent.
- Start lights: 5 emissive sphere/box meshes under the gantry beam, each with its own `MeshStandardMaterial` (red `#ff0000`). `setLights(n)`: lights 0..n-1 get `emissiveIntensity` 2 (emissive red), the others emissive black/intensity 0; `n` clamped to 0..5; `n < 0` turns all off. Test counts lights with emissive intensity > 0.
- Name meshes `pit`, `gantry`, `light`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/041-pit-gantry-lights.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | pit {start, end, side} on a straight fixture | `createPitBuilding` | box building along the pit range, 10 m from the track edge on that side, garage openings ≥ 10 |
| AT2 | fixture | `createStartGantry` | gantry spans the track at centerline[0], height ≥ 6 m |
| AT3 | start lights object | `setLights(n)` for n = 0…5 | exactly n red light materials emissive; `setLights(-1)` all off |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Every geometry/material created is disposable (no shared module-level materials that would be disposed twice).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Start-sequence timing and game logic (the object is only driven by `setLights`).
- Pit-lane asphalt/collision, adding to the scene (task 043), textures.
