# 258 — Frenet race view and track corridor

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure Frenet-frame helpers: car views, sorted neighbour query, a sampled track corridor, stop/off-track detection and braking-point lookup, for the racecraft AI (design: `docs/design/racing-ai-v2.md`, "Frenet view").

## Context

Simulation code: no `three` import, no allocation in per-tick functions (caller passes `out`). Units SI. `s` = `TrackProgress.distance`, `d` = `TrackProgress.lateral` (+ right). Types `TrackDataV2`: `src/core/types.ts`; `RacingLine`: `src/ai/racingLine.ts`; `halfWidthAt(track, 'left'|'right', i)`: `src/track/surfaces.ts`; `cumulativeLengths(points, true)`: `src/track/centerline.ts`; `mengerCurvature`: `src/ai/racingLine.ts`.

## Files

- `src/ai/raceView.ts` — create — everything below.
- `tests/unit/acceptance/258-race-view-corridor.test.ts` — created by the acceptance worker.

## Steps

Export exactly (types `CarView`, `Neighbour`, `TrackCorridor` as in the design doc, copied verbatim; `PlanBias` is defined here so 259 and 260 share it):

```ts
export interface CorridorSample { halfLeft: number; halfRight: number; lineD: number; profileV: number; curv: number }
export interface PlanBias { preferD: number | null; preferWeight: number; speedCap: number | null }
export interface BrakingPoint { distance: number; cornerSign: 1 | -1 }
export function collectNeighbours(self: CarView, others: readonly CarView[], lapLength: number, out: Neighbour[], ahead?: number, behind?: number): number;
export function buildCorridor(track: TrackDataV2, line: RacingLine, speeds: Float64Array, ds?: number): TrackCorridor;
export function corridorAt(c: TrackCorridor, s: number, out: CorridorSample): CorridorSample;
export class StopTracker { update(v: number, dt: number, afterGo: boolean): boolean; get stopped(): boolean }
export function isOffTrack(c: TrackCorridor, s: number, d: number): boolean;
export function brakingPoint(c: TrackCorridor, s: number, out?: BrakingPoint): BrakingPoint | null;
```

- `collectNeighbours`: `others` never contains self. gap = wrapped `s_o − s` into (−L/2, L/2]. Keep gap in (−behind, ahead]; defaults ahead 120, behind 60. Writes `out[i].car`/`.gap` in place (push a new `Neighbour` only if `out[i]` is undefined), sorted by |gap| ascending, ties by input order (stable insertion sort). Returns the count written; entries beyond are stale.
- `buildCorridor`: `ds` default 2; n = ceil(L / ds), L = closed centerline length. Sample k is at s = k·ds. Half widths from `halfWidthAt` at centerline indices, linearly interpolated over cumulative centerline length; `lineD` from `line.offsets` (same lateral sign as `TrackProgress`: + right); `profileV` from `speeds` (indexed like `line.points`); `curv` from `mengerCurvature` over the line, sign + for a right turn. Verify the sign and the offset sign with a test on a small fixture.
- `corridorAt`: linear interpolation, `s` wrapped with `((s % L) + L) % L`, last sample interpolates to sample 0.
- `StopTracker`: timer counts while `afterGo` and v < 3 m/s; any v ≥ 3 or `!afterGo` resets it to 0; `stopped` true when timer ≥ 1.0 − 1e-9. `update` returns `stopped`.
- `isOffTrack`: `d < −halfLeft − 0.3` or `d > halfRight + 0.3` (strict).
- `brakingPoint`: scan from `s` in `ds` steps up to 400 m; first s' with `profileV(s') < profileV(s) − 5` and `profileV(s'+ds) < profileV(s')`. `distance` = s' − s. `cornerSign` = sign of `curv` at the first local minimum of `profileV` after s' (0 counts as +1). Null if none. `out` reused if given.

Conventions: wrap by modulo on `lapLength`; boundaries as written above; non-finite input is not handled; `others` and corridor are never mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture C: synthetic `TrackCorridor`, lapLength 2000, ds 2, halfLeft = halfRight = 6, lineD 0, curv 0 except +0.02 for s ∈ [580, 620]; profileV 60 for s ≤ 500, linear to 20 at s 600, linear back to 60 at s 700, 60 after.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | lapLength 1000; self s 990; others s 10, 900, 500 | `collectNeighbours(self, others, 1000, out)` (ahead 120, behind 60) | returns 1; out[0].gap = 20 (±1e-9) |
| AT2 | self s 0; others with gaps +30, −10, +10, −50 | collect | order by \|gap\|: −10, +10 (input order on ties), +30, −50 |
| AT3 | a `TrackDataV2` fixture with per-index half-widths and a racing line | `buildCorridor(track, line, speeds)` | halfLeft/halfRight at sample k equal `halfWidthAt` at the matching centerline index (±1e-9 when ds matches the sample spacing); length n = ceil(L / ds) |
| AT4 | C | `corridorAt(C, s, out)` at s 3 and s 2003 | halfLeft equal; profileV at s 550 = 40 (±1e-9, linear interpolation); at s 1999 interpolates between the last sample and sample 0 |
| AT5 | `StopTracker` | v 2 for 0.99 s after go; then 0.02 s more; then v 4 one tick; v 2 before go for 5 s | false; true; false; false |
| AT6 | C, d = 6.31 / 6.29 / −6.31 | `isOffTrack(C, s 100, d)` | true / false / true |
| AT7 | C | `brakingPoint(C, 300)` and `brakingPoint(C, 100)` | {distance 214 ± 2, cornerSign +1}; null (beyond 400 m) |
| AT8 | source of the new files | read | no `from 'three'` |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/258-race-view-corridor.test.ts`.
- [ ] `src/ai/raceView.ts` imports nothing from `three`; `collectNeighbours`, `corridorAt`, `isOffTrack`, `brakingPoint` (with `out`), `StopTracker.update` allocate nothing.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Planner, intents, `RaceGame` changes, any edit to existing `src/` files.
