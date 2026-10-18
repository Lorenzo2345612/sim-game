# 266 — Policy network and learned driver in TS

Status: pending
Phase: 2
Depends on: 263
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Run the trained policy in TypeScript: parse `policy.json`, evaluate the MLP without allocation, and drive a car with it.

## Context

Depends on 263 (`OBS_SIZE`, `CarFrame`, `writeObservation`, `applyAction`, `TICKS_PER_STEP` in `src/ai/rl/observation.ts`; RaceGame hooks `carFrame`, `setCarOverride`). No `three`; no per-tick allocation.

## Files

- `src/ai/policyNet.ts` — create.
- `src/ai/learnedDriver.ts` — create.
- `tests/unit/acceptance/266-policy-net-driver.test.ts` — create (acceptance worker).

## Steps

1. `policyNet.ts` exports:
```ts
export interface PolicyLayer { in: number; out: number; w: Float64Array; b: Float64Array }
export interface Policy { version: 1; obsSize: 64; layers: PolicyLayer[]; activation: 'tanh'; obsMean: Float64Array; obsStd: Float64Array; approved: boolean }
export function parsePolicy(json: unknown): Policy
export class PolicyNet { constructor(policy: Policy); readonly policy: Policy; forward(obs: ArrayLike<number>, out: Float32Array): Float32Array }
```
2. `parsePolicy` validates: version 1, obsSize 64, activation `'tanh'`, `approved` boolean, `obsMean`/`obsStd` arrays of 64 finite numbers (std entry 0 -> 1; negative or non-finite -> throw), layers non-empty with `layers[0].in` 64, last `out` 2, `layers[i].in === layers[i-1].out`, `w.length === in*out` (row-major out×in), `b.length === out`. Every failure throws `Error` whose message starts with the field path (e.g. `obsSize`, `obsStd`, `layers[1].w`).
3. `forward`: normalise `(obs - mean)/std`, then each layer `y = W·x + b` followed by tanh on every layer (output included); writes 2 values into `out` (length >= 2) and returns it. Buffers preallocated in the constructor (ping-pong sized to the widest layer); no allocation in `forward`.
4. `learnedDriver.ts`: `class LearnedDriver { constructor(net: PolicyNet); bind(ctx: ObservationContext, selfIndex: number, frames: readonly CarFrame[]): void; update(obs: AiObservation, dt: number, out: DriverInput): DriverInput }` (`AiObservation` from `./aiDriver`; `obs` and `dt` are unused, kept for the AiDriver contract). `frames` is a caller-owned array refreshed in place each tick.
5. `update`: counts calls; on calls 0, 4, 8, … (every `TICKS_PER_STEP`) builds the observation with `writeObservation` (prev action = last output), runs `forward`, stores clamped [steer, accel]; every call writes the stored action into `out` with `applyAction` and returns `out` (same object). Mean action only, no noise.

Conventions: tanh via `Math.tanh`; arithmetic in float64, output float32; `bind` must be called before `update` (else throw).

## Acceptance tests (defined by the planner with Opus, before coding)

`policy.json` = `{ version 1, obsSize 64, layers: {in, out, w: number[] (row-major out×in), b: number[]}[], activation 'tanh', obsMean: number[64], obsStd: number[64], approved: boolean }`.


| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | fixture weights (64-4-2, values in the test) | `PolicyNet.forward(obs, out)` | matches the hand-computed vector (±1e-6), obs normalised by mean/std, tanh hidden, tanh output |
| AT2 | invalid JSON (layer size mismatch, obsSize 63, missing obsStd) | `parsePolicy` | throws naming the field |
| AT3 | `LearnedDriver` with fixture weights in a RaceGame AI slot | 5 s | outputs DriverInput mapped as 263 AT3; no allocation per update (array identity reused) |
| AT4 | obsStd entry 0 | parse | treated as 1 (no NaN) |
| AT5 | source | read | no `from 'three'` |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `forward` and `update` contain no allocation (no `new`, no array/object literals).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Selecting the driver in RaceGame, the approval gate (267), training, noise or stochastic policies, loading from the network.
