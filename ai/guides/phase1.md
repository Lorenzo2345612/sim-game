# Phase 1 design (planner, closed)

Goal: the three MVP tracks (Monza, Spa, Silverstone) look like real circuits (elevation, kerbs, run-offs, barriers, forests, grandstands, pits), the car reacts to surfaces, and the time-trial game is complete (gearbox, gamepad, cameras, HUD v2, minimap, ghost, audio, presets, track menu). The F4 car model is blocked until the user downloads it.

## Data flow

Offline (`tools/`, Node): GeoJSON + DEM window → `TrackData` v2 in `public/tracks/<id>.json` (one file per track, everything included). Runtime builds every mesh and collider from that data; no track `.glb`.

## Verified facts (planner experiments)

- Copernicus DEM GLO-30 tiles are public Cloud-Optimized GeoTIFFs: `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_<LAT>_00_<LON>_00_DEM/Copernicus_DSM_COG_10_<LAT>_00_<LON>_00_DEM.tif` where the tile is named by its south-west corner, e.g. `N45_00_E009_00` (Monza), `N50_00_E005_00` (Spa), `N52_00_W002_00` (Silverstone, lon −1.02…−1.01). 44 MB each: read only a window with `geotiff` (`fromUrl` + `readRasters({ window })`, HTTP range requests), never download whole tiles.
- GeoJSON sources (MIT, bacinger/f1-circuits) are in `assets/source/tracks/`: `it-1922` (Monza, 5793 m), `be-1925` (Spa, 7004 m), `gb-1948` (Silverstone, 5891 m). All closed LineStrings in race direction starting at the start line.
- Rapier heightfield (`ColliderDesc.heightfield(nrows, ncols, heights, scale)`): `heights.length = (nrows+1)*(ncols+1)`, column-major: `index = col*(nrows+1) + row`; row `i` ↔ `z = -scale.z/2 + i*scale.z/nrows`, col `j` ↔ `x = -scale.x/2 + j*scale.x/ncols`; centred on the collider translation. Verified in `ai/lab/terrain-colliders.mjs`.
- Trimesh colliders with triangles wound counter-clockwise seen from +Y are hit by the vehicle's down rays. `vehicle.wheelGroundObject(i)` returns the collider under each wheel: compare `collider.handle` with a handle → surface map.
- Kenney assets stay only until the F4 car arrives; all new environment is procedural or CC0 textures (`docs/research/track-textures.md`).

## TrackData v2 (`src/core/types.ts`, task 022)

Extends v1 (`version: 2`). All indices are centerline indices; segments may wrap (`end < start`).

```ts
export type Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff';
export type Side = 'left' | 'right';
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

## Constants (`src/core/constants.ts`, task 022)

```ts
export const KERB_WIDTH = 1.2;            // m, outside the asphalt edge
export const VERGE_WIDTH = 4;             // m of grass between asphalt/kerb/runoff and barrier where no runoff
export const BARRIER_GAP = 1;             // m extra beyond verge/runoff
export const CORNER_RADIUS = 400;         // m: points with radius below this are "corner"
export const KERB_RADIUS = 250;           // m: kerbs where radius below this
export const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1, kerb: 0.9, runoff: 0.95, grass: 0.45, gravel: 0.35 }; // × frictionSlip
export const SURFACE_DRAG: Record<Surface, number> = { asphalt: 0, kerb: 0, runoff: 0, grass: 0.15, gravel: 0.6 };   // × m·g, per wheel share
```

## Builder rules (tools, tasks 024–030)

- Elevation: DEM bilinear at each centerline point → circular moving average over 25 points (≈50 m) → minus value at index 0.
- Radius per point: circumradius of points i−5, i, i+5 (circular); straight = 1e6. Turning side: sign of cross product (left turn → corner inside = left).
- Kerbs: maximal runs where radius < KERB_RADIUS, extended 10 points each way, on the inside; plus on the outside for the last 15 points of each run (exit kerb). Runs shorter than 8 points dropped.
- Run-offs (outside of corners where radius < CORNER_RADIUS, extended 15 points): radius < 150 m → gravel 18 m; otherwise runoff (asphalt) 12 m.
- Barriers: both sides along the whole lap; offset = width/2 + (kerb ? KERB_WIDTH : 0) + (runoff width or VERGE_WIDTH) + BARRIER_GAP, taking per-segment maxima; type `tyres` where outside runoff is gravel, `wall` on the pit side between pit start/end, else `armco`. Barrier segments merge consecutive points with equal type and offset (offset rounded to 0.5 m).
- Terrain: grid covering track bbox + 400 m margin, spacing ≈ 8 m (rows/cols derived), DEM bilinear, relative to the same start-line value; within `width/2 + max offset + 5 m` of the centerline the height is the nearest centerline elevation − 0.15 m; linear blend to DEM over the next 30 m.
- Trees: deterministic (mulberry32, seed = hash of track id), jittered grid 12 m inside terrain bounds; keep a point if its distance to the centerline > barrier offset + 15 m and random < biome density; species by biome weights; scale = 0.85–1.15; rotY uniform; max 6000.
- Biomes (`tools/track-builder/tracks.json`): monza `{ oak 0.4, ash 0.3, aspen 0.3, density 0.55 }`, spa `{ pine 0.6, oak 0.4 (beech stand-in), density 0.65 }`, silverstone `{ oak 0.5, ash 0.5, density 0.12 }`; species presets: oak→'Oak Medium' 18 m, ash→'Ash Medium' 20 m, aspen→'Aspen Large' 25 m (poplar stand-in), pine→'Pine Large' 26 m.

## Runtime (src)

- `src/track/surfaces.ts` (task 031): pure geometry arrays from TrackDataV2: asphalt (elevation, y + 0.02), kerbs (+0.04, stripes 1.5 m via UV.v), runoff/gravel strips (+0.01), each `{positions, indices, uvs}` plus a `surface` tag. Shared by render and physics.
- Physics (task 032): `createPhysicsWorld(track?: TrackDataV2)`: heightfield terrain + one trimesh collider per surface strip set (map handle → Surface) + barrier walls (vertical quads 1.0 m high along barrier polylines). No track → Phase 0 flat ground (keep tests valid).
- Grip (task 033): before `updateVehicle`, per wheel: surface from `wheelGroundObject` (none → asphalt), `frictionSlip = base × SURFACE_GRIP`, drag impulse `SURFACE_DRAG × m × g × dt / 4` per wheel against velocity.
- Trees (task 039): EZ-Tree (MIT, `@dgreenheck/ez-tree`) generates 3 seeds per species at load, scaled to `heightMeters`; one `InstancedMesh2` (`@three.ez/instanced-mesh`, MIT) per variant/part with frustum culling; LOD: second variant with `options.leaves.count` halved beyond 250 m; hide beyond 1500 m.
- Gearbox (task 045): 6 gears, ratios `[3.2, 2.3, 1.8, 1.45, 1.2, 1.0]` × final 3.4, wheel radius 0.33 m, rpm = |v| / r × ratio × final × 60/2π clamped ≥ 3000 idle; limiter 9000 rpm (no drive force above); auto up-shift at 8500, down-shift at 5000; manual Q/E (gamepad LB/RB). Drive force unchanged formula (power-limited) but zero at limiter.
- All new runtime features expose debug getters on `window.__SIMGAME__` (task 054) for e2e checks.

## New dependencies (exact)

`geotiff@3.0.5` (devDependency, tools only), `@dgreenheck/ez-tree@1.1.0`, `@three.ez/instanced-mesh@0.3.16`.
