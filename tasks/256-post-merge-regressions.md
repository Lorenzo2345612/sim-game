# 256 — Fix two test failures on master after the 247 merge

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: coder, reviewer

## Goal

`npm test` passes on master again: a stale snapshot test is removed and the hard AI no longer loses distance on monza.

## Context

- Commit 812516a (task 247) legitimately rebuilt the track JSON, so the pre-253 snapshot hash in 253 AT6 is stale by design.
- `tests/unit/edge/225-ai-grip-margin.test.ts` EDGE3 (monza, 45 s after go, distance medium < hard < expert) fails: medium 1384.3 m vs hard 1281.4 m. It passed when 225 merged, before 247 changed monza sausages.

## Files

- `tests/unit/acceptance/253-runoff-flag-colours.test.ts` — modify — delete the AT6 `it(...)` block and any helpers/constants/imports only it uses. Planner-authorised; touch nothing else in the file.
- `src/ai/*` — modify — fix for the hard AI (at most 3 files).
- A temporary probe script outside `src/` and `tests/` — create, then delete before finishing.

## Steps

1. Delete AT6 as described above.
2. Probe why the hard AI is slower than medium on monza at 45 s (spin, sausage contact, off-track recovery, line/target choice).
3. Fix in `src/ai/` only (e.g. sausage avoidance in line/target selection, or the hard tier's grip margin). Do not change expert behaviour beyond what the fix needs.
4. Delete the probe script.

Conventions: not applicable (no new numeric API).

## Acceptance tests (defined by the planner with Opus, before coding)

No new test file; rows reference existing tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | master after the change | `npx vitest run tests/unit/acceptance/253-runoff-flag-colours.test.ts` | passes, no AT6 test present |
| AT2 | — | — | moved to task 268 (225 EDGE3 is a symptom of the AI barrier/off-track regression) |
| AT3 | | `tests/unit/acceptance/225-*.test.ts` and `tests/unit/acceptance/247-*.test.ts` | pass |

## Acceptance criteria

- [ ] AT1–AT3 pass.
- [ ] Full `npm test` passes except the known flaky 224 POST4.
- [ ] No probe script left in the repo.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Editing `tests/unit/edge/225-ai-grip-margin.test.ts`, track JSON or sausage placement.
- Task 252 work (expert spin-free).
- Any other test edit besides deleting 253 AT6.

## Planner answers (round 2)

- 225 EDGE3 is out of scope here: root cause measured by the planner (AI runs wide at Parabolica, wheel rays climb the armco, car flips); fixed in task 268. Do not edit `src/ai` or 225 tests. Finish with AT1 (done) and AT3; report EDGE3 as expected-failing, owned by 268.

## Planner answers (round 3)

- Authorised: delete the AT2 test block in `tests/unit/acceptance/256-post-merge-regressions.test.ts` (the 225 edge-suite assertion); nothing else in that file. 256 is then done with AT1 + AT3.
