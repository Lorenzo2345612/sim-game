# 027 — Lay out barriers

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Produce barrier segments for both sides of the whole lap, from kerb, run-off and pit data.

## Context

Rules in `ai/guides/phase1.md` "Builder rules" (Barriers) and constants (`KERB_WIDTH`, `VERGE_WIDTH`, `BARRIER_GAP`). Types `BarrierSegment`, `TrackSegment`, `RunoffSegment`, `PitLane` from `src/core/types.ts`. Segments are inclusive `[start, end]` and may wrap.

## Files

- `tools/track-builder/barriers.ts` — create
- `tests/unit/acceptance/027-barrier-layout.test.ts` — create by the acceptance role

## Steps

1. Export:
```ts
import type { Point2 } from '../../src/track/geo';
import type { BarrierSegment, TrackSegment, RunoffSegment, PitLane } from '../../src/core/types';
export function layoutBarriers(
  centerline: Point2[], widthMeters: number,
  kerbs: TrackSegment[], runoffs: RunoffSegment[], pit: PitLane,
): BarrierSegment[];
```
2. Per point and side: offset = `width/2 + (kerb on that side covers point ? KERB_WIDTH : 0) + (runoff on that side covers point ? runoff.widthMeters : VERGE_WIDTH) + BARRIER_GAP`; if several cover, take the maximum width. Round offset to the nearest 0.5 m.
3. Type per point and side: `wall` if the side equals `pit.side` and the index is in the pit range (wrap-aware); else `tyres` if a gravel runoff covers it; else `armco`.
4. Merge consecutive indices with equal type and offset into one segment. Do not merge across the index N−1→0 boundary. Output covers every index of each side exactly once, sorted by side then start.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | straight loop with no corners, width 12 | `layoutBarriers` | left and right armco at offset 6 + 4 + 1 = 11 m covering the whole lap |
| AT2 | gravel runoff 18 m on the right of indices 100–150 (+ kerb) | barriers | right side 100–150 is `tyres` at 6 + 1.2 + 18 + 1 = 26.2 → 26 m |
| AT3 | pit {start 10, end 60, side left} | barriers | left 10–60 is `wall` |
| AT4 | any input | segments | consecutive points with equal type and offset are merged; every index of each side covered exactly once |

## Acceptance criteria

- [ ] Acceptance tests pass; typecheck and lint clean.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering, colliders, trees, choosing pit/grandstand positions.
