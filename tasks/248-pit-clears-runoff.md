# 248 — Pit building clears run-off and the pit wall

Status: pending
Phase: 1
Depends on: 236, 247
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 2")

## Goal

Run-offs are removed beside the pit window (so the pit wall comes in to the verge) and the pit building sits behind the pit-side barrier. All tracks are rebuilt.

## Context

Audit `docs/research/track-audit-kerbs.md` §2. `pitBuildingPieces` is in `src/track/placement.ts` (task 236; read its current code, not only the spec). Rebuild with `npm run build:tracks`; only `runoffs`, `barriers` and fields derived from them in `buildTrack.ts` (`boards`, `trees`, `terrain`, `escapeRoads`) may change. `layoutBarriers` is unchanged.

## Files

- `tools/track-builder/pitRange.ts` — modify: add `clipRunoffsOutOfPit`.
- `tools/track-builder/buildTrack.ts` — modify: clip `runoffsFinal` before `layoutBarriers`.
- `src/track/placement.ts` — modify: `pitBuildingPieces` offset.
- `public/tracks/*.json` — regenerate.
- `tests/unit/acceptance/248-pit-clears-runoff.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
// tools/track-builder/pitRange.ts
export function clipRunoffsOutOfPit(runoffs: RunoffSegment[], centerline: Point2[], pit: PitLane, marginMeters: number): RunoffSegment[]
```
1. `clipRunoffsOutOfPit`: only runoffs with `side === pit.side` are clipped; the removed index set = indices whose arc distance from the pit window `pit.start..pit.end` (wrapping) is ≤ `marginMeters`, plus the window itself. Each clipped runoff becomes its maximal runs of kept indices (surface, width, side preserved, original order, each ≥ 1 index). Other side untouched. `pit.start === pit.end` ⇒ returns the input unchanged. `buildTrack.ts` calls it with margin 50 on `runoffsFinal` (after `stripParallel`, before `layoutBarriers`) and writes the clipped list to the JSON.
2. `pitBuildingPieces`: for every vertex index `i` of the pit polyline, the offset beyond the centerline is `max(halfWidthAt + EDGE_OFFSET, B(i) + 1)` where `B(i)` = max `offsetMeters` of `track.barriers` on `pit.side` covering `i` (none ⇒ the current value). Piece splitting, merging and everything else stay as in 236.

Conventions: arc distances along the closed polyline (closing edge included), `≤ marginMeters` inclusive; indices wrap modulo n; inputs not mutated; offsets in metres.

## Fixtures (tests)

- `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers/terrain, pit `{start: 10, end: 30, side: 'right'}`.
- "Every built track" = `public/tracks/<id>.json` for every id in `public/tracks/index.json`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT` + right gravel runoff `{0..99, width 25}` | the builder clip function | right runoffs cover exactly indices 0..4 and 36..99 |
| AT2 | AT1 output → `layoutBarriers` | right side over 10..30 | type `wall`, offset 11 |
| AT3 | `STRAIGHT` + right barrier offset 18 over 0..99 | `pitBuildingPieces` | every piece near face at distance ≥ 19 − 1e-6 from the centerline |
| AT4 | `STRAIGHT` + right barrier offset 8 | pitBuildingPieces | identical to the pre-change output |
| AT5 | every built track | pit pieces | no footprint sample (≤ 2 m grid) inside a non-grass `buildTrackSurfaces` triangle; no `barrierRuns` vertex with `index` in the pit window (`pit.start..pit.end`, wrap-aware) inside a footprint |
| AT6 | rebuilt JSONs vs pre-task | deep compare | only `runoffs`, `barriers` (and fields derived from them) differ |

## Acceptance criteria

- [ ] AT1–AT6 pass; `npm run build:tracks` changes only the allowed fields.
- [ ] Only the test edits listed above.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Pit lane geometry, `layoutBarriers`, runoff detection, pit-wall style, QA report (249).

## Planner-authorised test edits

- `tests/unit/acceptance/155-close-parallel.test.ts` AT5 and `tests/unit/acceptance/106-new-tracks-in-game.test.ts` AT5 (merge-base JSON comparison for monza, spa, silverstone): also delete `runoffs`, `trees` and `terrain` from both sides before comparing (derived from the new run-offs/barriers; `terrain.heights` is already blanked, the other terrain fields follow `maxBarrierOffset`).
- `tests/unit/edge/211-fontana-roval-edge.test.ts` EDGE6: replace the fontana sha256 with `sha256sum public/tracks/fontana.json` after the rebuild.
- 097 AT3 already ignores runoffs, barriers, trees: unchanged.

## Questions for the planner

- The design says offset "over the piece's indices"; the spec applies it per vertex before splitting (uniform near face is impossible otherwise at piece joints). Confirm.
- Tests that pin built runoffs/barriers of specific tracks (098, 140, 159, 173, style tests 190-205) may break; none verified. If one fails because of the new rule, report it here instead of editing.

## Planner answers

- Each piece is a straight box: its near-face offset = max of the per-vertex required offsets over the piece's vertices (steps at joints are fine).
- Authorised: an existing test that pins a built track's `runoffs`/`barriers` values inside a pit window (±50 m) may update those expected values to the rebuilt data; list each edit in the report. Any other failure: stop and report.

## Planner answers (AT5 cross-section barriers)

- AT5 now checks only barrier vertices whose `index` lies in the pit window (planner change). Barriers of other track sections crossing the building band (sepang 236–239, cleveland 625–627) are pre-existing data conflicts, out of scope here (logged for the 249 QA report). Authorised: in `tests/unit/acceptance/248-pit-clears-runoff.test.ts` AT5 filter the `barrierRuns` vertices to pit-window indices (wrap-aware); nothing else.
- Apply the already-authorised 155/106/211 edits.
