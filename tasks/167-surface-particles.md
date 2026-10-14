# 167 — Surface particles (stones, dust, grass clippings)

Status: pending
Phase: 1
Depends on: 165, 065
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Wheels on gravel throw stones and dust, wheels on grass throw clippings.

## Context

Depends on 165 only for `src/main.ts` serialisation, and on 065 for per-wheel `Telemetry.surface` (`Game.getTelemetry`, added by 164). Contact point per wheel: `VehicleState.wheels[i].position` (wheel centre) with y lowered by the wheel radius from the F4 spec (0.28 m); only wheels with `inContact`. Convention: no per-frame allocation (CLAUDE.md); dispose GPU resources.

## Files

- `src/render/surfaceParticles.ts` — create.
- `src/main.ts` — modify: create `SurfaceParticles` with the scene on track load; per frame and per wheel in contact, a preallocated fractional accumulator adds `emissionRate(surface, speed)·dt`; emit `floor(acc)` particles (subtract it) at the contact point with the car's velocity (preallocated Vec3); call `update(frame)`; `dispose()` on track unload. No emission while paused.
- `tests/unit/acceptance/167-surface-particles.test.ts` — create.

## Steps

```ts
import type { Surface, Vec3 } from '../core/types';
export function emissionRate(surface: Surface, speed: number): number; // per wheel, /s: speed < 3 m/s or non-finite → 0; grass 1.5·speed; gravel 3·speed; others 0
export class SurfaceParticles {
  constructor(scene: THREE.Scene, maxParticles?: number); // default 600; one pooled THREE.Points (or InstancedMesh) added to the scene
  emit(surface: Surface, pos: Vec3, vel: Vec3, count: number): void;
  update(dt: number): void; // integrate, age, hide dead; no allocations
  aliveCount(): number;
  dispose(): void; // removes from scene, disposes geometry and material
}
```

- `emit` gravel: half stones (life 1.2 s, ballistic with g = 9.81, grey-beige), half dust (life 2.0 s, slow rise, fades, grows). Grass: clippings (life 1.0 s, green). Other surfaces ignored. Initial velocity = `vel` plus a small random upward/sideways kick.
- Ring buffer: when full, the oldest particle is overwritten. Buffers are allocated once in the constructor (position array never reallocated).

Conventions: `count` non-finite or ≤ 0 does nothing; `dt` non-finite or ≤ 0 is ignored; a particle is dead when age ≥ life.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | emissionRate | ('gravel',20) / ('grass',20) / ('gravel',2) / ('asphalt',50) / ('kerb',50) / ('grass',NaN) | 60 / 30 / 0 / 0 / 0 / 0 |
| AT2 | new SurfaceParticles(scene, 600) | construct | scene gained exactly 1 child; aliveCount 0 |
| AT3 | pool 600 | emit('gravel', p, v, 100) | aliveCount 100 |
| AT4 | after AT3 | update(1/60) repeated for 2.1 s | aliveCount 0 |
| AT5 | pool 600 | emit('grass', p, v, 1000) | aliveCount 600, no throw |
| AT6 | pool 600 | emit('asphalt'…, 50); emit('kerb'…, 50); emit('runoff'…, 50) | aliveCount 0 |
| AT7 | gravel stones emitted at y = 1 with vel (0,0,0) | update(1/60) × 30 (0.5 s) | every stone y < 1 and finite; the position attribute array is the same object as before (no reallocation) |
| AT8 | any state | dispose() | object removed from scene; geometry.dispose and material.dispose called once each |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Protected tests: none change numbers.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wet grass, gravel dragged onto the track, tyre smoke/marks, audio, quality-settings toggle.
