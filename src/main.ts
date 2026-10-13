import './ui/hud.css';
import * as THREE from 'three';
import { FIXED_DT, MS_TO_KMH } from './core/constants';
import { FixedStepLoop } from './core/fixedStepLoop';
import { createVehicleState, interpolateVehicleState } from './core/interpolation';
import type { Quat, Surface, Terrain, TrackData, TrackDataV2, Vec3 } from './core/types';
import { Game } from './game/game';
import { KeyboardInput } from './input/keyboard';
import { buildRibbon } from './track/ribbon';
import { buildTrackSurfaces } from './track/surfaces';
import { buildTrackMarkings } from './track/markings';
import { createRenderer, createScene, type RendererHandle } from './render/sceneSetup';
import { createTrackObject } from './render/trackRenderer';
import { createTerrainMesh } from './render/terrainRenderer';
import { createTerrainMaterial, terrainTrackDistance } from './render/terrainMaterial';
import { createTrackSurfaceObject } from './render/trackSurfaceRenderer';
import { createTrackMarkingsObject } from './render/trackMarkingsRenderer';
import { createBarrierObject } from './render/barrierRenderer';
import { createTreeField, type TreeFactory, type TreeField } from './render/treeField';
import { createGrandstand } from './render/grandstand';
import { createPitBuilding, createStartGantry, createStartLights } from './render/pitAndStart';
import { applyEnvironment, ShadowRig } from './render/environment';
import { CarRenderer } from './render/carRenderer';
import { ChaseCamera } from './render/chaseCamera';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';

export interface SceneStats {
  barriers: number;
  treeInstances: number;
  grandstands: number;
  pitBuildings: number;
  startGantries: number;
  sky: boolean;
  shadows: boolean;
}

declare global {
  interface Window {
    __SIMGAME__?: {
      ready: boolean;
      getSpeedKmh(): number;
      getLap(): number;
      getSimTime(): number;
      trackId(): string;
      surfaceUnderCar(): Surface;
      carPosition(): Vec3;
      trackHeightUnderCar(): number;
      /** Car yaw in radians: 0 facing -Z, positive turning left (CCW seen from +Y). */
      getHeading(): number;
      sceneStats(): SceneStats;
      drawCalls(): number;
    };
  }
}

const TRACK_IDS = ['monza', 'spa', 'silverstone'];
const DEFAULT_TRACK_ID = 'monza';

// The v2 world renders below 15 fps on software GL (CI), where the default cap
// (8 steps/frame) would run the simulation slower than wall time. 240 steps match
// the 2 s frame clamp (2 * 120), so the sim stays real-time down to 0.5 fps — CI runs
// five SwiftShader workers per host and contention pushes frames past 1 s; catching
// up costs only physics time (240 steps ≈ 48 ms, ≈ 0.2 ms/step).
const MAX_SIM_STEPS_PER_FRAME = 240;

const status = document.getElementById('status');

interface Session {
  dispose(): void;
}

let menu: Menu | null = null;
let session: Session | null = null;
// One WebGL context for the page: a second WebGLRenderer on the same canvas would share it.
let rendererHandle: RendererHandle | null = null;

function onError(e: unknown): void {
  if (status) {
    status.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
    status.style.display = '';
  }
  console.error(e);
}

function endSession(): void {
  session?.dispose();
  session = null;
}

function showTrackSelect(): void {
  menu?.showTrackSelect((id) => {
    startGame(id).catch(onError);
  });
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m);
    } else if (material) {
      disposeMaterial(material);
    }
    const shadowMap = (obj as THREE.DirectionalLight).shadow?.map;
    if (shadowMap) shadowMap.dispose();
  });
  scene.clear();
}

function headingOf(q: Quat): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
}

// Bilinear sample of the terrain grid; heights are column-major (col * (rows + 1) + row).
function makeTerrainY(t: Terrain): (x: number, z: number) => number {
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  return (x, z) => {
    const fx = THREE.MathUtils.clamp(((x - minX) / t.sizeX) * t.cols, 0, t.cols);
    const fz = THREE.MathUtils.clamp(((z - minZ) / t.sizeZ) * t.rows, 0, t.rows);
    const j = Math.min(Math.floor(fx), t.cols - 1);
    const i = Math.min(Math.floor(fz), t.rows - 1);
    const tx = fx - j;
    const tz = fz - i;
    const h00 = t.heights[j * vertexRows + i];
    const h10 = t.heights[(j + 1) * vertexRows + i];
    const h01 = t.heights[j * vertexRows + i + 1];
    const h11 = t.heights[(j + 1) * vertexRows + i + 1];
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * tz;
  };
}

// SwiftShader (CI e2e) vertex-shades ez-tree geometry at ~1 µs/vertex, so the designed
// 1500 m far range costs seconds per frame there. Swap in a low-poly conifer through
// createTreeField's factory option — same instances, LODs and counts, ~1/100 the
// vertices. Real GPUs keep the 039 ez-tree variants.
function makeCheapTreeFactory(): TreeFactory {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f4a1c });
  return (_preset, _seed, leafFactor) => {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 3, 5), trunkMat);
    trunk.position.y = 1.5;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.8, 7 * (0.6 + 0.4 * leafFactor), 6), leafMat);
    crown.position.y = 3 + (3.5 * (0.6 + 0.4 * leafFactor));
    group.add(trunk, crown);
    return group;
  };
}

function isSoftwareGl(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: GLenum } | null;
  if (!info) return false;
  return /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
}

function nearestElevation(track: TrackDataV2, x: number, z: number): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < track.centerline.length; i++) {
    const dx = track.centerline[i][0] - x;
    const dz = track.centerline[i][1] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return track.elevation[best] ?? 0;
}

async function startGame(trackId: string): Promise<void> {
  endSession();
  menu?.hide();
  if (status) {
    status.textContent = 'Loading…';
    status.style.display = '';
  }

  const res = await fetch(`/tracks/${trackId}.json`);
  if (!res.ok) throw new Error(`Could not load ${trackId}.json`);
  const track: TrackData | TrackDataV2 = await res.json();

  let game = await Game.create(track);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!rendererHandle) rendererHandle = createRenderer(canvas);
  const handle = rendererHandle;
  const softwareGl = isSoftwareGl(handle.renderer);
  if (softwareGl) {
    // SwiftShader rasterizes on the CPU, shared by CI's parallel workers: at full
    // 1280x720 contention pushes frames past the sim catch-up clamp and the fixed-step
    // loop falls behind wall time. 50 % resolution keeps frames inside the clamp with
    // the 081 splat terrain (10+ texture reads per fragment vs 3 before).
    handle.renderer.setPixelRatio(0.5);
  }
  const { scene, camera, ground } = createScene();

  const disposables: { dispose(): void }[] = [];
  let shadows: ShadowRig | null = null;
  let treeField: TreeField | null = null;
  const stats: SceneStats = {
    barriers: 0,
    treeInstances: 0,
    grandstands: 0,
    pitBuildings: 0,
    startGantries: 0,
    sky: false,
    shadows: false,
  };

  if ('version' in track) {
    // v2: elevated terrain + textured surfaces + scenery replace the flat Phase 0 ground.
    ground.visible = false;
    applyEnvironment(scene, track.id);
    shadows = new ShadowRig(scene);
    shadows.setEnabled(handle.renderer, true);
    if (softwareGl) shadows.light.shadow.mapSize.set(1024, 1024); // same contention reason as the pixel ratio

    const trackDist = terrainTrackDistance(track.terrain, track.centerline);
    const terrain = createTerrainMesh(track.terrain, createTerrainMaterial(), trackDist);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const surfaces = createTrackSurfaceObject(buildTrackSurfaces(track));
    surfaces.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.receiveShadow = true;
    });
    scene.add(surfaces.group);
    disposables.push(surfaces);

    const markings = createTrackMarkingsObject(buildTrackMarkings(track));
    scene.add(markings.group);
    disposables.push(markings);

    const barriers = createBarrierObject(track);
    scene.add(barriers.group);
    disposables.push(barriers);

    const trees = createTreeField(track.trees, track.treeSpecies, {
      terrainY: makeTerrainY(track.terrain),
      factory: softwareGl ? makeCheapTreeFactory() : undefined,
    });
    treeField = trees;
    scene.add(trees.object);

    for (const g of track.grandstands) {
      const stand = createGrandstand(g);
      stand.position.y = nearestElevation(track, g.x, g.z);
      scene.add(stand);
    }

    scene.add(createPitBuilding(track));
    scene.add(createStartGantry(track));
    const lights = createStartLights(track);
    lights.setLights(0);
    scene.add(lights.object);

    stats.barriers = barriers.group.children.length;
    stats.treeInstances = track.treeSpecies.reduce((n, s) => n + trees.instanceCount(s.name), 0);
    stats.grandstands = track.grandstands.length;
    stats.pitBuildings = 1;
    stats.startGantries = 1;
  } else {
    const trackObj = createTrackObject(buildRibbon(track.centerline, track.widthMeters, 0.02), track);
    scene.add(trackObj.group);
  }

  const car = await CarRenderer.load('/models/race.glb');
  car.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  scene.add(car.root);
  disposables.push(car);

  const chase = new ChaseCamera(camera);
  chase.snap(game.getCurrentState());

  const keyboard = new KeyboardInput(window);
  const hud = new Hud(document.getElementById('hud') as HTMLElement);

  const loop = new FixedStepLoop(
    (dt) => game.step(keyboard.update(dt)),
    FIXED_DT,
    MAX_SIM_STEPS_PER_FRAME,
  );
  const interp = createVehicleState(4);

  let paused = false;
  let running = true;
  let last = -1;
  let rafId = 0;

  const onResize = (): void => handle.resize(window.innerWidth, window.innerHeight, camera);
  const frameFn = (now: number): void => {
    if (!running) return;
    if (last < 0) last = now;
    const frame = Math.min((now - last) / 1000, 2);
    last = now;
    // Paused: only the render keeps going, the fixed-step simulation must not advance.
    if (!paused) {
      const { alpha } = loop.advance(frame);
      interpolateVehicleState(game.getPrevState(), game.getCurrentState(), alpha, interp);
      car.update(interp);
      chase.update(interp, frame);
      shadows?.update(interp.position);
      treeField?.update(camera.position);
      hud.update({ speedKmh: Math.abs(interp.forwardSpeed) * MS_TO_KMH, ...game.getLapInfo() });
    }
    handle.renderer.render(scene, camera);
    rafId = requestAnimationFrame(frameFn);
  };

  const resume = (): void => {
    paused = false;
    menu?.hide();
  };

  const restart = async (): Promise<void> => {
    const next = await Game.create(track);
    // The session may have been torn down while the new Game was being created.
    if (!running) {
      next.dispose();
      return;
    }
    game.dispose();
    game = next;
    chase.snap(game.getCurrentState());
    loop.reset();
  };

  const changeTrack = (): void => {
    endSession();
    showTrackSelect();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    if (paused) {
      resume();
      return;
    }
    paused = true;
    menu?.showPause({
      onResume: resume,
      onRestart: () => {
        restart()
          .then(() => {
            if (running) resume();
          })
          .catch(onError);
      },
      onChangeTrack: changeTrack,
    });
  };

  const dispose = (): void => {
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    keyboard.dispose();
    hud.dispose();
    game.dispose();
    for (const disposable of disposables) disposable.dispose();
    treeField?.dispose();
    disposeScene(scene);
    window.__SIMGAME__ = undefined;
  };

  session = { dispose };

  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
  onResize();
  rafId = requestAnimationFrame(frameFn);

  if (status) status.style.display = 'none';
  window.__SIMGAME__ = {
    ready: true,
    getSpeedKmh: () => Math.abs(game.getCurrentState().forwardSpeed) * MS_TO_KMH,
    getLap: () => game.getLapInfo().lap,
    getSimTime: () => game.simTime,
    trackId: () => track.id,
    carPosition: () => {
      const p = game.getCurrentState().position;
      return { x: p.x, y: p.y, z: p.z };
    },
    // Spec 043 keeps the 056 chassis-centre raycast ('asphalt' fallback lives in Game), not a game.getWheelSurfaces() majority.
    surfaceUnderCar: () => game.surfaceUnderCar(),
    trackHeightUnderCar: () => game.trackHeightUnderCar(),
    getHeading: () => headingOf(game.getCurrentState().rotation),
    sceneStats: () => ({
      ...stats,
      sky: scene.getObjectByName('sky') !== undefined,
      shadows: handle.renderer.shadowMap.enabled,
    }),
    drawCalls: () => handle.renderer.info.render.calls,
  };
}

async function main(): Promise<void> {
  if (!status) throw new Error('Missing #status');
  const menuRoot = document.getElementById('menu');
  if (!menuRoot) throw new Error('Missing #menu');
  menu = new Menu(menuRoot, window.localStorage);

  const requested = new URLSearchParams(window.location.search).get('track');
  if (requested === null) {
    status.style.display = 'none';
    showTrackSelect();
    return;
  }
  await startGame(TRACK_IDS.includes(requested) ? requested : DEFAULT_TRACK_ID);
}

main().catch(onError);
