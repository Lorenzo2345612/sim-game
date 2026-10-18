# 281 — Electric powertrain math (motor, power split, battery, regen)

Status: pending
Phase: 7
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure module with the per-axle electric motor torque curve, front/rear power split, regen/friction blend and a battery model. Used later by 283/284/286; nothing consumes it yet.

## Context

Design: `docs/design/m7.1-electric.md`. Pure simulation code: no `three`, no Rapier, no imports from other src files. SI units (W, Nm, rad/s, J).

## Files

- `src/physics/electric.ts` — create
- `tests/unit/acceptance/281-electric-powertrain-math.test.ts` — create (from the table)

## Steps

```ts
export interface MotorSpec { maxPowerW: number; maxTorqueNm: number; maxRpm: number; ratio: number; regenMaxW: number }
export const REGEN_MIN_OMEGA = 3; // rad/s
export function motorWheelTorque(m: MotorSpec, wheelOmega: number, powerCapW: number, throttle: number): number;
export function splitPower(capW: number, front: MotorSpec, rear: MotorSpec): [number, number]; // [frontW, rearW]
export function regenSplit(axleBrakeNm: number, wheelOmega: number, m: MotorSpec, batteryFull: boolean): { regenNm: number; frictionNm: number };
export class Battery {
  constructor(capacityJ: number, startJ?: number);
  readonly capacityJ: number;
  get socJ(): number; get frac(): number; get empty(): boolean; get full(): boolean;
  drain(mechW: number, dt: number, eff: number): void;
  charge(mechW: number, dt: number, eff: number): void;
}
```

1. `motorWheelTorque`: motor speed ω_m = |wheelOmega|·ratio. Motor torque = throttle·min(maxTorqueNm, min(maxPowerW, powerCapW)/ω_m); ω_m = 0 gives maxTorqueNm. Result 0 when ω_m ≥ maxRpm·2π/60. Wheel torque = motor torque·ratio (always ≥ 0).
2. `splitPower`: each share proportional to maxPowerW, then clamped to that motor's maxPowerW.
3. `regenSplit`: limit = m.regenMaxW/|wheelOmega|; regenNm = min(request, limit); regenNm = 0 if `batteryFull` or |wheelOmega| < `REGEN_MIN_OMEGA`; frictionNm = request − regenNm.
4. `Battery`: `drain` removes mechW·dt/eff J, `charge` adds mechW·dt·eff J; socJ clamped to [0, capacityJ]; startJ defaults to capacityJ; `frac` = socJ/capacityJ; `empty` = socJ ≤ 0; `full` = socJ ≥ capacityJ.

Conventions: no rounding; `<`/`≥` as written above; throttle clamped to [0, 1]; negative mechW/dt/powerCapW treated as 0; axleBrakeNm ≤ 0 returns {0, 0}; no input is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

R = {350e3, 557, 20000, 7.8, 350e3}; F = {250e3, 400, 20000, 7.8, 350e3}.

| ID | Given | When | Then (tol 1e-3 relative unless noted) |
|---|---|---|---|
| AT1 | R, cap 350e3, throttle 1 | wheelOmega 0 / 40.2768 (3000 rpm motor) | 4344.6 / 4344.6 Nm |
| AT2 | R, cap 350e3 | wheelOmega 161.107 (12000 rpm motor) | 2172.4 Nm (power-limited) |
| AT3 | R, cap 262.5e3 | wheelOmega 161.107 | 1629.3 Nm |
| AT4 | R | wheelOmega 270 (motor 2106 rad/s ≥ 20000 rpm) | 0 |
| AT5 | R, cap 350e3, throttle 0.5 / −0.2 | wheelOmega 40.2768 | 2172.3 / 0 |
| AT6 | F, R | splitPower 450e3 / 600e3 / 700e3 | [187500, 262500] / [250000, 350000] / [250000, 350000] (exact) |
| AT7 | R, request 3000 Nm | ω 50 / ω 200 / ω 2 / ω 50 full | regen 3000 fr 0 / regen 1750 fr 1250 / regen 0 fr 3000 / regen 0 fr 3000 |
| AT8 | Battery(184.5e6) | drain(100e3, 1, 0.95) | socJ 184.5e6 − 105263.158 (1e-3 J) |
| AT9 | Battery(184.5e6, 1e6) | charge(100e3, 1, 0.95) | 1.095e6 |
| AT10 | Battery(1e6, 100) | drain(1e6, 1, 0.95) | socJ 0, empty true; then charge(1e9,1,1) → socJ 1e6, full true |

## Acceptance criteria

- [ ] All ATs pass.
- [ ] `src/physics/electric.ts` imports nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- CarSpec parsing (283), vehicle integration (284), attack mode (282), HUD, audio.
- Pit boost, coast regen, temperature/derating.
