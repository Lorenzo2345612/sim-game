# 273 — Expert AI spin-free in 3-car traffic (silverstone)

Status: pending
Phase: 2
Depends on: 252
Complexity: complex
Type: bugfix
Models: heavy
Roles: coder, reviewer

## Goal

Split from 252 (AT4): three expert AIs never spin in the opening 60 s on silverstone.

## Context

252 fixes single-AI spins in `src/ai/aiDriver.ts`. Here the remaining spins happen with cars alongside or close ahead. 090 POST10 (blocker/alongside priority in `traffic.ts`) is frozen; fix in the driver (steer/throttle limits while a car is alongside or close ahead).

## Files

- Fix, only in: `src/ai/aiDriver.ts`, `src/ai/speedProfile.ts`, `src/game/raceGame.ts` (AI wiring).
- `tests/unit/acceptance/252-expert-ai-spin-free.test.ts` — the coder removes the `it.skip` on AT4 (the `// moved to task 273` case); no other acceptance edits.
- Not allowed: vehicle physics, tyre model, car data, `AI_GRIP_MARGIN` (0.82), `traffic.ts` priority logic, 088/089/090/092/093/225/252 frozen tests.

## Steps

1. Probe (not committed): silverstone, 3 expert AIs, seeds 1–3, 60 s; log tick, car, speed, steer, throttle, rear slip, nearest car gap/lateral near each spin. At most 3 probe runs.
2. Fix in the driver; minimal change; unit test for the changed logic.
3. Budget: at most 4 runs of the 252 acceptance file; then report BLOCKED with the numbers. Write the report before minute 30.

Definitions and setup: as in 252.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT4 | silverstone, 3 AI expert, seeds 1–3 | step 60 s after go | no AI spins (252 AT4, un-skipped) |

Existing tests that must still pass: 088, 089, 090, 092, 093, 225, 252.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Physics, tyres, car data, overtaking logic, `traffic.ts` priorities.

Also un-skip 252 edge EDGE6 and EDGE9 (silverstone easy/medium traffic) — they must pass.

## Planner answers (round 1)

Planner-verified on your worktree: AT4 (expert) passes; only 252 EDGE6 and EDGE9 (easy/medium traffic) fail. EDGE6/EDGE9 are split out of this task: keep them `it.skip` with the comment `// split from 273, follow-up task` (planner-authorised; restore the skip if you removed it). Do no more probing. Run only `npx vitest run tests/unit/acceptance/252- tests/unit/edge/252- tests/unit/ai/`, typecheck and lint, then write the report.
