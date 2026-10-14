# 115 — Cockpit data per car (eye, steering wheel anchor, lock)

Status: pending
Phase: 1
Depends on: 058, 066, 072, 107, 113
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`CarSpec` carries optional cockpit geometry (eye point, steering wheel anchor, wheel radius, lock) with defaults, and the cockpit camera uses the car's eye point.

## Context

Design: `docs/plans/game-features.md` section 115. Car frame: metres, -Z forward, Y up. `src/render/cameraRig.ts` exports `COCKPIT_OFFSET = {x:0,y:0.75,z:-0.2}` and uses it for cockpit mode in `CameraRig.update`. `parseCarSpec` is in `src/physics/carSpec.ts` (helpers `num`, `vec3`, `optNum`, `fail`; `Vec3` exported there). Car JSONs: `public/cars/{f4,gt3-a,gt3-b,gt3-c}.json`.

## Files

- `src/physics/carSpec.ts` — modify: `cockpit` field, parsing, defaults.
- `src/render/cameraRig.ts` — modify: `CameraRig` gets `setCockpitEye(eye: Vec3): void`; cockpit mode uses it (initial value `COCKPIT_OFFSET`); T-cam unchanged.
- `public/cars/f4.json`, `gt3-a.json`, `gt3-b.json`, `gt3-c.json` — modify: add `cockpit`.
- `src/main.ts` — modify: after loading the player `CarSpec`, call `rig.setCockpitEye(spec.cockpit.eye)`.
- `tests/unit/acceptance/115-cockpit-data.test.ts` — acceptance worker.

## Steps

```ts
export interface CockpitSpec { eye: Vec3; wheel: Vec3; wheelRadius: number; lockDeg: number }
// CarSpec: cockpit: CockpitSpec   (always present after parseCarSpec)
```
(`CockpitSpec` imports `Vec3` already defined in carSpec.ts; JSON field is optional.)

1. Absent `cockpit` in JSON: eye = `COCKPIT_OFFSET` values (copy literals; carSpec.ts must not import from `src/render`, define `DEFAULT_COCKPIT_EYE` in carSpec.ts with the same values), wheel = eye + (0, -0.15, -0.45), wheelRadius 0.13, lockDeg 270.
2. Partial `cockpit` objects: missing `wheel` derives from the (given or default) eye as above; missing `wheelRadius`/`lockDeg` take defaults.
3. Validation: `wheelRadius` must be in [0.05, 0.3]; `lockDeg` in [90, 1080]; otherwise throw `Error` naming the field.
4. JSON values: f4 `eye` = default, `wheelRadius` 0.13, `lockDeg` 270; gt3-a/b/c `eye` = default, `wheel` = eye + (0,-0.15,-0.45), `wheelRadius` 0.17, `lockDeg` 480.

Conventions: no rounding; bounds inclusive; invalid input throws; parsing does not mutate input.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | parseCarSpec of f4.json / gt3-a.json | read cockpit | present; wheel.z < eye.z; wheel.y < eye.y; lockDeg 270 / 480 |
| AT2 | car JSON without cockpit | parseCarSpec | eye = COCKPIT_OFFSET; wheel = eye + (0, −0.15, −0.45) ± 1e-9; wheelRadius 0.13; lockDeg 270 |
| AT3 | wheelRadius 0 or 0.31, lockDeg 0 or 1081 | parseCarSpec | throws |

## Acceptance criteria

- [ ] AT1–AT3 pass; existing carSpec tests still pass.
- [ ] No import from `src/render` in `src/physics`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Steering wheel mesh (116), head motion (118), editing other CarSpec fields, prototype cars (they get defaults).
