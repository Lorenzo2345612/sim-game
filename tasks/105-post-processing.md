# 105 — Post-processing tiers: bloom, LUT, SMAA (GTAO high only)

Status: pending
Phase: 1
Depends on: 099
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Medium and high quality render through an `EffectComposer` chain (bloom, colour-grade LUT, SMAA; GTAO on high); low renders directly. Quality comes from `?quality=` or the saved preset.

## Context

Plan: `docs/plans/m1.2c-realism.md`. Tone mapping Neutral is set on the renderer by 099; `OutputPass` applies it at the end of the chain. Presets: `src/core/settings.ts` (`Preset`, `loadPreset`). Passes from `three/addons/postprocessing/` (`EffectComposer`, `RenderPass`, `GTAOPass`, `UnrealBloomPass`, `LUTPass`, `SMAAPass`, `OutputPass`).

## Files

- `src/render/postProcessing.ts` — create — `passesFor`, `parseCube`, `createPostProcessing`.
- `src/core/settings.ts` — modify — `parseQuality`.
- `src/main.ts` — modify — quality param, composer render path, `renderStats().passes`.
- `tools/assets/buildLut.ts` — create — LUT generator; `package.json` script `"build:lut": "tsx tools/assets/buildLut.ts"` (add it); writes `public/luts/grade.cube`.
- `tests/unit/acceptance/105-post-processing.test.ts` — create (acceptance worker).

## Steps

```ts
// postProcessing.ts
export type PassName = 'render' | 'gtao' | 'bloom' | 'lut' | 'smaa' | 'output';
export function passesFor(tier: Preset): PassName[];
export function parseCube(text: string): { size: number; data: Float32Array }; // data = size^3 * 3 floats, R fastest then G then B
export interface PostProcessing { render(dt: number): void; resize(w: number, h: number): void; passes: PassName[]; dispose(): void }
export function createPostProcessing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, tier: Preset, lut: { size: number; data: Float32Array } | null): PostProcessing;
// settings.ts
export function parseQuality(search: string): Preset | null; // reads "quality" from a query string; unknown/missing -> null
// buildLut.ts
export function generateCubeLut(size?: number): string; // default 33; .cube text with "LUT_3D_SIZE", domain 0..1
```

1. `passesFor`: low → `[]`; medium → `['render','bloom','lut','smaa','output']`; high → `['render','gtao','bloom','lut','smaa','output']`.
2. `createPostProcessing` builds exactly `passesFor(tier)` in that order (`UnrealBloomPass` strength 0.25, radius 0.4, threshold 0.9; `LUTPass` with a `Data3DTexture` from `lut`, intensity 1; GTAO defaults). `lut` null → skip the `lut` pass (and omit it from `passes`). Tier low → `render(dt)` calls `renderer.render(scene, camera)` directly. `dispose()` disposes the composer and every pass/texture. `resize` forwards to `composer.setSize`; composer pixel ratio = renderer's.
3. `generateCubeLut`: per entry (r,g,b in [0,1]) with luma `g = 0.2126r + 0.7152g + 0.0722b` and `s = smoothstep(0.5, 1, g)`: output `R = r + 0.03·s`, `B = b − 0.03·s`, `G = g_in`, each clamped to [0,1]. Entries in .cube order (R fastest). Deterministic output.
4. `main.ts`: quality = `parseQuality(location.search) ?? loadPreset(localStorage)`; load `/luts/grade.cube` with `parseCube` for non-low tiers; the frame loop calls `post.render(frame)` instead of `renderer.render`; `onResize` calls `post.resize`; dispose with the session. `renderStats()` (from 099) gains `passes: PassName[]`.

Conventions: `parseCube` ignores blank lines and `#` comments, reads `LUT_3D_SIZE`, throws `Error('parseCube: invalid')` on size mismatch or missing size; `parseQuality` is case-sensitive; no inputs mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/105-post-processing.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: `passesFor(tier)` | low / medium / high | [] / ['render','clamp','bloom','lut','smaa','output'] / ['render','clamp','gtao','bloom','lut','smaa','output'] |
| AT2 | unit: generated LUT `.cube` | parse | 33³ entries, identity ± 0.05 on neutral greys, warm shift on highlights (R − B ≥ 0.01 at 0.9 grey) |
| AT3 | e2e `/?track=monza&quality=medium` vs `quality=low` | screenshots | differ in ≥ 2 % of pixels; no console errors |

## Planner decision (2026-10-14, after coder timeouts)

- HDR overflow: the HDRI sun exceeds the half-float max (65504), producing Inf and then NaN that bloom spreads (white canvas, real GPUs too). Add a `clamp` ShaderPass right after `render`: non-finite → 0, then `min(rgb, 64.0)`. Keep the HalfFloat targets.
- Planner-authorised edit: `tests/unit/acceptance/105-post-processing.test.ts` AT1 expected lists gain `'clamp'` after `'render'` (as in the table).
- Debug budget: if AT3 still fails after one fix attempt, stop and report BLOCKED with the pixel stats; do not keep debugging SwiftShader.

## Acceptance criteria

- [ ] All AT rows pass; `public/luts/grade.cube` generated and committed by running `npm run build:lut`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass.

## Verification

```
npm run build:lut
npm run typecheck
npm run lint
npm test
npx playwright test 105-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Settings UI/menu for quality, depth of field, motion blur, TAA, per-tier pixel ratio changes (`presetSettings` unchanged), shadows/tree distance wiring, other LUT looks per track.
