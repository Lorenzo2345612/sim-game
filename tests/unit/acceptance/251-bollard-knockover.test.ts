import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import { groundHeightAt } from '../../../src/track/ground';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

// Variable specifiers keep typecheck green until task 251 adds the exports (the 250 pattern).
const BOLLARDS_MODULE = '../../../src/track/bollards';
const BOLLARD_RENDERER_MODULE = '../../../src/render/bollardRenderer';

const BOLLARD_RADIUS = 0.2;
const BOLLARD_RESPAWN_S = 20;
const BOLLARD_CLEAR_M = 30;
const STEPS_PER_S = Math.round(1 / FIXED_DT);

interface BollardCar { x: number; z: number; yaw: number; vx: number; vz: number; halfLength: number; halfWidth: number }
interface BollardField {
  readonly count: number;
  readonly homeX: Float32Array; readonly homeZ: Float32Array;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly spinAxisX: Float32Array; readonly spinAxisZ: Float32Array; readonly angle: Float32Array;
  readonly state: Uint8Array; readonly timer: Float32Array;
}
interface BollardRenderer { readonly mesh: THREE.InstancedMesh; update(): void; dispose(): void }

type CreateBollardFieldFn = (track: TrackDataV2) => BollardField;
type StepBollardsFn = (field: BollardField, cars: readonly BollardCar[], dt: number) => void;
type CreateBollardRendererFn = (field: BollardField) => BollardRenderer;

async function loadCreateBollardField(): Promise<CreateBollardFieldFn> {
  const mod = (await import(BOLLARDS_MODULE)) as unknown as { createBollardField: CreateBollardFieldFn };
  return mod.createBollardField;
}

async function loadStepBollards(): Promise<StepBollardsFn> {
  const mod = (await import(BOLLARDS_MODULE)) as unknown as { stepBollards: StepBollardsFn };
  return mod.stepBollards;
}

async function loadCreateBollardRenderer(): Promise<CreateBollardRendererFn> {
  const mod = (await import(BOLLARD_RENDERER_MODULE)) as unknown as { createBollardRenderer: CreateBollardRendererFn };
  return mod.createBollardRenderer;
}

// STRAIGHT: centerline [i*10, 0], i = 0..99, width 12, elevation 0, flat zero terrain.
function straightTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: 100 }, (_, i) => [i * 10, 0]);
  return {
    ...fixture,
    id: 'straight',
    name: 'Straight',
    widthMeters: 12,
    lengthMeters: 990,
    officialLengthMeters: 990,
    centerline,
    sectors: [0, 33, 66],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    trees: [],
    treeSpecies: [],
    grandstands: [],
    terrain: { originX: 0, originZ: 0, sizeX: 100, sizeZ: 100, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    bollards: [],
  };
}

const BOLLARD_X = 100;
const BOLLARD_Z = 5;

function postedTrack(): TrackDataV2 {
  const track = straightTrack();
  track.bollards = [{ x: BOLLARD_X, z: BOLLARD_Z, index: 10, side: 'right' }];
  return track;
}

// Car A: yaw -pi/2 (forward +x), 20 m/s along +x.
function carA(x = 90, z = BOLLARD_Z): BollardCar {
  return { x, z, yaw: -Math.PI / 2, vx: 20, vz: 0, halfLength: 2.5, halfWidth: 1 };
}

function advance(car: BollardCar): void {
  car.x += car.vx * FIXED_DT;
  car.z += car.vz * FIXED_DT;
}

function fieldArrays(field: BollardField): Record<string, number[]> {
  return {
    homeX: [...field.homeX], homeZ: [...field.homeZ],
    x: [...field.x], y: [...field.y], z: [...field.z],
    vx: [...field.vx], vy: [...field.vy], vz: [...field.vz],
    spinAxisX: [...field.spinAxisX], spinAxisZ: [...field.spinAxisZ], angle: [...field.angle],
    state: [...field.state], timer: [...field.timer],
  };
}

// Steps the car (advanced by v*dt each step) and the field until the bollard leaves
// state 0; returns the hit tick (1-based) or -1 after `maxSteps`.
async function stepUntilHit(
  field: BollardField, car: BollardCar, maxSteps: number,
): Promise<number> {
  const stepBollards = await loadStepBollards();
  for (let i = 1; i <= maxSteps; i++) {
    advance(car);
    stepBollards(field, [car], FIXED_DT);
    if (field.state[0] !== 0) return i;
  }
  return -1;
}

describe('251 bollard knockover acceptance', () => {
  it('AT1: POSTED + car A leaves state 0 at the first tick where the car front >= 99.8 (+-1 tick), vx > 10 at that tick, and rests at ground with x > 100 after 2 s', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const track = postedTrack();
    const field = createBollardField(track);
    expect(field.count).toBe(1);
    expect(field.state[0]).toBe(0);
    const car = carA();
    // First tick n where front = 90 + n*20*FIXED_DT + 2.5 >= 100 - 0.2.
    const frontTick = Math.ceil((BOLLARD_X - BOLLARD_RADIUS - 2.5 - 90) / (20 * FIXED_DT));
    let hitTick = -1;
    let hitVx = 0;
    for (let i = 1; i <= Math.round(2 / FIXED_DT); i++) {
      advance(car);
      stepBollards(field, [car], FIXED_DT);
      if (hitTick < 0 && field.state[0] !== 0) {
        hitTick = i;
        hitVx = field.vx[0];
      }
    }
    expect(hitTick, 'hit tick').toBeGreaterThan(0);
    expect(Math.abs(hitTick - frontTick), `hit ${hitTick} vs front tick ${frontTick}`).toBeLessThanOrEqual(1);
    expect(hitVx, 'vx at hit').toBeGreaterThan(10);
    expect(field.state[0], 'state after 2 s').toBe(2);
    const ground = groundHeightAt(track, field.x[0], field.z[0]);
    expect(Math.abs(field.y[0] - ground), `y ${field.y[0]} vs ground ${ground}`).toBeLessThanOrEqual(0.05);
    expect(field.x[0], 'x past home').toBeGreaterThan(BOLLARD_X);
  });

  it('AT2: POSTED + car A at z 2 (lateral gap 3 - 1 - 0.2 > 0) stays in state 0 throughout 2 s', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const field = createBollardField(postedTrack());
    const car = carA(90, 2);
    const steps = Math.round(2 / FIXED_DT);
    expect(Math.abs(BOLLARD_Z - car.z) - car.halfWidth - BOLLARD_RADIUS, 'lateral gap').toBeGreaterThan(0);
    for (let i = 0; i < steps; i++) {
      advance(car);
      stepBollards(field, [car], FIXED_DT);
      expect(field.state[0], `state at tick ${i + 1}`).toBe(0);
    }
  });

  it('AT3: after the AT1 hit the bollard respawns at its home x/z (+-1e-9) no earlier than 20 s after the hit and by 22 s + 1 tick when the car is teleported to x 5000', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const field = createBollardField(postedTrack());
    const car = carA();
    const hitTick = await stepUntilHit(field, car, Math.round(2 / FIXED_DT));
    expect(hitTick, 'hit tick').toBeGreaterThan(0);
    car.x = 5000;
    let tick = hitTick;
    let respawnTick = -1;
    const endTick = Math.round(22 / FIXED_DT) + 1;
    while (tick < endTick) {
      advance(car);
      tick += 1;
      stepBollards(field, [car], FIXED_DT);
      if (field.state[0] === 0) {
        respawnTick = tick;
        break;
      }
    }
    expect(respawnTick, 'respawned by 22 s + 1 tick').toBeGreaterThan(0);
    expect((respawnTick - hitTick) / STEPS_PER_S, 'not before 20 s after the hit').toBeGreaterThanOrEqual(BOLLARD_RESPAWN_S);
    expect(Math.abs(field.x[0] - BOLLARD_X), `x ${field.x[0]}`).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(field.z[0] - BOLLARD_Z), `z ${field.z[0]}`).toBeLessThanOrEqual(1e-9);
  });

  it('AT4: after the AT1 hit with the car parked at x 120 (within 30 m of home) the bollard is still state 2 at 30 s', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const field = createBollardField(postedTrack());
    const car = carA();
    const hitTick = await stepUntilHit(field, car, Math.round(2 / FIXED_DT));
    expect(hitTick, 'hit tick').toBeGreaterThan(0);
    car.x = 120;
    car.vx = 0;
    expect(Math.hypot(car.x - BOLLARD_X, car.z - BOLLARD_Z), 'car within clear radius').toBeLessThan(BOLLARD_CLEAR_M);
    let tick = hitTick;
    const endTick = Math.round(30 / FIXED_DT);
    while (tick < endTick) {
      tick += 1;
      stepBollards(field, [car], FIXED_DT);
    }
    expect(field.state[0], 'still resting').toBe(2);
  });

  it('AT5: running the AT1 scenario twice yields identical field arrays', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const run = (): Record<string, number[]> => {
      const field = createBollardField(postedTrack());
      const car = carA();
      for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
        advance(car);
        stepBollards(field, [car], FIXED_DT);
      }
      return fieldArrays(field);
    };
    expect(run()).toEqual(run());
  });

  it('AT6: the car object is unchanged (deep equal) across every stepBollards call of the AT1 scenario', async () => {
    const createBollardField = await loadCreateBollardField();
    const stepBollards = await loadStepBollards();
    const field = createBollardField(postedTrack());
    const car = carA();
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
      advance(car);
      const before = structuredClone(car);
      stepBollards(field, [car], FIXED_DT);
      expect(car, `car after step ${i + 1}`).toEqual(before);
    }
  });

  it('AT7: createBollardRenderer on the POSTED field yields an InstancedMesh with count 1 whose instance 0 matrix differs after a hit + update, and dispose() disposes geometry and material', async () => {
    const createBollardField = await loadCreateBollardField();
    const createBollardRenderer = await loadCreateBollardRenderer();
    const field = createBollardField(postedTrack());
    const renderer = createBollardRenderer(field);
    expect(renderer.mesh.name).toBe('bollards');
    expect(renderer.mesh.count).toBe(1);
    const initial = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, initial);
    const initialArr = initial.toArray();
    const stepBollards = await loadStepBollards();
    const car = carA();
    const hitTick = await stepUntilHit(field, car, Math.round(2 / FIXED_DT));
    expect(hitTick, 'hit tick').toBeGreaterThan(0);
    for (let i = hitTick; i < Math.round(2 / FIXED_DT); i++) {
      advance(car);
      stepBollards(field, [car], FIXED_DT);
    }
    renderer.update();
    const updated = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, updated);
    expect([...updated.toArray()], 'instance 0 matrix changed').not.toEqual(initialArr);
    const geoSpy = vi.spyOn(renderer.mesh.geometry, 'dispose');
    const materials = Array.isArray(renderer.mesh.material) ? renderer.mesh.material : [renderer.mesh.material];
    const matSpies = materials.map((m) => vi.spyOn(m, 'dispose'));
    renderer.dispose();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    for (const s of matSpies) expect(s).toHaveBeenCalledTimes(1);
  });

  it('AT8: src/track/bollards.ts imports nothing from three and the game loop calls stepBollards(', () => {
    const bollardsSrc = readFileSync(join(ROOT, 'src', 'track', 'bollards.ts'), 'utf8');
    expect(bollardsSrc).not.toMatch(/from ['"]three['"]/);
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    expect(mainSrc).toContain('stepBollards(');
  });
});
