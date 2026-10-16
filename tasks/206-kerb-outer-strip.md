# 206 — Painted strip outside the kerbs

Status: pending
Phase: 1
Depends on: 187
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A 0.6 m painted strip is drawn just outside each kerb when `style.kerbs.outerStrip` (or the matching kerb range's `outerStrip`) is set; with the default style nothing is added.

## Context

Design: `docs/design/track-style.md` (File `kerbs`). Types `ResolvedTrackStyle`, `segmentOverride` from `src/track/trackStyle.ts` (179). Main wiring pattern as in 186/187 (`disposables`, per-style builder). Kerb lateral extent today: from `halfWidthAt(track, side, i)` to `+ KERB_WIDTH` (`src/core/constants.ts`, 1.2 m); the kerb surface sits at `elevation[i] + KERB_Y`. Render only: no physics or surface change.

## Files

- `src/render/kerbOuterStrip.ts` — create
- `src/track/surfaces.ts` — modify: only `export const KERB_Y` (was private; same value 0.04)
- `src/main.ts` — modify (add to scene and `disposables`; `SceneStats.kerbOuterStripMeters`)
- `tests/unit/acceptance/206-kerb-outer-strip.test.ts`, `tests/e2e/acceptance/206-kerb-outer-strip.spec.ts` — acceptance worker creates

## Steps

```ts
import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';
export function createKerbOuterStrips(track: TrackDataV2, style: ResolvedTrackStyle): { group: THREE.Group; dispose(): void } | null;
// group.name 'kerbOuterStrips'; children are meshes named 'kerbOuterStrip', 'kerbOuterStrip:1', ...
// mesh.userData = { meters: number }; group.userData = { meters: number } (sum)
```

1. For each `track.kerbs[k]`, colour = `segmentOverride(style.kerbs.ranges, kerb, track.centerline.length)?.outerStrip ?? style.kerbs.outerStrip ?? null`. Null colour: segment skipped. Every colour null: return null.
2. Per segment build a ribbon over centerline indices `start..end` (wrapping, inclusive) on `kerb.side`: lateral from `halfWidthAt + KERB_WIDTH` to `+ 0.6` further, outward; y = `track.elevation[i] + KERB_Y`. Use the same side/normal convention as the kerb strips in `src/track/surfaces.ts`.
3. One mesh per distinct colour (lower-case hex), in first-appearance order, merged; `MeshStandardMaterial` with `color` = hex, `roughness` 0.9, `polygonOffset` true, factor/units -2/-2, no maps. `meters` = summed centreline arc length of the ribbons of that colour.
4. `dispose()` is idempotent and disposes every geometry and material.
5. `main.ts`: after the props, `const ko = createKerbOuterStrips(track, style)`; add `ko.group` and push to `disposables` if non-null. `SceneStats.kerbOuterStripMeters: number` = `group.userData.meters` or 0 (initial 0). Nothing per frame.

Conventions: metres; segment ends inclusive; inputs never mutated; default style returns null.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets (`offsetMeters`) are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | kerbs.outerStrip null and no range sets it | `createKerbOuterStrips(STRAIGHT + kerbs, style)` | null |
| AT2 | STRAIGHT, kerbs `[{0, 20, left}]`, kerbs.outerStrip `'#2e8b57'` | create | one mesh `kerbOuterStrip`; every vertex z in [-(6 + KERB_WIDTH + 0.6) - 0.01, -(6 + KERB_WIDTH) + 0.01] and x in [0 - 0.01, 200 + 0.01]; material colour `#2e8b57`; `userData.meters` 200 ± 1 |
| AT3 | kerbs `[{0, 20, left}, {40, 60, right}]`, outerStrip `'#2e8b57'`, range `{start: 35, end: 70, side: 'right', outerStrip: '#1f4fbf'}` | create | meshes `kerbOuterStrip` (`#2e8b57`, x 0..200, z < 0) and `kerbOuterStrip:1` (`#1f4fbf`, x 400..600, z > 0) |
| AT4 | outerStrip null, the AT3 range only | create | only the right-side strip, `userData.meters` 200 ± 1 |
| AT5 | AT2 with elevation 2 m everywhere | create | every vertex y in [2, 2.1] |
| AT6 | dispose | `dispose()` | geometries and materials disposed |
| AT7 | e2e `?track=budapest`, route style `{"version":1,"kerbs":{"outerStrip":"#2e8b57"}}` | `__SIMGAME__.sceneStats().kerbOuterStripMeters` | > 0; without the route 0 |

## Acceptance criteria

- [ ] All AT rows pass; existing tests stay green unedited (the `KERB_Y` export is additive).
- [ ] With `DEFAULT_TRACK_STYLE` the scene gains no object and `kerbOuterStripMeters` is 0.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 206-
```

## Out of scope

- Kerb stripe colours (183), edge lines, run-off paint, physics/grip changes, strips on pit or escape-road kerbs, per-circuit style files.
