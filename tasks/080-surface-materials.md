# 080 — PBR surface materials with anti-tiling for track strips

Status: pending
Phase: 1
Depends on: 077
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Track strips (asphalt, runoff, gravel, grass verge, kerb) render with per-kind PBR materials whose albedo does not visibly tile (two-scale blend driven by a macro-noise texture).

## Context

Guide: `ai/guides/architecture.md`. UV conventions in `src/track/surfaces.ts`: asphalt/runoff/gravel/grass uv = metres/10 (`UV_SCALE = 10`), kerb v = s/1.5. Texture dirs under `public/textures/` (each `color.jpg`, `normal.jpg`, `roughness.jpg`): asphalt, asphalt-track, grass, grass-mown, grass-dark, gravel, dirt, kerb, concrete; plus `public/textures/macro-noise.png` (RGB tileable: R low, G mid, B high frequency). Task 077 adds 'grass' strips. Task 081 reuses the anti-tiling helper exported here.

## Files

- `src/render/surfaceMaterials.ts` — create — material factory and shared anti-tiling shader helper.
- `src/render/trackSurfaceRenderer.ts` — modify — use `createSurfaceMaterial` for every surface; keep dispose contract.
- `src/main.ts` — modify — remove the `loadSurfaceTexture` runoff remap (runoff now loads `textures/asphalt/`).
- `tests/unit/acceptance/080-surface-materials.test.ts` — create (acceptance worker).

## Steps

```ts
export type SurfaceMaterialKind = 'asphalt' | 'runoff' | 'gravel' | 'grass' | 'kerb' | 'concrete';
export function createSurfaceMaterial(
  kind: SurfaceMaterialKind,
  loadTexture?: (url: string) => THREE.Texture,
  macro?: THREE.Texture,
): THREE.MeshStandardMaterial;
/** Patches a MeshStandardMaterial shader: adds uniforms uMacro, uSaturation, uTint and the anti-tiling albedo sampling. Reused by 081. */
export function applyAntiTiling(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>): void;
```

1. Default `loadTexture` = `THREE.TextureLoader().load` (set `texture.name = url`). If `macro` is omitted, load `textures/macro-noise.png` through `loadTexture`.
2. Texture dirs per kind: asphalt → `asphalt-track`; runoff → `asphalt`; gravel → `gravel`; grass → `grass-mown`; kerb → `kerb`; concrete → `concrete`. Load `color.jpg` (colorSpace SRGB), `normal.jpg`, `roughness.jpg`; all `RepeatWrapping`. Macro texture also `RepeatWrapping`.
3. `material.userData` = `{ tileMeters, saturation, tint, textures }` where `textures` lists every texture the material owns (macro included). Values: asphalt 8 m sat 0.8 tint 1; runoff 8 m sat 0.8 tint 1.15; gravel 3 m sat 0.55 tint 0.85; grass 5 m sat 0.9 tint 1; kerb 1.5 m sat 1 tint 1; concrete 4 m sat 1 tint 1.
4. Texture repeat = 10 / tileMeters on both axes (uv is metres/10), except kerb: kerb repeat = (1, 1) because kerb v is already s/1.5 and u is lateral/10 (one texture width across the kerb).
5. `onBeforeCompile` (via `applyAntiTiling`): sample albedo twice (uv, and uv·0.29 rotated 37°) and blend with macro R sampled at world-xz/180 m; multiply albedo brightness by 1 ± 0.12 using macro G at world-xz/40 m; apply `uSaturation` (desaturate toward luminance) and `uTint` multiplier. Normal and roughness maps stay on plain uv.
6. Kerb additionally: uniforms `uStripeA` = (0.78, 0.10, 0.10) and `uStripeB` = (0.92, 0.92, 0.92); per-uv.v-unit alternation mask picks the stripe colour, multiplied by the kerb albedo luminance so the texture detail remains.
7. `trackSurfaceRenderer`: every strip surface in `MESH_NAME` (incl. 'grass', with mesh name 'grass') gets `createSurfaceMaterial(kind, loadTexture, sharedMacro)`; one macro texture per `createTrackSurfaceObject` call; remove `kerbStripeTexture`. `dispose()` disposes geometries, materials and every texture in `userData.textures` exactly once (shared macro once).

Conventions: no new per-frame allocations; materials created once per track load; unknown kind not possible (typed).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/080-surface-materials.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | stub loader recording URLs | createSurfaceMaterial('gravel') | loaded textures/gravel/color.jpg, normal.jpg, roughness.jpg and textures/macro-noise.png; all RepeatWrapping; map colorSpace SRGB |
| AT2 | stub loader | 'asphalt' / 'runoff' / 'grass' / 'kerb' | colour URLs textures/asphalt-track/…, textures/asphalt/…, textures/grass-mown/…, textures/kerb/… |
| AT3 | each kind | userData | tileMeters asphalt 8, runoff 8, gravel 3, grass 5, kerb 1.5, concrete 4; saturation asphalt 0.8, gravel 0.55, grass 0.9, kerb 1 |
| AT4 | material, fake shader {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader} | material.onBeforeCompile(shader, renderer stub) | shader.uniforms has uMacro and uSaturation; fragmentShader contains 'uMacro'; for 'kerb' it also contains 'uStripeA' and 'uStripeB' |
| AT5 | strips of every surface incl. grass | createTrackSurfaceObject then dispose() | every created texture disposed exactly once (count dispose calls) |
| AT6 | e2e `/?track=silverstone` | ready | no console errors; no HTTP 404 for any /textures/ request |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Existing renderer tests still pass (update only tests that assert removed kerb DataTexture behaviour, if any).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Terrain material (081), markings (082), new texture files, physics grip changes, changes to `src/track/surfaces.ts`, post-processing.
