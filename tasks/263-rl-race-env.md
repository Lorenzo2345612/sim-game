# 263 — RL race environment over RaceGame

Status: pending
Phase: 2
Depends on: 262
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

A gym-style headless environment over `RaceGame` that exposes observations, rewards and the racecraft teacher action to a learning agent.

## Context

Layout, action and reward: `docs/design/racing-ai-v2.md` "Learned AI" (263). Uses 258 (`TrackCorridor`, `corridorAt`, `isOffTrack`), 261 (`RaceConfig.scenario`, `contactCount`) and 262 (racecraft drives all non-agent AIs). Import names from the files those tasks created (see their Files lists). No `three`; no allocation per step or tick (preallocated buffers).

## Files

- `src/ai/rl/observation.ts` — create — shared observation/action contract (also used by 266).
- `src/ai/rl/raceEnv.ts` — create — `RaceEnv`.
- `src/game/raceGame.ts` — modify — only the hooks below.
- `tests/unit/acceptance/263-rl-race-env.test.ts` — create (acceptance worker).

## Steps

1. `observation.ts` exports: `OBS_SIZE = 64`, `ACTION_SIZE = 2`, `TICKS_PER_STEP = 4`, `interface CarFrame { s: number; d: number; v: number; headingError: number; yawRate: number; rearSlip: number }`, `interface ObservationContext { corridor: TrackCorridor; lapLength: number }`,
   `writeObservation(ctx: ObservationContext, selfIndex: number, frames: readonly CarFrame[], prevSteer: number, prevAccel: number, out: Float32Array, offset: number): void` and `applyAction(steer: number, accel: number, out: DriverInput): DriverInput` (clamp both to [-1, 1]; accel >= 0 -> throttle = accel, brake 0; accel < 0 -> throttle 0, brake = -accel; steer = steer; reset false; mutates and returns `out`).
2. `writeObservation` fills 64 floats exactly as the design: [0] v/100, [1] d/6, [2] headingError, [3] yawRate, [4] rearSlip; curvature `curv*50`, `(halfLeft + d)/10`, `(halfRight - d)/10` at look-aheads 0,10,20,40,60,80,100,130,160,200,250,300 m (s wrapped by lapLength, values from `corridorAt`); 6 nearest other cars by |gap| (gap = Δs wrapped to (-L/2, L/2], ties to the lower car index) as Δs/100, Δd/6, Δv/20 (zeros for absent); [59] prevSteer, [60] prevAccel, [61] profileV(s)/100, [62] s/lapLength, [63] 0. d positive = right.
3. RaceGame hooks (nothing else changes; existing behaviour intact when unused): `setCarOverride(carIndex: number, input: Readonly<DriverInput> | null): void` (AI cars only, 1 <= carIndex < carCount, else RangeError; the AI's racecraft still runs each tick and its command is kept; the override replaces what is sent to the vehicle; ignored before go); `teacherCommand(carIndex: number): Readonly<DriverInput>` (last racecraft command of that AI, zeros before its first tick); `carFrame(carIndex: number, out: CarFrame): CarFrame` (s/d from TrackProgress, headingError = car yaw - track tangent at s wrapped to (-π, π], yawRate/rearSlip from the AI observation maths); `get corridor(): TrackCorridor`; `get lapLength(): number`.
4. `RaceEnv` (`export class RaceEnv`):
   `static create(opts: { track: TrackDataV2; spec: CarSpec; difficulty: Difficulty; laps: number; maxSteps: number }): Promise<RaceEnv>`;
   `reset(seed: number, scenario: NonNullable<RaceConfig['scenario']>, agents: readonly number[]): Float32Array` (disposes the previous RaceGame; aiCount = starts.length - 1; agents are AI car indices; returns obs of length agents.length*64, reused buffer);
   `step(actions: Float32Array): { obs: Float32Array; reward: Float32Array; done: boolean; info: { teacherAction: Float32Array; contacts: number } }` (actions = [steer, accel] per agent; each step runs 4 `RaceGame.step` calls with the override set via `applyAction`; the player input is brake 1 steer 0 with the player frozen by the scenario; result buffers are reused; teacherAction = [steer, throttle - brake] of `teacherCommand` at the 4th tick, pairs with the obs in the same result; zeros after reset);
   `dispose(): void`.
5. Reward per agent per step: Δ standings distance/100; -5 × (contactCount delta, applied to every agent); -1 if `isOffTrack` at step end; -0.01·|Δsteer| vs previous action; +2 per position gained (standings position). Done: any agent stuck (|v| < 1 m/s for 5 s of consecutive steps after go; that agent also gets -10), `maxSteps` reached, or race finished.

Conventions: positions improved = strictly lower `position` than the previous step; invalid action length -> throw; NaN action -> treated as 0; `s` wrapped to [0, lapLength).

## Acceptance tests (defined by the planner with Opus, before coding)

Observation layout, action and reward exactly as `docs/design/racing-ai-v2.md` "Learned AI" (263). Monza, f4, `RaceEnv` controlling the agent car indices given in `agents`; other AIs use racecraft (262).


| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `reset(1, scenario)` | read obs | Float32Array length 64 per agent, all finite; obs[0] = v/100 (±1e-6) |
| AT2 | same seed and fixed action sequence, two envs | 300 steps | identical obs and rewards |
| AT3 | action [0.3, 0.6] / [0.3, −0.4] | step | car input steer 0.3, throttle 0.6, brake 0 / throttle 0, brake 0.4; values outside [−1, 1] clamped |
| AT4 | one step | count ticks | `RaceGame.step` called 4 times (30 Hz) |
| AT5 | agent on the start straight, action [0, 1] for 120 steps | sum rewards | > 0; obs[0] increases |
| AT6 | agent forced off track (scenario d = halfRight + 2) | 10 steps | each step reward includes −1; contact event in a step → −5 per contact |
| AT7 | agent passes an AI (rank improves once) | that step | +2 exactly once |
| AT8 | agent speed < 1 m/s for 5 s after go, or `maxSteps` reached | step | done true; stuck adds −10 |
| AT9 | `info.teacherAction` | step | equals the racecraft AI action for the agent car at that tick (for behaviour cloning) |
| AT10 | source | read | no `from 'three'` |

## Acceptance criteria

- [ ] All AT rows pass; existing RaceGame tests (093, 225) unchanged.
- [ ] `writeObservation`/`step` allocate nothing (no `new`, no array literals in hot paths).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- The server protocol (264), policy inference (266), training, scenario generation, changing racecraft behaviour, per-car contact attribution.
