# 156 — Environment type per track: ground palette and vegetation

Status: pending
Phase: 1
Depends on: 081, 101, 106
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Every track has an `environment` type; desert and tropical tracks get their own ground textures and palm/cactus/shrub vegetation instead of the parkland grass and oaks.

## Context

Installed assets: palms `public/models/vegetation/palm-{date,coconut}.glb` (2022 tris, no LODs, world scale unchecked: normalise to the target heights by bounding box), props `public/models/props/{cactus,shrub-dry,lamp}.glb` (shrub-dry is a green Kenney bush: tint it dry for desert).

M1.2d, design `docs/plans/m1.2d-environments.md`, research `docs/research/environments.md`. Read the current code first: this task runs after 081 (terrain material), 101 (tree LODs) and 106 (new tracks); adapt file names to what exists, keep the public contract. Textures (`public/textures/ground/{sand,dry}/{color,normal,roughness}.jpg`) and models (`public/models/vegetation/palm-{date,coconut}.glb`, `public/models/props/{cactus,shrub-dry}.glb`) are installed by the planner; this task only consumes them. Mapping: city baku, singapore, lasvegas, detroit; desert bahrain, lusail, fontana; tropical sepang, daytona; forest spa; parkland monza, silverstone, mexico, braselton, elkhart, budapest, spielberg, cleveland. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/core/types.ts` — modify: `EnvironmentType`; optional `environment` on `TrackDataV2`.
- `src/render/terrainMaterial.ts` — modify: palette-driven texture sets.
- `src/render/treeField.ts` — modify: GLB species (palm-date, palm-coconut, cactus, shrub-dry) with 2 LODs (mesh, crossed quads).
- `tools/track-builder/tracks.json`, `tools/track-builder/trees.ts`, `tools/track-builder/buildTrackData.ts` — modify: `environment` per track, default species per type, copy to JSON.
- `src/main.ts` — modify: `SceneStats` adds `environmentType`, `treeSpecies`.
- `public/tracks/*.json` — regenerate (`npm run build:tracks`, all ids).

## Steps

```ts
// src/core/types.ts
export type EnvironmentType = 'parkland' | 'forest' | 'desert' | 'tropical' | 'city';
// TrackDataV2: environment?: EnvironmentType   (parser default 'parkland')
// terrainMaterial.ts
export interface GroundPalette { dirs: [string, string, string]; stripes: boolean } // dirs under textures/
export function groundPalette(type: EnvironmentType): GroundPalette;
// main.ts SceneStats adds: environmentType: EnvironmentType; treeSpecies: string[]
```

1. `groundPalette`: parkland/forest/city = the current A/B/C grass dirs, stripes true; desert = [ground/sand, ground/dry, ground/sand-b] (AT2; all three dirs exist), stripes false; tropical = current grass A/B, C = grass-dark, stripes true. `createTerrainMaterial(loadTexture?, ground?, palette?)`: palette is a new optional 3rd parameter (the `groundPalette()` return value), default `groundPalette('parkland')`; existing callers keep working, `main.ts` passes it 3rd. It keeps the dirt set.
2. Tree field: species with GLB models load the GLB (cached, one load per species) and use LOD0 = its meshes, LOD1 = crossed quads (two perpendicular textured quads, alpha-tested) as 101 does for generated trees. The field keeps its 3 LOD levels (80/250 m): for GLB species LOD2 (≥ 250 m) reuses the LOD1 crossed quads. Scale by `scaleForHeight`.
3. Builder defaults when the track's `biome.species` names none of `palm-date`, `palm-coconut`, `cactus`, `shrub-dry`: desert {palm-date 0.5, shrub-dry 0.4, cactus 0.1}, density 0.08; tropical {palm-coconut 0.6, oak 0.4}, density 0.5; city {palm-date 0.5, oak 0.5}, density 0.03. Parkland/forest keep the track's own biome. `treeSpecies` entries for new species: palm-date 9 m, palm-coconut 12 m, cactus 3 m, shrub-dry 1.2 m.
4. `main.ts`: `environmentType = track.environment ?? 'parkland'`, `treeSpecies` = names of species with ≥ 1 instance.
5. Regenerate all tracks.

Conventions: unknown type → parkland palette; missing `environment` → 'parkland'; palette dirs array is not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | every track JSON in public/tracks | read `environment` | matches the mapping above |
| AT2 | unit groundPalette('desert') / ('parkland') | call | texture dirs [ground/sand, ground/dry, ground/sand-b] and stripes false / the current grass sets and stripes true |
| AT3 | e2e `/?track=bahrain` | ready | `sceneStats().environmentType` 'desert'; `sceneStats().treeSpecies` includes 'palm-date'; no console errors |
| AT4 | e2e `/?track=monza` | ready | environmentType 'parkland'; treeSpecies has no palm |
| AT5 | e2e bahrain start screenshot, band y 200–330 | pixels | ≥ 40 % have R > G (sand), mean saturation < 0.45 |

## Acceptance criteria

- [ ] AT1–AT5 pass (e2e rows in `tests/e2e/acceptance/156-*.spec.ts`, unit in `tests/unit/acceptance/156-*.test.ts`); 081 and 101 tests still pass.
- [ ] All `public/tracks/*.json` regenerated; typecheck, lint, test, test:e2e pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 156-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- City buildings, water, landmarks, street furniture (157–160).
- New textures or models (planner installs them); per-track biome tuning beyond the defaults above.

## Planner-authorised test edits

The new top-level `environment` key breaks the pinned-JSON comparisons of older tasks. The coder adds `delete <copy>.environment;` (same pattern as the existing `sausages` deletions) to the strip/pin helpers in exactly these places and changes nothing else in them:
- `tests/unit/acceptance/106-new-tracks-in-game.test.ts` (helper around lines 54-69)
- `tests/unit/acceptance/097-terrain-below-strips.test.ts` (helper around lines 160-182)
- `tests/unit/acceptance/155-close-parallel.test.ts` (helper around lines 468-476)
