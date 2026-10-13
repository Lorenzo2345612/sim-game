import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { IDLE_RPM } from '../../../src/physics/gearbox';
import type { DriverInput, Quat, TrackData } from '../../../src/core/types';

const ROOT = new URL('../../..', import.meta.url);
const mainPath = fileURLToPath(new URL('src/main.ts', ROOT));

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

// Same fixture as acceptance 017: closed circle r = 200 resampled at ~2 m.
function circleTrack(r: number, spacing: number): TrackData {
  const n = Math.round((2 * Math.PI * r) / spacing);
  const centerline: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    centerline.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return {
    id: 'circle-200',
    name: 'Circle 200',
    widthMeters: 12,
    lengthMeters: 2 * Math.PI * r,
    officialLengthMeters: 2 * Math.PI * r,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    source: { dataset: 'fixture', license: 'fixture', url: 'fixture' },
  };
}

// 054 wiring lives only in src/main.ts and the node test env has no DOM, so the
// wiring edges are source contracts (same pattern as edge 043 / acceptance 018 AT3),
// one per spec rule; the game.ts additions are tested behaviourally.
function mainSrc(): string {
  return readFileSync(mainPath, 'utf8');
}

function headingOf(q: Quat): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
}

// The spec says "getters/methods" without fixing the shape; accept property or method.
function readNumeric(game: Game, key: 'gear' | 'rpm'): number {
  const v = (game as unknown as Record<string, unknown>)[key];
  return typeof v === 'function' ? (v as () => number)() : (v as number);
}

describe('054 gameplay integration edges', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('EDGE1: teleportToIndex puts the car on centerline point i at elevation + 0.6, facing the next point, at rest', async () => {
    const track = circleTrack(200, 2);
    game = await Game.create(track);
    const g = game;
    const teleport = (g as unknown as { teleportToIndex?: (i: number) => void }).teleportToIndex;
    expect(typeof teleport).toBe('function');
    const i = Math.floor(track.centerline.length / 4);
    teleport!.call(g, i);
    g.step(IDLE);
    const s = g.getCurrentState();
    const [cx, cz] = track.centerline[i];
    const [nx, nz] = track.centerline[i + 1];
    expect(s.position.x).toBeCloseTo(cx, 1);
    expect(s.position.z).toBeCloseTo(cz, 1);
    // v1 fixture has no elevation array: elevation defaults to 0 as in spawnFromTrack.
    expect(s.position.y).toBeCloseTo(0.6, 1);
    expect(headingOf(s.rotation)).toBeCloseTo(Math.atan2(-(nx - cx), -(nz - cz)), 2);
    expect(Math.abs(s.forwardSpeed)).toBeLessThan(0.15);
  });

  it('EDGE2: game exposes gear and rpm; at rest they are gear 1 and idle rpm', async () => {
    game = await Game.create(circleTrack(200, 2));
    expect(readNumeric(game, 'gear')).toBe(1);
    expect(readNumeric(game, 'rpm')).toBeCloseTo(IDLE_RPM, 0);
  });

  it('EDGE3: C cycles the camera, Q/E shift down/up, M toggles the gear mode auto/manual', () => {
    const src = mainSrc();
    expect(src).toMatch(/KeyC/);
    expect(src).toMatch(/\.next\(\)/);
    expect(src).toMatch(/KeyQ/);
    expect(src).toMatch(/KeyE/);
    expect(src).toMatch(/shiftDown/);
    expect(src).toMatch(/shiftUp/);
    expect(src).toMatch(/KeyM/);
    expect(src).toMatch(/setGearMode/);
    expect(src).toMatch(/['"]manual['"]/);
    expect(src).toMatch(/['"]auto['"]/);
  });

  it('EDGE4: the gamepad is polled every frame and merged with the keyboard input', () => {
    const src = mainSrc();
    expect(src).toMatch(/GamepadInput/);
    expect(src).toMatch(/mergeInputs\s*\(/);
    expect(src).toMatch(/getInput\s*\(\)/);
  });

  it('EDGE5: CameraRig replaces the direct chase camera', () => {
    const src = mainSrc();
    expect(src).toMatch(/CameraRig/);
    expect(src).not.toMatch(/new\s+ChaseCamera\b/);
  });

  it('EDGE6: HudV2 replaces Hud and receives sector times, lapValid and deltaSeconds', () => {
    const src = mainSrc();
    expect(src).toMatch(/import\s+['"]\.\/ui\/hudV2\.css['"]/);
    expect(src).toMatch(/new\s+HudV2\b/);
    expect(src).not.toMatch(/new\s+Hud\s*\(/);
    expect(src).toMatch(/sectorCompleted/);
    expect(src).toMatch(/sectorTimes/);
    expect(src).toMatch(/bestSectorTimes/);
    expect(src).toMatch(/lapValid/);
    expect(src).toMatch(/deltaSeconds/);
  });

  it('EDGE7: ghost loads at boot, records from lap start, saves on finish and drives the ghost car via ghostAt', () => {
    const src = mainSrc();
    expect(src).toMatch(/loadGhost\s*\(/);
    expect(src).toMatch(/GhostRecorder/);
    expect(src).toMatch(/\.start\(\)/);
    expect(src).toMatch(/\.record\(/);
    expect(src).toMatch(/finishLap\s*\(/);
    expect(src).toMatch(/saveGhostIfFaster\s*\(/);
    expect(src).toMatch(/ghostAt\s*\(/);
    expect(src).toMatch(/lapStarted/);
    expect(src).toMatch(/localStorage/);
  });

  it('EDGE8: EngineAudio resumes on the first user gesture and updates with rpm, throttle and slips', () => {
    const src = mainSrc();
    expect(src).toMatch(/EngineAudio/);
    expect(src).toMatch(/\.resume\(\)/);
    expect(src).toMatch(/['"]click['"]/);
    expect(src).toMatch(/\brpm\b/);
  });

  it('EDGE9: preset comes from ?preset= else loadPreset, applies pixel ratio, shadows and tree farDistance, and FpsOverlay reports fps and draw calls', () => {
    const src = mainSrc();
    expect(src).toMatch(/['"]preset['"]/);
    expect(src).toMatch(/loadPreset\s*\(/);
    expect(src).toMatch(/presetSettings\s*\(/);
    expect(src).toMatch(/setPixelRatio\s*\(/);
    expect(src).toMatch(/setEnabled\s*\(/);
    expect(src).toMatch(/farDistance/);
    expect(src).toMatch(/FpsOverlay/);
    expect(src).toMatch(/info\.render\.calls/);
  });

  it('EDGE10: __SIMGAME__ exposes cameraMode, gear, preset, drawCalls and teleportToIndex', () => {
    const src = mainSrc();
    expect(src).toMatch(/cameraMode\s*:/);
    expect(src).toMatch(/gear\s*:/);
    expect(src).toMatch(/preset\s*:/);
    expect(src).toMatch(/drawCalls\s*:/);
    expect(src).toMatch(/teleportToIndex\s*:/);
  });
});
