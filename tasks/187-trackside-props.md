# 187 — Generic trackside props from the track style

Status: pending
Phase: 1
Depends on: 180
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`style.props` places simple procedural primitives (footbridge, marshal post, tent, scoreboard, billboard row, tower) beside or over the track. Generic shapes only: no text, no logo, no texture.

## Context

Design: `docs/design/track-style.md` (File `props`, Limits: ≤ 60). Types: `ResolvedTrackStyle`, props entries `{type, index, side, offsetMeters, lengthMeters, heightMeters, color: string | null}` (179 defaults: offset 10, length 10, height 4, color null) from `src/track/trackStyle.ts`. 186 created the main.ts wiring pattern and exported `rightNormalAt` from `src/track/barrierPath.ts`; right normal = `(-dz, dx)` (STRAIGHT: right = +z). Offsets are measured from the track edge (`widthMeters/2`). `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js` may be used.

## Files

- `src/render/trackProps.ts` — create
- `src/main.ts` — modify (add to scene and `disposables`; `SceneStats.props`)
- `tests/unit/acceptance/187-trackside-props.test.ts`, `tests/e2e/acceptance/187-trackside-props.spec.ts` — acceptance worker creates

## Steps

```ts
import type { TrackDataV2 } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';
export interface TrackPropsObject { group: THREE.Group; dispose(): void }
export function createTrackProps(track: TrackDataV2, style: ResolvedTrackStyle): TrackPropsObject | null;
// group.name 'trackProps'; group.userData: { placed: number; skipped: number }
```

1. `style.props` empty returns null.
2. Placement frame: tangent = central difference at `index` (wrapping), L = along tangent, D = outward normal of `side` (`left`/`right`), base y = `track.elevation[index]`. Each prop's footprint spans D in [0, depth]; its D = 0 face sits at `widthMeters/2 + offsetMeters` from the centerline point; centred on L = 0. Shapes (boxes/cylinders, L × D × H metres), `len` = lengthMeters, `h` = heightMeters:
   - `marshalPost`: booth 2 × 2 × 2.4 plus roof slab 2.6 × 2.6 × 0.15 on top (len/h ignored).
   - `tent`: body len × 6 × 0.6h plus gable roof prism (6 m base, rise 0.4h) on top.
   - `scoreboard`: two legs 0.5 × 0.5 × h at the ends of a panel len × 0.5 × 0.4h whose top is at h.
   - `billboardRow`: ceil(len / 8) boards 6 × 0.2 × 2.5 at y 1.5..4, spacing 8 m along L, each on two 0.2 × 0.2 × 1.5 posts.
   - `tower`: column 3 × 3 × h plus cabin 4 × 4 × 2.5 above it (len ignored).
   - `footbridge` (centred on the centerline, spans across, ignores `side`/`offsetMeters`): deck 3 m wide along L, 0.6 m thick, bottom at y = `h`, length across = max(`len`, `widthMeters` + 4); two piers 1 × 1 × h at the deck ends; two rails 1 m high on the deck edges.
3. Skip (count in `userData.skipped`, not built) any non-footbridge prop with a footprint ground corner closer than `widthMeters/2` (strict `<`, tolerance 1e-6) to any centerline point.
4. Colour = `color` or grey `#9a9ea3`. Merge all props sharing the same type and colour into one mesh named `prop:<type>` (one `MeshStandardMaterial`, `color` set from the hex, no maps). `userData.placed` = built props. `dispose()` is idempotent, disposes all geometries and materials.
5. `main.ts`: after floodlights, `const props = createTrackProps(track, style)`; add and push to `disposables` if non-null. `SceneStats.props: number` = `userData.placed` or 0. Nothing per frame.

Conventions: metres, `<` for the skip distance, props never mutate `style`, ties keep input order.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge (`widthMeters/2`), not the centerline. Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | props `[]` | `createTrackProps(STRAIGHT, style)` | null |
| AT2 | `{type: 'footbridge', index: 50, lengthMeters: 30, heightMeters: 6, color: '#2e8b57'}` | create | one child named `prop:footbridge`; spans the track: its bbox covers z from < -6 to > +6 at x = 500 ± 1; lowest deck point ≥ elevation + 5.5 (clear of cars); colour `#2e8b57` |
| AT3 | `{type: 'marshalPost', index: 20, side: 'right', offsetMeters: 8}` | create | `prop:marshalPost` centre at x 200 ± 1, z between 6 + 8 - 1 and 6 + 8 + 3 (outside the edge) |
| AT4 | each of `tent`, `scoreboard`, `billboardRow`, `tower` beside the track (offset 10, side left) | create | one named child per prop; none intersects the asphalt (every bbox corner at least widthMeters/2 m from every centerline point, footbridge excepted) |
| AT5 | `billboardRow` length 40 | inspect | it carries no text texture: materials have no `map` or a plain colour map only |
| AT6 | prop with `index` on a hairpin such that the offset lands on the other leg | create | that prop is skipped and `userData.skipped` counts it |
| AT7 | 60 props: 20 tents, 20 marshalPosts, 20 billboardRows, each type with one of 2 colours | create | ≤ 12 draw objects (props of the same type and colour are instanced or merged) |
| AT8 | dispose | `dispose()` | all geometries and materials disposed |
| AT9 | e2e monza with a footbridge route style | `__SIMGAME__.sceneStats().props` | 1; without: 0 |

## Acceptance criteria

- [ ] Every AT row passes; empty `props` leaves the scene unchanged.
- [ ] No text, canvas texture or image map in `src/render/trackProps.ts`.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 187-
```

## Out of scope

- Named landmarks, branded or lettered signs, street walls/lamps (156-160), animation, collision with the car.
- Floodlights (186), barrier/pit styling, any `public/tracks/*.style.json`.
