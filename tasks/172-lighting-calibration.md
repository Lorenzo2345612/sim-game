# 172 — Lighting calibration: one sun, tamer whites and bloom

Status: pending
Phase: 1
Depends on: 106
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

On v2 tracks the scene has exactly one sun, calibrated exposure, bloom that only catches emissive highlights, and white paint that is not blown out.

## Context

User report: on track, white and everything looks far too bright. Causes: `createScene` in `src/render/sceneSetup.ts` adds a Phase-0 DirectionalLight '#ffffff' 2.0 that stays on v2 tracks, while `src/main.ts` (v2 branch, ~line 345) also adds `ShadowRig` (`src/render/environment.ts`, DirectionalLight 2): double direct light on top of HDRI IBL (`environmentIntensity` 0.7). `src/render/postProcessing.ts` UnrealBloomPass (0.25, 0.4, 0.9) under NeutralToneMapping blooms bright non-emissive surfaces (lines, kerbs, concrete, sky). Hooks: `__SIMGAME__` in `src/main.ts` (`sceneStats`, `renderStats` ~lines 828-845). Phase-0 (v1) tracks keep their single sun.

## Files

- `src/main.ts` — modify — remove Phase-0 sun on v2, extend hooks and `SceneStats`/`renderStats` types.
- `src/render/environment.ts`, `src/render/postProcessing.ts`, `src/render/sceneSetup.ts` — modify — constants below.
- White-paint materials in `src/render/` (`trackMarkingsRenderer.ts`, `surfaceMaterials.ts`, `distanceBoards.ts`, `pitAndStart.ts`, `barrierProfiles.ts`) — modify only the colour values (max 3 src files total beyond the above if unavoidable: keep edits colour-only).
- `tests/e2e/acceptance/172-lighting.spec.ts` — create (acceptance worker).

## Steps

1. When `ShadowRig` is created on a v2 track, remove the Phase-0 DirectionalLight from the scene and dispose it (shadow map if any). Exactly one visible DirectionalLight remains. v1 path unchanged.
2. `ShadowRig` light intensity 2.2.
3. `renderer.toneMappingExposure = 0.85`; `scene.backgroundIntensity = 0.85`.
4. Bloom: strength 0.12, radius unchanged (0.4), threshold 1.0.
5. White paint (track lines, white kerb stripes, start gantry/boards white panels, pit building): linear albedo max(r,g,b) ≤ 0.7 (sRGB ≈ #d9d9d9). Keep a single exported/registered list of these materials so the hook can read them.
6. Hooks (types updated):
   - `sceneStats().directionalLights: number` — visible DirectionalLights in the scene.
   - `sceneStats().maxWhiteAlbedo: number` — max over the white-paint materials of max(r,g,b) of `material.color` (linear); 0 if none.
   - `renderStats().exposure: number`; `renderStats().bloom: { strength: number; threshold: number } | null` (null when the pass is off).

Conventions: no rounding; hook values read live from the objects, not cached constants.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | e2e `/?track=monza` (v2) | ready | `sceneStats().directionalLights` === 1 |
| AT2 | e2e `/?track=monza`, preset high | ready | `renderStats().exposure` in [0.8, 0.9]; `renderStats().bloom.threshold` ≥ 1.0 and `.strength` ≤ 0.15 |
| AT3 | e2e `/?track=monza` | ready | `sceneStats().maxWhiteAlbedo` ≤ 0.7 and > 0 |
| AT4 | e2e `/?track=lusail` | ready | AT1 holds (one light) and `sceneStats().shadows` unchanged from the setting |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] v1 tracks still render with one sun; existing e2e hook consumers still pass (`npm test`).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 172-
```

## Out of scope

- Changing HDRI, `environmentIntensity`, shadow settings, car materials, or tone mapping type.
- Quality-preset redesign.
