# 270 — Neural driver v2: kerb-aware line, tyre/surface inputs, per-model setup, lenient limits

Status: pending
Phase: 2
Depends on: 269
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Neural drivers use the full track (kerbs), sense tyre state and surface, carry an evolved car setup, and are trained under track-limit rules that no longer select timid drivers.

## Context

Analysis of the best Cleveland model (racing line): ~16 s/lap lost vs the QSS minimum-time profile, all in corners (min corner speeds 30–40 % below); the car centre was within 0.9 m of an edge only 1 % of the time, kerbs <1 %, grass never. Causes: the target line is clamped 1 m inside the white line and computed for a uniform half width; the trainer eliminates a car whose centre is >0.5 m past the edge for 0.5 s; the speed-phase overspeed penalty (`overW` 0.3) holds cars under a 1.5 g profile. Read (from task 269) `src/ai/neuralFeatures.ts`, `src/ai/neuralPolicy.ts`, `scripts/evolve/{worker,evolve,export-models}.mts`, and the neural-car construction in `src/game/raceGame.ts`. Types: `Surface` in `src/core/types.ts`; `Telemetry` and `getTelemetry(out?)` in `src/physics/vehicleModel.ts`; `Setup`, `defaultSetup`, `clampSetup`, `applySetup` in `src/physics/setup.ts`; `KERB_WIDTH` in `src/core/constants.ts`.

## Files

`src/track/surfaces.ts`, `src/ai/neuralFeatures.ts`, `src/ai/neuralPolicy.ts`, `src/game/raceGame.ts` (neural-car construction only), `scripts/evolve/{worker,evolve,export-models}.mts`, new `scripts/evolve/limits.mts`, new `scripts/evolve/genome.mts`, tests `tests/unit/acceptance/270-neural-driver-v2.test.ts` and the AT8 edit in `tests/unit/acceptance/269-evolved-neural-driver.test.ts`.

## Steps

```ts
// src/track/surfaces.ts
export function hasKerb(track: TrackDataV2, side: Side, i: number): boolean; // segmentCovers over track.kerbs
// src/ai/neuralFeatures.ts: racingTargetPoints gains kerb flags (trainer and game call it identically)
export function racingTargetPoints(centerline: readonly [number, number][], halfWidthLeft: readonly number[], halfWidthRight: readonly number[], kerbLeft: readonly boolean[], kerbRight: readonly boolean[]): [number, number][];
// NeuralCarState gains (all filled from getTelemetry, reused output object):
//   tempFrontC: number; tempRearC: number; optTempC: number; tempWindowC: number; wearMean: number; offWheels: number;
// src/ai/neuralPolicy.ts
export const N_IN = 39, N_W = 674 (derived by the existing formulas);
export function neuralCarSpec(spec: CarSpec, model: { setup?: Partial<Setup> }): CarSpec;
// scripts/evolve/genome.mts
export const N_SET = 8;
export function joinGenome(weights: ArrayLike<number>, setupGenes?: ArrayLike<number>): Float64Array;
export function splitGenome(g: ArrayLike<number>, spec: CarSpec): { weights: Float64Array; setup: Setup };
// scripts/evolve/limits.mts
export function trackLimits(): TrackLimitsState;
export interface TrackLimitsState { step(offWheels: number, dt: number): void; readonly lapValid: boolean; readonly eliminated: boolean; newLap(): void } // state per car
```

1. `racingTargetPoints`: usable half width per index and side = `hw + KERB_WIDTH − 0.3` where kerb flag, else `hw − 0.6`. Racing line = `computeRacingLine(cl, maxUsable, 0)` (maxUsable = max usable over all indices and sides); each target's lateral is then clamped to `[−usableLeft[i], usableRight[i]]`. Callers build flags with `hasKerb`; the `trackWidthM` parameter is removed.
2. New inputs appended at the END of the vector (indices 35..38): `(tempFrontC − optTempC)/tempWindowC`, same for rear, `wearMean` (mean wear of 4 wheels, 0..1), `offWheels/4` (wheels whose surface is not `asphalt`/`kerb`). Front = wheels with negative local z in `spec.wheels.positions` (verify order in VehicleModel). optTempC/tempWindowC are of the car's current compound. No per-frame allocation. `padGenome` keeps zero-padding, so older genomes behave identically.
3. `parseNeuralModel` accepts 674 and any padded-compatible older length (incl. 610); other lengths throw `Error('Invalid neural model: ...')`. Model JSON gets optional `setup`.
4. `neuralCarSpec` = `applySetup(spec, clampSetup(spec, { ...defaultSetup(spec), ...model.setup }))`. `RaceGame` builds each neural AI car's `VehicleModel` from it (classic AIs unchanged); the raceGame options carry the model's `setup` alongside the weights (minimal change). `export-models.mts` copies `setup` when present.
5. `limits.mts`: sampled per car; a lap is invalid if all 4 wheels are off at any sample (1–3 off is fine); `eliminated` once 4 wheels are off continuously > 2.0 s; `newLap()` resets lap validity. Samples taken every 4 physics steps (dt = 4·`FIXED_DT`) from telemetry surfaces. `worker.mts` replaces the `offT > 0.5` rule with it; the upside-down, stall > 4 s and > 30 m backwards rules stay.
6. Invalid lap: no lap bonus, its time is not used for best lap, +5 s on the car's finish time. Worker returns `invalidLaps: number[]`; `evolve.mts` saves hall-of-fame models only for finishers with 0 invalid laps (with `--evals 2`: invalid laps summed).
7. Setup genes: `splitGenome` gene 0 = key default, +1 = max, −1 = min, linear in between (per key range from `clampSetup`/spec), then `clampSetup`. `joinGenome` pads weights with `padGenome`, appends genes (default zeros). `evolve.mts` genomes are `N_W + N_SET` long, mutate/cross over the whole length, setup genes with 3× sigma; resume accepts pop.json/model files of any older length; worker builds each car from `applySetup(spec, setup)` (fuel override kept). Saved models: `weights` = first `N_W`, plus `setup`; champion/pop.json keep full genomes.
8. Speed-phase `overW` 0.3 → 0.

Conventions: double precision, no rounding; kerb/limit comparisons: wheel off iff surface not in {asphalt, kerb}; elimination uses strict `> 2.0 s`; invalid input throws; `fill`/`neuralCarSpec` do not mutate inputs.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | cleveland track, `racingTargetPoints` with kerb flags from `hasKerb` | build targets | every target lateral lies within [−(hwL + (kerbL ? KERB_WIDTH − 0.3 : −0.6)), hwR + (kerbR ? KERB_WIDTH − 0.3 : −0.6)] (±1e-9) of its index; at least one target on a kerb side has \|lateral\| > that side's hw |
| AT2 | NeuralFeatures, f4 medium: front wheels tempC = optTempC + tempWindowC, rear wheels at optTempC, all wear 0.5, the two rear wheels on grass, fronts on asphalt | compute features | inputs 35..38 = [1, 0, 0.5, 0.5] (±1e-9); `N_IN` 39, `N_W` 674 |
| AT3 | `parseNeuralModel` with 610 weights; 674; 675 | parse | 610 padded to 674 with identical `forward` output when inputs 35–38 are 0; 674 accepted; 675 throws `Invalid neural model` |
| AT4 | `neuralCarSpec(f4, model)` with `setup: { rearWing: 0 }`; `{ rearWing: 99 }`; no `setup` | build | claRear = default claRear − 5 × wingStep.claRear; 99 clamped to rearWing 10; no setup deep-equals `applySetup(f4, defaultSetup(f4))` |
| AT5 | RaceGame monza f4, 1 neural AI whose model has `setup: { rearWing: 0 }` | create | the AI car is built from `neuralCarSpec` (its rear downforce coefficient equals AT4's value) |
| AT6 | `trackLimits` fed samples every 1/30 s: (a) 3 wheels off for 10 s; (b) 4 off for 1.0 s, then 0; (c) 4 off for 2.1 s | step | (a) lap valid, not eliminated; (b) lap invalid, not eliminated; (c) eliminated |
| AT7 | `joinGenome` of a 610-weight genome; genes all +1; all −1 | join, then `splitGenome` | length `N_W + 8`; weights equal `padGenome(old)`; zero genes → `defaultSetup(f4)`; +1 → every key's max; −1 → every key's min |
| AT8 | 269 acceptance tests | run | all pass; the only authorised edit is replacing `610` literals that denote the current padded length (`N_W`) with `N_W` imported from `src/ai/neuralPolicy` |

AT5 may run headless; existing tests must not change except the AT8 edit.

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Classic AI untouched; models of 610 weights still load and drive identically.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

New tracks/cars, retraining, the classic AI, difficulty gating, rewards other than listed.
