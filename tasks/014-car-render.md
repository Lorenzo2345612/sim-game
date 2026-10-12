# 014 — Render the car (Kenney model)

Status: done
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`CarRenderer` loads the `race.glb` model, detaches the wheels from the body and positions them every frame from `VehicleState`.

## Context

Guide: `ai/guides/architecture.md`, sections "Visual car" and "Rapier: verified facts" (`wheelRotation` sign). `render` layer (three + core, no Rapier). `VehicleState` and `Quat` from `src/core/types.ts`. The model faces +Z; each wheel node's pivot is at the wheel centre (node translation), so setting `position = 0` puts the wheel centre at its group's origin.

## Files

- `public/models/race.glb` — create (copy of `assets/vendor/kenney-car-kit/race.glb`)
- `public/models/Textures/colormap.png` — create (copy of `assets/vendor/kenney-car-kit/Textures/colormap.png`)
- `src/render/carRenderer.ts` — create
- `tests/unit/render/carRenderer.test.ts` — create

## Steps

1. Copy both files with `mkdir -p public/models/Textures && cp ...`. Do not modify `assets/`.
2. In `src/render/carRenderer.ts` export EXACTLY:

```ts
export const WHEEL_NODE_NAMES = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'] as const; // same order as VehicleState.wheels
export function computeWheelQuaternion(chassis: Quat, steering: number, rotation: number, out: THREE.Quaternion): THREE.Quaternion;
export class CarRenderer {
  static async load(url: string): Promise<CarRenderer>;
  static fromGltfScene(gltfScene: THREE.Object3D): CarRenderer;
  readonly root: THREE.Group;
  update(state: VehicleState): void;
  dispose(): void;
}
```

3. `computeWheelQuaternion`: `out = chassis × Ry(steering) × Rx(-rotation) × Ry(π)` (quaternion multiplication in that order, left to right). Use module-level temporary quaternions and constant axes with `setFromAxisAngle` (no allocations). Returns `out`.
4. `load(url)`: `new GLTFLoader().loadAsync(url)` (`import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`) then `CarRenderer.fromGltfScene(gltf.scene)`.
5. `fromGltfScene(scene)`:
   - Find with `scene.getObjectByName(name)` the `body` node and the 4 in `WHEEL_NODE_NAMES`. If one is missing: `throw new Error('Missing node: <name>')` (`body` is checked first, then the wheels in `WHEEL_NODE_NAMES` order).
   - `root = new THREE.Group()`. Children of `root`, in this order: `carBody` (Group) and 4 `wheelGroup` (Group).
   - Body: `bodyPivot = new Group()`, `bodyPivot.rotation.y = Math.PI`, `bodyPivot.position.y = -0.45`; `body.removeFromParent()`, `body.scale.setScalar(1.6)`, `bodyPivot.add(body)`, `carBody.add(bodyPivot)`.
   - Each wheel: `wheel.removeFromParent()`, `wheel.position.set(0, 0, 0)`, `wheel.scale.setScalar(1.1)`, `wheelGroup.add(wheel)`. Wheels do NOT hang from `carBody`: their groups live in world coordinates.
   - Store `carBody` and `wheelGroups: THREE.Group[]` (order = `WHEEL_NODE_NAMES`) as private fields, plus `private readonly tmpQuat = new THREE.Quaternion()`.
6. `update(state)`: `carBody.position.set(state.position.x, .y, .z)`; `carBody.quaternion.set(rot.x, rot.y, rot.z, rot.w)`. For i in 0..3: `wheelGroups[i].position.set(w.position.x, w.position.y, w.position.z)` and `wheelGroups[i].quaternion.copy(computeWheelQuaternion(state.rotation, w.steering, w.rotation, this.tmpQuat))`. No object creation in `update`.
7. `dispose()`: `root.traverse` and for each `Mesh`: `geometry.dispose()`; for each material (array or single): call `dispose()` on every property that is a `THREE.Texture` (e.g. `map`), then `material.dispose()`.
8. Comments only where the logic is not obvious.

## Tests (`tests/unit/render/carRenderer.test.ts`, Node, no loader, no WebGL)

Test helper: root `Object3D` with children `body` (Mesh with `BoxGeometry` + `MeshStandardMaterial`) and the 4 wheels (Mesh with `BoxGeometry`), each with a non-zero `position`.

- `fromGltfScene builds root with body and wheels`: does not throw; `root.children.length === 5`.
- `fromGltfScene throws on missing wheel`: without `wheel-back-right` → `toThrow('Missing node: wheel-back-right')`.
- `fromGltfScene throws on missing body`: `toThrow('Missing node: body')`.
- `update places wheels at state positions`: state with 4 distinct positions; after `update`, each wheel's world position (`getWorldPosition`) ≈ the state's (4 decimals), in `state.wheels` order; `carBody` at `state.position`.
- `computeWheelQuaternion identity is Ry(pi)`: (identity, 0, 0) ≈ `{x:0, y:1, z:0, w:0}` up to global sign (compare `Math.abs` of components, 5 decimals).
- `computeWheelQuaternion steering adds yaw`: with `q0` (steering 0) and `q1` (steering 0.3), identity chassis, rotation 0: `q1 × q0⁻¹` ≈ `Ry(0.3)` (`setFromAxisAngle(Y, 0.3)`), compared with `angleTo` < 1e-5.
- `computeWheelQuaternion returns out`: returns the same object passed in.
- `dispose does not throw` and calls `geometry.dispose` (spy with `vi.spyOn`).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/014-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | fake scene: Object3D 'body' + 4 Mesh wheels named per `WHEEL_NODE_NAMES` | `CarRenderer.fromGltfScene` | returns instance; root has 5 children: car body group (containing the body pivot) + 4 wheel groups |
| AT2 | fake scene without 'wheel-back-right' | `fromGltfScene` | throws Error('Missing node: wheel-back-right') |
| AT3 | instance | `update(state)` with wheel positions p0..p3 | each wheel group world position = p_i ±1e-6; body follows state.position |
| AT4 | identity chassis | `computeWheelQuaternion(id, 0, 0, out)` | equals Ry(π) (angleTo < 1e-6) |
| AT5 | identity chassis | steering 0.3 vs 0 | yaw difference 0.3 ±1e-6 |
| AT6 | files | — | `public/models/race.glb` and `public/models/Textures/colormap.png` exist |

## Acceptance criteria

- [ ] Tests pass in Node. `public/models/race.glb` and `public/models/Textures/colormap.png` exist.
- [ ] No `new` inside `update` or `computeWheelQuaternion`.

## Verification

```
npm run typecheck
npm run lint
npm test
ls public/models public/models/Textures
```

## Out of scope

- Visual verification (task 018). Known risk: if the wheels spin backwards on screen, flip the sign of `rotation` in `computeWheelQuaternion` (and its test); note it, do not fix it here.
- State interpolation (task 017), shadows, custom materials/colours, smoke, visual suspension.
- Modifying `assets/` or `ASSETS_LICENSES.md`.
