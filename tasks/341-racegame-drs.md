# 341 — RaceGame DRS integration

Status: pending
Phase: 7
Depends on: 338, 339, 340
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

RaceGame runs the DRS rules for every car whose spec has `activeAero.drs` and drives their active aero; the player opens DRS with the overtake button.

## Context

Design: `docs/design/ow-ladder.md`. `RaceGame` currently never calls `setAeroZone`. `DriverInput.overtake` (edge) is forwarded at ~L746 and is unused by cars without ERS: it is the DRS button for DRS cars. DRS is a player button: no auto-open assist. The player is car 0. VSC is `this.vsc.phase`, yellow flags in `this.flags`. Weather wetness: use the existing weather state if present, else false. Allocation-free per tick (reuse arrays).

## Files

- `src/game/raceGame.ts` — modify (create `Drs` only when some car has `activeAero.drs`; zones from `deriveDrsZones(deriveAeroZones(track.centerline), lapLength)`)
- `tests/unit/acceptance/341-racegame-drs.test.ts` — create

## Steps

```ts
// RaceGame additions
drsState(car: number): { enabled: boolean; open: boolean }; // all false for non-DRS cars or when disabled
```
1. Each tick after go: build `DrsCarInput` (lapDist, lap from classification, running, braking = command brake > 0.05, throttle) and `DrsContext` (vsc phase `'deployed'` or `'ending'`, wet, per-zone yellow from flags, restartLapsLeft 0 until SC restarts exist); call `drs.update(time, ...)`.
2. Player (car 0): `playerInput.overtake` edge -> `drs.request(0)`; nothing else opens it for the player. AI requests are task 343.
3. For each DRS car: `vehicle.setAeroZone(drs.state(i).open)` (every tick, also false).
4. Cars without `activeAero.drs`: untouched.

Conventions: per-tick order: after rule updates (VSC/flags), before vehicle step; no `new` in the loop; timing uses simulation time only.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/341-racegame-drs.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | RaceGame, 2 cars with a drs-flag spec (copy of ow26 JSON + `drs:true`), car 1 follows car 0 by 0.5 s on lap 3 | pass the detection point and enter the zone | `drsState(1).enabled` true inside the zone, `drsState(0).enabled` false |
| AT2 | as AT1 on lap 2 | same | enabled false |
| AT3 | as AT1 but the player (car 0) follows car 1 by 0.5 s on lap 3 | overtake input edge inside the zone, next tick | `drsState(0).open` true; car 0 telemetry `aero.drs` true and `aero.blend` rising over the next 0.3 s |
| AT4 | open DRS | brake 1 for one tick | open false |
| AT5 | AT1 with VSC deployed | tick | enabled false for all cars |
| AT6 | race of f4 cars only (no drs flag), 3 cars, 30 s after go | `drsState(i)` every tick | `{enabled:false, open:false}` for every car and tick |

## Acceptance criteria

- [ ] All ATs pass; existing RaceGame tests unchanged and green.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- AI use (343); HUD (342); pit lane / SC restart laps; DRS in single-player `Game` (keeps its aero-zone behaviour for ow26); detection interpolation between ticks.
