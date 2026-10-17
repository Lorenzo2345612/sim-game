# 185 — Barrier colours, wall band and configurable catch fence from the track style

Status: pending
Phase: 1
Depends on: 180
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`style.barriers` recolours armco, wall, tyres and foam, adds an optional wall band, and makes the catch fence configurable (height, barrier types, colour, per-range height). Default style reproduces today's output exactly.

## Context

Design: `docs/design/track-style.md` (File `barriers`, Limits). Types: `ResolvedTrackStyle`, `DEFAULT_TRACK_STYLE`, `segmentOverride(ranges, seg, pointCount)` from `src/track/trackStyle.ts` (179). Colours are sRGB hex; `THREE.Color.set(hex)` converts to linear. Today the fence is built only inside the armco branch (3 m, 1 m behind the rail line). `BarrierVertex` (`src/track/barrierPath.ts`) carries `index` and `type`. Guides: `ai/guides/testing.md`.

## Files

- `src/render/barrierRenderer.ts` — modify
- `src/render/barrierProfiles.ts` — modify only if a constant moves (`FENCE_HEIGHT` stays the default 3)
- `tests/unit/acceptance/185-barrier-fence-style.test.ts` — acceptance worker creates

## Steps

Signature (existing `BarrierObject` gains no field; the metric is on `group.userData`):

```ts
createBarrierObject(track: TrackDataV2, loadTexture?: (url: string) => THREE.Texture, style?: ResolvedTrackStyle): BarrierObject
// group.userData.fenceMeters: number
```

1. Colours (null/undefined = today's value): armco material colour = `barriers.armco.color`; wall material colour (`createSurfaceMaterial('concrete')`) = `concrete.color`; tyre instance colour B = `tyres.beltColor` (colour A stays 0.9 grey; instances still alternate A, B); foam uses `foam.colors` (2 entries) cycling by block count instead of the 3 defaults; mesh names for custom foam: `foamA`, `foamB` (default names unchanged).
2. Wall band: when `concrete.bandColor` is set and wall spans exist, one mesh `wallBand` (plain `MeshStandardMaterial`, that colour, `DoubleSide`) covering only wall spans: a vertical strip on the track-facing face, from 0.35 to 0.65 m above the path (height 0.3 m), pushed 0.01 m toward the track. Disposed with the rest.
3. Fence is no longer tied to armco. Per path vertex, fence height = `segmentOverride(barriers.ranges, {start: v.index, end: v.index, side}, pointCount)?.fenceHeightMeters` if a range matches, else `fence.heightMeters` when the vertex's span type is in `fence.types`, else 0. Each path edge (k-1, k) is its own quad (4 own vertices) with the height of vertex k; edges of height 0 are skipped. Quad base y = path y, offset 1 m behind the rail line as today, uv v = height / 3 (u as today). Fence of every type uses the same single `fence` mesh/material; the mesh is created only if it has ≥ 1 quad (texture loads included). Material colour = `fence.color` when set (map/alphaMap/alphaTest as today).
4. `group.userData.fenceMeters` = total horizontal length of fence quads (sum of path-edge lengths with height > 0), 0 when none. Default style: armco length only, as today.
5. Colliders are untouched: no import from `src/physics`.

Conventions: closed whole-lap runs keep the closing edge; ranges use `rangeContains` semantics of 179 (inclusive, wrapping); `style` undefined = DEFAULT; style never mutated.

## Planner-authorised test edits (decision 185-coder)

- `tests/unit/acceptance/185-barrier-fence-style.test.ts` AT1 (lines 89-90: 190 < x < 210), AT2 and AT4 (`toBeLessThanOrEqual(2)` → `10`); `tests/unit/edge/185-barrier-fence-style.test.ts` EDGE2 (`toBeLessThanOrEqual(1)` → `10`). Keep the metric = sum of path-edge lengths. Nothing else.
- Delete `scratch-debug185.ts` before finishing.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture: STRAIGHT with barriers `[{0,20,left,armco,8},{30,50,left,wall,8},{60,80,right,tyres,8},{85,95,right,foam,8}]` (STRAIGHT: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, flat elevation, pit `{start: 10, end: 30, side: 'right'}`).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | DEFAULT style | `createBarrierObject(track, load, style)` | mesh `fence` exists; `userData.fenceMeters` = armco length only (200 ± 10; the closed-loop seam lengthens the first path edge); fence height 3 m (bbox Y extent above rail base 3 ± 0.01) |
| AT2 | fence `{heightMeters: 5, types: ['armco', 'wall']}` | create | fenceMeters = 400 ± 10; fence top 5 m above each barrier base (±0.01) |
| AT3 | fence `{heightMeters: 0}` | create | no `fence` mesh; fenceMeters 0 |
| AT4 | DEFAULT fence; ranges `[{start: 60, end: 80, side: 'right', fenceHeightMeters: 4}]` | create | fenceMeters = 200 + 200 (±10): tyres segment gets a 4 m fence even though tyres is not in types |
| AT5 | ranges `[{start: 0, end: 20, side: 'left', fenceHeightMeters: 0}]` | create | fenceMeters 0 (armco fence removed there) |
| AT6 | fence color `'#2e8b57'` | create | fence material colour `#2e8b57` |
| AT7 | concrete `{color: '#dadada', bandColor: '#dac400'}` | create | wall material colour `#dadada`; a mesh `wallBand` exists with colour `#dac400`, height 0.3 ± 0.01, along the 200 m wall only |
| AT8 | armco `{color: '#9aa0a6'}` | create | armco material colour `#9aa0a6` |
| AT9 | tyres `{beltColor: '#1f4fbf'}` | create | tyre instance colours alternate the existing white with `#1f4fbf` (linear ±1e-3) instead of red |
| AT10 | foam `{colors: ['#d0432d', '#dadada']}` | create | foam blocks use only those two colours, both present |
| AT11 | DEFAULT style | create with and without style | identical mesh names, counts, colours, instance counts |
| AT12 | physics | barrier colliders before/after any style | identical (fence and band are render only) |

## Acceptance criteria

- [ ] Every AT row passes; tests 038, 083, 086, 103, 141 and `tests/unit/render/barrierRenderer.test.ts` pass unchanged (default children stay `['armco','armcoPosts','fence']` for an armco-only track).
- [ ] `dispose()` disposes every new geometry/material; `wallBand` and fence colours do not leak textures.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Fence/barrier colliders and physics; barrier geometry, offsets or profiles other than the fence and band.
- Kerb, run-off, pit and grandstand styling (182, 183); floodlights and props (186, 187).
- Editing `main.ts` or any `public/tracks/*.style.json`.
