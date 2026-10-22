# 343 — AI cars use DRS

Status: pending
Phase: 7
Depends on: 341
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

AI cars with DRS open it whenever it is enabled and they are at full throttle.

## Context

Design: `docs/design/ow-ladder.md`. AI commands are built in `raceGame.ts` per tick (see how `cmd.overtake` is set for the player). The AI never brakes on straights, so DRS closes on its own at the braking point.

## Files

- `src/game/raceGame.ts` — modify (after 341: AI branch calls `drs.request(i)` when `drs.state(i).enabled && !open && command.throttle >= 0.9`)
- `tests/unit/acceptance/343-ai-drs-use.test.ts` — create

## Steps

1. Only for DRS cars; no random skip, no per-difficulty rule (later).
2. No change to AI speed profiles or commands.

Conventions: request each tick while eligible (idempotent).

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/343-ai-drs-use.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | 2 AI DRS cars, car 1 within 0.5 s of car 0 at detection on lap 3 | step through the zone | `drsState(1).open` true at some tick in the zone |
| AT2 | same on lap 2 | same | never open |
| AT3 | as AT1, run to the end of lap 3 | car 1 max speed inside the zone on lap 3 (DRS open) vs lap 2 (not allowed) | lap 3 ≥ lap 2 + 3 km/h; car 1 telemetry `aero.drs` true on ≥ 50 % of the zone ticks after it first opens |
| AT4 | f4 AI race, 4 cars | step one full lap after go | `drsState(i)` `{false,false}` for every car and tick |

## Acceptance criteria

- [ ] All ATs pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Difficulty-dependent DRS usage; DRS defence logic; learned AI features.
