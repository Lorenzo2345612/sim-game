# 282 — Attack mode rules

Status: pending
Phase: 7
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure state machine for the electric car's timed power-boost ("attack") activations.

## Context

Design: `docs/design/m7.1-electric.md`. Pure code, no imports. `time` is simulation seconds supplied by the caller. Activation zones/arming are out of scope: callers activate directly.

## Files

- `src/physics/attackMode.ts` — create
- `tests/unit/acceptance/282-attack-mode-rules.test.ts` — create (from the table)

## Steps

```ts
export class AttackMode {
  constructor(activations?: number /* default 2 */, durationS?: number /* default 240 */);
  tryActivate(lap: number, vsc: boolean, time: number): boolean;
  mode(time: number): 'race' | 'attack';
  remainingS(time: number): number;
  get activationsLeft(): number;
}
```

1. `tryActivate` returns false (no state change) when `lap < 2`, `vsc` is true, an activation is active at `time`, or `activationsLeft` is 0. Otherwise it consumes one activation, records start `time` and returns true.
2. Active interval is [start, start + durationS): `mode` returns 'attack' inside it, 'race' otherwise.
3. `remainingS` = start + durationS − time while active, else 0.

Conventions: start inclusive, end exclusive; no rounding; invalid (NaN) arguments make `tryActivate` return false; no input mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | new | tryActivate(1, false, 10) | false; activationsLeft 2 |
| AT2 | new | tryActivate(2, false, 100) | true; mode(101) 'attack'; remainingS(160) 180; mode(340) 'race'; mode(339.999) 'attack' |
| AT3 | after AT2 | tryActivate(3, false, 200) | false (active) |
| AT4 | after AT2 | tryActivate(4, false, 400), then tryActivate(5, false, 700) | true, false; activationsLeft 0 |
| AT5 | new | tryActivate(3, true, 50) | false |

## Acceptance criteria

- [ ] All ATs pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring to VehicleModel (284) or HUD (286); activation zones; pit-stop re-arming; power values.
