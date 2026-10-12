# 012 — Create the base Three.js scene

Status: pending
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`createScene()` returns scene, camera, ground and sun without needing WebGL, and `createRenderer(canvas)` creates the configured `WebGLRenderer`.

## Context

`render` layer: may import `three` and `src/core`, NOT Rapier. Guide: `ai/guides/architecture.md`, section "Three.js". Shadows are out of scope.

## Files

- `src/render/sceneSetup.ts` — create
- `tests/unit/render/sceneSetup.test.ts` — create

## Steps

1. In `src/render/sceneSetup.ts` (`import * as THREE from 'three'`) export EXACTLY:

```ts
export interface SceneParts { scene: THREE.Scene; camera: THREE.PerspectiveCamera; ground: THREE.Mesh; sun: THREE.DirectionalLight }
export function createScene(): SceneParts;
export interface RendererHandle { renderer: THREE.WebGLRenderer; resize(width: number, height: number, camera: THREE.PerspectiveCamera): void; dispose(): void }
export function createRenderer(canvas: HTMLCanvasElement): RendererHandle;
```

2. `createScene()` (no WebGL, no `window`/`document`):
   - `scene.background = new THREE.Color('#9ec9f0')`; `scene.fog = new THREE.Fog('#9ec9f0', 300, 2500)`.
   - `HemisphereLight('#cfe8ff', '#5a7a3a', 0.8)` added to the scene.
   - `sun = DirectionalLight('#ffffff', 2.0)`, `position.set(300, 500, 200)`, `castShadow = false`, added to the scene.
   - `ground`: `Mesh(PlaneGeometry(6000, 6000), MeshStandardMaterial({ color: '#4f7a3a', roughness: 1 }))`, `rotation.x = -Math.PI / 2`, `position.y = 0`, `name = 'ground'`, added to the scene.
   - `camera = PerspectiveCamera(60, 16 / 9, 0.1, 5000)`, `position.set(0, 5, 10)` (not added to the scene).
3. `createRenderer(canvas)`: `new THREE.WebGLRenderer({ canvas, antialias: true })`; `setPixelRatio(Math.min(window.devicePixelRatio, 2))`; `outputColorSpace = THREE.SRGBColorSpace`; `toneMapping = THREE.ACESFilmicToneMapping`.
   - `resize(w, h, camera)`: `renderer.setSize(w, h, false)`; `camera.aspect = w / h`; `camera.updateProjectionMatrix()`.
   - `dispose()`: `renderer.dispose()`.
4. Comments only where the logic is not obvious.

## Tests (`tests/unit/render/sceneSetup.test.ts`, Node, `createScene` only)

- `scene has fog and sky-blue background`: `scene.fog` is `THREE.Fog` with near 300 and far 2500; `scene.background` is a `Color` with `getHexString() === '9ec9f0'`.
- `scene has at least two lights`: children with `isLight === true` count >= 2; `sun.position` = (300, 500, 200); `sun.castShadow === false`.
- `ground is rotated and named`: `ground.name === 'ground'`, `ground.rotation.x` ≈ -π/2 (5 decimals), `ground.position.y === 0`, child of `scene`.
- `camera has expected projection`: fov 60, near 0.1, far 5000, aspect ≈ 16/9, position (0, 5, 10).

## Acceptance criteria

- [ ] The 4 tests pass in Node without WebGL.
- [ ] `createRenderer` is NOT unit-tested (needs WebGL).
- [ ] `src/render/sceneSetup.ts` imports nothing except `three`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Shadows, skybox, post-processing, render loop, `window.resize` listeners (wired by `main.ts`, task 018).
- Trees, buildings or any other decoration.
