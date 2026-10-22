# 346 — Ladder lap-time calibration

Status: pending
Phase: 7
Depends on: 344, 345
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

f4 < ow3 < ow2 < ow26 hold with the real-world lap-time ratios on the same layouts, by tuning the ow3/ow2 JSON (EST fields only).

## Context

Design: `docs/design/ow-ladder.md`. Targets (research 1.2): ow3/ow2 pole ratio 1.047-1.062; ow2 = ow26 x 1.17-1.19 (re-anchor on the sim `ow26`); f4 slower than ow3 by 4-8 %. Quasi-steady lap estimate: sum(ds / v) over `speedProfile(line, carLimitsFromSpec(spec, fuelKg))` (`src/ai/speedProfile.ts`) on `monza` and `spielberg`. Tune only EST fields (aero coefficients, tyre widths, gear ratios, torque shape below the power peak); power peaks, limiters, DRS scales and ow3 mass stay. Planner decision: `ow2` `massKg` may drop 795 -> 740 only here, and only if the ratio is otherwise unreachable; then update the number in `tests/unit/acceptance/345-ow2-car.test.ts` AT1 (numbers only, authorised) and report. Use skill `physics-lab` if needed.

## Files

- `tests/unit/acceptance/346-ow-ladder-calibration.test.ts` — create (acceptance worker)
- `tests/unit/calibration/ow-ladder.test.ts` — create: lap-estimate helper and final tuned numbers in a comment
- `public/cars/ow3.json`, `public/cars/ow2.json` — modify (tuning only)
- `tests/unit/acceptance/345-ow2-car.test.ts` — modify only if the 740 fallback is used (AT1 mass number)

## Steps

1. Helper in the test computes lap time estimate per car/track with fuel start mass.
2. Tune JSON until all ATs hold on both tracks while 344/345 acceptance bands stay green; record final numbers in the test comment.

Conventions: ratios are lap(slower) / lap(faster); tolerance bands, not point values.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/346-ow-ladder-calibration.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | monza and spielberg, f4 / ow3 / ow2 / ow26 estimates | order | strictly f4 > ow3 > ow2 > ow26 on both |
| AT2 | same | ow3 / ow2 lap ratio | 1.03-1.08 |
| AT3 | same | f4 / ow3 lap ratio | 1.03-1.10 |
| AT4 | same | ow2 / ow26 lap ratio | 1.10-1.25 |

## Acceptance criteria

- [ ] All ATs pass; tuning limited to EST fields (diff in the commit); 344 and 345 suites still green.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run tests/unit/acceptance/346- tests/unit/calibration/ow-ladder.test.ts tests/unit/acceptance/344- tests/unit/acceptance/345-
```

## Out of scope

- AI racecraft retune, DRS effect on lap times, new tracks.
