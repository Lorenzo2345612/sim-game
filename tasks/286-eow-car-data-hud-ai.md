# 286 — `eow` car data, menu entry, battery HUD, AI power

Status: pending
Phase: 7
Depends on: 284, 285
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The brand-neutral electric open-wheel car "Electric OW" (`eow`) is selectable, drivable with battery and attack-mode HUD, and the AI uses its electric power.

## Context

Design: `docs/design/m7.1-electric.md`; assumed values: `docs/research/cars/electric-ow.md` section "Proposed". Model reuses `/models/ow26.glb` (`model.url`). `chassis.massKg` = 954 (convention: with driver, no fuel, per guides/vehicle-dynamics.md); fuel capacity/start 0. Values: wheels radius 0.345, width 0.295 (front) / `widthRear` 0.345; gearbox `ratios [1]`, `final 7.8`, `reverse 7.8`, `shiftTime 0`; aero cda 1.15, claFront 0.70, claRear 1.00; electric block as in 284 (rear 350 kW/557 Nm, front 250 kW/400 Nm, 20000 rpm, ratio 7.8, regen 350 kW each; batteryJ 184.5e6; efficiency 0.95; modes 450e3/600e3; attack 2 x 240 s). Other fields (inertia, suspension, tyres, diff, brakes, aids, cockpit, steering) copy ow26 or research doc values; voice `synth.kind 'electric'`, layers order 31 (motor), 156 and 60 (gear mesh), all source `wheel`, gains 0.2 / 0.08 / 0.06, carrier 10000 Hz / 0.05; `synth.turbo` and `synth.whine` absent (231 AT6 needs null); explicit ow26-like exhaust fields `pipeM [0.5,0.5]`, `tailM 0.5`, `drive 1.4`, `exhaustGain 0.6`, `crackle 0.2` (parsed, ignored when rendering; 244 AT8); keep `sound.cylinders` 4, `firingDeg` of length 4 and legacy fields valid (226 AT6).

## Files

- `public/cars/eow.json` — create
- `public/cars/index.json` — modify: append `{ "id": "eow", "name": "Electric OW", "category": "open-wheel" }` as last entry
- `src/ui/hudErs.ts` — modify: `HudErs.updateElectric(d: HudElectricData)`; `export type HudElectricData = { socFrac: number; mode: 'race' | 'attack'; attackLeftS: number }`; shows `{round(soc·100)}%` in the SoC element, `RACE`/`ATK` in the mode element, attack seconds left (`{ceil}s`) in the lap element while attack; existing `update` unchanged
- `src/ai/speedProfile.ts` — modify `carLimitsFromSpec`: when `spec.electric`, `pmax = spec.electric.modes.race` (replaces the torque-curve max)
- `src/ui/menu.ts` — modify: append `'eow'` to `CAR_IDS` (last)
- `src/main.ts` — modify (minimal): in the existing `if (telemetry.ers) … else hudErs.update(null)` block, `else if (telemetry.electric) hudErs.updateElectric(telemetry.electric)` (shows the root, clears the ERS-only elements OT/flow/clip/aero), and call the player vehicle's `setLap(info.lap)` next to `hudData.lap = info.lap`
- Protected tests that count/enumerate cars and must be updated for the new entry (numbers only): `tests/e2e/acceptance/073-car-selection.spec.ts` (count 8, values append `'eow'`, names append `'Electric OW'`), `tests/unit/calibration/ow26.test.ts` (AT9 `INDEX_OTHERS` append `{ id: 'eow', name: 'Electric OW', category: 'open-wheel' }`), `tests/unit/edge/221-ow26-car.test.ts` (EDGE2: ow26 once, last entry becomes `'eow'`), `tests/unit/edge/221-ow26-car.post.test.ts` (POST11 last id `'eow'`), `tests/unit/acceptance/231-car-synth-data.test.ts` (`CAR_IDS` append `'eow'`), `tests/unit/acceptance/244-engine-voice-timbre.test.ts` (AT8: `MASTER.eow = {pipeM [0.5,0.5], tailM 0.5}`, `DRIVE.eow 1.4`, `EXHAUST_GAIN.eow 0.6`, `CRACKLE.eow 0.2`), `tests/unit/acceptance/226-engine-sound-spec.test.ts` (AT6 stays valid via cylinders 4)
- `tests/unit/acceptance/286-eow-car-data-hud-ai.test.ts`, `tests/e2e/acceptance/286-eow-car-data-hud-ai.spec.ts` — create (from the table)

## Steps

1. Create `eow.json` valid for `parseCarSpec` (283) and `parseEngineSynth` (285).
2. HUD/AI/menu as listed in Files.

Conventions: AI power uses `electric.modes.race` unscaled before the existing 0.9 factor; `vMax` formula unchanged using that pmax; rwd cars unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/cars/eow.json` | parseCarSpec | drive 'awd'; electric.modes {450000, 600000}; batteryJ 184.5e6 |
| AT2 | eow spec | carLimitsFromSpec(spec, 0) | powerPerMass = 0.9·450e3/m (1e-6 rel) with m the spec's mass incl. fuel 0 |
| AT3 | e2e `/?car=eow&track=monza` | 3 s full throttle | HUD SoC text matches `/\d+ ?%/`, mode text RACE |
| AT4 | e2e menu | open car select | "Electric OW" listed |

## Acceptance criteria

- [ ] All ATs pass; every protected test listed above updated and green; existing ow26/f4 behaviour unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 286-
```

## Out of scope

- Custom 3D model, attack-mode zones/arming UI, pit boost, time-based race format, electric-specific tracks (Mexico short layout, street circuits), AI energy management, aero kits.
