# 150 — Sausage kerb render and colliders

Status: pending
Phase: 2
Depends on: 149, 141
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Sausages from the track data are drawn as yellow raised kerbs with black end caps and are solid for the car (wheel rays hit them).

## Context

M2.5, design `docs/plans/late-features.md` ("150"). Read the current code first: this task runs after 149 (`TrackDataV2.sausages`, may be undefined → treat as `[]`) and 141 (`SceneStats` additions in `src/main.ts`, barrier instancing in `src/render/barrierRenderer.ts`); adapt file names to what exists, keep the public contract. Colliders: `addTrackColliders` in `src/physics/trackColliders.ts`; tag sausages with the same surface as kerb strips (`surfaceOf`). Render may import `three`; instancing, `dispose()`, no per-frame allocation. Local geometry frame: X across (width), Y up, Z along the track (length), base at y = 0 centred on the origin. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e: `tests/e2e/acceptance/150-sausage-render.spec.ts`.

## Files

- `src/render/sausageRenderer.ts` — create.
- `src/physics/trackColliders.ts` — modify: add fixed convex-hull colliders for every sausage.
- `src/main.ts` — modify: add the object to the scene, dispose with the session, `SceneStats.sausages: number` (0 when none/v1).
- `tests/unit/acceptance/150-sausage-render.test.ts`, `tests/e2e/acceptance/150-sausage-render.spec.ts` — create (acceptance worker).

## Steps

```ts
export const SAUSAGE_BASE_WIDTH = 0.5, SAUSAGE_TOP_WIDTH = 0.25, SAUSAGE_HEIGHT = 0.13, SAUSAGE_CAP_LENGTH = 0.4;
export function sausageHullPoints(length: number): Float32Array; // 8 corner points (xyz) of the trapezoid prism, base y 0
export function createSausageGeometry(length: number): THREE.BufferGeometry; // has a `color` attribute: yellow body, black on the first/last SAUSAGE_CAP_LENGTH m
export interface SausageObject { group: THREE.Group; count: number; dispose(): void }
export function createSausages(track: TrackDataV2): SausageObject;
export function sausagePose(track: TrackDataV2, s: Sausage): { position: Vec3; yaw: number }; // base centre on the ground, yaw along the tangent
```

1. Profile: trapezoid 0.5 m wide at the base, 0.25 m at the top, 0.13 m tall, 6 m long (`Sausage.length`), along the track tangent.
2. One `InstancedMesh` (vertex colours, shared geometry for equal length) for all sausages; instance matrix from `sausagePose`.
3. Pose: centerline point at `index` + right-normal (central difference of neighbours) · (±`offset`: +right, −left); y = `elevation[index]`; yaw aligns local Z with the tangent.
4. Collider per sausage: `RAPIER.ColliderDesc.convexHull(sausageHullPoints(length))`, fixed, translated/rotated by `sausagePose`; the wheel raycasts must hit it. Same friction as kerb strips.
5. `createSausages`: `count` = sausages; `dispose()` frees geometry and material.

Conventions: metres; `track.sausages ?? []`; empty → empty group with `count` 0; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: build for one sausage on flat ground | geometry | max y − ground = 0.13 ± 1e-6; base width 0.5, length 6 (± 1e-6) |
| AT2 | Node: f4 drives across a sausage perpendicular at 25 m/s | 1 s | chassis vertical velocity peak > 1.0 m/s; with the sausage removed < 0.3 m/s |
| AT3 | e2e `/?track=monza` | ready | `sceneStats().sausages` = count in monza.json; no console errors |

## Acceptance criteria

- [ ] AT1–AT3 pass.
- [ ] `drawCalls()` grows by at most 1 versus without sausages.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e -- 150
```

## Out of scope

- Placement (149); damage from kerb strikes; kerb strip changes; textures (vertex colours only).
- README, tasks.json, milestones.json.
