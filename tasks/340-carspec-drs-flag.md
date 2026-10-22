# 340 — CarSpec `activeAero.drs` flag and DRS telemetry

Status: pending
Phase: 7
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Cars can declare that their active aero is driver-operated DRS, and telemetry reports it.

## Context

Design: `docs/design/ow-ladder.md`. `ActiveAeroSpec` today is `{dragScale, downforceScale, transitionS}`; the blend is driven by `VehicleModel.setAeroZone(bool)`. For `drs: true` cars the caller will pass the DRS open flag through the same method (341), so vehicle physics stays unchanged. Frozen: ow26 JSON must parse and behave identically.

## Files

- `src/physics/hybridTypes.ts` — modify: `ActiveAeroSpec.drs?: boolean`; `AeroTelemetry.drs?: boolean`
- `src/physics/carSpec.ts` — modify: parse `activeAero.drs` (optional boolean)
- `src/physics/vehicleModel.ts` — modify: telemetry `aero.drs` = `spec.activeAero.drs === true` when the spec has activeAero
- `tests/unit/acceptance/340-carspec-drs-flag.test.ts` — create

## Steps

1. `activeAero.drs` absent -> field undefined in the parsed spec (not false); present non-boolean -> `Invalid car spec: activeAero.drs`.
2. Telemetry `aero.drs` is `true` only for specs with `drs: true`, otherwise absent.
3. No physics change: blend/drag/downforce logic untouched.

Conventions: strict boolean check (no truthy coercion); existing validation order and messages unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/340-carspec-drs-flag.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | public/cars/ow26.json, f4.json | parseCarSpec | parses; `activeAero.drs` undefined; f4 has no activeAero |
| AT2 | ow26 JSON with `activeAero.drs` true | parseCarSpec | `spec.activeAero.drs === true`, scales unchanged |
| AT3 | `activeAero.drs` 1 / "yes" | parseCarSpec | throws message containing `activeAero.drs` |
| AT4 | VehicleModel on flat world (as in `tests/unit/acceptance/221-*`), drs spec, `setAeroZone(true)`, full throttle 1 s | telemetry | `aero.drs` true, `aero.blend` 1 (1e-6) |
| AT5 | ow26 JSON as committed vs the same JSON with `activeAero.drs` false | identical 1 s full-throttle runs with `setAeroZone(true)` | telemetry `aero.blend` and car speed identical every tick (1e-12); `aero.drs` undefined for the committed ow26 |

## Acceptance criteria

- [ ] All ATs pass; existing ow26/f4 tests unchanged and green.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- DRS state/rules (338); RaceGame wiring (341); new car data.
