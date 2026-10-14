# 144 — Damage model (pure)

Status: pending
Phase: 2
Depends on: 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure module that turns collision impulses into per-part damage and derives the performance effects of that damage.

## Context

M2.4, design `docs/plans/late-features.md` ("144"). Read the current code first: this task runs after 058 (`src/physics/carSpec.ts`); adapt file names to what exists, keep the public contract. No Rapier, no `three`. Car local frame: −Z forward, +X right; wheel order FL, FR, RL, RR (`WHEEL_NODE_NAMES` in `src/render/carRenderer.ts`). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/physics/damage.ts` — create.
- `tests/unit/acceptance/144-damage-model.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Vec3 } from '../core/types';
export interface DamageState { frontWing: number; rearWing: number; suspension: [number, number, number, number]; puncture: [boolean, boolean, boolean, boolean]; detached: [boolean, boolean, boolean, boolean] }
export interface Impact { impulse: number; point: Vec3; otherCar: boolean } // N·s, car local
export interface CarZones { halfLength: number; halfWidth: number; hubs: [Vec3, Vec3, Vec3, Vec3] } // hubs in wheel order
export interface DamageEffects { aeroFront: number; aeroRear: number; toe: [number, number, number, number]; gripScale: [number, number, number, number] }
export function createDamageState(): DamageState; // all 0 / false
export function applyImpact(state: DamageState, impact: Impact, zones: CarZones, rng: () => number): DamageState; // mutates and returns state
export function damageEffects(state: DamageState, out?: DamageEffects): DamageEffects;
```

1. Zone: nearest hub (3D distance) with distance ≤ 0.6 m → that corner; else `point.z < −0.6·halfLength` → front wing; `point.z > 0.6·halfLength` → rear wing; else none (no change, `rng` not called).
2. Damage added = `clamp((J − J0)/Jk, 0, 1)`, part value capped at 1: wings J0 1500, Jk 6000; suspension J0 3000, Jk 9000.
3. Corner hit with J > 2000: `puncture = true` if `rng() < clamp((J − 2000)/6000, 0, 1)`; `rng` is called only for corner hits with J > 2000.
4. Detach: corner whose suspension was already 1 BEFORE this hit and J > 9000 → `detached = true` and `puncture = true`.
5. `damageEffects`: aeroFront = 1 − 0.7·frontWing; aeroRear = 1 − 0.5·rearWing; toe (rad) = [0.03·s0, −0.03·s1, 0.02·s2, −0.02·s3]; gripScale per wheel = 0 if detached, else 0.35 if puncture, else 1. With `out`, reuse it (no allocation).

Conventions: hub radius inclusive (`<= 0.6`), zone thresholds strict (`<`, `>`); J ≤ J0 adds 0; non-finite or negative J is ignored; `applyImpact` mutates `state` only; no `Math.random`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | zones halfLength 2.5, hubs (±0.75, 0, ∓1.37); impact J 4500 at (0, 0.3, −2.3) | applyImpact | frontWing 0.5 ± 1e-9; all else 0 |
| AT2 | impact J 1400 anywhere | applyImpact | state unchanged |
| AT3 | impact J 7500 at the FR hub + (0.1, 0, 0) | applyImpact | suspension[1] 0.5 ± 1e-9; rng returning 0.1 → puncture[1] true; rng 0.95 → false |
| AT4 | two hits J 12000 at the RL hub | applyImpact ×2 | after 1st suspension[2] = 1, detached false; after 2nd detached[2] true and puncture[2] true |
| AT5 | frontWing 1, rearWing 0.5, suspension [1,0,0,0], puncture [false,true,false,false] | damageEffects | aeroFront 0.3, aeroRear 0.75, toe[0] 0.03, gripScale [1, 0.35, 1, 1] (± 1e-9) |
| AT6 | impact at (1.0, 0, 0) (side, no hub within 0.6) | applyImpact | unchanged |

## Acceptance criteria

- [ ] AT1–AT6 pass.
- [ ] `damage.ts` imports nothing from `three` or Rapier.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rapier contact events (145), applying effects to the vehicle (146), debris (147), HUD and settings (148).
- README, tasks.json, milestones.json.
