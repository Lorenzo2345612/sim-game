# NNN — Short title in imperative form

Status: pending | in progress | done | blocked
Phase: 0 | 1 | 2 | 3
Depends on: NNN, NNN (or "nothing")
Complexity: simple | complex
Type: feature | bugfix   (bugfix = heavy models from the first coder run)
Models: standard | heavy   (heavy = heavy coder/fixer from the first run; only for tasks known to be hard)
Roles: acceptance, coder, reviewer (complex adds tester-pre and tester)

## Goal

One or two sentences: what behavior exists at the end that does not exist today.

## Context

The minimum the worker needs to know and cannot deduce from the code: PRD decisions (cite the section), conventions, why it is done this way. Guides to read: `ai/guides/...`.

## Files

- `src/...` — create | modify — what goes in it
- `tests/...` — create — what it tests

## Steps

Behaviour and rules, not implementation: signatures, verified constants with units, edge cases. No function bodies; name standard algorithms instead of spelling them out. Whole spec ≤ 60 lines.

1. ...
2. ...

Conventions (mandatory for numeric/geometric code, one line each): rounding mode, boundary inclusivity (`<` vs `<=`), out-of-range and empty/invalid input (throw or clamp), tie-breaks, whether inputs are mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps (inputs a row omits must be optional there). The `acceptance` worker turns each row into `tests/unit/acceptance/NNN-<slug>.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | ... | ... | ... |

## Acceptance criteria

Verifiable by a test or a command. No "works well".

- [ ] ...
- [ ] ...

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Things the worker must NOT do even if they seem related.
