# 267 — Learned vs racecraft evaluation and difficulty gate

Status: pending
Phase: 2
Depends on: 266
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Measure the learned policy against racecraft and use it for hard/expert AIs only when the measurement approves it.

## Context

Depends on 266 (`Policy`, `PolicyNet`, `parsePolicy`, `LearnedDriver`) and transitively 263/262. Uses `RaceGame.carFrame`/`corridor`/`lapLength` hooks of 263. `public/ai/policy.json` is the shipped policy; its `approved` flag is edited manually after `learnedEnabled` is true.

## Files

- `src/ai/learnedGate.ts` — create.
- `src/game/raceGame.ts` — modify — driver selection only.
- `tools/rl/eval.ts` — create.
- `tests/unit/acceptance/267-learned-eval-gate.test.ts` — create (acceptance worker).

## Steps

1. `learnedGate.ts` exports:
```ts
export interface ControllerStats { bestLap: number; meanLap: number; contacts: number; positionChanges: number }
export interface EvalReport { learned: Record<string, ControllerStats>; racecraft: Record<string, ControllerStats> }
export type PolicyLoader = () => Promise<Policy | null>
export function learnedEnabled(report: EvalReport): boolean
export function shouldUseLearned(policy: Policy | null, difficulty: Difficulty): boolean
export const browserPolicyLoader: PolicyLoader
```
2. `learnedEnabled`: true only when `racecraft` has at least one track and for every track in `racecraft` the `learned` entry exists, all its numbers are finite, `learned.bestLap <= racecraft.bestLap` and `learned.contacts <= racecraft.contacts` (non-strict). Otherwise false.
3. `shouldUseLearned`: policy not null, `policy.approved === true`, difficulty `hard` or `expert`. `browserPolicyLoader`: `fetch('/ai/policy.json')` -> `parsePolicy`; any failure (no fetch, HTTP error, invalid JSON) resolves `null`.
4. RaceGame: `RaceConfig` gains optional `policyLoader?: PolicyLoader` (default `browserPolicyLoader`) and `controller?: 'auto' | 'racecraft' | 'learned'` (default `'auto'`). In `create`: `'auto'` loads the policy and uses learned for all AI cars iff `shouldUseLearned`; `'racecraft'` never; `'learned'` always (loader null -> throw), ignoring `approved` and difficulty. Learned cars use one `LearnedDriver` each, bound to a shared `frames: CarFrame[]` refreshed in place every tick before the drivers run; racecraft is unchanged otherwise. Add `aiDriverKind(carIndex: number): 'racecraft' | 'learned'`. Without these options behaviour is identical to today.
5. `eval.ts`: `npx tsx tools/rl/eval.ts --policy <file> --tracks monza,spa,suzuka --cars 8 --laps 3` (defaults as shown). For each track and each controller (`learned`, `racecraft`; difficulty expert, car f4, seed 1, normal grid start, no scenario) simulate until `raceFinished` or 600 s, then compute: `bestLap` = min of `bestLap` over cars, `meanLap` = mean of each car's `bestLap`, `contacts` = `contactCount`, `positionChanges` = number of `position` decreases summed over cars sampled each 1 s of sim time. A car with no completed lap counts as 600. Print one `EvalReport` as JSON on stdout; exit 0.

## Acceptance tests (defined by the planner with Opus, before coding)

`tools/rl/eval.ts --policy <file> --tracks monza,spa,suzuka --cars 8 --laps 3` prints a JSON report per controller (best lap, mean lap, contacts, position changes).


| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | fixture policy, `--tracks monza --laps 1 --cars 2` | run | exit 0; JSON has `learned` and `racecraft` blocks with finite numbers |
| AT2 | `learnedEnabled(report)` | learned best lap ≤ racecraft and contacts ≤ racecraft on every track | true; any track worse → false |
| AT3 | `public/ai/policy.json` with approved true, difficulty hard/expert | RaceGame.create | AI drivers are `LearnedDriver` |
| AT4 | approved false, missing file, or easy/medium | create | racecraft drivers |

## Acceptance criteria

- [ ] All AT rows pass; existing RaceGame tests unchanged.
- [ ] Missing `public/ai/policy.json` never throws in `RaceGame.create` with `controller: 'auto'`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Flipping `approved` automatically, UI changes, shipping a trained policy, per-difficulty tuning of the learned driver, retraining.
