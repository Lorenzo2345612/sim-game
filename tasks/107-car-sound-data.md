# 107 — Car sound data

Status: pending
Phase: 1
Depends on: 058, 072
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Each car declares its engine sound parameters in its JSON; `parseCarSpec` exposes them with defaults.

## Context

M1.7 audio plan (`docs/plans/m1.7-audio.md`). Consumed later by tasks 108/109. `parseCarSpec` is in `src/physics/carSpec.ts` (helpers `pick`, `num`, `fail`).

## Files

- `src/physics/carSpec.ts` — modify — `CarSpec.sound` and parsing.
- `public/cars/f4.json`, `gt3-a.json`, `gt3-b.json`, `gt3-c.json` — modify — add `sound` block.
- `tests/unit/physics/carSoundSpec.test.ts` — create — edge tests.

## Steps

```ts
export interface CarSound { cylinders: number; exhaustLengthM: number; intakeMix: number; crackle: number }
// CarSpec gains (non-optional after parsing):  sound: CarSound
export const DEFAULT_CAR_SOUND: CarSound; // { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 }
```

- JSON `sound` block is optional; when absent `parseCarSpec` returns `DEFAULT_CAR_SOUND` (a copy). Missing individual fields inside a present block also take the default.
- Data (cylinders / exhaustLengthM / intakeMix / crackle): f4 4/1.0/0.35/0.1; gt3-a 8/1.4/0.25/0.5; gt3-b 6/1.1/0.3/0.4; gt3-c 8/1.5/0.2/0.6. Any other car JSON existing in `public/cars/` at implementation time and lacking `sound`: V8 values 8/1.4/0.25/0.5.
- Fix any `CarSpec` literal in existing tests/fixtures that fails typecheck by adding the default `sound`.

Conventions: `cylinders` must be an integer in 1..12 else throw (same `Invalid car spec: sound.cylinders ...` style via `fail`); `exhaustLengthM` in (0, 10]; `intakeMix` and `crackle` in [0, 1]; out of range or non-finite throws; no clamping.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/107-car-sound-data.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | parseCarSpec of f4.json / gt3-a.json | read `sound` | {4, 1.0, 0.35, 0.1} / {8, 1.4, 0.25, 0.5} |
| AT2 | a car JSON without `sound` | parseCarSpec | sound = {4, 1.2, 0.3, 0.2} |
| AT3 | `sound.cylinders` 0, 13 or non-integer | parseCarSpec | throws (valid 1..12 integer) |

## Acceptance criteria

- [ ] All AT rows pass; all 4 car JSONs carry the listed data.
- [ ] Extra tests: range errors for exhaustLengthM/intakeMix/crackle throw; partial block takes defaults.
- [ ] Existing tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Any audio code or use of the values (108/109); new cars; UI.
