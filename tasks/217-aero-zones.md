# 217 — Active-aero zones from the centerline

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure function that derives straight-line active-aero zones from a closed track centerline, plus a lookup by lap distance.

## Context

Centerline format: `TrackData.centerline` in `src/core/types.ts` (closed, [x, z] metres, ~2 m spacing, last point not repeated). Pure module: no `three`. Existing helper `cumulativeLengths(centerline, true)` in `src/track/centerline.ts` may be reused (returns cumulative lengths, total at index n). Reference (planner probe): Monza 5 zones covering ~53 % of the lap; Budapest 1; every track in `public/tracks/index.json` >= 1.

## Files

- `src/track/aeroZones.ts` — create
- `tests/unit/acceptance/217-aero-zones.test.ts` — create (acceptance worker)

## Steps

1. Export:
```ts
export interface AeroZone { start: number; end: number } // metres along the closed centerline; 0 <= start < L; start < end <= start + L
export const AERO_ZONE_WINDOW_M = 50; export const AERO_ZONE_MAX_CURVATURE = 1 / 800; export const AERO_ZONE_MIN_LENGTH_M = 300;
export function deriveAeroZones(centerline: [number, number][]): AeroZone[];
export function inAeroZone(zones: readonly AeroZone[], d: number, lapLength: number): boolean;
```
2. Cumulative arc length s_i, L = total (closed). Point i is straight when |dtheta| / AERO_ZONE_WINDOW_M < AERO_ZONE_MAX_CURVATURE, where dtheta (wrapped to (-pi, pi]) = heading of the segment starting at the point nearest arc s_i + 25 minus heading of the segment starting at the point nearest s_i - 25 (arc positions circular). "Nearest" = the point with the smallest circular arc distance; on an exact tie take the point with the larger arc position (the later one along the lap).
3. Zones = maximal circular runs of straight points whose run length (s_last - s_first, circular) >= AERO_ZONE_MIN_LENGTH_M; start = s_first, end = start + run length. All points straight → `[{ start: 0, end: L }]`. Sorted by start; a run wrapping the line keeps start < L and end > L.
4. `inAeroZone`: d taken modulo L (positive modulo); true when (d - start) mod L <= end - start for some zone. Empty zones → false.

Conventions: run length boundary inclusive (`>= 300`); straight test strict (`<`); `inAeroZone` boundaries inclusive at both ends; fewer than 3 points → `[]`; input not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/217-aero-zones.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | stadium: two 1000 m straights joined by R = 200 m semicircles, 2 m spacing, index 0 at the middle of a straight | derive | exactly 2 zones; each `end − start` in [960, 1000]; `inAeroZone(z, 0, L)` and `inAeroZone(z, L − 1, L)` true; at the middle of each semicircle false |
| AT2 | circle R = 150 m, 2 m spacing | derive | `[]` |
| AT3 | circle R = 1000 m, 2 m spacing | derive | one zone {start 0, end L} (±1e-6) |
| AT4 | `public/tracks/monza.json` centerline | derive | 4–6 zones; sum of lengths / L in [0.45, 0.62]; every zone length ≥ 300 |
| AT5 | every id in `public/tracks/index.json` | derive | ≥ 1 zone; zones sorted, non-overlapping, 0 ≤ start < L, end ≤ start + L |
| AT6 | zones `[{start: 900, end: 1100}]`, L 1000 | `inAeroZone` at d 950, 50, 100, 101, 500, −50, 2050 | true, true, true, false, false, true, true |
| AT7 | source | read file | no `three` import |

## Acceptance criteria

- [ ] Acceptance table passes.
- [ ] No `three` import.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Using zones in Game/vehicle (219), rendering zones, per-track manual overrides.
