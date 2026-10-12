# 007 — Build the track ribbon geometry

Status: pending
Phase: 0
Depends on: 004
Roles: coder, tester, reviewer

## Goal

`buildRibbon` turns a closed centerline into a constant-width mesh (positions, indices, uvs) with no `three` dependency.

## Context

Axes: `ai/guides/architecture.md` (Y up, north = -Z, east = +X). `Point2` = `[x, z]` from `./geo`. The `track` layer does not import `three`; render (task 013) wraps this in a `BufferGeometry`. Relative imports without extension. Minimal code comments.

## Files

- `src/track/ribbon.ts` — create
- `tests/unit/track/ribbon.test.ts` — create

## Steps

```ts
import type { Point2 } from './geo';
export interface RibbonGeometry { positions: Float32Array; indices: Uint32Array; uvs: Float32Array; vertexCount: number }
export function buildRibbon(centerline: Point2[], width: number, y: number): RibbonGeometry;
```

`N = centerline.length` (closed curve, last point NOT repeating the first). If `N < 3` throw `Error('buildRibbon: need at least 3 points')`. For each point `i`:

1. `d = normalize(P[(i+1)%N] - P[(i-1+N)%N])` (x,z). If its length < 1e-9 use `d = (0, -1)`.
2. `right = (-d.z, d.x)` (for `d=(0,-1)` gives `(1,0)`).
3. `L_i = P_i - right * width/2`; `R_i = P_i + right * width/2`.
4. Vertex `2i` = `L_i`, vertex `2i+1` = `R_i`, positions `(x, y, z)`.
5. uv: left `u=0`, right `u=1`; `v = s_i / width`, `s_i` = cumulative centerline distance to `P_i` (`s_0 = 0`). Both vertices of a pair share `v`.

Indices: for each `i` in `0..N-1`, `j = (i+1)%N` (segment `N-1 → 0` included), 6 indices `[2i, 2i+1, 2j, 2i+1, 2j+1, 2j]` (normals face +Y, verified).

Output sizes: `positions.length = N*6`, `uvs.length = N*4`, `indices.length = N*6`, `vertexCount = 2N`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/007-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | circle r = 100, N = 100 points | `buildRibbon(c, 12, 0.02)` | vertexCount 200; positions.length 600; indices.length 600; uvs.length 400 |
| AT2 | same | every triangle | normal (cross product) y > 0 |
| AT3 | same | for each i | distance(L_i, R_i) = 12 ±1e-4; every vertex y = 0.02 |
| AT4 | loop [[0,0],[0,−100],[10,−100],[10,0]] (index 0 heads ≈ −Z) | `buildRibbon(loop, 12, 0)` | vertex 0 (left) x < vertex 1 (right) x (right = +X when facing −Z) |
| AT5 | same | indices | every index < vertexCount; closing segment (N−1 → 0) present |

## Acceptance criteria

Tests in `tests/unit/track/ribbon.test.ts` with a square `[[0,0],[0,-100],[100,-100],[100,0]]` and a circle r=100, 64 points (`[100cos a, -100 sin a]`, `a = 2πk/64`):

- [ ] `sizes match` for N=4 and N=64: `positions.length === N*6`, `indices.length === N*6`, `uvs.length === N*4`, `vertexCount === 2*N`.
- [ ] `all triangles face up`: per triangle `(a,b,c)`, `u=b-a`, `w=c-a`, `u.z*w.x - u.x*w.z > 0` (both shapes).
- [ ] `left and right vertices are width apart`: 3D distance between vertices `2i` and `2i+1` equals `width` (12) ±1e-6.
- [ ] `all vertices have the requested y`: `y = 0.05` → `toBeCloseTo(0.05, 6)`.
- [ ] `right vertex is east of left on the first square segment`: vertex 1 x > vertex 0 x.
- [ ] `indices are valid and close the loop`: every index < `vertexCount`; the triangles of the closing segment (`N-1 -> 0`) are present.
- [ ] `uv u is 0 on left and 1 on right, v starts at 0 and increases` (pair 1 v > pair 0 v).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Normals, kerbs, textures, variable width, seamless `v` at the seam.
- Importing `three` or creating `BufferGeometry` (task 013).
- Any other export.
