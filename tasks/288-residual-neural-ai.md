# 288 — Residual neural AI in the game (classic driver + net offset/pace)
Status: done (implemented by the planner on user request, 2026-10-19)
Phase: 2
Depends on: 269, 270
Complexity: complex
Type: feature
Models: standard
Roles: —

## Goal
Run models trained with `scripts/evolve/evolve.mts --residual` in `RaceGame`: the classic `AiDriver` drives (traffic speed cap, yellow/blue/VSC rules, stuck reset unchanged); every 4 steps the shared MLP sets its lateral offset and pace. Published: `public/ai-models/cleveland-f4/expert.json` (gen331, `aidriver=neural`, expert).

## Files
- `src/ai/residualPolicy.ts` — new: `X_LOOK`, `N_X`, `N_XW`, `RESIDUAL_EVERY`, `parseResidualModel`, `aheadIndices`, `ResidualNet`.
- `src/game/raceGame.ts` — `RaceGameOptions.neuralResidual`, `AiCar.residual`.
- `src/main.ts` — loader passes `neuralResidual` when the model JSON has `residual: true`.
- `scripts/evolve/genome.mts`, `worker.mts`, `evolve.mts` — trainer genome = `N_W + N_SET + N_XW` (`fullGenome`); `joinGenome` keeps the old `N_W + N_SET` length (frozen tests).
- `scripts/evolve/race-residual.mts` — headless benchmark through the game mode (`--mix all|half|none`).
- `tests/unit/residualPolicy.test.ts`.

## Contract
- Model JSON: `residual: true`, `res: { offset (m at output ±1), up, down }`, `weights` (N_W, padded like 269), `extra` (≤ N_XW = N_X·N_HID, row h = hidden unit h), `setup`, `line`.
- Inputs: the 269/270 features (`NeuralFeatures.fill`) plus N_X = 8 extras: for d in 30/60/100 m (centerline index from `aheadIndices`, wraps at lap end) `(halfRight − lateral)/10`, `(halfLeft + lateral)/10`; then previous output 0 and 1. Extras are folded into the hidden biases and the shared `forward()` runs unchanged.
- Outputs: `offset = out0 · res.offset` replaces the traffic offset; `speedScale = (1 + (out1 > 0 ? up : down) · out1) · damageSpeedScale` (no difficulty jitter, as trained). Rule offsets (yellow 0, blue ±2 m) still override afterwards.
- Non-residual neural models and the classic AI are unchanged; `ai.neural` is unset on residual cars.

## Acceptance tests (planner)
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `{ weights }` / residual without `res.down` / extra longer than N_XW | `parseResidualModel` | null / throws `Invalid residual model` / throws |
| AT2 | closed square cum [0,10,20,30,40] | `aheadIndices(cum, 4, 15)` | [2, 3, 0, 1] |
| AT3 | all-zero weights and extra | `decide` | offset 0, scale 1 |
| AT4 | only `w[out0←h0] = 1`, `extra[0] = 1`, halfRight 5, lateral 1, features 0 | `decide` ×4 | offset = 5·tanh(tanh(0.4)) (1e-9), held for the next 3 calls |
| AT5 | Cleveland gen331, 11 AI, 5 laps, hard | `race-residual.mts --mix all` seeds 1, 2 | 11/11 finish, 0 crash faults |

## Known limits (not part of this task)
- A car stopped on track freezes the cars behind it under yellow (cap = speed of the car ahead, respawn on the same spot). Affects classic and residual AI alike; needs its own bugfix task.
- Trainer avg lap is ~3–4 s optimistic versus the game (89.3 s → ~92–93 s).

## Out of scope
- Residual models on other tracks, difficulty sets, UI changes.
