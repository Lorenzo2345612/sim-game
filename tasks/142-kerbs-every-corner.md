# 142 — Kerbs on every corner with entry/exit extensions

Status: pending
Phase: 1
Depends on: 098
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Every corner of every track has kerbs: inside the full corner plus a few metres before and after, and outside at the exit (and at the entry of tight corners). Today only corners with radius < 250 m get kerbs, 10 points before/after.

## Context

M1.2c, design in `docs/plans/m1.2c-realism.md` ("142–143"). Runs come from the existing private `analyze(points, CORNER_RADIUS)` / `cornerRuns` in `tools/track-builder/corners.ts` (`Run { start, end, side, minRadius }`, `side` = turn side = inside). `KERB_RADIUS` stays in `constants.ts` (pinned by task 022 tests) but `detectKerbs` stops using it. Sample spacing is ~2 m; every offset below is a centerline INDEX offset, not metres. Task 140 later adds a dependency on this one. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `tools/track-builder/corners.ts` — modify: rewrite `detectKerbs` only (remove the `KERB_RADIUS` import and `MIN_KERB_RUN`).
- `public/tracks/*.json` — regenerate with `npm run build:tracks` for ALL ten ids in `tools/track-builder/tracks.json` (monza, spa, silverstone, mexico, daytona, lusail, bahrain, braselton, elkhart, sepang). Kerbs also change barrier offsets, trees and terrain; that is expected.
- `tests/unit/acceptance/142-kerbs-every-corner.test.ts` — create (acceptance worker).
- Minimal planner-authorised edits to existing tests that fail only because of the new kerb rule: `tests/unit/acceptance/026-corner-analysis.test.ts` (AT3 stadium r = 80 now gives inside + entry + exit per turn; the "300 > KERB_RADIUS → 0 kerbs" case now has kerbs), `tests/unit/edge/026-corner-analysis.post.test.ts` (R 260 / R 248 / R 252 / 7-vs-8-point / all-qualifying-loop / rose / stadium expectations; update its `specKerbs` helper to the new rule), `tests/unit/acceptance/098-osm-runoffs.test.ts` (AT5: drop `'kerbs'` from the identical-keys list). Then run `npm test`, fix only other tests that fail because of the regenerated kerbs, and list every edit in the report. Never weaken a non-kerb assertion.

## Steps

```ts
export function detectKerbs(points: Point2[]): TrackSegment[]; // signature unchanged; TrackSegment from src/core/types.ts
```

1. For every corner run with `minRadius < CORNER_RADIUS` (400, already the `analyze` threshold) and at least 4 points (`wrap(end − start, n) + 1 ≥ 4`):
   - inside kerb (side = run.side): `[start − 15, end + 15]`;
   - outside exit kerb (side = opposite): `[end − 5, end + 20]`;
   - outside entry kerb (side = opposite): `[start − 20, start + 5]`, only when `minRadius < 150`.
2. Per side, merge kerbs that overlap or touch (next.start ≤ prev.end + 1, cyclically, including across index 0). A merged or single kerb covering ≥ n indices becomes `{ start: 0, end: n − 1 }`.
3. Output sorted by `start` ascending (ties: left before right); wrapped segments (`end < start`) keep their original `start`.
4. `buildTrack.ts` is unchanged: it already feeds `detectKerbs` output to `detectRunoffs` and `layoutBarriers`.

Conventions: indices use positive modulo; bounds inclusive; thresholds strict (`< 400`, `< 150`, run length `≥ 4`); empty input or n < 3 returns `[]`; input not mutated; no randomness.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rounded square: 4 straights 600 m + 4 arcs R 300 (90°), spacing 2 m | detectKerbs | 8 kerbs: per arc an inside kerb [start − 15, end + 15] and an outside kerb [end − 5, end + 20] (± 1 index); no outside entry kerb |
| AT2 | same with arcs R 30 | detectKerbs | 12 kerbs: per arc inside [start − 15, end + 15], outside entry [start − 20, start + 5], outside exit [end − 5, end + 20] (± 1) |
| AT3 | same with arcs R 500 | detectKerbs | [] |
| AT4 | two same-side kerbs [10, 30] and [31, 50] produced by adjacent runs | detectKerbs | merged into one [10, 50] |
| AT5 | rebuilt monza/spa/silverstone | read | every corner run (Rmin < 400, ≥ 4 points) has an inside kerb covering [start − 15, end + 15]; kerb count ≥ the previous JSON's; centerline, elevation and pit identical to the previous JSON |

## Acceptance criteria

- [ ] AT1–AT5 pass.
- [ ] All ten `public/tracks/*.json` regenerated without error; centerline, elevation and pit unchanged for all ten.
- [ ] `grep -n KERB_RADIUS tools/track-builder/corners.ts` returns nothing; `constants.ts` still exports it.
- [ ] `npm test` fully green after the authorised test edits; each edit listed in the report.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Run-off, barrier, tree or terrain rules (only their inputs change); paved run-offs/foam/escape roads (140).
- Removing `KERB_RADIUS`, changing `KERB_WIDTH`, kerb rendering or surface grip.
- Editing `tools/track-builder/tracks.json`, README, tasks.json, milestones.json.
