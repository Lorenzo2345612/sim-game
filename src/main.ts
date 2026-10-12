import './ui/hud.css';
import { MS_TO_KMH } from './core/constants';
import { FixedStepLoop } from './core/fixedStepLoop';
import { createVehicleState, interpolateVehicleState } from './core/interpolation';
import type { TrackData } from './core/types';
import { Game } from './game/game';
import { KeyboardInput } from './input/keyboard';
import { buildRibbon } from './track/ribbon';
import { createRenderer, createScene } from './render/sceneSetup';
import { createTrackObject } from './render/trackRenderer';
import { CarRenderer } from './render/carRenderer';
import { ChaseCamera } from './render/chaseCamera';
import { Hud } from './ui/hud';

declare global {
  interface Window {
    __SIMGAME__?: { ready: boolean; getSpeedKmh(): number; getLap(): number; getSimTime(): number };
  }
}

const status = document.getElementById('status');

function onError(e: unknown): void {
  if (status) status.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
}

async function main(): Promise<void> {
  if (!status) throw new Error('Missing #status');
  status.textContent = 'Loading…';

  const res = await fetch('/tracks/monza.json');
  if (!res.ok) throw new Error('Could not load monza.json');
  const track: TrackData = await res.json();

  const game = await Game.create(track);

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const handle = createRenderer(canvas);
  const { scene, camera } = createScene();
  const trackObj = createTrackObject(buildRibbon(track.centerline, track.widthMeters, 0.02), track);
  scene.add(trackObj.group);

  const car = await CarRenderer.load('/models/race.glb');
  scene.add(car.root);

  const chase = new ChaseCamera(camera);
  chase.snap(game.getCurrentState());

  const keyboard = new KeyboardInput(window);
  const hud = new Hud(document.getElementById('hud') as HTMLElement);

  const loop = new FixedStepLoop((dt) => game.step(keyboard.update(dt)));
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
  };
}

main().catch(onError);
