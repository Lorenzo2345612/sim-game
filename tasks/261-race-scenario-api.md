# 261 — RaceGame scenario starts and contact counter

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`RaceGame` can start from an arbitrary scenario (per-car track position, lateral offset, speed, speed scale, frozen cars) without the start sequence, and exposes a car-to-car contact counter.

## Context

Used by the racecraft tests (262) and the RL env (263). Design: `docs/design/racing-ai-v2.md`, "Integration". With `scenario` absent the behaviour must stay bit-identical (existing acceptance 093/225 and edge tests unchanged). `TrackProgress.lateral` is + right; `s` = `TrackProgress.distance`. Keep the code in the existing style of `src/game/raceGame.ts` (spawn orientation as in `respawnOnLine`).

## Files

- `src/game/raceGame.ts` — modify (only file in `src/`).
- `tests/unit/acceptance/261-race-scenario-api.test.ts` — by the acceptance worker.

## Steps

```ts
export interface RaceScenario {
  starts: { s: number; d: number; v: number }[]; // by car index; player = 0
  speedScales?: number[];                        // by car index, AI only
  frozen?: number[];                             // car indices held with brake 1
}
// RaceConfig gains: scenario?: RaceScenario;
// RaceGame gains:   get contactCount(): number;
```

- Spawn: when `scenario.starts[i]` exists, car i spawns at the centerline point at arc length `s` (linear interpolation, wrapped on the lap) shifted `d` m along the right-hand normal, yaw along the track direction, y = `track.elevation` there + `SPAWN_HEIGHT_M`. Cars without an entry use their normal grid slot. Initial `linvel` = `v` m/s along the heading (`vehicle.body.setLinvel`). `this.slots` holds the poses used.
- Start sequence: with `scenario` present `step` treats the phase as `'go'` with go time 0 from the first tick (raceTime = simTime), never updates `StartSequence`, never applies jump-start penalties; `startLights()` returns 0.
- `speedScales[i]` multiplies the AI's `speedScale` (difficulty scale + jitter) for car i; missing = 1. Jitter rng draws stay identical.
- `frozen`: car i gets throttle 0, brake 1, steer 0 every tick (the player's input is ignored if 0 is frozen; a frozen AI's driver is not run and it is never stuck-respawned).
- `contactCount`: number of car-car contacts since go, 0 at start. After each `world.step`, for each pair whose wrapped |Δs| < 8 m and |Δd| < 4 m, test `world.contactPair(chassisA, chassisB, ...)` for any manifold with `numSolverContacts() > 0`; count it once per pair if ≥ 0.5 s passed since that pair was last counted. Preallocated pair timers, no allocation per tick; no change to the physics or damage path.
- `scenario.starts` shorter than the car count is allowed; longer is ignored.

Conventions: `s` wrapped modulo lap length; `d`, `v` used as given; scenario object is not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Track monza, car f4 from `public/`. `scenario` = `{ starts: {s, d, v}[] (one per car index), speedScales?: number[] (per car index, AI only), frozen?: number[] }`.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | aiCount 1, scenario starts [{s 1000, d −8, v 0}, {s 100, d 2, v 0}] | create, read states | car 1 XZ within 0.5 m of centerline point at s 100 shifted 2 m right (TrackProgress lateral sign); yaw error vs track direction < 0.05 rad |
| AT2 | car 1 start v 30 | first step | car 1 forwardSpeed 30 ± 1.5 |
| AT3 | scenario given | step 0.5 s | start sequence skipped: phase is go from t 0; AI 1 forwardSpeed rising |
| AT4 | speedScales [1, 0.8] vs [1, 1.0], same starts | 15 s | AI 1 distance covered with 0.8 ≤ 0.9 × the 1.0 run |
| AT5 | frozen [1] | 10 s | car 1 forwardSpeed < 0.5 m/s throughout |
| AT6 | two AIs started at the same s, d −0.5 and +0.5 | 2 s | `contactCount` ≥ 1 and ≤ 5 (one per pair per 0.5 s) |
| AT7 | one AI alone on track, scenario | 10 s | contactCount 0 |
| AT8 | no scenario | create + 3 s | identical states to master behaviour (existing 093/225 tests unchanged) |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/261-race-scenario-api.test.ts`.
- [ ] Existing tests that use `RaceGame` (`tests/unit/acceptance/093-race-game.test.ts`, `225-ai-grip-margin.test.ts`, `tests/unit/edge/093-*`, `145-contact-impacts.post.test.ts`, `225-*`) pass unmodified; if any needs a change: BLOCK and report, do not edit.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- AI behaviour changes (262), edits to `processContactEvents` or the physics, UI exposure of the scenario, RL env.
