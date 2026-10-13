# Architecture (Phase 0)

Reference document for all tasks. If a task contradicts this guide, the task wins.

## Pinned versions (npm, checked 2026-10-11, Node 24)

| Package | Version | Note |
|---|---|---|
| typescript | `~6.0.3` | do NOT use 7.x: typescript-eslint only supports `<6.1.0` |
| vite | `^8.3.4` | |
| vitest | `^5.0.3` | `node` environment |
| three | `^0.186.1` | import addons from `three/addons/...` |
| @types/three | `^0.186.0` | |
| @dimforge/rapier3d-compat | `0.21.0` | exact; the vehicle API is verified with this version |
| eslint | `^10.12.0` | flat config `eslint.config.js` |
| @eslint/js | `^10.0.1` | |
| typescript-eslint | `^8.71.1` | |
| tsx | `^4.23.15` | run `tools/` scripts |
| @types/node | `^24.0.0` | |
| @playwright/test | `1.64.0` | only from the e2e task |

Package manager: npm. `"type": "module"` in `package.json`.

## Layers and allowed dependencies

```
src/core     → nothing (pure TypeScript)
src/track    → core
src/physics  → core, track (surface geometry only), @dimforge/rapier3d-compat
src/game     → core, track, physics (simulation orchestration, no three, no DOM)
src/input    → core
src/render   → core, three
src/ui       → core (DOM)
src/main.ts  → everything (the only place that wires layers)
tools/       → src/core, src/track, node:fs, node:path
```

- `core`, `track`, `physics` and `input` do NOT import `three` (tested in Node without WebGL).
- `render` does not import Rapier: it receives already computed states (`VehicleState`).
- No module except `main.ts` touches `window` or `document`, except `input` (events) and `ui` (DOM), which receive them injected, and `render/createRenderer`, which may read `window.devicePixelRatio`.

## Conventions

- SI units: meters, seconds, kilograms, radians, newtons, m/s. km/h only in the UI (`m/s * 3.6`).
- World axes: Y up. The track lies in the XZ plane with Y = 0. Geographic north = -Z, east = +X.
- The car faces **-Z** in its local space; +X is its right.
- Yaw (rotation about Y) for forward direction `(dx, dz)`: `yaw = Math.atan2(-dx, -dz)`. Quaternion: `{ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }`.
- Forward vector of a quaternion `q` (apply q to (0,0,-1)):
  `fx = -2*(q.x*q.z + q.w*q.y)`, `fy = -2*(q.y*q.z - q.w*q.x)`, `fz = -(1 - 2*(q.x*q.x + q.y*q.y))`.
- Simulation at fixed step `FIXED_DT = 1/120` s. Render interpolates between the previous and current state.
- File names in camelCase (`lapTimer.ts`). Named exports, no `export default`.
- `strict: true`, no `any`.

## Shared types (`src/core/types.ts`, task 002)

```ts
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** Normalised driver controls. steer: -1 = full left, +1 = full right. */
export interface DriverInput { throttle: number; brake: number; steer: number; reset: boolean; shiftUp?: boolean; shiftDown?: boolean }

export interface SpawnPose { position: Vec3; yaw: number }

export interface WheelState {
  /** Wheel centre in world space. */
  position: Vec3;
  /** Steering angle in radians as applied to Rapier (positive = left). */
  steering: number;
  /** Accumulated spin angle around the axle in radians (Rapier wheelRotation). */
  rotation: number;
  inContact: boolean;
}

export interface VehicleState {
  position: Vec3;
  rotation: Quat;
  /** Signed speed along the car's forward axis, m/s (negative when reversing). */
  forwardSpeed: number;
  wheels: WheelState[]; // order: front-left, front-right, rear-left, rear-right
}

/** Output of tools/track-builder, served from public/tracks/<id>.json. */
export interface TrackData {
  id: string;                 // "monza"
  name: string;               // "Monza" (city/region name, never the commercial name)
  widthMeters: number;        // 12
  lengthMeters: number;       // length of the resampled closed centerline
  officialLengthMeters: number;
  /** Closed centerline [x, z] in metres, ~2 m spacing, index 0 = start/finish line, last point NOT repeated. */
  centerline: [number, number][];
  /** Centerline indices where sectors 1, 2, 3 start. sectors[0] is always 0. */
  sectors: [number, number, number];
  source: { dataset: string; license: string; url: string };
}

export type LapEvent =
  | { type: 'lapStarted'; lap: number; time: number }
  | { type: 'sectorCompleted'; lap: number; sector: number; sectorTime: number }
  | { type: 'lapCompleted'; lap: number; lapTime: number; isBest: boolean };

export type Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff';
export type Side = 'left' | 'right';
/** Centerline index range; end is inclusive, segments may wrap (end < start). */
export interface TrackSegment { start: number; end: number; side: Side }
export interface RunoffSegment extends TrackSegment { surface: 'gravel' | 'runoff'; widthMeters: number }
export interface BarrierSegment extends TrackSegment { type: 'armco' | 'tyres' | 'wall'; offsetMeters: number }
export interface Terrain { originX: number; originZ: number; sizeX: number; sizeZ: number; rows: number; cols: number; heights: number[] } // Rapier layout; origin = centre
export interface TreeSpecies { name: string; preset: string; heightMeters: number }
export interface TreeInstances { species: string; data: number[] } // flat [x, z, scale, rotY] * n
export interface Grandstand { x: number; z: number; yaw: number; lengthMeters: number; rows: number; roof: boolean }
export interface PitLane { start: number; end: number; side: Side }
export interface SurfaceStrip { surface: Surface; positions: Float32Array; indices: Uint32Array; uvs: Float32Array } // task 031 builds, 032/037 consume
export interface TrackDataV2 extends Omit<TrackData, 'source'> {
  version: 2;
  elevation: number[];      // metres, per centerline point, relative to the start line (start = 0)
  kerbs: TrackSegment[];
  runoffs: RunoffSegment[];
  barriers: BarrierSegment[];
  terrain: Terrain;
  treeSpecies: TreeSpecies[];
  trees: TreeInstances[];
  grandstands: Grandstand[];
  pit: PitLane;
  source: { dataset: string; license: string; url: string; dem: string };
}
```

## Constants (`src/core/constants.ts`, task 002)

```ts
import type { Surface } from './types';

export const FIXED_DT = 1 / 120;          // s
export const MAX_STEPS_PER_FRAME = 8;     // avoid spiral of death
export const GRAVITY = -9.81;             // m/s², Y axis
export const AIR_DENSITY = 1.225;         // kg/m³
export const MS_TO_KMH = 3.6;
export const KERB_WIDTH = 1.2;            // m, outside the asphalt edge
export const VERGE_WIDTH = 4;             // m of grass between asphalt/kerb/runoff and barrier where no runoff
export const BARRIER_GAP = 1;             // m extra beyond verge/runoff
export const CORNER_RADIUS = 400;         // m: points with radius below this are "corner"
export const KERB_RADIUS = 250;           // m: kerbs where radius below this
export const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1, kerb: 0.9, runoff: 0.95, grass: 0.45, gravel: 0.35 }; // × frictionSlip
export const SURFACE_DRAG: Record<Surface, number> = { asphalt: 0, kerb: 0, runoff: 0, grass: 0.15, gravel: 0.6 };   // × m·g, per wheel share
```

## Placeholder car (values calibrated with Rapier 0.21.0)

Measured calibration: 0-100 km/h in 3.4 s, top speed 222 km/h, braking ~1.6 g at `brake = 1`, stable at 190 km/h with full steering (no flip).

```ts
export const PLACEHOLDER_CAR = {
  massKg: 650,
  chassisHalfExtents: { x: 0.8, y: 0.2, z: 2.0 },   // m
  wheelRadius: 0.33,                                 // m
  suspensionRestLength: 0.12,                        // m
  maxSuspensionTravel: 0.1,                          // m
  suspensionStiffness: 60,
  suspensionCompression: 4.4,
  suspensionRelaxation: 2.3,
  frictionSlip: 2.2,
  sideFrictionStiffness: 1.0,
  // chassis-space connection points: FL, FR, RL, RR
  wheelPositions: [
    { x: -0.8, y: 0, z: -1.3 }, { x: 0.8, y: 0, z: -1.3 },
    { x: -0.8, y: 0, z: 1.25 }, { x: 0.8, y: 0, z: 1.25 },
  ],
  enginePowerW: 130000,        // power limit
  maxDriveForceN: 6000,        // traction limit at low speed, split across rear wheels
  brakeMax: 20,                // Rapier brake value per wheel at brake = 1
  maxSteerLowSpeed: 0.35,      // rad, at 0 m/s
  maxSteerHighSpeed: 0.10,     // rad, at >= 60 m/s (linear in between)
  dragAreaCdA: 0.9,            // m²
  liftAreaClA: 2.0,            // m² (downforce)
} as const;
```

## Rapier: verified facts (do not change without testing)

- `await RAPIER.init()` once before creating anything (`import RAPIER from '@dimforge/rapier3d-compat'`).
- Mundo: `new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })`, `world.timestep = FIXED_DT`.
- Phase 0 ground: fixed collider `ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0)` (surface at y = 0). The track is visual only in Phase 0.
- Chassis: `RigidBodyDesc.dynamic().setTranslation(x, 0.6, z).setRotation(q).setCanSleep(false)` + `ColliderDesc.cuboid(hx, hy, hz).setMass(massKg)`.
- `const v = world.createVehicleController(body)`. Wheels: `v.addWheel(connection, {x:0,y:-1,z:0}, {x:1,y:0,z:0}, restLength, radius)`. **The axle is (1,0,0)**: with this, a POSITIVE engine force moves the car toward **-Z** (forward).
- **Steering: positive `setWheelSteering` turns LEFT.** Therefore `wheelSteering = -input.steer * maxSteer`.
- Rear-wheel drive: `setWheelEngineForce(2|3, F / 2)`, con `F = throttle * min(maxDriveForceN, enginePowerW / max(forwardSpeed, 1))`.
- Brake: `setWheelBrake(i, brake * brakeMax)` on all 4 wheels.
- Do not use `currentVehicleSpeed()` (misleading sign). `forwardSpeed = dot(linvel, forward(q))`.
- Aerodynamics every step, BEFORE `updateVehicle`:
  - Drag: `k = 0.5 * AIR_DENSITY * CdA * |v| * dt`; `body.applyImpulse({x: -v.x*k, y: -v.y*k, z: -v.z*k}, true)` (if `|v| > 0.01`).
  - Downforce: `body.applyImpulse({x: 0, y: -0.5 * AIR_DENSITY * ClA * forwardSpeed² * dt, z: 0}, true)`.
- Step order: apply forces/impulses → `v.updateVehicle(dt)` → `world.step()`.
- Resting chassis height ≈ 0.39 m.
- `wheelRotation(i)` grows positive when moving forward. Visually, a wheel moving toward -Z rotates by a NEGATIVE angle about +X: use `-rotation` in render.
- Free with `world.free()` in tests (`afterEach`).

## Three.js

- `import * as THREE from 'three'`; addons: `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'`.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`, `renderer.toneMapping = THREE.ACESFilmicToneMapping`.
- Do not create `Vector3`/`Quaternion`/arrays inside the loop: module- or instance-level temporaries.
- `dispose()` geometries, materials and textures when discarding.

## Visual car (Kenney Car Kit, CC0)

Files `assets/vendor/kenney-car-kit/race.glb` and `assets/vendor/kenney-car-kit/Textures/colormap.png` (the GLB references the external texture `Textures/colormap.png`): copy to `public/models/race.glb` and `public/models/Textures/colormap.png`. Nodes: `body`, `wheel-front-left`, `wheel-front-right`, `wheel-back-left`, `wheel-back-right`. The model faces **+Z** (rotate it by π about Y), measures 2.56 × 1.2 m and its wheels have radius 0.3.
- Body: scale 1.6, Y rotation = π, position = chassis with local offset `(0, -0.45, 0)`.
- Wheels: detached from the body, scale 1.1 (radius 0.33 = physical), placed every frame at `WheelState.position`; orientation = chassis rotation × `Ry(steering)` × `Rx(-rotation)` × `Ry(π)`.

## Track data

- Source: `assets/source/tracks/it-1922.geojson` (bacinger/f1-circuits, MIT). `FeatureCollection` with 1 `LineString` of 125 `[lon, lat]` points, closed (first point = last), in race direction, starting at the start/finish line. `properties.length = 5793`.
- Local equirectangular projection centered on the bbox center: `R = 6371008.8`; `x = (lon - lon0) * cos(lat0 rad) * R * π/180`; `z = -(lat - lat0) * R * π/180`.
- Expected length after projecting: 5786.6 m (raw polyline), ~5788.5 m after Catmull-Rom. Acceptance tolerance: ±1 % of 5793.
- Phase 0 width: 12 m. Flat (y = 0).
- Spawn: point `centerline[N - 5]` (10 m before the finish line), yaw toward `centerline[N - 4]`, y = 0.6.
