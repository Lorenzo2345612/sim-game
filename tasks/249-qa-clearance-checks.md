# 249 — QA report: clearance checks

Status: pending
Phase: 1
Depends on: 237, 245, 246, 247, 248
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 2")

## Goal

`qaReport` gains four checks, `kerb`, `barrier-fold`, `sausage` and `pit-clear`, that measure the clearance rules of tasks 245–248 and fail on violation.

## Context

Extends `tools/track-qa/report.ts` (task 237; read its current code: `qaReport`, `QaReport`, `QaCheck`, CLI, footprint sampling and the `buildTrackSurfaces` point-in-triangle test already exist). Uses `buildTrackSurfaces`, `barrierRuns`, `sausagePieces` (247), `pitBuildingPieces` (236/248). Definitions: `R(i)` = `cornerCurvature(centerline, i).radius` (`src/track/surfaces.ts`); `inner(i, side)` = that corner's `side` equals `side`; `half(side, i)` = `halfWidthAt(track, side, i)`; `clearance(p)` = XZ distance from p to the nearest centerline sample point (any index); `halfNear(p)` = min of both half-widths at that nearest index. No `three` imports.

## Files

- `tools/track-qa/report.ts` — modify: new metrics and checks.
- `tests/unit/acceptance/249-qa-clearance-checks.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
export interface ClearanceMetric { worst: number; atMeters: number }   // atMeters = arc length along the lap of the nearest centerline index to the worst item
// QaReport gains:
clearance: { kerb: ClearanceMetric | null; barrierFold: ClearanceMetric | null; sausage: ClearanceMetric | null; pitClear: { overlapSamples: number; barrierVertices: number; atMeters: number | null } }
```
1. `kerb`: over all kerb strips of `buildTrackSurfaces`, `worst` = min over triangle centroids of `clearance − (halfNear − 0.3)` (245 AT5 metric). `barrier-fold`: min over non-median `barrierRuns` vertices (both sides) of `clearance − (halfNear + KERB_WIDTH + 0.5)` (246 AT5). `sausage`: min over footprint samples of every `sausagePieces` piece (5 along the sausage arc × 3 across the 0.5 m width) of `clearance − (halfNear + KERB_WIDTH + 0.1)` (247 AT4). A metric is null when there are no items.
2. `pit-clear`: `overlapSamples` = pit-piece footprint samples (grid ≤ 2 m, edges included) inside a non-grass `buildTrackSurfaces` triangle (XZ, edge counts as inside); `barrierVertices` = `barrierRuns` vertices inside any pit-piece footprint rectangle (both sides). `atMeters` = lap position of the first offender, null when none.
3. Checks (always present, one each, names exactly `kerb`, `barrier-fold`, `sausage`, `pit-clear`): `fail` when the metric `worst < −1e-6` (or `overlapSamples + barrierVertices > 0`); otherwise `ok`. `detail` states the worst value and `atMeters`. CLI output and exit code follow 237 (any `fail` ⇒ exit 1).

Conventions: metres, no rounding; `< −1e-6` strict; empty items ⇒ `ok`; inputs not mutated; invalid input as 237.

## Fixtures (tests)

- `STADIUM(R)`: closed loop, width 12, flat elevation 0, no terrain, no runoffs/barriers/sausages/kerbs unless the row adds them. Straight A (0,0)→(200,0) every 2 m (endpoint excluded); semicircle centred (200,−R) from (200,0) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m, j = 0..m−1; straight B (200,−2R)→(0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0), same m. Every bend is a left turn (inside = left). Kerbs, when a row says "kerbs", cover every index on both sides.
- `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers/terrain, pit `{start: 10, end: 30, side: 'right'}`.
- AT2/AT1 `STADIUM` fixtures have `pit: {start: 0, end: 0, side: 'right'}`. "armco 12" = armco both sides offset 12 over every index.

## Planner answers (round 2)

EDGE6 typo confirmed (worst = offset − 0.25 − SAUSAGE_LIMIT, per its own first half). Planner-authorised edit, the only one: in `tests/unit/edge/249-qa-clearance-edge.test.ts` EDGE6 second fixture change `offset: SAUSAGE_LIMIT - 0.25` to `offset: SAUSAGE_LIMIT + 0.25`. Nothing else in that file. AT3 shipped-track violations (baku, ermita-*, sepang, cleveland) are reported only; the track-data fixes are a follow-up task, not here. POST4 timeout in 224 is pre-existing, ignore.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STADIUM(30)` + kerbs + a left sausage `{index: 0, offset 3, length 6}` (over the asphalt); `STRAIGHT` + right gravel runoff `{0..99, width 25}` (not clipped) | qaReport each | first: `sausage` check `fail`; second: `pit-clear` check `fail` |
| AT2 | `STADIUM(30)` + kerbs, armco 12, no sausages | qaReport | `kerb`, `barrier-fold`, `sausage`, `pit-clear` all `ok` |
| AT3 | CLI `npm run track:qa -- all` | run | no `fail` among these four checks on any track |

## Acceptance criteria

- [ ] AT1–AT3 pass; `npm run track:qa -- all` prints no `fail` for the four new checks.
- [ ] No protected test file edited.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Fixing any failing track; changing 245–248 rules; screenshots (238); an e2e run.

## Planner-authorised test edits

None identified. Existing 237 tests assert named checks (`stand`, `pit`, `layout`, `barrier`) only; the four new checks are additive. If a 237 test asserts an exact `checks` length, report it under Questions.

## Questions for the planner

- AT3 requires the rebuilt tracks of 247/248 to be clean; if a track still fails after those tasks, fix it by a follow-up, not in this task.
