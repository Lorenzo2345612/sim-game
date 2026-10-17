import './ui/theme.css';
import './ui/hud.css';
import './ui/hudV2.css';
import './ui/hudTyres.css';
import './ui/hudErs.css';
import './ui/setupHud.css';
import * as THREE from 'three';
import { EngineAudio, type EngineAudioStats } from './audio/engineAudio';
import { Mixer } from './audio/mixer';
import type { Difficulty } from './ai/traffic';
import { FIXED_DT, MS_TO_KMH } from './core/constants';
import { FixedStepLoop } from './core/fixedStepLoop';
import { createVehicleState, interpolateVehicleState } from './core/interpolation';
import { surfaceFeedback, type Feedback } from './core/surfaceFeedback';
import { loadCockpitSettings, loadGameOptions, loadMirrorSetting, loadPreset, loadVolumes, parseQuality, presetSettings, type Preset } from './core/settings';
import type { CityEnv, DriverInput, EnvironmentType, LapEvent, Surface, TrackData, TrackDataV2, Vec3, VehicleState } from './core/types';
import { Game, type LapInfo } from './game/game';
import { RaceGame, type RaceConfig } from './game/raceGame';
import { GhostRecorder, ghostAt, loadGhost, saveGhostIfFaster, type GhostLap } from './game/ghost';
import { ghostTimeAt } from './game/ghostDelta';
import { defaultLivery, loadLivery, type Livery } from './game/livery';
import { GamepadInput, mergeInputs } from './input/gamepad';
import { KeyboardInput } from './input/keyboard';
import { parseCarSpec, type CarSpec } from './physics/carSpec';
import { applySetup, loadSetup } from './physics/setup';
import type { GearboxMode } from './physics/gearbox';
import type { Telemetry } from './physics/vehicle';
import type { Standing } from './race/classification';
import { CameraRig, type CameraMode } from './render/cameraRig';
import { HeadMotion } from './render/headMotion';
import { createPostProcessing, parseCube, type PassName } from './render/postProcessing';
import { createRenderer, createScene, maxWhiteAlbedo, type RendererHandle } from './render/sceneSetup';
import { VirtualMirror } from './render/mirror';
import { createSteeringWheel, disposeSteeringWheel, setSteeringWheelAngle } from './render/steeringWheel';
import { SurfaceParticles, emissionRate } from './render/surfaceParticles';
import { createTrackObject } from './render/trackRenderer';
import { createTerrainMesh } from './render/terrainRenderer';
import { createTerrainMaterial, groundPalette, terrainTrackDistance } from './render/terrainMaterial';
import { createTrackSurfaceObject } from './render/trackSurfaceRenderer';
import { createTrackMarkingsObject } from './render/trackMarkingsRenderer';
import { createBarrierObject } from './render/barrierRenderer';
import { createSausages } from './render/sausageRenderer';
import { createKerbOuterStrips } from './render/kerbOuterStrip';
import { createCityObject, type CityObject } from './render/cityRenderer';
import { createLandmarks } from './render/landmarks';
import { createDistanceBoards } from './render/distanceBoards';
import { createStreetFurniture, loadLampModel } from './render/streetFurniture';
import { createTrackProps } from './render/trackProps';
import { createTreeField, type TreeField } from './render/treeField';
import { loadGlbModels, loadTreeModels } from './render/treeModels';
import { createGrandstand } from './render/grandstand';
import { createPitBuilding, createStartGantry, createStartLights } from './render/pitAndStart';
import { createFloodlights } from './render/floodlights';
import { applyEnvironment, ShadowRig } from './render/environment';
import { CarRenderer } from './render/carRenderer';
import { applyLivery, liveryPrimaryOf } from './render/liveryMaterial';
import { addNumberDecals, disposeNumberDecals } from './render/numberDecal';
import { TrackProgress } from './track/trackProgress';
import { buildRibbon } from './track/ribbon';
import { terrainHeightAt } from './track/ground';
import { grandstandFootprint, groundedBase } from './track/placement';
import { buildTrackSurfaces } from './track/surfaces';
import { buildTrackMarkings } from './track/markings';
import { loadTrackStyle, extraGrandstands } from './track/trackStyleWiring';
import { parseTrackData } from './track/parseTrackData';
import { HudV2, type HudV2Data } from './ui/hudV2';
import { HudTyres, type HudTyresData } from './ui/hudTyres';
import { HudErs, type HudErsData } from './ui/hudErs';
import { CAR_IDS, CAR_STORAGE_KEY, Menu, TRACK_CHOICES } from './ui/menu';
import { LiveryEditor, type LiveryPreview } from './ui/liveryEditor';
import { Minimap } from './ui/minimap';
import { FpsOverlay } from './ui/fpsOverlay';
import { SetupPanel } from './ui/setupPanel';
import { SetupHud } from './ui/setupHud';

export interface SceneStats {
  barriers: number;
  sausages: number;
  foamBlocks: number;
  escapeRoads: number;
  treeInstances: number;
  grandstands: number;
  floodlights: number;
  style: { id: string; loaded: boolean; warnings: number; extraGrandstands: number };
  kerbOuterStripMeters: number;
  pitBuildings: number;
  startGantries: number;
  distanceBoards: number;
  props: number;
  buildings: number;
  lamps: number;
  sidewalks: number;
  landmarks: number;
  sky: boolean;
  shadows: boolean;
  environment: string;
  environmentType: EnvironmentType;
  treeSpecies: string[];
  ibl: boolean;
  horizonColor: [number, number, number];
  fogColor: [number, number, number];
  fogDensity: number;
  groundTexture: string | null;
  carScreenRect: { x: number; y: number; w: number; h: number };
  liveryPrimary: string;
  playerLivery: Livery;
  directionalLights: number;
  maxWhiteAlbedo: number;
  decals: number;
  steeringWheel: { visible: boolean; angle: number };
}

declare global {
  interface Window {
    __SIMGAME__?: {
      ready: boolean;
      getSpeedKmh(): number;
      getLap(): number;
      getSimTime(): number;
      trackId(): string;
      carId(): string;
      surfaceUnderCar(): Surface;
      carPosition(): Vec3;
      trackHeightUnderCar(): number;
      /** Car yaw in radians: 0 facing -Z, positive turning left (CCW seen from +Y). */
      getHeading(): number;
      telemetry(): Telemetry;
      sceneStats(): SceneStats;
      renderStats(): {
        toneMapping: string;
        passes: PassName[];
        exposure: number;
        bloom: { strength: number; threshold: number } | null;
        mirrorRenders: number;
      };
      drawCalls(): number;
      cameraMode(): CameraMode;
      gear(): number;
      preset(): Preset;
      teleportToIndex(i: number): void;
      rpm(): number;
      audioStats(): EngineAudioStats;
      audioPaused(): boolean;
      setLivery(l: Partial<Livery>): void;
      raceStandings(): readonly Standing[];
      carCount(): number;
      startLights(): number;
    };
  }
}

const TRACK_IDS = TRACK_CHOICES.map((c) => c.id);
const DEFAULT_TRACK_ID = 'monza';
const DEFAULT_CAR_ID = 'f4';

// ?car= wins over the saved choice; an unknown id anywhere falls back to the default.
function resolveCarId(params: URLSearchParams, storage: Storage): string {
  const requested = params.get('car') ?? storage.getItem(CAR_STORAGE_KEY);
  return requested !== null && CAR_IDS.includes(requested) ? requested : DEFAULT_CAR_ID;
}

// The v2 world renders below 15 fps on software GL (CI), where the default cap
// (8 steps/frame) would run the simulation slower than wall time. 240 steps match
// the 2 s frame clamp (2 * 120), so the sim stays real-time down to 0.5 fps — CI runs
// five SwiftShader workers per host and contention pushes frames past 1 s; catching
// up costs only physics time (240 steps ≈ 48 ms, ≈ 0.2 ms/step).
const MAX_SIM_STEPS_PER_FRAME = 240;

// Cockpit steering wheel leans back (top away from the driver); radians.
const STEERING_WHEEL_TILT = -(20 * Math.PI) / 180;

const G = 9.81;

const status = document.getElementById('status');

interface Session {
  dispose(): void;
}

// Player-facing slice of the simulation: Game natively, RaceGame through car 0.
interface PlayerSim {
  step(input: DriverInput): void;
  readonly simTime: number;
  getPrevState(): VehicleState;
  getCurrentState(): VehicleState;
  getTelemetry(out?: Telemetry): Telemetry;
  gear(): number;
  rpm(): number;
  heading(): number;
  meanLapFuel(): number | null;
  getLapInfo(): LapInfo;
  drainEvents(): LapEvent[];
  shiftUp(): void;
  shiftDown(): void;
  setGearMode(mode: GearboxMode): void;
  surfaceUnderCar(): Surface;
  trackHeightUnderCar(): number;
  teleportToIndex(i: number): void;
  dispose(): void;
}

const RACE_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const NO_EVENTS: LapEvent[] = [];

function intFromQuery(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function raceConfigFromQuery(params: URLSearchParams, trackId: string, carId: string): RaceConfig {
  const diff = params.get('diff');
  return {
    trackId,
    carId,
    laps: Math.max(1, intFromQuery(params, 'laps', 3)),
    aiCount: intFromQuery(params, 'ai', 5),
    difficulty: RACE_DIFFICULTIES.includes(diff as Difficulty) ? (diff as Difficulty) : 'medium',
    seed: intFromQuery(params, 'seed', 1),
  };
}

const emptyLapInfo = (): LapInfo => ({
  lap: 0,
  currentLapTime: null,
  lastLapTime: null,
  bestLapTime: null,
  valid: true,
});

let menu: Menu | null = null;
let liveryEditor: LiveryEditor | null = null;
let session: Session | null = null;
// One WebGL context for the page: a second WebGLRenderer on the same canvas would share it.
let rendererHandle: RendererHandle | null = null;
// Page-lifetime audio: one AudioContext, created suspended and resumed on first gesture.
let engineAudio: EngineAudio | null = null;
let mixer: Mixer | null = null;
let audioResumed = false;

const NO_SLIP: readonly number[] = [0, 0, 0, 0];
// Reused per frame by updateEffects; never reallocated in the loop.
const effectState = { speed: 0, surface: 'asphalt' as Surface, shifting: false, slipRatios: [0, 0, 0, 0] };

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

function closeLiveryEditor(): void {
  liveryEditor?.dispose();
  liveryEditor = null;
  showTrackSelect();
}

function showLiveryEditor(): void {
  menu?.hide();
  liveryEditor = new LiveryEditor(document.body, window.localStorage, CAR_IDS, createLiveryPreview, {
    onBack: closeLiveryEditor,
  });
  liveryEditor.open();
}

const PREVIEW_PAINT = 'preview-paint';
const PREVIEW_WIDTH = 660;
const PREVIEW_HEIGHT = 440;
// One turntable revolution every 10 s.
const TURNTABLE_RAD_PER_S = (2 * Math.PI) / 10;

// Second scene on the page's single renderer (a second WebGLRenderer would share the context);
// each frame is blitted into the editor canvas through a 2d context.
function createLiveryPreview(canvas: HTMLCanvasElement): LiveryPreview {
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const gameCanvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!rendererHandle && gameCanvas) rendererHandle = createRenderer(gameCanvas);
  const renderer = rendererHandle?.renderer ?? null;
  const ctx = renderer ? canvas.getContext('2d') : null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141922');
  const hemi = new THREE.HemisphereLight('#ffffff', '#3a4250', 1.2);
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(3, 6, 4);
  const camera = new THREE.PerspectiveCamera(38, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 100);
  camera.position.set(0, 2.1, 7.6);
  camera.lookAt(0, 0.4, 0);
  scene.add(hemi, sun);

  const stage = new THREE.Group();
  scene.add(stage);

  // Painted placeholder keeps the preview responsive while the glb loads.
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.55, 4.4),
    new THREE.MeshStandardMaterial({ name: PREVIEW_PAINT, color: '#ffffff', roughness: 0.45 }),
  );
  placeholder.position.y = 0.5;
  stage.add(placeholder);

  let target: { root: THREE.Object3D; paint: string[]; bounds: THREE.Box3; decaled: boolean } = {
    root: placeholder,
    paint: [PREVIEW_PAINT],
    bounds: new THREE.Box3().setFromObject(placeholder),
    decaled: false,
  };
  let car: CarRenderer | null = null;
  const carBounds = new THREE.Box3();
  const restWorld = new THREE.Matrix4();
  let decals: THREE.Mesh[] = [];
  let appliedNumber = -1;
  let loadToken = 0;
  let livery = defaultLivery(0);

  const applyCurrent = (): void => {
    applyLivery(target.root, target.paint, livery, target.bounds);
    if (!target.decaled || appliedNumber === livery.number) return;
    disposeNumberDecals(decals);
    decals = [];
    car?.root.updateMatrixWorld(true);
    decals = addNumberDecals(car!.root, carBounds, livery.number, 0.35, restWorld);
    appliedNumber = livery.number;
  };

  const loadCar = async (carId: string): Promise<void> => {
    const token = ++loadToken;
    try {
      const res = await fetch(`/cars/${carId}.json`);
      if (!res.ok) throw new Error(`cars/${carId}.json HTTP ${res.status}`);
      const spec = parseCarSpec(await res.json());
      const metaRes = await fetch(spec.model.url.replace(/\.glb$/, '.json'));
      const meta = metaRes.ok ? ((await metaRes.json()) as { paintMaterials?: string[] }) : {};
      const bodyOffsetY = -(spec.suspension.front.restLength + spec.wheels.radius);
      const next = await CarRenderer.load(spec.model.url, bodyOffsetY);
      if (token !== loadToken) {
        next.dispose();
        return;
      }
      if (car) {
        stage.remove(car.root);
        car.dispose();
      }
      car = next;
      stage.add(car.root);
      car.root.updateMatrixWorld(true);
      carBounds.setFromObject(car.root);
      restWorld.copy((car.root.getObjectByName('body') ?? car.root).matrixWorld);
      target = { root: car.root, paint: meta.paintMaterials ?? [], bounds: carBounds, decaled: true };
      placeholder.visible = false;
      appliedNumber = -1;
      applyCurrent();
    } catch {
      // keep the placeholder; the editor stays usable without the model
    }
  };

  let rafId = 0;
  let disposed = false;
  let bufferW = 0;
  let bufferH = 0;
  const frame = (now: number): void => {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    if (!renderer || !ctx) return;
    stage.rotation.y = ((now / 1000) * TURNTABLE_RAD_PER_S) % (Math.PI * 2);
    if (bufferW !== PREVIEW_WIDTH || bufferH !== PREVIEW_HEIGHT) {
      renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
      bufferW = PREVIEW_WIDTH;
      bufferH = PREVIEW_HEIGHT;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  };
  rafId = requestAnimationFrame(frame);

  return {
    setCar: (carId) => void loadCar(carId),
    setLivery: (next) => {
      livery = next;
      applyCurrent();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      disposeNumberDecals(decals);
      decals = [];
      car?.dispose();
      car = null;
      placeholder.geometry.dispose();
      disposeMaterial(placeholder.material as THREE.MeshStandardMaterial);
      disposeScene(scene);
    },
  };
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

function countDirectionalLights(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((obj) => {
    const light = obj as THREE.DirectionalLight;
    if (light.isDirectionalLight && light.visible) count++;
  });
  return count;
}

// SwiftShader (CI e2e) vertex-shades the baked lod0 foliage at a cost the CPU rasterizer
// cannot carry, so it starts at lod1 and skips the finest level entirely.
function isSoftwareGl(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: GLenum } | null;
  if (!info) return false;
  return /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
}

/** Time and distance along the centerline of every ghost sample, for the lap-delta lookup. */
function ghostProgress(ghost: GhostLap, centerline: [number, number][]): { times: Float64Array; dist: Float64Array } {
  const progress = new TrackProgress(centerline);
  const times = new Float64Array(ghost.samples.length);
  const dist = new Float64Array(ghost.samples.length);
  for (let i = 0; i < ghost.samples.length; i++) {
    times[i] = ghost.samples[i][0];
    dist[i] = progress.update(ghost.samples[i][1], ghost.samples[i][3]).distance;
  }
  return { times, dist };
}

function presetFromQuery(storage: Storage): Preset {
  const requested = new URLSearchParams(window.location.search).get('preset');
  return requested === 'low' || requested === 'medium' || requested === 'high'
    ? requested
    : loadPreset(storage);
}

/** Query multiplier: a finite value above 0 wins, an absent query keeps the stored option, anything else is 1. */
function queryMultiplier(raw: string | null, stored: number): number {
  if (raw === null) return stored;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Union of the paint meshes' geometry boxes, in the car model space the shader samples. */
function paintBounds(root: THREE.Object3D, paintMaterials: string[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  const box = new THREE.Box3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((m) => paintMaterials.includes(m.name))) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) bounds.union(box.copy(mesh.geometry.boundingBox));
  });
  return bounds;
}

async function loadGradeLut(): Promise<{ size: number; data: Float32Array } | null> {
  try {
    const res = await fetch('/luts/grade.cube');
    if (!res.ok) return null;
    return parseCube(await res.text());
  } catch {
    return null; // a missing or malformed LUT drops the lut pass
  }
}

async function startGame(trackId: string): Promise<void> {
  endSession();
  menu?.hide();
  // "Change track" leaves the audio paused behind the menu; a new session must not inherit it.
  engineAudio?.setPaused(false);
  mixer?.setPaused(false);
  if (status) {
    status.textContent = 'Loading…';
    status.style.display = '';
  }

  const res = await fetch(`/tracks/${trackId}.json`);
  if (!res.ok) throw new Error(`Could not load ${trackId}.json`);
  const track: TrackData | TrackDataV2 = parseTrackData(await res.json());

  const loadedStyle = await loadTrackStyle(trackId, track.centerline.length);
  for (const m of [...loadedStyle.errors, ...loadedStyle.warnings]) console.warn(`[style ${trackId}] ${m}`);
  const trackStyle = loadedStyle.style;

  const params = new URLSearchParams(window.location.search);
  const carId = resolveCarId(params, window.localStorage);
  const specRes = await fetch(`/cars/${carId}.json`);
  if (!specRes.ok) throw new Error(`Could not load ${carId}.json`);
  const baseSpec = parseCarSpec(await specRes.json());
  engineAudio?.setSound(baseSpec.sound);
  engineAudio?.setLimiterRpm(baseSpec.engine.limiterRpm);

  const gameOpts = loadGameOptions(window.localStorage);
  const qCompound = params.get('compound');
  const compound =
    qCompound === 'soft' || qCompound === 'medium' || qCompound === 'hard' ? qCompound : gameOpts.compound;
  const tune = {
    compound,
    wear: queryMultiplier(params.get('wear'), gameOpts.wear),
    fuel: queryMultiplier(params.get('fuel'), gameOpts.fuel),
  };
  const freshSpec = (): CarSpec => applySetup(baseSpec, loadSetup(carId, track.id, baseSpec, window.localStorage));
  let gameSpec = freshSpec();
  const raceTrack: TrackDataV2 | null = 'version' in track ? track : null;
  const raceCfg =
    params.get('race') === '1' && raceTrack !== null
      ? raceConfigFromQuery(params, track.id, carId)
      : null;
  if (params.get('race') === '1' && raceTrack === null) throw new Error('?race=1 requires a v2 track');
  let game: Game | null = null;
  let raceGame: RaceGame | null = null;
  if (raceCfg !== null) {
    // raceCfg is only built when raceTrack is non-null.
    raceGame = await RaceGame.create(raceTrack!, gameSpec, raceCfg, tune);
  } else {
    game = await Game.create(track, gameSpec, tune);
  }
  const raceStates: VehicleState[] = [];
  for (let i = 0; i < (raceGame?.carCount ?? 0); i++) raceStates.push(createVehicleState(4));
  let raceTel: Telemetry | null = null;
  const sim: PlayerSim = {
    step: (input) => {
      if (raceGame !== null) raceGame.step(input);
      else game?.step(input);
    },
    get simTime() {
      return raceGame !== null ? raceGame.simTime : game?.simTime ?? 0;
    },
    getPrevState: () => (raceGame !== null ? raceGame.getPrevStates()[0] : game!.getPrevState()),
    getCurrentState: () =>
      raceGame !== null ? raceGame.getStates(raceStates)[0] : game!.getCurrentState(),
    getTelemetry: (out?) =>
      raceGame !== null ? raceGame.getTelemetry(out) : game!.getTelemetry(out),
    gear: () => {
      if (raceGame === null) return game!.gear();
      raceTel ??= raceGame.getTelemetry();
      return raceGame.getTelemetry(raceTel).gear;
    },
    rpm: () => {
      if (raceGame === null) return game!.rpm();
      raceTel ??= raceGame.getTelemetry();
      return raceGame.getTelemetry(raceTel).rpm;
    },
    heading: () => {
      if (raceGame === null) return game!.heading();
      const q = sim.getCurrentState().rotation;
      return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
    },
    meanLapFuel: () => (raceGame !== null ? null : game!.meanLapFuel()),
    getLapInfo: () => (raceGame !== null ? emptyLapInfo() : game!.getLapInfo()),
    drainEvents: () => (raceGame !== null ? NO_EVENTS : game!.drainEvents()),
    shiftUp: () => {
      if (raceGame === null) game?.shiftUp();
    },
    shiftDown: () => {
      if (raceGame === null) game?.shiftDown();
    },
    setGearMode: (mode) => {
      if (raceGame === null) game?.setGearMode(mode);
    },
    surfaceUnderCar: () => (raceGame !== null ? 'asphalt' : game!.surfaceUnderCar()),
    trackHeightUnderCar: () => (raceGame !== null ? NaN : game!.trackHeightUnderCar()),
    teleportToIndex: (i) => {
      if (raceGame === null) game?.teleportToIndex(i);
    },
    dispose: () => {
      raceGame?.dispose();
      game?.dispose();
    },
  };

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!rendererHandle) rendererHandle = createRenderer(canvas);
  const handle = rendererHandle;
  // ?quality= (105) wins; ?preset= (054) and the saved preset are the fallbacks.
  const preset = parseQuality(window.location.search) ?? presetFromQuery(window.localStorage);
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
  const { scene, camera, ground, sun } = createScene();

  const disposables: { dispose(): void }[] = [];
  let shadows: ShadowRig | null = null;
  let treeField: TreeField | null = null;
  let city: CityObject | null = null;
  let playerLivery = loadLivery(window.localStorage, baseSpec.id);
  const stats: SceneStats = {
    barriers: 0,
    sausages: 0,
    foamBlocks: 0,
    escapeRoads: 0,
    treeInstances: 0,
    grandstands: 0,
    floodlights: 0,
    style: { id: '', loaded: false, warnings: 0, extraGrandstands: 0 },
    kerbOuterStripMeters: 0,
    pitBuildings: 0,
    startGantries: 0,
    distanceBoards: 0,
    props: 0,
    buildings: 0,
    lamps: 0,
    sidewalks: 0,
    landmarks: 0,
    sky: false,
    shadows: false,
    environment: '',
    environmentType: 'parkland',
    treeSpecies: [],
    ibl: false,
    horizonColor: [0, 0, 0],
    fogColor: [0, 0, 0],
    fogDensity: 0,
    groundTexture: null,
    carScreenRect: { x: 0, y: 0, w: 0, h: 0 },
    liveryPrimary: '',
    playerLivery,
    directionalLights: 0,
    maxWhiteAlbedo: 0,
    decals: 0,
    steeringWheel: { visible: false, angle: 0 },
  };

  if ('version' in track) {
    // v2: elevated terrain + textured surfaces + scenery replace the flat Phase 0 ground.
    ground.visible = false;
    const environmentType: EnvironmentType = track.environment ?? 'parkland';
    stats.environmentType = environmentType;
    const env = await applyEnvironment(scene, track.id, handle.renderer, trackStyle);
    stats.environment = env.name;
    stats.horizonColor = env.horizon;
    shadows = new ShadowRig(scene);
    // The rig is the v2 sun; the Phase-0 one would double the direct light on top of the IBL.
    scene.remove(sun);
    sun.shadow.map?.dispose();
    sun.dispose();
    shadows.setEnabled(handle.renderer, settings.shadows);
    if (softwareGl) shadows.light.shadow.mapSize.set(1024, 1024); // same contention reason as the pixel ratio

    const groundUrl = `textures/ground/${track.id}.jpg`;
    // Cap 600 so trackDist reaches the satellite fade's full-weight distance (081's default 200 would hide it).
    const trackDist = terrainTrackDistance(track.terrain, track.centerline, 600);
    const terrain = createTerrainMesh(
      track.terrain,
      createTerrainMaterial(undefined, { url: groundUrl, rect: track.terrain }, groundPalette(environmentType)),
      trackDist,
    );
    terrain.receiveShadow = true;
    scene.add(terrain);
    stats.groundTexture = groundUrl;

    const surfaces = createTrackSurfaceObject(buildTrackSurfaces(track), { style: trackStyle, track });
    surfaces.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.receiveShadow = true;
    });
    scene.add(surfaces.group);
    disposables.push(surfaces);

    const markings = createTrackMarkingsObject(buildTrackMarkings(track), trackStyle);
    scene.add(markings.group);
    disposables.push(markings);

    const barriers = createBarrierObject(track, undefined, trackStyle);
    scene.add(barriers.group);
    disposables.push(barriers);

    const floodlights = createFloodlights(track, trackStyle);
    if (floodlights !== null) {
      scene.add(floodlights.group);
      disposables.push(floodlights);
      stats.floodlights = floodlights.group.userData.poles as number;
    }

    const sausages = createSausages(track);
    scene.add(sausages.group);
    disposables.push(sausages);

    const boards = createDistanceBoards(track);
    scene.add(boards.group);
    disposables.push(boards);

    if (environmentType === 'city') await loadLampModel();
    const furniture = createStreetFurniture(track);
    scene.add(furniture.group);
    disposables.push(furniture);

    const props = createTrackProps(track, trackStyle);
    if (props) {
      scene.add(props.group);
      disposables.push(props);
      stats.props = props.group.userData.placed as number;
    }

    const terrainY = (x: number, z: number): number => terrainHeightAt(track.terrain, x, z);

    // Baked LODs replace the preset tree farDistance cull (052 presets keep the value, the
    // field no longer consumes it): instances are never culled by distance, LOD 2 (crossed
    // quads) being the farthest level.
    const treeModels = await loadTreeModels();
    Object.assign(treeModels, await loadGlbModels(track.treeSpecies.map((s) => s.name)));
    const trees = createTreeField(track.trees, track.treeSpecies, {
      models: treeModels,
      terrainY,
      minLod: softwareGl ? 1 : 0,
    });
    treeField = trees;
    scene.add(trees.object);

    for (const g of track.grandstands) {
      const { baseY, plinthBottom } = groundedBase(track, g.x, g.z, g.yaw, grandstandFootprint(g));
      const stand = createGrandstand(g, undefined, trackStyle, baseY - plinthBottom);
      stand.position.y = baseY;
      scene.add(stand);
    }

    const extras = extraGrandstands(track, trackStyle);
    for (const g of extras) {
      const { baseY, plinthBottom } = groundedBase(track, g.x, g.z, g.yaw, grandstandFootprint(g));
      const stand = createGrandstand(g, undefined, trackStyle, baseY - plinthBottom);
      stand.position.y = baseY;
      scene.add(stand);
    }
    stats.style = { id: trackId, loaded: loadedStyle.loaded, warnings: loadedStyle.warnings.length, extraGrandstands: extras.length };

    scene.add(createPitBuilding(track, trackStyle));
    scene.add(createStartGantry(track));
    const lights = createStartLights(track);
    lights.setLights(0);
    scene.add(lights.object);

    const kerbOuter = createKerbOuterStrips(track, trackStyle);
    if (kerbOuter !== null) {
      scene.add(kerbOuter.group);
      disposables.push(kerbOuter);
      stats.kerbOuterStripMeters = kerbOuter.group.userData.meters as number;
    }

    stats.barriers = barriers.group.children.length;
    stats.sausages = sausages.count;
    stats.foamBlocks = barriers.foamBlocks;
    stats.escapeRoads = track.escapeRoads?.length ?? 0;
    stats.treeInstances = track.treeSpecies.reduce((n, s) => n + trees.instanceCount(s.name), 0);
    stats.treeSpecies = track.treeSpecies.filter((s) => trees.instanceCount(s.name) > 0).map((s) => s.name);
    stats.grandstands = track.grandstands.length;
    stats.pitBuildings = 1;
    stats.startGantries = 1;
    stats.distanceBoards = boards.count;

    const landmarks = createLandmarks(track, terrainY);
    scene.add(landmarks.group);
    stats.landmarks = landmarks.count;
    disposables.push(landmarks);

    // Baked OSM city (157); absent on non-city tracks, ignored on failure.
    try {
      const envRes = await fetch(`/tracks/${track.id}-env.json`);
      if (envRes.ok) {
        city = createCityObject(await envRes.json() as CityEnv, terrainY);
        scene.add(city.group);
        stats.buildings = city.buildings;
        disposables.push(city);
      }
    } catch {
      // a missing or malformed env file leaves the track without a city
    }
    stats.lamps = furniture.lamps;
    stats.sidewalks = furniture.sidewalks;
  } else {
    const trackObj = createTrackObject(buildRibbon(track.centerline, track.widthMeters, 0.02), track);
    scene.add(trackObj.group);
  }

  // Body origin sits on the ground; drop it so the model's contact plane meets the tyres at rest.
  const bodyOffsetY = -(baseSpec.suspension.front.restLength + baseSpec.wheels.radius);
  const car = await CarRenderer.load(baseSpec.model.url, bodyOffsetY);
  car.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  scene.add(car.root);
  disposables.push(car);

  const cockpitWheel = createSteeringWheel(baseSpec.cockpit.wheelRadius);
  cockpitWheel.position.set(
    baseSpec.cockpit.wheel.x,
    baseSpec.cockpit.wheel.y,
    baseSpec.cockpit.wheel.z,
  );
  cockpitWheel.rotation.x = STEERING_WHEEL_TILT;
  cockpitWheel.visible = false;
  car.root.add(cockpitWheel);
  disposables.push({ dispose: () => disposeSteeringWheel(cockpitWheel) });

  const modelRes = await fetch(baseSpec.model.url.replace(/\.glb$/, '.json'));
  const modelMeta = modelRes.ok ? ((await modelRes.json()) as { paintMaterials?: string[] }) : {};
  const paintMaterials = modelMeta.paintMaterials ?? [];
  const liveryBounds = paintBounds(car.root, paintMaterials);
  applyLivery(car.root, paintMaterials, playerLivery, liveryBounds);
  const carBounds = new THREE.Box3().setFromObject(car.root);
  // Body rest pose at the capture of carBounds: the body moves under the always-identity car.root.
  car.root.updateMatrixWorld(true);
  const restWorld = new THREE.Matrix4().copy((car.root.getObjectByName('body') ?? car.root).matrixWorld);
  let decalMeshes = addNumberDecals(car.root, carBounds, playerLivery.number, 0.35, restWorld);
  stats.decals = decalMeshes.length;

  const carBox = new THREE.Box3();
  const carCorner = new THREE.Vector3();
  const carScreenRect = (): { x: number; y: number; w: number; h: number } => {
    carBox.setFromObject(car.root);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      carCorner
        .set(
          i & 1 ? carBox.max.x : carBox.min.x,
          i & 2 ? carBox.max.y : carBox.min.y,
          i & 4 ? carBox.max.z : carBox.min.z,
        )
        .project(camera);
      const sx = (carCorner.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-carCorner.y * 0.5 + 0.5) * window.innerHeight;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const ghostCar = await CarRenderer.load(baseSpec.model.url, bodyOffsetY);
  ghostCar.makeGhost();
  ghostCar.root.visible = false;
  scene.add(ghostCar.root);
  disposables.push(ghostCar);

  const cockpitSettings = loadCockpitSettings(window.localStorage);
  const cameraRig = new CameraRig(camera);
  cameraRig.setCockpitEye(baseSpec.cockpit.eye);
  cameraRig.setCockpitFov(cockpitSettings.cockpitFov);
  cameraRig.update(sim.getCurrentState(), 0);
  const headMotion = new HeadMotion();

  const mirror = new VirtualMirror(document.body, camera.far);
  const mirrorEnabled = loadMirrorSetting(window.localStorage);

  const keyboard = new KeyboardInput(window);
  const gamepad = new GamepadInput();

  const hud = new HudV2(document.getElementById('hud') as HTMLElement);
  hud.setRpmRange(baseSpec.gearbox.upRpm, baseSpec.engine.limiterRpm);
  let activeCompound = baseSpec.tyres.compounds[compound];
  const hudTyres = new HudTyres(document.body);
  const hudErs = new HudErs(document.body);
  const ersData: HudErsData = {
    socFrac: 0, powerW: 0, mode: 'balance', overtake: false, clipping: false,
    lapDeployJ: 0, lapHarvestJ: 0, deployCapJ: 0, aeroStraight: null,
  };
  const tyresData: HudTyresData = {
    tempC: [0, 0, 0, 0],
    wear: [0, 0, 0, 0],
    dirt: [0, 0, 0, 0],
    optTempC: activeCompound.optTempC,
    tempWindowC: activeCompound.tempWindowC,
    fuelL: 0,
    meanLapL: null,
    compound: tune.compound,
    pressureKpa: gameSpec.tyres.pressureKpa,
  };
  const minimap = new Minimap(document.body, track.centerline);
  const fpsOverlay = new FpsOverlay(document.body, window);

  const setupHud = new SetupHud(document.body);
  const refreshSetupHud = (): void => {
    setupHud.show(loadSetup(carId, track.id, baseSpec, window.localStorage), tune.compound, baseSpec);
  };
  if (setupHud.visible) refreshSetupHud();

  const ghostRecorder = new GhostRecorder(track.id);
  let ghost = loadGhost(window.localStorage, track.id);
  let ghostData = ghost === null ? null : ghostProgress(ghost, track.centerline);
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

  // Head motion: car-frame velocity finite difference over the frame (reused temps).
  const headPrevPos = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headInvRot = new THREE.Quaternion();
  const headPrevCar = { x: 0, z: 0 };
  let headVelPrimed = false;

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
      const wp = baseSpec.wheels.positions[i];
      ghostWheel.set(wp[0], GHOST_WHEEL_DROP, wp[2]).applyQuaternion(ghostQuat);
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
    if (ghost === null || ghostData === null || lapTime === null) return null;
    const d = carProgress.update(interp.position.x, interp.position.z).distance;
    const t = ghostTimeAt(ghostData.times, ghostData.dist, d, lapTime, carProgress.length);
    return t === null ? null : lapTime - t;
  };

  const handleLapEvents = (events: LapEvent[]): void => {
    for (const ev of events) {
      if (ev.type === 'lapStarted') {
        ghostRecorder.start();
        lapActive = true;
        lapWasValid = true;
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
          ghostData = ghostProgress(lap, track.centerline);
        }
      }
    }
  };

  let simInput: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
  const loop = new FixedStepLoop(
    (dt) => {
      gamepad.update(dt);
      simInput = mergeInputs(keyboard.update(dt), gamepad.getInput());
      if (simInput.shiftUp) sim.shiftUp();
      if (simInput.shiftDown) sim.shiftDown();
      if (gamepad.takeSetupHudToggle()) toggleSetupHud();
      sim.step(simInput);
      if (lapActive) {
        const state = sim.getCurrentState();
        ghostRecorder.record(FIXED_DT, state.position, state.rotation);
      }
      handleLapEvents(sim.drainEvents());
    },
    FIXED_DT,
    MAX_SIM_STEPS_PER_FRAME,
  );
  const interp = createVehicleState(4);
  const telemetry: Telemetry = sim.getTelemetry();
  // fb stays in scope for the next consumers (165 rumble, 167 particles).
  const fb: Feedback = { shake: 0, low: 0, high: 0 };

  const particles = new SurfaceParticles(scene);
  disposables.push(particles);
  const emissionAcc = new Float64Array(4);
  const particlePos: Vec3 = { x: 0, y: 0, z: 0 };
  const particleVel: Vec3 = { x: 0, y: 0, z: 0 };
  const particleQuat = new THREE.Quaternion();
  const particleFwd = new THREE.Vector3();

  const emitParticles = (dt: number): void => {
    const speed = Math.abs(interp.forwardSpeed);
    particleQuat.set(interp.rotation.x, interp.rotation.y, interp.rotation.z, interp.rotation.w);
    particleFwd.set(0, 0, -1).applyQuaternion(particleQuat);
    for (let i = 0; i < interp.wheels.length; i++) {
      const wheel = interp.wheels[i];
      const surface = telemetry.wheels[i].surface;
      const rate = wheel.inContact ? emissionRate(surface, speed) : 0;
      emissionAcc[i] = rate > 0 ? emissionAcc[i] + rate * dt : 0;
      const count = Math.floor(emissionAcc[i]);
      if (count <= 0) continue;
      emissionAcc[i] -= count;
      const wp = wheel.position;
      particlePos.x = wp.x;
      particlePos.y = wp.y - baseSpec.wheels.radius;
      particlePos.z = wp.z;
      particleVel.x = speed * particleFwd.x;
      particleVel.y = 0;
      particleVel.z = speed * particleFwd.z;
      particles.emit(surface, particlePos, particleVel, count);
    }
    particles.update(dt);
  };

  let autoGearbox = true;
  let lastGear = sim.gear();
  let paused = false;
  let running = true;
  let last = -1;
  let rafId = 0;
  // Counts visible frames so the mirror renders on every other one.
  let mirrorTick = 0;
  let fpsAvg = 0;
  const frameStats = { fps: 0, drawCalls: 0 };

  const post = createPostProcessing(
    handle.renderer,
    scene,
    camera,
    preset,
    preset === 'low' ? null : await loadGradeLut(),
  );

  const onResize = (): void => {
    handle.resize(window.innerWidth, window.innerHeight, camera);
    post.resize(window.innerWidth, window.innerHeight);
  };
  const frameFn = (now: number): void => {
    if (!running) return;
    if (last < 0) last = now;
    const frame = Math.min((now - last) / 1000, 2);
    last = now;
    if (!audioResumed && anyGamepadPressed()) resumeAudio();
    // Paused: only the render keeps going, the fixed-step simulation must not advance.
    if (!paused) {
      const { alpha } = loop.advance(frame);
      interpolateVehicleState(sim.getPrevState(), sim.getCurrentState(), alpha, interp);
      car.update(interp);
      setSteeringWheelAngle(cockpitWheel, simInput.steer, baseSpec.cockpit.lockDeg);
      let latG = 0;
      let longG = 0;
      if (frame > 0) {
        headVel
          .set(
            (interp.position.x - headPrevPos.x) / frame,
            0,
            (interp.position.z - headPrevPos.z) / frame,
          )
          .applyQuaternion(
            headInvRot.set(interp.rotation.x, interp.rotation.y, interp.rotation.z, interp.rotation.w).invert(),
          );
        // Car faces -Z: forward velocity is -z; latG + = right, longG + = accelerating.
        const right = headVel.x;
        const fwd = -headVel.z;
        if (headVelPrimed) {
          latG = (right - headPrevCar.x) / frame / G;
          longG = (fwd - headPrevCar.z) / frame / G;
        } else {
          headVelPrimed = true;
        }
        headPrevCar.x = right;
        headPrevCar.z = fwd;
      }
      headPrevPos.copy(interp.position);
      const head = headMotion.update(latG, longG, frame);
      cameraRig.setHeadOffset(cockpitSettings.headMotion ? head.x : 0, cockpitSettings.headMotion ? head.z : 0);
      cameraRig.update(interp, frame);
      sim.getTelemetry(telemetry);
      surfaceFeedback(telemetry.wheels, Math.abs(interp.forwardSpeed), fb);
      gamepad.rumble(fb.low, fb.high, performance.now());
      cameraRig.applyShake(fb.shake, sim.simTime);
      emitParticles(frame);
      shadows?.update(interp.position);
      treeField?.update(camera.position);
      city?.update(sim.simTime);
      minimap.update(interp.position.x, interp.position.z);

      const info = sim.getLapInfo();
      hudData.speedKmh = Math.abs(interp.forwardSpeed) * MS_TO_KMH;
      hudData.gear = sim.gear();
      hudData.rpm = sim.rpm();
      hudData.lap = info.lap;
      hudData.currentLapTime = info.currentLapTime;
      hudData.lastLapTime = info.lastLapTime;
      hudData.bestLapTime = info.bestLapTime;
      hudData.lapValid = info.valid;
      hudData.deltaSeconds = ghostDelta(info.currentLapTime);
      hud.update(hudData);

      for (let i = 0; i < 4; i++) {
        tyresData.tempC[i] = telemetry.wheels[i].tempC;
        tyresData.wear[i] = telemetry.wheels[i].wear;
        tyresData.dirt[i] = telemetry.wheels[i].dirt ?? 0;
      }
      tyresData.fuelL = telemetry.fuelKg / baseSpec.fuel.densityKgL;
      const meanFuelKg = sim.meanLapFuel();
      tyresData.meanLapL = meanFuelKg === null ? null : meanFuelKg / baseSpec.fuel.densityKgL;
      hudTyres.update(tyresData);
      if (telemetry.ers) {
        Object.assign(ersData, telemetry.ers);
        ersData.aeroStraight = telemetry.aero ? telemetry.aero.blend >= 0.5 : null;
        hudErs.update(ersData);
      } else {
        hudErs.update(null);
      }

      updateGhostCar(info.currentLapTime);
      engineAudio?.update(sim.rpm(), simInput.throttle, NO_SLIP);
      const gearNow = sim.gear();
      effectState.speed = Math.abs(interp.forwardSpeed);
      effectState.surface = sim.surfaceUnderCar();
      effectState.shifting = gearNow !== lastGear;
      lastGear = gearNow;
      for (let i = 0; i < 4; i++) {
        const w = telemetry.wheels[i];
        const kappa = Math.abs(w.kappa);
        const alpha = Math.abs(w.alpha);
        effectState.slipRatios[i] = kappa > alpha ? kappa : alpha;
      }
      engineAudio?.updateEffects(effectState);
    } else {
      gamepad.rumble(0, 0, performance.now());
    }
    cockpitWheel.visible = cameraRig.mode === 'cockpit';
    const mirrorVisible = mirrorEnabled && cameraRig.mode !== 'chase';
    mirror.setVisible(mirrorVisible);
    if (mirrorVisible && mirrorTick++ % 2 === 0) {
      mirror.render(handle.renderer, scene, interp.position, interp.rotation);
    }
    if (frame > 0) fpsAvg += (1 / frame - fpsAvg) * 0.1;
    frameStats.fps = fpsAvg;
    frameStats.drawCalls = handle.renderer.info.render.calls;
    fpsOverlay.update(frameStats);
    post.render(frame);
    rafId = requestAnimationFrame(frameFn);
  };

  const resume = (): void => {
    paused = false;
    engineAudio?.setPaused(false);
    mixer?.setPaused(false);
    menu?.hide();
  };

  const restart = async (): Promise<void> => {
    const nextSpec = freshSpec();
    if (raceCfg !== null) {
      const next = await RaceGame.create(raceTrack!, nextSpec, raceCfg, tune);
      // The session may have been torn down while the new game was being created.
      if (!running) {
        next.dispose();
        return;
      }
      raceGame?.dispose();
      raceGame = next;
    } else {
      const next = await Game.create(track, nextSpec, tune);
      if (!running) {
        next.dispose();
        return;
      }
      game?.dispose();
      game = next;
    }
    lastGear = sim.gear();
    gameSpec = nextSpec;
    activeCompound = baseSpec.tyres.compounds[tune.compound];
    tyresData.compound = tune.compound;
    tyresData.optTempC = activeCompound.optTempC;
    tyresData.tempWindowC = activeCompound.tempWindowC;
    tyresData.pressureKpa = gameSpec.tyres.pressureKpa;
    autoGearbox = true;
    lapActive = false;
    lapWasValid = true;
    sectorTimes[0] = null;
    sectorTimes[1] = null;
    sectorTimes[2] = null;
    // dt = 1 s makes the chase camera close the gap in one call (near-snap) after the reset.
    cameraRig.update(sim.getCurrentState(), 1);
    // The teleport would read as one frame of huge acceleration; re-prime the head-motion velocity.
    headVelPrimed = false;
    headPrevPos.copy(sim.getCurrentState().position);
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
    spec: freshSpec(),
    carId,
    trackId: track.id,
    storage: window.localStorage,
    compound: tune.compound,
    onApply: () => {
      tune.compound = loadGameOptions(window.localStorage).compound;
      restart().catch(onError);
    },
    onClose: showPauseMenu,
  });

  const openSetup = (): void => {
    menu?.hide();
    setupPanel.open();
  };

  const toggleSetupHud = (): void => {
    if (paused || setupPanel.visible) return;
    if (setupHud.visible) setupHud.hide();
    else refreshSetupHud();
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
      mixer?.setPaused(true);
      showPauseMenu();
      return;
    }
    if (event.repeat) return;
    switch (event.code) {
      case 'KeyC':
        cameraRig.next();
        mixer?.setCameraMode(cameraRig.mode);
        break;
      case 'KeyQ':
        sim.shiftDown();
        break;
      case 'KeyE':
        sim.shiftUp();
        break;
      case 'KeyM':
        autoGearbox = !autoGearbox;
        sim.setGearMode(autoGearbox ? 'auto' : 'manual');
        break;
      case 'KeyI':
        toggleSetupHud();
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
    hudTyres.dispose();
    hudErs.dispose();
    minimap.dispose();
    fpsOverlay.dispose();
    mirror.dispose();
    setupHud.dispose();
    setupPanel.dispose();
    sim.dispose();
    for (const disposable of disposables) disposable.dispose();
    treeField?.dispose();
    post.dispose();
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
    getSpeedKmh: () => Math.abs(sim.getCurrentState().forwardSpeed) * MS_TO_KMH,
    getLap: () => sim.getLapInfo().lap,
    getSimTime: () => sim.simTime,
    trackId: () => track.id,
    carId: () => carId,
    carPosition: () => {
      const p = sim.getCurrentState().position;
      return { x: p.x, y: p.y, z: p.z };
    },
    // Spec 043 keeps the 056 chassis-centre raycast ('asphalt' fallback lives in Game), not a game.getWheelSurfaces() majority.
    surfaceUnderCar: () => sim.surfaceUnderCar(),
    trackHeightUnderCar: () => sim.trackHeightUnderCar(),
    getHeading: () => sim.heading(),
    telemetry: () => sim.getTelemetry(),
    sceneStats: () => {
      const fog = scene.fog;
      return {
        ...stats,
        carScreenRect: carScreenRect(),
        liveryPrimary: liveryPrimaryOf(car.root) ?? '',
        playerLivery,
        sky: scene.background !== null,
        shadows: handle.renderer.shadowMap.enabled,
        ibl: scene.environment !== null,
        directionalLights: countDirectionalLights(scene),
        maxWhiteAlbedo: maxWhiteAlbedo(),
        steeringWheel: { visible: cockpitWheel.visible, angle: cockpitWheel.rotation.z },
        fogColor: fog
          ? ([fog.color.r, fog.color.g, fog.color.b] as [number, number, number])
          : ([0, 0, 0] as [number, number, number]),
        fogDensity: fog instanceof THREE.FogExp2 ? fog.density : 0,
      };
    },
    renderStats: () => ({
      toneMapping: TONE_MAPPING_NAMES[handle.renderer.toneMapping] ?? 'Custom',
      passes: post.passes,
      exposure: handle.renderer.toneMappingExposure,
      bloom: post.bloom
        ? { strength: post.bloom.strength, threshold: post.bloom.threshold }
        : null,
      mirrorRenders: mirror.renders,
    }),
    drawCalls: () => handle.renderer.info.render.calls,
    cameraMode: () => cameraRig.mode,
    gear: () => sim.gear(),
    preset: () => preset,
    teleportToIndex: (i: number) => sim.teleportToIndex(i),
    rpm: () => sim.rpm(),
    audioStats: () =>
      engineAudio?.getStats() ?? { running: false, engine: 'oscillator', firingHz: 0 },
    audioPaused: () => engineAudio?.paused ?? false,
    raceStandings: () => (raceGame !== null ? raceGame.standings() : []),
    carCount: () => (raceGame !== null ? raceGame.carCount : 1),
    startLights: () => (raceGame !== null ? raceGame.startLights() : 0),
    setLivery: (l: Partial<Livery>) => {
      const prevNumber = playerLivery.number;
      playerLivery = { ...playerLivery, ...l };
      applyLivery(car.root, paintMaterials, playerLivery, liveryBounds);
      if (playerLivery.number !== prevNumber) {
        disposeNumberDecals(decalMeshes);
        car.root.updateMatrixWorld(true);
        decalMeshes = addNumberDecals(car.root, carBounds, playerLivery.number, 0.35, restWorld);
        stats.decals = decalMeshes.length;
      }
    },
  };
}

async function main(): Promise<void> {
  if (!status) throw new Error('Missing #status');
  const menuRoot = document.getElementById('menu');
  if (!menuRoot) throw new Error('Missing #menu');
  menu = new Menu(menuRoot, window.localStorage, showLiveryEditor);

  engineAudio = new EngineAudio();
  const mixNodes = engineAudio.mixerNodes();
  mixer = new Mixer(mixNodes.ctx, mixNodes, loadVolumes(window.localStorage));
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
