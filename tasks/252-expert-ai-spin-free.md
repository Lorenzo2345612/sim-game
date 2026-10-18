# 252 — Expert AI drives spin-free on monza and spa

Status: pending
Phase: 2
Depends on: 225, 254
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

The expert AI (and easy/medium) never spins in the opening 60 s on monza, spa and silverstone, while keeping its pace ordering.

## Context

225 landed `AI_GRIP_MARGIN = 0.82` and a stability aid (throttle scaling on rear slip angle / yaw error), but expert still spins on monza/spa. The cause is unknown: diagnose first, then fix where the cause is.

## Files

- Probe script: scripted, NOT committed, not under `tests/`. Output goes only in the report.
- Fix, only in: `src/ai/aiDriver.ts`, `src/ai/speedProfile.ts`, `src/ai/racingLine.ts`, `src/ai/traffic.ts`, `src/game/raceGame.ts` (AI wiring). Max ~3 files in the end.
- Not allowed: vehicle physics, tyre model, car data, the `AI_GRIP_MARGIN` value (0.82), 088/089/092/093/225 frozen tests.
- `tests/unit/acceptance/252-expert-ai-spin-free.test.ts` — create (acceptance worker).

## Steps

1. Diagnose with one probe: monza and spa, 1 expert AI, seed 1, 60 s after go (setup as in 225). Per tick near any spin log: tick index, speed, target speed, throttle, brake, steer, rear slip angle, yaw rate. At most 2 probe runs per track.
2. Report in the final report: spin location (lap metres), phase (braking / turn-in / apex / exit) and cause.
3. Fix the cause in the allowed files only (e.g. target speed, brake point, steering/throttle limits). Minimal change; add a unit test for the changed logic.
4. Budget: at most 4 full runs of the 252 acceptance file. If AT1–AT4 still fail, report BLOCKED with the probe numbers and per-run results.

Definitions (same as 225): "spin" = at any tick after go, the angle between the car's forward vector (−Z rotated by its quaternion, projected on XZ) and the track tangent at its `TrackProgress` index exceeds 60°. Distance = sum of horizontal displacement per tick after go. Setup: `RaceGame.create(track, spec, { trackId, carId, laps: 3, aiCount, difficulty, seed })`, default car spec of the 093 tests, player braking 1 throughout; AIs start at index 1 in `getStates`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, 1 AI, difficulty `expert`, seed 1 | step 60 s sim after go | AI never spins (225's spin definition); AI distance > 1500 m |
| AT2 | spa, 1 AI, difficulty `expert`, seed 1 | step 60 s sim after go | AI never spins; AI distance > 1500 m |
| AT3 | monza, 1 AI, seed 1, `easy`, `medium`, `expert` (separate games) | step 45 s after go | none spins; easy < medium < expert distance |
| AT4 | silverstone, 3 AI expert, seeds 1–3 | step 60 s after go | no AI spins |
| AT5 | spa, 1 AI, seed 1, `easy` and `expert` (separate games) | step 45 s after go | easy distance < expert distance (from 225 EDGE4) |

Existing tests that must still pass: 088, 089, 092, 093, 225 acceptance and edge tests.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Vehicle physics, tyre model, car data, changing `AI_GRIP_MARGIN`, mistakes per lap, overtaking logic, HUD, committing the probe.

## Planner answers (coder timeout)

- Required: AT1–AT5 plus every existing test. The 3-AI traffic spin is in scope, because AT4 covers it.
- Do not change the blocker/alongside priority in `traffic.ts`: 090 POST10 stays frozen. Revert that change, and fix the spin in the driver instead (steer and throttle limits while a car is alongside or close ahead, in `aiDriver.ts`).
- Tester-pre EDGE6/7/9: the expert cases are required, and the easy/medium cases are advisory (not required to pass).
- 249 AT3 and 250 AT9 failures are known and unrelated; ignore them.

## Planner answers (coder timeout, round 2)

- Scope cut: AT4 (silverstone, 3 AI traffic) moves to task 273. 252 = AT1, AT2, AT3, AT5 plus existing tests. Single-AI spins only; do not run silverstone or multi-AI probes.
- Authorised test edit: in `tests/unit/acceptance/252-expert-ai-spin-free.test.ts` change only the AT4 case to `it.skip` with the comment `// moved to task 273`. No other acceptance edits.
- Time budget: the probe limit in Steps (2 runs per track) is hard. If AT1/AT2 still fail after 2 fix attempts, stop and write the report (BLOCKED, probe numbers, per-run results) before minute 30.
- Merge leftovers: if the worktree has conflict markers or stray probe files from earlier runs, delete the probe files and resolve markers first; do not re-run old probes.

## Merge note (planner, 2026-10-18)

Master gained task 270 (neural driver v2) which also edits `src/ai/aiDriver.ts` and `src/game/raceGame.ts`. The planner replayed the branch onto master in the worktree (backup: `backup/252-pre-rebase`); 252 changes are applied uncommitted and both files have conflict blocks. Do not run git commands. Keep both sides: 270's neural-driver code paths unchanged and 252's expert spin-free logic applied to the rule-based driver. Remove all markers and re-run Verification, including the 270 and 225 tests.
