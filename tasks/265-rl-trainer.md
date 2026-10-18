# 265 — PPO trainer with behaviour-cloning warm start

Status: pending
Phase: 2
Depends on: 264, 266
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer

## Goal

Train a driving policy locally: behaviour cloning from the racecraft teacher, then PPO, exporting `policy.json` for 266.

## Context

Depends on 264 (`EnvPool` in `tools/rl/client.py`) and 266 (`policy.json` format, `parsePolicy`). GPU: RTX 5060 (Blackwell) needs CUDA 12.8 PyTorch wheels. Obs 64, action 2 (steer, accel) in [-1, 1] as in 263. Python runs only from `.venv-rl`; vitest tests skip with a visible reason (`it.skipIf` plus a console warning) when `.venv-rl/bin/python` is missing.

## Files

- `tools/rl/train.py` — create.
- `tools/rl/requirements.txt` — create — `--extra-index-url https://download.pytorch.org/whl/cu128`, `torch>=2.7`, `numpy`; header comment with the venv commands (`python3 -m venv .venv-rl`, `.venv-rl/bin/pip install -r tools/rl/requirements.txt`).
- `.gitignore` — modify — add `.venv-rl/` and `tools/rl/runs/`.
- `tests/unit/acceptance/265-rl-trainer.test.ts` — create (acceptance worker).

## Steps

1. CLI: `train.py [--smoke] [--cpu] [--resume DIR] [--envs N=8] [--procs P=8] [--run NAME=run] [--dry-run]`. Output dir `tools/rl/runs/<NAME>` (`smoke` when `--smoke`, overriding NAME). Device cuda when available and not `--cpu`.
2. Networks: actor MLP 64-128-128-2 (tanh hidden), action mean = tanh(output), state-independent learnable log-std init -1.0; separate critic 64-128-128-1. Input = (obs - obsMean)/obsStd with mean/std computed once from the BC data (std < 1e-6 -> 1) and frozen.
3. BC phase: roll out with the teacher actions (`teacher` of the previous step; zeros on the first), collect samples, fit actor mean to teacher with MSE (Adam lr 1e-3, batch 256, epochs 30). Log lines `bc epoch=<e> loss=<x>` (first epoch logged, last epoch logged).
4. PPO phase: Adam lr 3e-4, clip 0.2, GAE λ 0.95, γ 0.995, 4 epochs, minibatch 1024, rollout 512 steps per env per iteration, advantage normalisation, value loss coefficient 0.5; done flags reset GAE bootstrapping. Log `ppo iter=<i> step=<global env steps> reward=<mean>`.
5. Smoke: 2 envs, 1 process, 3 cars, 2000 BC samples, 2 PPO iterations of 64 steps; whole run < 300 s on CPU.
6. After BC and after every PPO iteration write `ckpt.pt` (actor, critic, log-std, optimiser, obs norm, global step) and `policy.json` (version 1, obsSize 64, three layers {in, out, w row-major out×in, b}, activation `tanh` (output tanh applied by 266), obsMean, obsStd, `approved: false`). `--resume DIR` restores `ckpt.pt`, skips BC, logs `resumed step=<n>`, continues counting from n.
7. After writing the policy log `zero_obs_output [a, b]` = actor mean for a zero raw obs (float with 6 decimals).
8. `--dry-run`: build the `EnvPool` with `--envs`/`--procs`, reset once, print `spawned <procs>`, close, exit 0 (all server processes gone).

## Acceptance tests (defined by the planner with Opus, before coding)

`tools/rl/train.py` (PyTorch in `.venv-rl`, `tools/rl/requirements.txt`), MLP 64-128-128-2 tanh, actor-critic; BC from `teacherAction`, then PPO (clip 0.2, GAE λ 0.95, γ 0.995). Tests skip with a visible reason when `.venv-rl` is missing.


| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `train.py --smoke --cpu` | run | exit 0 within 300 s; writes `tools/rl/runs/smoke/policy.json` |
| AT2 | smoke BC phase | log | BC loss at the end < 0.5 × the first logged loss |
| AT3 | `policy.json` | load with `parsePolicy` (266) | parses; forward of a zero obs equals PyTorch's output (±1e-4, value in the log) |
| AT4 | `--resume runs/smoke` | run 1 iteration | continues from the checkpoint step count |
| AT5 | `--envs 8 --procs 8` dry run | start | spawns 8 env processes and stops them on exit (no orphans) |

## Acceptance criteria

- [ ] All AT rows pass (or are skipped with the visible reason when `.venv-rl` is absent).
- [ ] `policy.json` has `approved: false` always; `.gitignore` entries present.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Setting `approved` (267 gate, manual), hyperparameter search, multi-GPU, TensorBoard, ONNX export, installing the venv inside tests.
