# 272 — Neural trainer: reference-lap target line and speed profile

Status: pending
Phase: 2
Depends on: 270
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Neural drivers can be trained and played with the owner's recorded lap as target line and brake-cue speed profile.

## Context

The owner drove Cleveland F4 in 88.2 s (best neural AI 93.8 s). The lap is a ghost (`GhostLap` + `carId`, 30 Hz samples `[t,x,y,z,qx,qy,qz,qw]`, `src/game/ghost.ts`) in `assets/source/ref-laps/cleveland-f4-user.json`. It is clean: max |lateral| 8.0 m, half width 7.5 m, kerbs 1.2 m. Read `tasks/270-neural-driver-v2.md` (kerb clamp rule, `hasKerb`, `KERB_WIDTH`), `scripts/evolve/{worker,evolve,export-models,mintime}.mts`, `src/ai/neuralFeatures.ts` (`lineArg` = `{ points, mintimeSpeed }`), `TrackProgress` in `src/track/trackProgress.ts` (sign convention), `loadNeuralModels` in `src/main.ts`, `neuralLine` in `RaceGameOptions` (`src/game/raceGame.ts`).

## Files

`src/ai/refLine.ts` (new), `src/ai/neuralModelLoader.ts` (new), `src/main.ts` (loader only), `scripts/evolve/{evolve,worker,export-models}.mts`, test `tests/unit/acceptance/272-neural-reference-line.test.ts`. Existing tests unchanged.

## Steps

```ts
// src/ai/refLine.ts (pure: no three, no Rapier)
export function refLineFromGhost(
  ghost: { lapTime: number; samples: number[][] },
  centerline: [number, number][],
  hwL: ArrayLike<number>, hwR: ArrayLike<number>,
  kerbL: ArrayLike<boolean>, kerbR: ArrayLike<boolean>,
): { pts: [number, number][]; v: number[] };
// src/ai/neuralModelLoader.ts
export function neuralLineFor(
  json: { line?: string }, base: string, fetchJson: (url: string) => Promise<any>,
): Promise<RaceGameOptions['neuralLine']>; // resolves undefined when none
```

1. `refLineFromGhost`: project every sample (x = s[1], z = s[3]) onto the centreline (arc length s, signed lateral, same sign as `TrackProgress`). Coverage: every 50 m bin of the lap must hold at least one sample, else `throw new Error('Invalid reference lap: ...')`. Per centreline index: lateral = linear interpolation of the samples by arc length (with wrap), then centred moving average over ±3 indices (wrapping). Clamp to `[-(hwL + (kerbL ? KERB_WIDTH - 0.3 : -0.6)), hwR + (kerbR ? KERB_WIDTH - 0.3 : -0.6)]` per index (rule of 270), then convert to world points (centreline point + lateral along the normal, same convention as the projection). Speed per index: distance/time between consecutive samples, interpolated by arc length, smoothed over ±3 indices.
2. `neuralLineFor`: 'racing' → `{kind:'racing'}` (no fetch); 'mintime' → `fetchJson(`${base}/line-mintime.json`)` → `{kind:'mintime', pts, v}`; 'ref' → `fetchJson(`${base}/line-ref.json`)` → same `{kind:'mintime', pts, v}`; otherwise undefined. `loadNeuralModels` in `src/main.ts` calls it (replace the inline branches; keep its try/catch behaviour).
3. Trainer: `evolve.mts` accepts `--line ref --ref <ghost.json>` (`LINE` allows `ref`; missing `--ref` with `ref` throws). `worker.mts` receives the ghost path through `workerData`, builds hwL/hwR/kerb flags (`hasKerb`) and calls `refLineFromGhost`, then passes `{ points: pts, mintimeSpeed: v }` exactly like mintime. Model dir key suffix `-ref`; saved models and `index.json` carry `line: 'ref'` and `index.json` also `ref: <ghost path as given>`. Seeding: reuse the existing `--resume` (genome files, comma-separated, older lengths padded via `padGenome`); no new option. A ref run may start from a racing population via `--resume <racing pop.json or models>`.
4. `export-models.mts`: `-ref` dirs are stripped like `-racing`/`-mintime` for the base key; among line variants of a key the best expert `bestLap` wins (existing rule). For `line: 'ref'` write `<out>/<track>-<car>/line-ref.json` (`{pts, v}` from `refLineFromGhost`, ghost path from source `index.json` `ref`, track loaded as in `worker.mts`) and difficulty files with `line: 'ref'`. Source and output roots can be overridden by env `EVOLVE_MODELS_DIR` and `AI_MODELS_OUT` (defaults unchanged) so tests use temp dirs.

Conventions: double precision, no rounding; bins and clamps inclusive; invalid ghost throws `Error` starting `Invalid reference lap`; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | cleveland track + `assets/source/ref-laps/cleveland-f4-user.json`, kerb flags from `hasKerb` | `refLineFromGhost` | `pts.length` = centerline length; every pt's signed lateral lies within the AT clamp (±1e-6); mean distance from each pt to the nearest ghost sample ≤ 0.6 m |
| AT2 | same | `refLineFromGhost` | Σ segment length / mean(v of its two ends) over the closed line is within 3 % of `lapTime`; min v in [8, 20] m/s; max v ≤ 90 |
| AT3 | synthetic straight-ish ghost: the cleveland centreline driven at constant 40 m/s on lateral 0 | `refLineFromGhost` | every v within 40 ± 0.5; every pt within 0.05 m of the centreline |
| AT4 | the user ghost with samples whose arc length is past half the lap removed | `refLineFromGhost` | throws an Error whose message starts with `Invalid reference lap` |
| AT5 | `neuralLineFor` with a stub `fetchJson` | json line 'ref'; 'mintime'; 'racing'; none | 'ref' fetches exactly `${base}/line-ref.json` and returns `{kind:'mintime', pts, v}`; 'mintime' fetches `line-mintime.json`; 'racing' → `{kind:'racing'}` with no fetch; none → undefined |
| AT6 | temp model dir `cleveland-f4-ref` with index.json `{line:'ref', ref:'assets/source/ref-laps/cleveland-f4-user.json', models:{…}}` holding one model | run export-models into a temp out dir | writes `cleveland-f4/line-ref.json` with pts/v lengths = centerline length and difficulty files with `line: 'ref'` |
| AT7 | evolve cleveland f4 `--line ref --ref assets/source/ref-laps/cleveland-f4-user.json --pop 6 --gens 1 --speed-laps 1` | run (timeout 600000) | exits 0; the run's champion json has `line: 'ref'` |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Existing center/racing/mintime training, export and loading behave as before.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Running a training, exporting real models, committing `public/ai-models/**`, new tracks/cars, changes to the physics or the ghost format, racecraft (271).
