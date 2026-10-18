# 278 — RaceGame timed sessions (practice, qualifying)

Status: pending
Phase: 3
Depends on: 276, 277
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`RaceGame` can run a timed session (practice or qualifying) with staggered releases from the grid and a qualifying classification fed every step; the race session is unchanged.

## Context

Design: `docs/design/c0-weekend.md` (278). Uses `QualifyingClassification`, `QualiStanding` from `src/race/qualifying.ts` (task 277, import, do not redefine) and `RaceConfig.gridOrder` (task 276). `countWheelsOff` is in `src/race/trackLimits.ts`. Wheel surfaces come from `vehicles[i].getTelemetry().wheels[j].surface`. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/game/raceGame.ts` — modify.
- `tests/unit/acceptance/278-racegame-timed-sessions.test.ts` — create (acceptance worker).
- `tests/unit/edge/278-racegame-timed-sessions.test.ts` — create (tester-pre).
- Protected tests (093, 094, 095, 171) keep passing unchanged: race session behaviour is identical.

## Steps

```ts
export interface RaceSessionConfig { kind: 'race' | 'practice' | 'qualifying'; minutes?: number }
// RaceConfig gains: session?: RaceSessionConfig   (absent = { kind: 'race' })
// RaceGame gains:
get sessionFinished(): boolean;
get timeLeft(): number | null;
get startPhase(): StartPhase;               // StartPhase from src/race/startSequence.ts
qualiStandings(): QualiStanding[];
```

1. `sessionFinished`: race → `raceFinished`; timed → classification `finished`. `timeLeft`: timed → `max(0, minutes·60 − simTime)`; race → `null`. `qualiStandings()`: timed → classification `standings()`; race → `[]`. `startPhase` returns the start sequence phase (race) or `'go'` (timed, from t=0).
2. Timed sessions (practice and qualifying alike; `minutes` required, > 0, else `create` rejects with Error containing `session.minutes`): no start lights (`startLights()` returns 0, `startPhase` `'go'` from t=0), no jump-start check or penalty, no `RaceClassification` race penalties.
3. Grid hold: the car at grid position p (index in the effective grid order: `gridOrder`, or default order `[1..aiCount, 0]`) gets throttle 0, brake 1, steering 0 (player and AI) until `simTime ≥ 2.0·p` s; afterwards player input and AI drivers run as in a race after go. The existing AI stuck respawn stays unchanged.
4. Every step, after progress refresh, the classification is fed per car: `update(car, lapDistance, simTime, countWheelsOff(wheel surfaces), FIXED_DT)`. `lapDistance` is the car's lap distance used by the race classification (`traffic[i].distance` modulo lap length, in [0, lapLength)).
5. Race session: no code path changes (`startPhase` is `'grid'` at t=0, `timeLeft` null, `qualiStandings()` `[]`, `startLights()` unchanged).

Conventions: `timeLeft` never negative; `minutes` fractional allowed (1 = 60 s); getters do not mutate; `qualiStandings()` returns a fresh array.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 3, qualifying 1 min, seed 1, player brake 1 | t=0 | startLights phase 'go'; timeLeft 60 |
| AT2 | same | step to 3.9 s / 6.0 s | car at grid position 2 (car 3) moved < 0.2 m at 3.9 s, > 0.5 m at 6.0 s; car 1 (pos 0) moved > 0.5 m by 1.5 s |
| AT3 | same | step to 10 s | timeLeft 50 (1e-6) |
| AT4 | monza, aiCount 1 (classic, expert), qualifying 1 min, player brake 1 | step until sessionFinished (cap 361 s) | finished by simTime ≤ 360.02 s; AI laps ≥ 1 and (bestLap null or 60 ≤ bestLap ≤ 240); player laps 0, bestLap null, done |
| AT5 | race session (no `session`) | create | startLights phase 'grid' at t=0; timeLeft null; qualiStandings [] |

AT "startLights phase" is read through `startPhase`.

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/278-racegame-timed-sessions.test.ts`.
- [ ] `create` with `session.minutes` ≤ 0 or missing for a timed kind rejects.
- [ ] Existing 093 unit and e2e tests pass unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Weekend logic, UI, HUD, `main.ts` changes (task 280).
- Flags, safety car, tyre/fuel changes per session, pit stops.
- AI behaviour changes (no flying-lap logic, no traffic avoidance for qualifying).
- Changing `RaceClassification` or `QualifyingClassification`.
