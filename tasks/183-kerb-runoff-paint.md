# 183 — Kerb colours per segment and run-off paint

Status: pending
Phase: 1
Depends on: 180
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Kerb stripe colours and painted run-off areas come from `style.kerbs` / `style.runoffPaint` per track segment; with the default style the surface meshes are identical to today.

## Context

Design: `docs/design/track-style.md`. Task 179 types/`segmentOverride`, task 180 `TrackSurfaceOptions { loadTexture?, style?, track? }`. Strips merge many segments into one mesh per surface today, so a strip must carry its source segment. Kerb stripes today: shader uniforms `uStripeA` (0.78, 0.1, 0.1) / `uStripeB` (0.7, 0.7, 0.7) in `applyKerbStripes`. Run-off strip uv: u = lateral metres / 10, v = arc length / 10; run-off texture repeat = 10 / tileMeters (8), so in the fragment `vMapUv × 8` = metres. Hex → uniform: `new THREE.Color(hex)` (sRGB→linear), pass r,g,b.

## Files

- `src/core/types.ts` — modify: `SurfaceStrip` gains `segment?: { kind: 'kerb' | 'runoff'; index: number }`.
- `src/track/surfaces.ts` — modify: strips built from `track.kerbs[i]` / `track.runoffs[i]` get `segment = {kind, index: i}`; `filterStripTriangles` copies `segment` to the strip it returns. Nothing else changes (positions/indices/uvs/order identical).
- `src/render/surfaceMaterials.ts` — modify.
- `src/render/trackSurfaceRenderer.ts` — modify.
- `tests/unit/acceptance/183-kerb-runoff-paint.test.ts` — create (acceptance role).

## Steps

```ts
export interface SurfacePaint { stripeColors?: [string, string]; pattern?: 'solid' | 'stripes' | 'bands'; colors?: string[]; stripeMeters?: number }
export function createSurfaceMaterial(kind, loadTexture?, macro?, style?: ResolvedTrackStyle /* accepted, unused until 184: void style */, paint?: SurfacePaint): THREE.MeshStandardMaterial
```

- Kerb material with `paint.stripeColors`: uniforms `uStripeA`, `uStripeB` = `Vector3` linear colours of the two hexes; `material.userData.stripeColors` = the hex pair, or `null` for the default. Keep `customProgramCacheKey` `surface-kerb`.
- Paint material (`kind 'runoff'` with `paint.pattern`): fragment replaces the albedo with the paint colour × `clamp(lum / 0.3, 0.6, 1.2)` (lum = sampled albedo luminance, as kerb stripes do). `solid`: `colors[0]`. `stripes`: block index = `floor(vMapUv.y × 8 / stripeMeters)` (bands across the run-off); `bands`: block index = `floor(abs(vMapUv.x) × 8 / stripeMeters)` (parallel to the track); colour = `colors[index mod colors.length]`; with exactly 1 colour odd blocks keep the unpainted albedo. Uniforms: `uPaintColors` (array of 4 `Vector3`, padded with the last colour; first `colors.length` entries are the linear colours), `uPaintCount`, `uPaintStripe` (metres), `uPaintMode` (0 solid, 1 stripes, 2 bands). Cache key includes the pattern. `material.userData` additionally `{ pattern, colors, stripeMeters }`; `SurfaceMaterialUserData` gets these as optional fields.
- `createTrackSurfaceObject(strips, options)`: strips are grouped per surface as today, but:
  - Kerb strips: with `options.style` and `options.track` and a `segment` tag, the group colours = `segmentOverride(style.kerbs.ranges, track.kerbs[index], track.centerline.length)?.colors ?? style.kerbs.colors ?? null`; untagged strips or missing options → `null`. One mesh per distinct colour pair (`null` = default), in first-appearance order, named `kerbs`, `kerbs:1`, `kerbs:2`…; each has its own material.
  - Run-off strips (`surface === 'runoff'` and `segment.kind === 'runoff'` only; gravel and untagged strips are never painted): pattern/colors/stripeMeters = the matching `style.runoffPaint.ranges` entry's value (via `segmentOverride`) falling back to the section value. `pattern 'none'` or empty colours → stays in the normal `runoff` mesh. Painted strips go to meshes named `runoffPaint`, `runoffPaint:1`… one per distinct (pattern, colors, stripeMeters), with `mesh.userData = { pattern, colors, stripeMeters }`.
  - Empty groups create no mesh (a `runoff` mesh is absent when every run-off strip is painted). Vertex/triangle merging per mesh unchanged; the sum of triangles over a surface's meshes equals today's single mesh.
- Dispose releases every material/geometry as today.

Conventions: colours lower-case hex in userData; segment index = index into `track.kerbs` / `track.runoffs`; missing `style`/`track`/tag → default look; strips not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | STRAIGHT with kerbs `[{0,20,left},{40,60,left}]`, DEFAULT style | `createTrackSurfaceObject(strips, {style, track})` | exactly 1 mesh named `kerbs` (as today) |
| AT2 | kerbs.colors `['#da0000', '#00da00']` | create | every kerb material has `userData.stripeColors` = `['#da0000', '#00da00']` |
| AT3 | kerbs.colors default; ranges `[{start: 35, end: 70, side: 'left', colors: ['#dac400', '#1f4fbf']}]` | create | 2 kerb meshes (`kerbs`, `kerbs:1`); the one whose geometry spans x 400..600 has stripeColors `['#dac400', '#1f4fbf']`; the other uses the renderer default |
| AT4 | AT3 | count triangles | sum of triangles across kerb meshes = triangles of the single default mesh in AT1 |
| AT5 | runoffs `[{0,20,left,'runoff',8}]`, runoffPaint `{pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 2}` | create | a mesh `runoffPaint` exists with `userData.pattern 'stripes'`, `userData.colors` as given, `userData.stripeMeters 2`; the `runoff` mesh no longer contains those triangles (triangle total of runoff + runoffPaint equals the default runoff count) |
| AT6 | runoffPaint pattern `'none'` (default) | create | no `runoffPaint` mesh |
| AT7 | gravel run-off segment with a paint range covering it | create | gravel is never painted: no `runoffPaint` mesh; gravel triangle count unchanged |
| AT8 | runoffPaint default `none`, ranges `[{start: 0, end: 20, side: 'left', pattern: 'solid', colors: ['#58d23a']}]` | create | `runoffPaint` mesh, pattern 'solid', colors `['#58d23a']` |
| AT9 | kerb and paint uniforms | inspect `material.userData` and the shader uniforms after `onBeforeCompile` with a stub shader | stripe uniforms equal the linear-space conversion of the hex colours (±1e-3) |
| AT10 | physics | `buildTrackSurfaces(track)` before/after | identical output (rendering only; surfaces and grip unchanged) |

## Acceptance criteria

- [ ] All AT rows pass; existing tests (`tests/unit/render/trackSurfaceRenderer.test.ts`, acceptance 031, 037, 080, 096, 176) stay green unedited.
- [ ] AT10 compares `surface`, `positions`, `indices`, `uvs` per strip (the new optional `segment` field is additive).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `kerbs.outerStrip` rendering, edge lines, palette tints (184), barriers (185), physics/grip changes, escape-road strips, new textures.
