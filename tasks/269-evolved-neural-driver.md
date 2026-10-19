# 269 — Evolved neural AI opponents (opt-in, experimental)

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

AI opponents can be driven by the neuroevolution policies trained in `scripts/evolve`, selectable per race. The classic AI stays the default.

## Context

PRD M2.3: the learned AI replaces hard/expert only if it beats the classic AI; that gate is task 267, not here. Models live in `scripts/evolve/models/<track>-<car>/index.json` (+ genome files `{gen,nIn,track,car,raceLaps,raceTime,avgLap,bestLap,weights[]}`). Read `scripts/evolve/policy.mts` (MLP, tanh, `forward`, `padGenome`) and `scripts/evolve/worker.mts` (vProf build, `pointAt`, feature vector ~lines 160–200, `nearest()` traffic sensor, decision every 4 physics steps with inputs held, steer = out[0], throttle = max(out[1],0), brake = max(−out[1],0)). Task 268 edits `src/game/raceGame.ts` in parallel: keep the change there minimal.

## Files

- `src/ai/neuralPolicy.ts` — create (no `three`): `LOOK`, `PROD`, `N_BASE`, `N_NEAR`, `N_IN`, `N_HID`, `N_OUT`, `N_W`, `forward`, `padGenome` moved unchanged from `policy.mts`, plus `parseNeuralModel`.
- `src/ai/neuralFeatures.ts` — create (no `three`): feature extraction.
- `src/ai/neuralDriver.ts` — create: per-car driver.
- `scripts/evolve/policy.mts`, `scripts/evolve/worker.mts` — modify: import from the new modules (policy.mts keeps `randomGenome`, `gauss`, `mulberry32` and re-exports the moved names so `evolve.mts` works). Training behaviour must not change.
- `scripts/evolve/export-models.mts` — create; `package.json` script `export-ai-models`; generated `public/ai-models/**` committed.
- `src/game/raceGame.ts` — modify (driver selection point only); race-setup menu in `src/ui` — modify (toggle).
- Tests: `tests/unit/acceptance/269-evolved-neural-driver.test.ts`, `tests/e2e/acceptance/269-evolved-neural-driver.spec.ts`; edge tests by tester-pre/tester.

## Steps

```ts
export function parseNeuralModel(json: unknown): Float64Array; // reads json.weights
export class NeuralFeatures {
  constructor(centerline: readonly [number, number][], halfWidthLeft: readonly number[], halfWidthRight: readonly number[]);
  fill(out: Float64Array /* N_IN */, s: NeuralCarState): void;
}
export interface NeuralCarState {
  position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number };
  forwardSpeed: number; linvel: { x: number; y: number; z: number }; angvel: { x: number; y: number; z: number };
  progress: { index: number; distance: number; lateral: number }; // TrackProgress result (src/track/trackProgress.ts)
  fuelMassKg: number; compoundGrip: number; // mu0/muMedium − 1
  others: ReadonlyArray<{ position: { x: number; y: number; z: number }; linvel: { x: number; y: number; z: number } }>; // self excluded, player included
}
export class NeuralDriver {
  constructor(weights: Float64Array, features: NeuralFeatures);
  decide(step: number, s: NeuralCarState): { steer: number; throttle: number; brake: number };
}
export interface RaceGameOptions { aiDriver?: 'classic' | 'neural'; neuralModels?: Partial<Record<Difficulty, Float64Array>> } // added to existing options; Difficulty from src/ai/traffic.ts
```

1. `parseNeuralModel`: `weights.length === N_W` accepted; shorter genome paddable via `padGenome` is padded; anything else throws `Error('Invalid neural model: ...')`.
2. `NeuralFeatures`: built once per track (cumulative lengths, vProf exactly as worker.mts: kappa from points ±10 m, MU_G 1.5·9.81, cap 90, DECEL 11, two backward passes). `fill` is byte-for-byte equivalent to worker.mts features; nearest 4 others within 60 m. No allocation per call.
3. `NeuralDriver.decide`: evaluates features + `forward` only when `step % 4 === 0` (step counted from race start); other steps return the held inputs. Reuses buffers.
4. Export script: for each `scripts/evolve/models/<track>-<car>/index.json`, copy the difficulty genomes (easy, medium, hard, expert; only those present) to `public/ai-models/<track>-<car>/<difficulty>.json` keeping `{nIn, avgLap, bestLap, gen, weights}`; write `public/ai-models/index.json` = `{ "<track>-<car>": ["easy",...present] }`. Run it once and commit the output.
5. `RaceGame.create`: `aiDriver` default `'classic'`. With `'neural'` and a model for the AI's difficulty, that AI uses `NeuralDriver`; otherwise the classic driver (no throw). Browser loader fetches `public/ai-models/...`; tests read from disk.
6. Race-setup menu: toggle "AI: classic / neural (experimental)", visible only when `public/ai-models/index.json` lists the selected `<track>-<car>`; the choice is passed to `RaceGame`.

Conventions: features computed in double precision, no rounding; `<`/`<=` as in worker.mts; invalid model input throws; `fill` mutates only `out`, never inputs.

## Planner answers (round 1)

Master changed `scripts/evolve/worker.mts`/`evolve.mts` after this branch started (commits caafbbd, 593ae13: `--line center|racing|mintime`). Before finishing, merge master into the worktree and port the line-dependent features too:
- Saved models carry `line` (`center` default when absent). `neuralFeatures` takes the target-line points per centerline index and the speed profile built from them: `center` = centerline, `racing` = `computeRacingLine(...)` exactly as `worker.mts` builds it (clamped inside edges), `mintime` = the cached `scripts/evolve/lines/<track>-<car>-mintime.json`, which `export-ai-models` copies to `public/ai-models/<track>-<car>/line-mintime.json` when a mintime model is exported.
- `export-ai-models` also reads `models/<track>-<car>-racing/` and `-mintime/` dirs; per track/car pick the fastest `expert` across lines and keep its whole difficulty set from that same line.
- `worker.mts` must keep producing identical features for all three lines after the refactor (determinism AT unchanged).

## Planner answers (round 2)

Planner-authorised test edits in `tests/unit/acceptance/269-evolved-neural-driver.test.ts` (only these):
- `modelPath` returns the repo-relative path `` `public/ai-models/${track}-${car}/${difficulty}.json` `` (no `join(ROOT, ...)`; `readJson` already joins ROOT).
- AT5: threshold `> 50` becomes `> 10` (and the test title accordingly); the start countdown eats most of the 10 s. The classic-identical position checks stay.
Then run AT1–AT10, the Playwright spec for AT10, lint and the full suite, and report.

## Planner answers (round 3)

- Models were trained before task 254 (rear grip), so lap times drift: AT1 factor 1.06 → 1.08, AT2 1.08 → 1.10 (acceptance table updated).
- AT8 assertion: every key in `index.json` has its files, and every source model dir's base key (`-racing`/`-mintime` stripped) is listed.
- AT6 gets a 600 000 ms per-test timeout, like AT1–AT4.
- Planner-authorised test edits in `tests/unit/acceptance/269-evolved-neural-driver.test.ts`, exactly: AT1 factor `1.06` → `1.08`; AT2 factor `1.08` → `1.10`; AT8 assertion as above; AT6 `it()` timeout `600_000`. Nothing else in the test changes. Do not retrain or modify model files.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | RaceGame monza, f4, aiCount 1, difficulty expert, aiDriver neural with `public/ai-models/monza-f4/expert.json` loaded as the game loads it (plain or residual, with its line), seed 3, player brake 1 | 3 laps (≤ 600 s) | AI finishes 3 laps; 0 resets; AI best lap ≤ 1.08 × the model file's `bestLap` |
| AT2 | same as AT1 on spa with `spa-f4/expert.json` (skip with a clear message only if that file does not exist) | 2 laps (≤ 600 s) | finishes; 0 resets; best lap ≤ 1.10 × model `bestLap` |
| AT3 | RaceGame monza, f4, aiCount 7, difficulty medium, aiDriver neural, seed 3, player brake 1 | 300 s | every AI completes ≥ 1 lap; total resets ≤ 2 |
| AT4 | monza single AI, neural expert vs neural easy, each loaded as the game loads it (plain or residual), AT1 setup otherwise | 2 laps each | expert best lap < easy best lap |
| AT5 | aiDriver neural on a track with no model (silverstone) | create + 10 s | no throw; AIs use the classic driver (positions identical to `aiDriver: 'classic'`) and move > 10 m (start countdown included) |
| AT6 | AT1 setup run twice | 60 s each | identical AI position (±1e-9) |
| AT7 | `parseNeuralModel` with weights length 610; a 21-input genome (16·21+16+32+2 weights); length 611 | parse | 610 accepted; 21-input padded to 610 with zero weights on new inputs and identical `forward` output when new inputs are 0; 611 throws `Invalid neural model` |
| AT8 | `npm run export-ai-models` output | read | every key in `public/ai-models/index.json` has its files; every source model dir's base key (dir name with `-racing`/`-mintime` stripped) is listed; every listed file, loaded as the game loads it (plain or residual), has `N_W` weights (the genome length exported by `src/ai/neuralPolicy.ts`) |
| AT9 | NeuralDriver, physics steps 0..11 | call `decide` each step | features/forward evaluated only on steps 0, 4, 8; other steps return the held inputs |
| AT10 | Playwright: race setup with monza + f4, then silverstone + f4 | open menu | neural toggle visible for monza, hidden for silverstone |

AT1–AT4 and AT6 are slow headless runs: per-test timeout up to 600 000 ms in `tests/unit/acceptance/269-*.test.ts`.

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `scripts/evolve` still runs with identical training behaviour (imports only changed).
- [ ] Classic AI is the default; no existing test changes.
- [ ] `public/ai-models/` generated and committed.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 269-
```

## Out of scope

- Replacing the classic AI by default, difficulty gating (task 267), RL tasks 263–266, training changes, new models.


## Note (2026-10-19)
Residual mode (classic driver + net offset/pace, 8 extra inputs) lives in `src/ai/residualPolicy.ts`; see `tasks/288-residual-neural-ai.md`. Models with `residual: true` are not driven by `NeuralDriver`. The trainer genome has `N_XW` extra genes after the setup genes (`fullGenome`); `joinGenome` keeps `N_W + N_SET`.
