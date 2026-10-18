# 264 — RL env server (Node) and Python client

Status: pending
Phase: 2
Depends on: 263
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Run many `RaceEnv`s in Node processes and drive them from Python over a binary pipe protocol.

## Context

Depends on 263 (`RaceEnv`, `OBS_SIZE`). One agent per env (car index 1); car 0 is the frozen player. Run with `npx tsx`. stdout carries frames only; logs go to stderr.

## Files

- `tools/rl/envServer.ts` — create — server and exported `makeScenario`.
- `tools/rl/client.py` — create — `EnvPool` and `--selftest` (stdlib + numpy only).
- `tests/unit/acceptance/264-rl-env-server.test.ts` — create (acceptance worker).

## Steps

1. CLI: `npx tsx tools/rl/envServer.ts --envs N --cars C --track monza --difficulty hard --laps 3 --max-steps 2400` (defaults: 4, 8, monza, hard, 3, 2400; car f4). Track/car loaded from `public/` like `tests/unit/acceptance/225-ai-grip-margin.test.ts`.
2. Export `makeScenario(seed: number, cars: number, halfLeft: number, lapLength: number): NonNullable<RaceConfig['scenario']>`: player (index 0) frozen at d = -(halfLeft + 8); cars 1..C-1 at s = 200 - 12·(k-1) (wrapped), d = ±2 alternating, v 0, speedScales (player 1) uniform in [0.85, 1.0] from a seeded mulberry32. Deterministic per seed.
3. Frame = header `u32 type, u32 payloadBytes` then payload; all little-endian, floats are float32. N = env count, O = 64.

| Type | Dir | Payload |
|---|---|---|
| 0x01 RESET | to server | N × u32 seeds |
| 0x02 STEP | to server | N × 2 f32 actions |
| 0x03 CLOSE | to server | empty; server exits 0 |
| 0x81 OBS | to client | u32 N, u32 O, N×O f32 |
| 0x82 STEPR | to client | u32 N, u32 O, N×O f32 obs, N f32 reward, N f32 done (1 or 0), N×2 f32 teacher |
| 0xFF ERROR | to client | UTF-8 message |

4. Auto-reset: when an env is done, its obs in STEPR is the first obs of the next episode (done = 1 flags it); seed of episode k of env e = baseSeed + e + k·N (baseSeed from the RESET seed).
5. Malformed input (unknown type, payload length not matching the type, payload > 1 MiB, EOF inside a frame): write an ERROR frame, exit code 2. EOF between frames: exit 0.
6. `client.py`: `class EnvPool(procs: int, envs_per_proc: int, cars: int = 8, **server_args)` spawns `npx tsx` from the repo root (derived from `__file__`); `reset(seeds) -> obs (E, 64) float32`; `step(actions (E, 2)) -> (obs, reward (E,), done (E,) bool, teacher (E, 2))`, envs ordered by process then index; `close()` sends CLOSE and waits (kill after 5 s); ERROR frame -> raise RuntimeError with the message. `python3 -I tools/rl/client.py --selftest`: 1 process, 4 envs, reset, 5 steps, prints `obs shape (4, 64)`, exit 0.

## Acceptance tests (defined by the planner with Opus, before coding)

`tools/rl/envServer.ts` runs N `RaceEnv`s per process, little-endian binary frames on stdin/stdout (protocol table in the spec); `tools/rl/client.py` (stdlib + numpy only) spawns K processes.


| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | server with 4 envs | reset frame | 4 × 64 float32 obs, header carries env count and obs size |
| AT2 | 100 step frames | read | each reply has obs, reward, done, teacherAction for 4 envs; done envs auto-reset and flag it |
| AT3 | malformed frame | send | server writes an error frame and exits non-zero, no hang |
| AT4 | 2-car envs, 1 process | 10 s | ≥ 150 env-steps/s |
| AT5 | vitest spawns `python3 -I tools/rl/client.py --selftest` | run | exit 0; prints obs shape (4, 64) |

## Acceptance criteria

- [ ] All AT rows pass; `makeScenario` is deterministic for equal arguments.
- [ ] A killed Python parent leaves no server running (server exits on stdin close).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Training, shared memory or sockets, multi-agent envs, more than one track per server.
