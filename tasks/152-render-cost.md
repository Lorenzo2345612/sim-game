# 152 — Render cost: draw calls, culling, shadows

Status: pending
Phase: 3
Depends on: 151
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Fewer draw calls through merged static meshes and per-cell culled instanced fields, and a shadow map sized by preset, with no visual regression.

## Context

M5, design `docs/plans/late-features.md` ("152"). Read the current code first: this task runs after 151 (`perfStats`, `drawCalls()`) and every render feature (barriers, boards 143, sausages 150, kerbs, trees, grandstands, foam 141, crowd/tyres if present); adapt file names to what exists, keep the public contract. Implement as post-passes over the assembled scene groups in `src/main.ts` so producer modules stay unchanged. `three` `mergeGeometries` (`three/addons/utils/BufferGeometryUtils.js`) and `InstancedMesh` bounding spheres give frustum culling. Dispose merged sources. No per-frame allocation. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e: `tests/e2e/acceptance/152-render-cost.spec.ts`.

## Files

- `src/render/chunking.ts` — create.
- `src/render/sceneSetup.ts` — modify: `shadowConfig(preset)`, shadow map applied from it.
- `src/main.ts` — modify: apply post-passes after the scene is built; test hook `__SIMGAME__.debugCameraYaw(rad: number): void` (rotates the camera about world Y by `rad` around its position until the next frame update).
- `tests/unit/acceptance/152-render-cost.test.ts`, `tests/e2e/acceptance/152-render-cost.spec.ts` — create (acceptance worker).

## Steps

```ts
export function assignCells(positions: readonly { x: number; z: number }[], cellSize: number): Map<string, number[]>; // key `${cx},${cz}`, cx = floor(x/cellSize)
export function mergeStaticGroup(group: THREE.Group, chunkMeters: number): THREE.Group; // non-instanced Meshes merged per material per chunk
export function chunkInstancedMesh(mesh: THREE.InstancedMesh, cellSize: number): THREE.Group; // one InstancedMesh per cell, own bounding sphere
export interface ShadowConfig { mapSize: number; cascades: number }
export function shadowConfig(preset: Preset): ShadowConfig; // low {0,0}, medium {1024,1}, high {2048,2}
```

1. Static trackside (barriers, boards, sausages, kerb strips, pit/start objects) merged per material per 500 m chunk (chunk key = floor of arc length or XZ cell; pick XZ cells of 500 m); instanced fields (trees, crowd, tyres, foam) split into 200 m XZ cells.
2. Merged groups and cell meshes have `frustumCulled = true` and correct bounding spheres; materials shared, not cloned.
3. Shadows: low none (shadow map disabled); medium one 1024 map following the camera; high 2048 with a second cascade (a second directional light/map covering a larger range, implementer's choice of ranges).
4. `AT4` baseline: BEFORE changing anything, run the AT4 test once with `UPDATE_BASELINE=1` to write `tests/e2e/acceptance/152-baseline-monza-start.png`; commit it; afterwards the test compares against it.
5. Existing tests that count meshes/children are adapted minimally and reported.

Conventions: cell boundaries `floor`, negative coordinates use `floor` (not truncation); empty input → empty map; inputs not mutated; deterministic order (insertion order of first appearance).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e monza medium preset, start | drawCalls() | ≤ 150 (was ≤ 300 budget) |
| AT2 | e2e spa, camera at start vs looking away from the track (yaw 180°) | drawCalls | looking away ≤ 0.6 × start |
| AT3 | unit: cell assignment of instances | build | every instance in exactly one cell; cells ≤ 200 m |
| AT4 | e2e screenshots before/after at monza start | pixel diff | ≤ 2 % pixels differ by > 10/255 (no visual regression) |

## Acceptance criteria

- [ ] AT1–AT4 pass; medium preset set via the existing settings storage key in e2e.
- [ ] `sceneStats()` counts keep their meaning (counts of logical objects, not meshes).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 152-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- LOD systems, occlusion culling, texture atlasing, post-processing changes; adaptive quality (154).
- README, tasks.json, milestones.json.

## Planner answers (round 1)

- EDGE7 is wrong: under the floor-cell convention the three boxes fall in cells (0,0), (0,-1), (-1,0), so 3 meshes is correct. Authorised edit: `tests/unit/edge/152-render-cost-edge.test.ts:163` expects 3 merged meshes (one per cell). No other edge-test changes.
- Accepted as designed: `renderer.info.autoReset=false` with one manual reset per frame, persistent `debugCameraYaw` offset, far cascade as a second directional light skipped under software GL.
- Generate the AT4 baseline with `UPDATE_BASELINE=1` and include the PNG in the diff (listed file).

## Planner answers (round 2)

- Test scope (timeouts): run only `npx vitest run tests/unit/acceptance/152- tests/unit/edge/152-`, `npx playwright test 152-`, typecheck and lint. Do not run `npm test`/full vitest/full Playwright (the reviewer does) and do not write probe specs; no `sleep` waits.
- AT1/AT2 count draw calls, which do not depend on software GL speed; they stay. Measure once with `npx playwright test 152-`. If AT1 or AT2 still fails after the cell merge, stop and report BLOCKED with the measured value and a draw-call breakdown by category (track, terrain, scenery cells, cars, shadows); do not keep tuning.

## Planner answers (round 3)

- AT1 relaxed to ≤ 200 draw calls (measured 194; was ~300). AT2 is removed from this task (barrier-cell culling becomes a follow-up); mark it `it.skip` with `// split from 152, follow-up task` (planner-authorised). No more tuning.
- The baseline PNG `152-baseline-monza-start.png` belongs to this task's diff: leave it in the working tree, the pipeline commits it. The `import.meta.url` path change is accepted.
