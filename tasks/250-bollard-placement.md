# 250 — Bollard placement

Status: pending
Phase: 1
Depends on: 248
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 3")

## Goal

The builder places groups of 3 breakable bollards after sausages, on the inside of ~90° corners and at corners with wide inner run-off, and writes them to track JSON `bollards`. All tracks are rebuilt.

## Context

Depends on 248 only to serialise JSON rebuilds. Rebuild with `npm run build:tracks` (regenerates every `public/tracks/<id>.json` listed in `public/tracks/index.json`); only `bollards` may be added. Runtime behaviour is task 251. Run-offs, barriers and sausages passed in are the final built lists.

## Files

- `src/core/types.ts` — modify: add `Bollard`, `TrackDataV2.bollards?`.
- `src/track/parseTrackData.ts` — modify: default `bollards` to `[]` for v2.
- `tools/track-builder/bollards.ts` — create: `buildBollards`.
- `tools/track-builder/sausages.ts` — modify: only add `export` to the existing `arcLength` and `apexIndex`.
- `tools/track-builder/buildTrack.ts` — modify: call `buildBollards` after sausages and barriers, write `data.bollards`.
- `public/tracks/*.json` — regenerate.
- `tests/unit/acceptance/250-bollard-placement.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
// src/core/types.ts
export interface Bollard { x: number; z: number; index: number; side: Side }
// TrackDataV2: bollards?: Bollard[]
// tools/track-builder/bollards.ts
import type { Bollard, BarrierSegment, RunoffSegment, Sausage } from '../../src/core/types';
export function buildBollards(
  points: Point2[], halfWidths: { left: number[]; right: number[] } | undefined,
  sausages: Sausage[], runoffs: RunoffSegment[], barriers: BarrierSegment[],
): Bollard[]
```
`Point2` as in `tools/track-builder/corners.ts`. `halfWidths` undefined ⇒ half width 6 m everywhere (tests only). `buildTrack.ts` always passes arrays: `parallel.halfLeft/halfRight` when `parallel.any`, else arrays filled with `config.widthMeters / 2`.
1. Groups of 3, each bollard at `lateral` metres along the right normal `(−dz, dx)` of the segment containing its arc position (right = +1, left = −1) from the linearly interpolated centerline point; `index` = nearest centerline index; `side` as below.
2. R1, after every sausage (auto and override): same side, lateral = `sausage.offset`, arc positions `end + 2, end + 4, end + 6` m, `end` = arc position of `sausage.index` + `length/2` (downstream, increasing index, wrapping).
3. R2, every run of `detectCorners(points)` with 60° ≤ θ ≤ 120° and `minRadius ≤ 40`: inner side (`run.side`), lateral `half + KERB_WIDTH + 1.0`, arc positions apex − 4, apex, apex + 4 (apex = exported `apexIndex(radii(points), run, n)`; θ per the design definition: absolute sum of signed heading changes from `run.start` to `run.end`).
4. R3, every run (any θ) with a runoff of `side === run.side` covering the apex index (ranges may wrap) and `widthMeters ≥ 10`: same group as R2.
5. At most one R2/R3 group per run; skip it when an R1 bollard of the same side lies within 15 m arc of the apex.
6. Drop a single bollard if: lateral ≥ 0.8·`radii(points)[index]` (inner side only); or `clearance < halfNear + KERB_WIDTH + 0.5`; or lateral > (`offsetMeters` of the inner-side barrier covering `index`) − 0.5 (no barrier ⇒ no drop). `clearance`/`halfNear` as in the design's wave 2 definitions; `KERB_WIDTH` imported as `sausages.ts` does.
7. Output sorted by arc position of `index`, ties by side; deterministic.

Conventions: metres; arc positions wrap modulo lap length (closing edge included); θ bounds and `minRadius ≤ 40` inclusive; inputs not mutated; `n < 3` ⇒ `[]`; no `three` import.

## Fixtures (tests)

`STADIUM(R)`: closed loop, width 12, flat, no terrain; straight (0,0)→(200,0) every 2 m (endpoint excluded); semicircle centred (200,−R) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m; straight back to (0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0); every bend a left turn (inside = left). `BOX(R)`: closed loop, width 12, flat; start (0,0) heading +x: straight to (200,0) every 2 m; quarter circle centre (200,−R); straight to (200+R, −R−200); quarter circle centre (200, −R−200); straight to (0, −2R−200); quarter circle centre (0, −R−200); straight to (−R, −R); quarter circle centre (0, −R) back to (0,0); m = max(6, ceil(π·R/2)) points per quarter at angles π/2·j/m; left turns, 4 corners θ = 90°. No runoffs/barriers/sausages unless the row adds them. "Built track" = `public/tracks/<id>.json` for every id in `public/tracks/index.json`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `BOX(20)` | buildBollards | 12 bollards, all `left`; per corner 3, the middle one at distance 20 − 8.2 = 11.8 ± 0.3 from the corner centre; outer two 4 ± 0.3 m arc (along the centerline) from it |
| AT2 | `STADIUM(30)` | build | 0 bollards (θ = 180°, no runoff, no sausage) |
| AT3 | `STADIUM(30)` + left runoff covering bend 1, width 12 | build | 3 bollards, all `left`, within 10 m arc of bend 1 apex; none near bend 2 |
| AT4 | same with width 8 | build | 0 bollards |
| AT5 | `STADIUM(30)` + left sausage `{index: apex of bend 1, offset 7.8, length 10}` | build | 3 bollards at lateral 7.8 ± 0.05 from the nearest centerline point, arc positions apex + 7, + 9, + 11 m (± 0.5) |
| AT6 | `BOX(20)` + left sausage at corner 1 apex (offset 7.8, length 10) | build | 12 bollards: corner 1 has only the sausage group (3, lateral 7.8 ± 0.05), corners 2–4 the R2 groups |
| AT7 | `BOX(7)` | build | 0 bollards (0.8·7 = 5.6 < 8.2) |
| AT8 | every built track | read `bollards` | every bollard `clearance ≥ halfNear + KERB_WIDTH + 0.5 − 1e-6`; total over all tracks > 0; at least 10 tracks have ≥ 1 |
| AT9 | rebuilt JSONs vs pre-task | deep compare | only `bollards` added |
| AT10 | `parseTrackData` on a JSON without `bollards` | parse | `bollards` = `[]` |

## Acceptance criteria

- [ ] AT1–AT10 pass; `npm run build:tracks` leaves only `bollards` added in every JSON.
- [ ] Only the test edits listed below.

## Existing tests that must still pass

All current tests (`npm test`) except the authorised edits below.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Runtime knock-over, rendering and collisions (251); any change to sausage, kerb, barrier or run-off rules; bollards on straights; QA report checks.

## Planner-authorised test edits

- Per-id sweep tests or JSON byte-hash / sha256 tests (e.g. `tests/unit/edge/211-fontana-roval-edge.test.ts` EDGE6, `tests/unit/acceptance/241-ermita-tracks.test.ts` AT4 hashes if that file exists) that fail only because `bollards` was added may be updated to the new values (`sha256sum public/tracks/<id>.json`, or ignore the `bollards` key in deep compares). Nothing else may be edited; list each edit in the report.

## Planner answers (round 1)
- EDGE8 in `tests/unit/edge/250-bollard-placement-edge.test.ts` is inconsistent with the spec (end = sausage index arc + length/2). Authorised edit: in EDGE8 change the sausage `length: 10` to `length: 6` (so `+ 3` is length/2); no other edge-test change. The implementation follows the spec and AT5.
