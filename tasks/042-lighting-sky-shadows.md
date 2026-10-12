# 042 — Sky, fog per track and car-following shadows

Status: done
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`applyEnvironment` adds a physical sky and per-track fog to a scene; `ShadowRig` keeps a high-resolution directional shadow centred on the car.

## Context

Acceptance tests for this task are Vitest in `tests/unit/acceptance/042-lighting-sky-shadows.test.ts` (Node, no WebGL; renderer in AT3 is a plain object with `shadowMap: { enabled: boolean }`). Scene comes from `createScene` in `src/render/sceneSetup.ts` (returns `{ scene, camera, ground, sun }`). Sky: `import { Sky } from 'three/addons/objects/Sky.js'`.

## Files

- `src/render/environment.ts` — create
- `tests/unit/render/environment.test.ts` — create (unknown track id falls back to monza; update moves light and target together)

## Steps

```ts
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
export const FOG_TABLE: Record<string, { color: string; density: number }> = {
  monza: { color: '#b8c9d9', density: 0.00055 },
  spa: { color: '#9aa7b0', density: 0.0011 },
  silverstone: { color: '#a9b3bb', density: 0.0008 },
};
export function applyEnvironment(scene: THREE.Scene, trackId: string): void;
export class ShadowRig {
  readonly light: THREE.DirectionalLight;
  constructor(scene: THREE.Scene);
  update(carPosition: Vec3): void;
  setEnabled(renderer: { shadowMap: { enabled: boolean } }, enabled: boolean): void;
}
```

- `applyEnvironment`: adds one `Sky` (named `sky`, scale 4500, sun elevation 35°, azimuth 150°; remove any previous `sky`), sets `scene.fog = new THREE.FogExp2(color, density)` from `FOG_TABLE` (unknown id → monza) and `scene.background = null` (the Sky is the background).
- `ShadowRig`: creates its own `DirectionalLight` (intensity 2, `castShadow` true, `shadow.mapSize` 2048×2048, orthographic shadow camera `left/bottom -60`, `right/top 60`, near 1, far 400, `shadow.bias` -0.0004) and adds light and `light.target` to the scene. Sun offset from the car (150, 200, 100).
- `update`: target at the car position, light at car + offset; texel-snap is NOT required. Updates `shadow.camera` matrices only via Three's own render.
- `setEnabled`: `renderer.shadowMap.enabled = enabled` and `light.castShadow = enabled`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/042-lighting-sky-shadows.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | scene from `createScene` | `applyEnvironment(scene, 'spa')` | Sky object present; fog colour and density from a per-track table (monza, spa, silverstone) |
| AT2 | `ShadowRig` | `update(carPosition)` | directional light shadow camera centred within 1 m of the car; mapSize 2048; frustum ±60 m |
| AT3 | preset 'low' | shadows | `renderer.shadowMap.enabled` false |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Calling `applyEnvironment` twice leaves exactly one `sky` in the scene.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Setting `castShadow`/`receiveShadow` on car, terrain or trees (task 043).
- Preset logic (task 052), changing `createScene`, time-of-day, clouds.
