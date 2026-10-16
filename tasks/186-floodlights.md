# 186 — Floodlight poles along the track from the track style

Status: pending
Phase: 1
Depends on: 180, 182, 184
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

When `style.floodlights` is non-null, instanced poles (and arms) with light heads stand along the chosen track ranges, outside the track. Geometry only: no light sources, no emissive (night mode is M2.2b).

## Context

Design: `docs/design/track-style.md` (File `floodlights`, Out of scope). Types: `ResolvedTrackStyle` (`style.floodlights: {style, heightMeters, heads, spacingMeters, offsetMeters, side, ranges} | null`) from `src/track/trackStyle.ts` (179); the style loaded in `main.ts` comes from 180. Right normal = `(-dz, dx)` of the central-difference tangent (STRAIGHT: right = +z, left = -z). Base height: the terrain height at the pole's XZ (bilinear sample of `track.terrain`, same convention as `terrainY` in `src/render/pitAndStart.ts`; export and reuse it) when `track.terrain` exists, else `track.elevation` linearly interpolated at the arc position. `halfWidthAt(track, side, index)` is in `src/track/surfaces.ts`. Offsets are measured from the track edge.

## Files

- `src/render/floodlights.ts` — create
- `src/render/pitAndStart.ts` — modify (only add `export` to `terrainY`; 182 also edits this file, hence the dependency)
- `src/track/barrierPath.ts` — modify (only add `export` to `rightNormalAt`)
- `src/main.ts` — modify (add to scene and `disposables`; `SceneStats.floodlights`)
- `tests/unit/acceptance/186-floodlights.test.ts`, `tests/e2e/acceptance/186-floodlights.spec.ts` — acceptance worker creates

## Steps

```ts
import type { TrackDataV2 } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';
export interface FloodlightsObject { group: THREE.Group; dispose(): void }
export function createFloodlights(track: TrackDataV2, style: ResolvedTrackStyle): FloodlightsObject | null;
// group.name 'floodlights'; group.userData: { poles: number; heads: number }
```

1. `style.floodlights === null` returns null.
2. Walk each range (empty `ranges` = whole lap) over centerline indices `start..end` forward, wrapping; the polyline length L sums consecutive point distances (no closing chord, except the whole-lap walk which closes back to index 0). Poles at arc positions `k × spacingMeters`, k = 0..floor(L / spacing) for a range (inclusive) and `k × spacing < L` for the whole lap. Ranges are independent; counts add.
3. `side` `left` or `right` gives one pole per position, `both` gives one on each side. Pole base = centerline point at that arc position + side normal × (`halfWidthAt(track, side, nearest index)` + `offsetMeters`).
4. Skip any pole whose base is closer than `track.widthMeters / 2 + 1` m (strict `<`) to any centerline point. `userData.poles` counts the kept poles.
5. Geometry (shared `MeshStandardMaterial` greys, `castShadow` false): pole = cylinder radius 0.15 m, height `heightMeters`, base at the base height above. Style `arm`: also a horizontal 2.5 m arm box (0.15 × 0.15 m section) at the pole top pointing toward the track, heads at the arm end. Style `mast`: heads at the pole top. Heads: box 0.6 × 0.3 × 0.4 m, `heads` per pole in a row along the tangent, 0.7 m apart, centred; `userData.heads` = kept poles × `heads`. One `InstancedMesh` each for poles, heads and (arm style only) arms: at most 3 draw objects.
6. `dispose()` is idempotent and disposes all geometries and materials.
7. `main.ts`: after the barriers, `const fl = createFloodlights(track, style)`; if non-null add `fl.group` to the scene and push it to `disposables`. `SceneStats.floodlights: number` = `userData.poles` or 0. Nothing is added to the per-frame loop.

Conventions: positions in metres, `<` for the skip distance, sides `left`/`right` as in `Side`, style never mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | floodlights null | `createFloodlights(STRAIGHT, style)` | returns null |
| AT2 | `{spacingMeters: 20, side: 'left', heightMeters: 8, offsetMeters: 6, ranges: [{start: 0, end: 99}]}` on STRAIGHT (range walks indices forward, 990 m, no closing chord) | create | `userData.poles` = floor(990 / 20) + 1 = 50; every pole base at z = -(6 + 6) ± 0.01 (left, halfWidth 6 + offset 6); pole tops at elevation + 8 ± 0.01 |
| AT3 | as AT2 with side 'both' | create | poles 100; half at z ≈ -12, half at z ≈ +12 |
| AT4 | ranges `[{start: 0, end: 49}]`, spacing 20, side 'left' | create | poles only at x ≤ 490; count 25 ± 1 |
| AT5 | heads 6, style 'mast', heightMeters 30 | create | `userData.heads` = poles × 6; head meshes are instanced (≤ 3 draw objects total in the group) |
| AT6 | any pole | placement | no pole within `widthMeters/2 + 1` m of any centerline point (checked against all points, so poles never stand on a hairpin's other leg); poles that would violate it are skipped |
| AT7 | terrain present | create on monza with a floodlight style | every pole base y within 0.5 m of the terrain/elevation at its position |
| AT8 | dispose | call returned `dispose()` | all geometries and materials disposed |
| AT9 | e2e `?track=monza`, route style `{"version":1,"floodlights":{"spacingMeters":40}}` | `__SIMGAME__.sceneStats().floodlights` | > 0; without the route: 0 |
| AT10 | no allocations per frame | source | floodlights add nothing to the per-frame loop (static meshes only) |

## Acceptance criteria

- [ ] Every AT row passes; default style (floodlights null) changes nothing in the scene.
- [ ] `src/render/floodlights.ts` imports `three` only for rendering and has no per-frame code.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 186-
```

## Out of scope

- Light sources, emissive materials, glow, shadows from lights, night mode (M2.2b).
- Props (187), barrier or pit styling, any `public/tracks/*.style.json`.
