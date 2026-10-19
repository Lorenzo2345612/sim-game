# 287 — Decouple 269 POST9 from the published models
Status: pending
Phase: 2
Depends on: 269
Complexity: simple
Type: bugfix
Models: standard
Roles: coder, reviewer

## Goal
`tests/unit/edge/269-evolved-neural-driver.post.test.ts` POST9 compares the committed `public/ai-models/*/expert.json` with the fastest trainer model. The planner now publishes curated models by hand (judged in-game), so POST9 fails on master (`cleveland-f4 expert bestLap: expected 105.75… to be 93.82…`). Make POST9 test the export selection logic instead of the committed files.

## Files
- `tests/unit/edge/269-evolved-neural-driver.post.test.ts` — modify POST9 only (planner-authorised edit of a frozen test).
- `scripts/evolve/export-models.mts` — modify only if needed to accept an output directory (e.g. `--out <dir>`, default unchanged).

## Steps
1. POST9 runs the export into a temp dir (`mkdtempSync(os.tmpdir())`) and asserts the same selection rules against that output (fastest expert across `-racing`/`-mintime` dirs, whole difficulty set and `line` field from the winner). Remove the temp dir afterwards.
2. POST9 must not read anything under `public/ai-models/` (published models and difficulty sets are hand-curated; e.g. cleveland-f4 lists only expert).
3. Default behaviour of `export-models.mts` (no flag) unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | master with hand-published `public/ai-models/cleveland-f4/expert.json` (gen433) | `npx vitest run tests/unit/edge/269-evolved-neural-driver.post.test.ts` | all tests pass |
| AT2 | the run | `git status --short public/ai-models` | empty (POST9 writes nothing into `public/`) |

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/edge/269-evolved-neural-driver.post.test.ts
```

## Out of scope
- Other 269 tests, model training, the game's model loading.
