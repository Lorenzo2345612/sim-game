import './ui/hud.css';
import './ui/hudV2.css';
import * as THREE from 'three';
import { EngineAudio } from './audio/engineAudio';
import { FIXED_DT, MS_TO_KMH } from './core/constants';
import { FixedStepLoop } from './core/fixedStepLoop';
import { createVehicleState, interpolateVehicleState } from './core/interpolation';
import { loadPreset, presetSettings, type Preset } from './core/settings';
import type { DriverInput, LapEvent, Quat, Surface, Terrain, TrackData, TrackDataV2, Vec3 } from './core/types';
import { Game } from './game/game';
import { GhostRecorder, ghostAt, loadGhost, saveGhostIfFaster, type GhostLap } from './game/ghost';
import { GamepadInput, mergeInputs } from './input/gamepad';
import { KeyboardInput } from './input/keyboard';
import { parseCarSpec } from './physics/carSpec';
import { F4_CAR } from './physics/vehicleConfig';
import { CameraRig, type CameraMode } from './render/cameraRig';
import { createRenderer, createScene, type RendererHandle } from './render/sceneSetup';
import { createTrackObject } from './render/trackRenderer';
import { createTerrainMesh } from './render/terrainRenderer';
import { createTerrainMaterial, terrainTrackDistance } from './render/terrainMaterial';
import { createTrackSurfaceObject } from './render/trackSurfaceRenderer';
import { createTrackMarkingsObject } from './render/trackMarkingsRenderer';
import { createBarrierObject } from './render/barrierRenderer';
import { createTreeField, type TreeField } from './render/treeField';
import { loadTreeModels } from './render/treeModels';
import { createGrandstand } from './render/grandstand';
import { createPitBuilding, createStartGantry, createStartLights } from './render/pitAndStart';
import { applyEnvironment, ShadowRig } from './render/environment';
import { CarRenderer } from './render/carRenderer';
import { TrackProgress } from './track/trackProgress';
import { buildRibbon } from './track/ribbon';
import { buildTrackSurfaces } from './track/surfaces';
import { buildTrackMarkings } from './track/markings';
import { HudV2, type HudV2Data } from './ui/hudV2';
import { Menu } from './ui/menu';
import { Minimap } from './ui/minimap';
import { FpsOverlay } from './ui/fpsOverlay';
import { SetupPanel } from './ui/setupPanel';

export interface SceneStats {
  barriers: number;
  treeInstances: number;
  grandstands: number;
  pitBuildings: number;
  startGantries: number;
  sky: boolean;
  shadows: boolean;
  environment: string;
  ibl: boolean;
  horizonColor: [number, number, number];
  fogColor: [number, number, number];
  groundTexture: string | null;
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
      renderStats(): { toneMapping: string };
      drawCalls(): number;
      cameraMode(): CameraMode;
      gear(): number;
      preset(): Preset;
      teleportToIndex(i: number): void;
      audioPaused(): boolean;
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
// Page-lifetime audio: one AudioContext, created suspended and resumed on first gesture.
let engineAudio: EngineAudio | null = null;
let audioResumed = false;

const NO_SLIP: readonly number[] = [0, 0, 0, 0];

const TONE_MAPPING_NAMES: Record<number, string> = {
  [THREE.NoToneMapping]: 'None',
  [THREE.LinearToneMapping]: 'Linear',
  [THREE.ReinhardToneMapping]: 'Reinhard',
  [THREE.CineonToneMapping]: 'Cineon',
  [THREE.ACESFilmicToneMapping]: 'ACESFilmic',
  [THREE.CustomToneMapping]: 'Custom',
  [THREE.AgXToneMapping]: 'AgX',
  [THREE.NeutralToneMapping]: 'Neutral',
};

function resumeAudio(): void {
  audioResumed = true;
  engineAudio?.resume();
}

function anyGamepadPressed(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return false;
  const pads = navigator.getGamepads();
  if (!pads) return false;
  for (const pad of pads) {
    if (!pad) continue;
    for (const button of pad.buttons) {
      if (button.pressed) return true;
    }
  }
  return false;
}

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

// SwiftShader (CI e2e) vertex-shades the baked lod0 foliage at a cost the CPU rasterizer
// cannot carry, so it starts at lod1 and skips the finest level entirely.
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

/** Distance along the centerline of every ghost sample, for the lap-delta lookup. */
function ghostDistances(ghost: GhostLap, centerline: [number, number][]): Float64Array {
  const progress = new TrackProgress(centerline);
  const out = new Float64Array(ghost.samples.length);
  for (let i = 0; i < ghost.samples.length; i++) {
    out[i] = progress.update(ghost.samples[i][1], ghost.samples[i][3]).distance;
  }
  return out;
}

function presetFromQuery(storage: Storage): Preset {
  const requested = new URLSearchParams(window.location.search).get('preset');
  return requested === 'low' || requested === 'medium' || requested === 'high'
    ? requested
    : loadPreset(storage);
}

async function startGame(trackId: string): Promise<void> {
  endSession();
  menu?.hide();
  // "Change track" leaves the audio paused behind the menu; a new session must not inherit it.
  engineAudio?.setPaused(false);
  if (status) {
    status.textContent = 'Loading…';
    status.style.display = '';
  }

  const res = await fetch(`/tracks/${trackId}.json`);
  if (!res.ok) throw new Error(`Could not load ${trackId}.json`);
  const track: TrackData | TrackDataV2 = await res.json();

  // Task 070 replaces this fetch with its car loader; today it only feeds the setup panel.
  const specRes = await fetch('/cars/f4.json');
  if (!specRes.ok) throw new Error('Could not load f4.json');
  const carSpec = parseCarSpec(await specRes.json());

  let game = await Game.create(track);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!rendererHandle) rendererHandle = createRenderer(canvas);
  const handle = rendererHandle;
  const preset = presetFromQuery(window.localStorage);
  const settings = presetSettings(preset, window.devicePixelRatio);
  handle.renderer.setPixelRatio(settings.pixelRatio);
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
    environment: '',
    ibl: false,
    horizonColor: [0, 0, 0],
    fogColor: [0, 0, 0],
    groundTexture: null,
  };

  if ('version' in track) {
    // v2: elevated terrain + textured surfaces + scenery replace the flat Phase 0 ground.
    ground.visible = false;
    const env = await applyEnvironment(scene, track.id, handle.renderer);
    stats.environment = env.name;
    stats.horizonColor = env.horizon;
    shadows = new ShadowRig(scene);
    shadows.setEnabled(handle.renderer, settings.shadows);
    if (softwareGl) shadows.light.shadow.mapSize.set(1024, 1024); // same contention reason as the pixel ratio

    const groundUrl = `textures/ground/${track.id}.jpg`;
    // Cap 600 so trackDist reaches the satellite fade's full-weight distance (081's default 200 would hide it).
    const trackDist = terrainTrackDistance(track.terrain, track.centerline, 600);
    const terrain = createTerrainMesh(
      track.terrain,
      createTerrainMaterial(undefined, { url: groundUrl, rect: track.terrain }),
      trackDist,
    );
    terrain.receiveShadow = true;
    scene.add(terrain);
    stats.groundTexture = groundUrl;

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

    // Baked LODs replace the preset tree farDistance cull (052 presets keep the value, the
    // field no longer consumes it): instances are never culled by distance, LOD 2 (crossed
    // quads) being the farthest level.
    const treeModels = await loadTreeModels();
    const trees = createTreeField(track.trees, track.treeSpecies, {
      models: treeModels,
      terrainY: makeTerrainY(track.terrain),
      minLod: softwareGl ? 1 : 0,
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

  // Body origin sits on the ground; drop it so the model's contact plane meets the tyres at rest.
  const car = await CarRenderer.load('/models/f4.glb', -(F4_CAR.suspensionRestLength + F4_CAR.wheelRadius));
  car.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  scene.add(car.root);
  disposables.push(car);

  const ghostCar = await CarRenderer.load('/models/f4.glb', -(F4_CAR.suspensionRestLength + F4_CAR.wheelRadius));
  ghostCar.makeGhost();
  ghostCar.root.visible = false;
  scene.add(ghostCar.root);
  disposables.push(ghostCar);

  const cameraRig = new CameraRig(camera);
  cameraRig.update(game.getCurrentState(), 0);

  const keyboard = new KeyboardInput(window);
  const gamepad = new GamepadInput();

  const hud = new HudV2(document.getElementById('hud') as HTMLElement);
  const minimap = new Minimap(document.body, track.centerline);
  const fpsOverlay = new FpsOverlay(document.body, window);

  const ghostRecorder = new GhostRecorder(track.id);
  let ghost = loadGhost(window.localStorage, track.id);
  let ghostDist = ghost === null ? null : ghostDistances(ghost, track.centerline);
  let ghostCursor = 0;
  let lapActive = false;
  let lapWasValid = true;

  const sectorTimes: (number | null)[] = [null, null, null];
  const bestSectorTimes: (number | null)[] = [null, null, null];
  const hudData: HudV2Data = {
    speedKmh: 0,
    gear: 1,
    rpm: 0,
    lap: 0,
    currentLapTime: null,
    lastLapTime: null,
    bestLapTime: null,
    sectorTimes,
    bestSectorTimes,
    deltaSeconds: null,
    lapValid: true,
  };

  const carProgress = new TrackProgress(track.centerline);
  const ghostState = createVehicleState(4);
  const ghostQuat = new THREE.Quaternion();
  const ghostWheel = new THREE.Vector3();
  const GHOST_WHEEL_DROP = -0.06; // resting wheel centre below the chassis connection plane (ghost samples carry no wheel data)

  const updateGhostCar = (lapTime: number | null): void => {
    if (ghost === null || lapTime === null) {
      ghostCar.root.visible = false;
      return;
    }
    ghostAt(ghost, lapTime, ghostState.position, ghostState.rotation);
    const p = ghostState.position;
    const r = ghostState.rotation;
    ghostQuat.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < ghostState.wheels.length; i++) {
      const wp = F4_CAR.wheelPositions[i];
      ghostWheel.set(wp.x, GHOST_WHEEL_DROP, wp.z).applyQuaternion(ghostQuat);
      const w = ghostState.wheels[i];
      w.position.x = p.x + ghostWheel.x;
      w.position.y = p.y + ghostWheel.y;
      w.position.z = p.z + ghostWheel.z;
    }
    ghostCar.update(ghostState);
    ghostCar.root.visible = true;
  };

  // Current lap time minus the ghost's time at the same track progress; null without a ghost.
  const ghostDelta = (lapTime: number | null): number | null => {
    if (ghost === null || ghostDist === null || lapTime === null) return null;
    const d = carProgress.update(interp.position.x, interp.position.z).distance;
    while (ghostCursor < ghostDist.length - 2 && ghostDist[ghostCursor + 1] <= d) ghostCursor++;
    const j = Math.min(ghostCursor + 1, ghostDist.length - 1);
    const a = ghost.samples[ghostCursor];
    const b = ghost.samples[j];
    const da = ghostDist[ghostCursor];
    const db = ghostDist[j];
    const u = db > da ? Math.min(1, Math.max(0, (d - da) / (db - da))) : 0;
    return lapTime - (a[0] + (b[0] - a[0]) * u);
  };

  const handleLapEvents = (events: LapEvent[]): void => {
    for (const ev of events) {
      if (ev.type === 'lapStarted') {
        ghostRecorder.start();
        lapActive = true;
        lapWasValid = true;
        ghostCursor = 0;
        sectorTimes[0] = null;
        sectorTimes[1] = null;
        sectorTimes[2] = null;
      } else if (ev.type === 'sectorCompleted') {
        const s = ev.sector - 1;
        sectorTimes[s] = ev.sectorTime;
        const best = bestSectorTimes[s];
        if (best === null || ev.sectorTime < best) bestSectorTimes[s] = ev.sectorTime;
      } else if (ev.type === 'lapInvalidated') {
        lapWasValid = false;
      } else if (ev.type === 'lapCompleted') {
        lapActive = false;
        const lap = ghostRecorder.finishLap(lapWasValid, ev.lapTime);
        if (lap !== null && saveGhostIfFaster(window.localStorage, lap)) {
          ghost = lap;
          ghostDist = ghostDistances(lap, track.centerline);
        }
      }
    }
  };

  let simInput: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  const loop = new FixedStepLoop(
    (dt) => {
      gamepad.update(dt);
      simInput = mergeInputs(keyboard.update(dt), gamepad.getInput());
      if (simInput.shiftUp) game.shiftUp();
      if (simInput.shiftDown) game.shiftDown();
      game.step(simInput);
      if (lapActive) {
        const state = game.getCurrentState();
        ghostRecorder.record(FIXED_DT, state.position, state.rotation);
      }
      handleLapEvents(game.drainEvents());
    },
    FIXED_DT,
    MAX_SIM_STEPS_PER_FRAME,
  );
  const interp = createVehicleState(4);

  let autoGearbox = true;
  let paused = false;
  let running = true;
  let last = -1;
  let rafId = 0;
  let fpsAvg = 0;
  const frameStats = { fps: 0, drawCalls: 0 };

  const onResize = (): void => handle.resize(window.innerWidth, window.innerHeight, camera);
  const frameFn = (now: number): void => {
    if (!running) return;
    if (last < 0) last = now;
    const frame = Math.min((now - last) / 1000, 2);
    last = now;
    if (!audioResumed && anyGamepadPressed()) resumeAudio();
    // Paused: only the render keeps going, the fixed-step simulation must not advance.
    if (!paused) {
      const { alpha } = loop.advance(frame);
      interpolateVehicleState(game.getPrevState(), game.getCurrentState(), alpha, interp);
      car.update(interp);
      cameraRig.update(interp, frame);
      shadows?.update(interp.position);
      treeField?.update(camera.position);
      minimap.update(interp.position.x, interp.position.z);

      const info = game.getLapInfo();
      hudData.speedKmh = Math.abs(interp.forwardSpeed) * MS_TO_KMH;
      hudData.gear = game.gear();
      hudData.rpm = game.rpm();
      hudData.lap = info.lap;
      hudData.currentLapTime = info.currentLapTime;
      hudData.lastLapTime = info.lastLapTime;
      hudData.bestLapTime = info.bestLapTime;
      hudData.lapValid = info.valid;
      hudData.deltaSeconds = ghostDelta(info.currentLapTime);
      hud.update(hudData);

      updateGhostCar(info.currentLapTime);
      engineAudio?.update(game.rpm(), simInput.throttle, NO_SLIP);
    }
    if (frame > 0) fpsAvg += (1 / frame - fpsAvg) * 0.1;
    frameStats.fps = fpsAvg;
    frameStats.drawCalls = handle.renderer.info.render.calls;
    fpsOverlay.update(frameStats);
    handle.renderer.render(scene, camera);
    rafId = requestAnimationFrame(frameFn);
  };

  const resume = (): void => {
    paused = false;
    engineAudio?.setPaused(false);
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
    autoGearbox = true;
    lapActive = false;
    lapWasValid = true;
    ghostCursor = 0;
    sectorTimes[0] = null;
    sectorTimes[1] = null;
    sectorTimes[2] = null;
    // dt = 1 s makes the chase camera close the gap in one call (near-snap) after the reset.
    cameraRig.update(game.getCurrentState(), 1);
    loop.reset();
  };

  const changeTrack = (): void => {
    endSession();
    showTrackSelect();
  };

  const showPauseMenu = (): void => {
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
      onSetup: openSetup,
    });
  };

  const setupPanel = new SetupPanel(document.body, {
    spec: carSpec,
    carId: carSpec.id,
    trackId: track.id,
    storage: window.localStorage,
    onApply: () => restart().catch(onError),
    onClose: showPauseMenu,
  });

  const openSetup = (): void => {
    menu?.hide();
    setupPanel.open();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') {
      if (setupPanel.visible) {
        setupPanel.close();
        return;
      }
      if (paused) {
        resume();
        return;
      }
      paused = true;
      engineAudio?.setPaused(true);
      showPauseMenu();
      return;
    }
    if (event.repeat) return;
    switch (event.code) {
      case 'KeyC':
        cameraRig.next();
        break;
      case 'KeyQ':
        game.shiftDown();
        break;
      case 'KeyE':
        game.shiftUp();
        break;
      case 'KeyM':
        autoGearbox = !autoGearbox;
        game.setGearMode(autoGearbox ? 'auto' : 'manual');
        break;
    }
  };

  const dispose = (): void => {
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    keyboard.dispose();
    hud.dispose();
    minimap.dispose();
    fpsOverlay.dispose();
    setupPanel.dispose();
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
    sceneStats: () => {
      const fog = scene.fog;
      return {
        ...stats,
        sky: scene.background !== null,
        shadows: handle.renderer.shadowMap.enabled,
        ibl: scene.environment !== null,
        fogColor: fog
          ? ([fog.color.r, fog.color.g, fog.color.b] as [number, number, number])
          : ([0, 0, 0] as [number, number, number]),
      };
    },
    renderStats: () => ({
      toneMapping: TONE_MAPPING_NAMES[handle.renderer.toneMapping] ?? 'Custom',
    }),
    drawCalls: () => handle.renderer.info.render.calls,
    cameraMode: () => cameraRig.mode,
    gear: () => game.gear(),
    preset: () => preset,
    teleportToIndex: (i: number) => game.teleportToIndex(i),
    audioPaused: () => engineAudio?.paused ?? false,
  };
}

async function main(): Promise<void> {
  if (!status) throw new Error('Missing #status');
  const menuRoot = document.getElementById('menu');
  if (!menuRoot) throw new Error('Missing #menu');
  menu = new Menu(menuRoot, window.localStorage);

  engineAudio = new EngineAudio();
  window.addEventListener('keydown', resumeAudio, { once: true });
  document.addEventListener('click', resumeAudio, { once: true });

  const requested = new URLSearchParams(window.location.search).get('track');
  if (requested === null) {
    status.style.display = 'none';
    showTrackSelect();
    return;
  }
  await startGame(TRACK_IDS.includes(requested) ? requested : DEFAULT_TRACK_ID);
}

main().catch(onError);
