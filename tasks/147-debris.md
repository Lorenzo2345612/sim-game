# 147 — Debris: detached wings and wheels as physics bodies

Status: pending
Phase: 2
Depends on: 145, 146
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

When a wing is destroyed or a wheel detaches, a dynamic debris body appears, is rendered, collides with cars and track, and is cleaned up.

## Context

M2.4, design `docs/plans/late-features.md` ("147"). Read the current code first: this task runs after 145 (contact events, `DamageCar`) and 146 (`Vehicle.damage`); adapt file names to what exists, keep the public contract. Render may import `three`; physics code must not. Wheel order FL, FR, RL, RR; wheel nodes via `WHEEL_NODE_NAMES` (`src/render/carRenderer.ts`). Debris colliders must produce contact force events with car chassis (145). No `Math.random`: seeded mulberry32. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/physics/debris.ts` — create.
- `src/render/debrisRenderer.ts` — create (meshes for live debris; wheel mesh cloned from the car wheel node, wing as box in the livery colour or grey; hides the car's wheel node when `wheelHidden`).
- `src/game/raceGame.ts` — modify: owns the `DebrisField`, triggers spawns, steps it.
- `tests/unit/acceptance/147-debris.test.ts` — create (acceptance worker).

## Steps

```ts
export type DebrisKind = 'wheel' | 'frontWing' | 'rearWing';
export const MAX_DEBRIS = 8, DEBRIS_LIFETIME_S = 60, DEBRIS_MAX_DISTANCE_M = 300;
export class DebrisField {
  constructor(world: RAPIER.World, seed: number);
  spawn(kind: DebrisKind, car: number, wheel: number, position: Vec3, velocity: Vec3): void; // wheel = -1 for wings
  step(dt: number, carPositions: readonly Vec3[]): void;
  readonly count: number;
  wheelHidden(car: number, wheel: number): boolean; // true once a wheel debris of that car/wheel was spawned (until reset)
  getBodies(): readonly RAPIER.RigidBody[];
  dispose(): void;
}
```

1. Triggers (in `RaceGame`, per car, compare with previous tick): a wing crossing > 0.95 for the first time spawns wing debris once; `detached[i]` turning true spawns wheel debris once.
2. Shapes: wheel = cylinder (radius `wheelRadius` from the spec, width 0.3 m, mass 12 kg); front wing = box 1.6 × 0.05 × 0.4 m, 6 kg (or the model's front-wing bounds when available); rear wing = box 1.0 × 0.3 × 0.3 m, 5 kg.
3. Initial linear velocity = `velocity` argument (the car's point velocity); angular velocity: each component uniform in [−15, 15] rad/s from the seeded rng, then clamped to length ≤ 15.
4. Debris collides with cars and track and emits contact force events; a debris–car contact applies `applyImpact` to the car (debris counts as `otherCar: false`).
5. `step`: remove a body when age > 60 s or its distance to EVERY car position is > 300 m (horizontal XZ distance). At most 8 alive: spawning a 9th removes the oldest first. Removed bodies are deleted from the world.
6. Render: one mesh per live debris, pose copied from the body each frame (no per-frame allocation); meshes disposed on removal and `dispose()`.

Conventions: positions/velocities in world metres and m/s; age strict `>`; distance strict `>`; non-finite inputs ignored.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node: detach FR at 40 m/s | spawn | one debris body; initial speed 40 ± 2 m/s; car's FR wheel node hidden (render flag) |
| AT2 | 10 detach/wing events | count | ≤ 8 debris alive, oldest removed first |
| AT3 | debris left alone 61 s | step | removed |
| AT4 | a car driving through a debris wheel at 30 m/s | contact | contact event with the car (debris is a hazard); no NaN |

## Acceptance criteria

- [ ] AT1–AT4 pass; "render flag" in AT1 = `wheelHidden(car, 1) === true`.
- [ ] 60 s race with no damage creates no debris and no extra bodies.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Damage computation (144–146), HUD/repair (148), debris sound or particles, wing visual deformation.
- README, tasks.json, milestones.json.
