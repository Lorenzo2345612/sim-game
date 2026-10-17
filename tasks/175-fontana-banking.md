# 175 — Fontana banking data

Status: pending
Phase: 1
Depends on: 168, 174
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Fontana's oval-derived stretch is banked using the mechanism from 174, and the analysis is documented.

## Context

Auto Club Speedway real banking: turns 14 deg, front stretch 11 deg, back stretch 3 deg. The game course (`public/tracks/fontana.json`, 2426 m, "Fontana Inner") is the infield/roval layout: every curve in it has radius under 200 m, so no oval turn is used. Analysis of the built centerline (local radius from heading change over +-16 m): the only long low-curvature stretch with kink-free approaches is the front stretch, about 1792 m to 2240 m (heading +x, y ~ 55); other straights (256-464, 560-740, 880-1000, 1120-1230) are infield straights and are NOT banked. A back stretch cannot be identified with confidence and is not banked. Mechanism and `BankRange` type: task 174 (`tools/track-builder/banking.ts`).

## Files

- `tools/track-builder/tracks.json` — modify — add `banking` to the `fontana` entry.
- `public/tracks/fontana.json` — rebuild with the builder (only `bank` is added).
- Tests: `tests/unit/acceptance/175-fontana-banking.test.ts`, `tests/e2e/acceptance/175-fontana-banking.spec.ts`.

## Steps

1. Add to the fontana entry exactly: `"banking": [{ "fromMeters": 1830, "toMeters": 2210, "degrees": 11, "raisedSide": "right" }]` (counter-clockwise circuit, so the outside of the oval is the right side).
2. Rebuild fontana with the builder; no other registry field changes.
3. Turn and back-stretch ranges are intentionally absent; the AT1 rows for them are skipped.
4. Infield (must be 0): indices at 0..1770 m and 2250 m..end.

Conventions: meters along the centerline from index 0 (`lengthMeters`), as in 174; no code changes.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/175-fontana-banking.test.ts` (e2e row into `tests/e2e/acceptance/175-fontana-banking.spec.ts`) before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit: built fontana.json | max \|bank\| in the oval-turn ranges | in [13°, 15°]; front-stretch ranges in [10°, 12°]; back-stretch ranges in [2°, 4°] (rows for parts the course does not use are skipped) |
| AT2 | unit: built fontana.json | indices on the infield | bank = 0 |
| AT3 | e2e `/?track=fontana`, teleport to the middle of the most banked range | hold throttle 5 s sim | `surfaceUnderCar` 'asphalt' throughout, speed > 30 km/h |

Applicable here: AT1 only the front stretch 1830..2210 (indices at least 60 m inside); AT2 infield per Steps 4; AT3 teleports to index nearest 2020 m.

## Acceptance criteria

- [ ] `fontana.json` has `bank` with max 11 deg (+-1) on the front stretch and 0 elsewhere.
- [ ] Surfaces and terrain consistent (174 tests still pass).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 175-
```

## Out of scope

- Banking code (174), other tracks, oval turns and back stretch (not on this course), Cleveland and Detroit.

## Planner-authorised test edit (174 POST8)

`tests/unit/edge/174-bank-profile.post.test.ts` POST8: replace the single `daytona.json` skip with an allowlist `['daytona.json', 'fontana.json', 'fontana-roval.json']` of tracks allowed a non-zero bank (daytona must still have one); update the test title accordingly. Nothing else in that file.
