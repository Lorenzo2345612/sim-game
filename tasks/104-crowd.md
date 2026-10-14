# 104 — Crowd sprite atlas and seated crowd

Status: pending
Phase: 1
Depends on: 040
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Grandstands show a textured crowd of people (sprites from a baked atlas) instead of coloured boxes.

## Context

M1.2c. CC0 Quaternius character GLBs are in `assets/source/crowd/*.glb` (installed by the planner, listed in `ASSETS_LICENSES.md`). Offline tool renders them with three.js in headless Chrome through Playwright, reusing `ARGS` and the launch style of `scripts/review/lib.mjs` (SwiftShader); the tool serves `node_modules/three` and the GLBs from a temporary local `node:http` server (no network). Current crowd: `createGrandstand` in `src/render/grandstand.ts` (040), InstancedMesh `crowd` of boxes, seats `floor(length/0.6)` per row, `ROW_RISE` 0.8, `ROW_DEPTH` 0.9, `mulberry32` seed `Math.round(x*31 + z*17)`.

## Files

- `tools/assets/buildCrowd.ts` — create — atlas bake; `package.json` — modify: only script `"build:crowd": "tsx tools/assets/buildCrowd.ts"`.
- `src/render/grandstand.ts` — modify — crowd from atlas.
- `tests/unit/acceptance/104-crowd.test.ts` — create (acceptance worker); e2e AT4 following existing e2e pattern.

## Steps

```ts
// grandstand.ts
export function seatPositions(g: Grandstand): Array<{ x: number; y: number; z: number }>; // local coords, rows × floor(length/0.6), row-major
export function createGrandstand(g: Grandstand, loadTexture?: (url: string) => THREE.Texture): THREE.Group;
```

1. Tool output: `public/textures/crowd/atlas.png` (1024×1024 RGBA, 8×8 cells of 128×128, row 0 at top) and `public/textures/crowd/atlas.json` `{ cells: boolean[64]; meanSaturation: number }` (cells = non-empty, i.e. any pixel alpha > 0; saturation = HSV mean over opaque pixels, computed in the page before encoding).
2. Cell i: character file `files[i % N]` (files sorted by name, N = file count), variant `floor(i / N)`; variant picks a seeded (mulberry32, seed i) desaturated clothing tint (saturation ≤ 0.3) and horizontal mirror on odd variants. If the GLB has a clip named like `/sit|idle/i` pose it at t = 0, else bind pose. Orthographic front camera framed waist-up, transparent background, fixed lights. All 64 cells filled; ≥ 48 required. Mean saturation < 0.35.
3. Deterministic: fixed viewport and device scale factor 1, no timestamps; two runs give byte-identical `atlas.png`.
4. Crowd: ONE `InstancedMesh` named `crowd` per grandstand, count `round(0.85 · rows · perRow)` (perRow = seats per row); the occupied seats are the first N of a mulberry32-seeded (same seed as today) shuffle of `seatPositions`. Instance translation equals its seat position exactly (quad origin at bottom centre).
5. Each person is a 0.9 × 0.9 m quad facing local −Z (toward the track, no billboarding), material `MeshStandardMaterial` with the atlas as `map` (SRGB, name = url, default `loadTexture` = `TextureLoader`, url `/textures/crowd/atlas.png`), `alphaTest` 0.5, `roughness` 0.9, per-instance cell via an instanced attribute used to offset the uv by (col, row)/8 (patched with `onBeforeCompile`), and a seeded per-instance tint with `setColorAt` (HSL s 0.3–0.6, l 0.45–0.7). No per-frame work.
6. `disposeGrandstand` also disposes the atlas texture; zero seats or zero rows creates no `crowd` mesh.

Conventions: `round` is half-up; count tolerance ±1 is for the tests only, the code must give exactly `Math.round(0.85 * rows * perRow)`; `seatPositions` is in grandstand-local metres, y = tier top; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/104-crowd.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:crowd` | output | `public/textures/crowd/atlas.png` 1024×1024 = 8×8 cells of 128×128, ≥ 48 non-empty cells, mean saturation < 0.35 |
| AT2 | run twice | output | byte-identical |
| AT3 | unit: crowd for a grandstand with R rows × S seats | build | instances = round(0.85·R·S) ± 1; each on a seat position; one InstancedMesh per grandstand |
| AT4 | e2e monza | ready | `drawCalls()` ≤ 300; screenshot of the start grandstand region has luminance std dev ≥ 0.05 |

## Acceptance criteria

- [ ] All AT rows pass (AT1 reads PNG IHDR for size and `atlas.json` for cells/saturation).
- [ ] Existing grandstand tests (040) still pass; edits to them reported.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass.

## Verification

```
npm run build:crowd
npm run typecheck
npm run lint
npm test
npx playwright test 104-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Animation, standing/cheering behaviour, billboarding, LOD of the crowd, new npm dependencies, new character assets, grandstand structure/roof, `src/main.ts`.
