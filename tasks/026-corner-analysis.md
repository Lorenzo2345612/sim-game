# 026 — Detect radii, kerbs and run-offs

Status: pending
Phase: 1
Depends on: 022
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

From a closed centerline compute corner radii and derive kerb and run-off segments.

## Context

Rules in `ai/guides/phase1.md` "Builder rules": Radius per point, Kerbs, Run-offs; constants `CORNER_RADIUS`, `KERB_RADIUS` in `src/core/constants.ts`; types `TrackSegment`, `RunoffSegment`, `Side` in `src/core/types.ts` (task 022). Points are `[x, z]` metres, ~2 m spacing, closed (last not repeated), indices circular. Segment `end` is inclusive and segments may wrap (`end < start`), never split at index 0.

## Files

- `tools/track-builder/corners.ts` — create
- `tests/unit/acceptance/026-corner-analysis.test.ts` — create by the acceptance role

## Steps

1. Exports:
```ts
import type { Point2 } from '../../src/track/geo';
import type { TrackSegment, RunoffSegment } from '../../src/core/types';
export function radii(points: Point2[]): number[];
export function detectKerbs(points: Point2[]): TrackSegment[];
export function detectRunoffs(points: Point2[]): RunoffSegment[];
```
2. `radii`: circumradius of points i−5, i, i+5 (circular); collinear (area ≈ 0) → `1e6`; cap at `1e6`.
3. Turning side at i: `cross = (p[i]-p[i-5]).x·(p[i+5]-p[i]).z − (p[i]-p[i-5]).z·(p[i+5]-p[i]).x`; `cross < 0` = left turn, `> 0` = right turn (map view: east +X, north −Z). Inside = turning side, outside = opposite.
4. Corner runs: maximal circular runs of consecutive points with the same turning side and radius below the threshold (`KERB_RADIUS` for kerbs, `CORNER_RADIUS` for run-offs). If every point qualifies, treat as one run starting at the first non-qualifying boundary or index 0.
5. Kerbs: per run (length ≥ 8 before extension), inside kerb = run extended 10 points each way, side = inside; plus exit kerb on the outside = last 15 points of the (extended) run. Sorted by `start`.
6. Run-offs: per run (no minimum length), extended 15 points each way, side = outside; if the minimum radius of the run < 150 → `surface 'gravel'`, `widthMeters 18`; else `surface 'runoff'`, `widthMeters 12`.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | circle r = 100 m, 2 m spacing, counter-clockwise | `radii(points)` | every value 100 ±1 |
| AT2 | straight segment (collinear points) | radius | 1e6 |
| AT3 | closed loop: 400 m straight, 180° turn r = 80 m, 400 m straight, 180° turn r = 80 m | `detectKerbs` | 2 inside kerb runs (side = turning side) covering each turn ±12 points + 2 exit kerbs on the outside of 15 points |
| AT4 | same loop | `detectRunoffs` | 2 gravel segments of 18 m on the outside of each turn (radius < 150), extended 15 points |
| AT5 | same loop with r = 300 m turns | `detectRunoffs` | 2 `runoff` (asphalt) segments of 12 m, no kerbs (300 > KERB_RADIUS) |
| AT6 | loop crossing index 0 inside a turn | kerb segment | wraps (`end < start`) instead of being split in two |

## Acceptance criteria

- [ ] Acceptance tests pass; pure TypeScript, no `three`, no Node APIs.
- [ ] Indices always in `[0, N)`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Barriers (027), writing JSON, tuning thresholds, rendering.
