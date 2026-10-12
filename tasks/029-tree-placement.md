# 029 — Place trees deterministically

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Produce reproducible tree instance data per species around a track.

## Context

Rule in `ai/guides/phase1.md` "Builder rules" (Trees). Types `TrackDataV2` parts: `Terrain`, `TreeInstances`, `BarrierSegment` from `src/core/types.ts`. Terrain bounds: `originX ± sizeX/2`, `originZ ± sizeZ/2`.

## Files

- `tools/track-builder/trees.ts` — create
- `tests/unit/acceptance/029-tree-placement.test.ts` — create by the acceptance role

## Steps

1. Exports:
```ts
import type { Point2 } from '../../src/track/geo';
import type { Terrain, TreeInstances, BarrierSegment } from '../../src/core/types';
export interface Biome { species: { name: string; weight: number }[]; density: number }
export function mulberry32(seed: number): () => number;   // standard mulberry32, returns [0,1)
export function placeTrees(
  trackId: string, centerline: Point2[], terrain: Terrain,
  barriers: BarrierSegment[], biome: Biome,
): TreeInstances[];
```
2. Seed = 32-bit FNV-1a hash of `trackId`.
3. Jittered grid, cell 12 m, from the terrain's min corner. Per cell call the RNG in this fixed order: x jitter, z jitter, density roll, species roll, scale, rotY. Keep the tree if the position is inside terrain bounds, its distance to the nearest centerline point > (max `offsetMeters` over all barriers) + 15, and density roll < `biome.density`.
4. Species by cumulative weights (normalised). `scale = 0.85 + 0.3·r`; `rotY = r·2π`. Instance data is the flat `[x, z, scale, rotY]` per tree. Stop at 6000 trees total.
5. Return one `TreeInstances` per species with at least one tree, in biome order. Use a spatial grid for the distance check.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | square track, terrain 2 km, biome density 0.5 | `placeTrees` twice with the same id | identical output (deterministic) |
| AT2 | same | every tree | distance to centerline > max barrier offset + 15 m; inside terrain bounds |
| AT3 | density 0 / density 1 | count | 0 / ≤ 6000 and > 0 |
| AT4 | weights oak 0.5 ash 0.5, 2000+ trees | species split | each 50 % ±8 % |
| AT5 | any | instance data | flat [x, z, scale, rotY] with scale in [0.85, 1.15], rotY in [0, 2π) |

## Acceptance criteria

- [ ] Acceptance tests pass; same input gives byte-identical output.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Terrain height of trees (done at render time), species presets, rendering.
