# 257 — Drop the stale track-hash test in 243

Status: pending
Phase: 1
Depends on: 243
Complexity: simple
Type: bugfix
Models: standard
Roles: coder, reviewer

## Goal

`tests/unit/acceptance/243-arroyo-bridges.test.ts` AT9 compares non-ermita track JSON with `MASTER_HASHES` recorded before the 247 rebuild, so it fails on master by design. Remove it.

## Files

- `tests/unit/acceptance/243-arroyo-bridges.test.ts` — modify — delete the AT9 `it(...)` block and the `MASTER_HASHES` constant and imports only it uses. Planner-authorised; touch nothing else.

## Steps

1. Delete AT9 as above.
2. Run the file and `npm run typecheck`, `npm run lint`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | master after the change | `npx vitest run tests/unit/acceptance/243-arroyo-bridges.test.ts` | passes; no AT9 present; AT1–AT8 and AT10 unchanged |

## Acceptance criteria

- [ ] AT1 passes; typecheck and lint pass.

## Verification

```
npx vitest run tests/unit/acceptance/243-arroyo-bridges.test.ts
npm run typecheck
npm run lint
```

## Out of scope

- Any other file or test (253 AT6 and 225 EDGE3 are task 256).
