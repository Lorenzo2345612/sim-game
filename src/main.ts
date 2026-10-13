import './ui/hud.css';
import * as THREE from 'three';
import { FIXED_DT, MS_TO_KMH } from './core/constants';
import { FixedStepLoop } from './core/fixedStepLoop';
import { createVehicleState, interpolateVehicleState } from './core/interpolation';
import type { Quat, Surface, TrackData, TrackDataV2, Vec3 } from './core/types';
import { Game } from './game/game';
import { KeyboardInput } from './input/keyboard';
import { buildRibbon } from './track/ribbon';
import { buildTrackSurfaces } from './track/surfaces';
import { createRenderer, createScene } from './render/sceneSetup';
import { createTrackObject } from './render/trackRenderer';
import { createTerrainMesh } from './render/terrainRenderer';
import { createTrackSurfaceObject } from './render/trackSurfaceRenderer';
import { CarRenderer } from './render/carRenderer';
import { ChaseCamera } from './render/chaseCamera';
import { Hud } from './ui/hud';

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
    };
  }
}

const TRACK_IDS = ['monza', 'spa', 'silverstone'];
const DEFAULT_TRACK_ID = 'monza';

// The v2 world renders below 15 fps on software GL (CI), where the default cap
// (8 steps/frame) would run the simulation slower than wall time. 30 steps match
// the 0.25 s frame clamp (0.25 * 120), so the sim stays real-time down to 4 fps
// and never needs more; worst-case cost ~6 ms/frame (physics ≈ 0.2 ms/step).
const MAX_SIM_STEPS_PER_FRAME = 30;

const status = document.getElementById('status');

function onError(e: unknown): void {
  if (status) status.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
}

function selectedTrackId(): string {
  const requested = new URLSearchParams(window.location.search).get('track');
  return requested !== null && TRACK_IDS.includes(requested) ? requested : DEFAULT_TRACK_ID;
}

function headingOf(q: Quat): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
}

const textureLoader = new THREE.TextureLoader();

// Task 035 ships no runoff texture set; run-off areas are asphalt (builder rule).
function loadSurfaceTexture(url: string): THREE.Texture {
  const texture = textureLoader.load(url.replace('textures/runoff/', 'textures/asphalt/'));
  texture.name = url;
  return texture;
}

function loadTiledTexture(url: string, srgb: boolean): THREE.Texture {
  const texture = textureLoader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createTerrainMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: loadTiledTexture('textures/grass/color.jpg', true),
    normalMap: loadTiledTexture('textures/grass/normal.jpg', false),
    roughnessMap: loadTiledTexture('textures/grass/roughness.jpg', false),
    roughness: 1,
  });
}

async function main(): Promise<void> {
  if (!status) throw new Error('Missing #status');
  status.textContent = 'Loading…';

  const trackId = selectedTrackId();
  const res = await fetch(`/tracks/${trackId}.json`);
  if (!res.ok) throw new Error(`Could not load ${trackId}.json`);
  const track: TrackData | TrackDataV2 = await res.json();

  const game = await Game.create(track);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const handle = createRenderer(canvas);
  const { scene, camera, ground } = createScene();

  if ('version' in track) {
    // v2: elevated terrain + textured surface strips replace the flat Phase 0 ground.
    ground.visible = false;
    scene.add(createTerrainMesh(track.terrain, createTerrainMaterial()));
    const surfaces = createTrackSurfaceObject(buildTrackSurfaces(track), {
      loadTexture: loadSurfaceTexture,
    });
    scene.add(surfaces.group);
  } else {
    const trackObj = createTrackObject(buildRibbon(track.centerline, track.widthMeters, 0.02), track);
    scene.add(trackObj.group);
  }

  const car = await CarRenderer.load('/models/race.glb');
  scene.add(car.root);

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

  const onResize = (): void => handle.resize(window.innerWidth, window.innerHeight, camera);
  window.addEventListener('resize', onResize);
  onResize();

  let last = -1;
  const frameFn = (now: number): void => {
    if (last < 0) last = now;
    const frame = Math.min((now - last) / 1000, 0.25);
    last = now;
    const { alpha } = loop.advance(frame);
    interpolateVehicleState(game.getPrevState(), game.getCurrentState(), alpha, interp);
    car.update(interp);
    chase.update(interp, frame);
    hud.update({ speedKmh: Math.abs(interp.forwardSpeed) * MS_TO_KMH, ...game.getLapInfo() });
    handle.renderer.render(scene, camera);
    requestAnimationFrame(frameFn);
  };
  requestAnimationFrame(frameFn);

  status.style.display = 'none';
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
    surfaceUnderCar: () => game.surfaceUnderCar(),
    trackHeightUnderCar: () => game.trackHeightUnderCar(),
    getHeading: () => headingOf(game.getCurrentState().rotation),
  };
}

main().catch(onError);
