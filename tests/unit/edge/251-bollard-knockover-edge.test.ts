import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2, VehicleState } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import { groundHeightAt } from '../../../src/track/ground';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const BOLLARDS_MODULE = '../../../src/track/bollards';
const BOLLARD_RENDERER_MODULE = '../../../src/render/bollardRenderer';

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
type BollardCarFromStateFn = (s: VehicleState, halfLength: number, halfWidth: number, out: BollardCar) => BollardCar;

async function load<T>(modPath: string, name: string): Promise<T> {
  const mod = (await import(modPath)) as Record<string, unknown>;
  return mod[name] as T;
}

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

function withBollards(pts: [number, number][]): TrackDataV2 {
  const track = straightTrack();
  track.bollards = pts.map(([x, z], i) => ({ x, z, index: i, side: 'right' as const }));
  return track;
}

function carA(x: number, z: number, yaw = -Math.PI / 2, vx = 20, vz = 0): BollardCar {
  return { x, z, yaw, vx, vz, halfLength: 2.5, halfWidth: 1 };
}

function advance(car: BollardCar): void {
  car.x += car.vx * FIXED_DT;
  car.z += car.vz * FIXED_DT;
}

describe('251 bollard knockover edge', () => {
  it('EDGE1: bollard at the car centre gets the 2 m/s impulse along the car forward direction', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    const car = carA(100, 5); // yaw -pi/2 => forward (+1, 0)
    step(field, [car], FIXED_DT);
    expect(field.state[0]).toBe(1);
    expect(field.vx[0], 'vx = 0.7*20 + 2*1').toBeCloseTo(0.7 * 20 + 2, 4);
    expect(field.vz[0], 'vz = 0 + 2*0').toBeCloseTo(0, 4);
    expect(field.vy[0]).toBeCloseTo(3, 4);
  });

  it('EDGE2: oblique hit uses the normalised bollard-minus-centre direction; spin axis is unit and perpendicular to the horizontal velocity', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    const car = carA(98, 4); // centre (98,4); bollard on OBB boundary; n = (2,1)/sqrt(5)
    step(field, [car], FIXED_DT);
    expect(field.state[0]).toBe(1);
    const nx = 2 / Math.sqrt(5);
    const nz = 1 / Math.sqrt(5);
    expect(field.vx[0], 'vx = 0.7*20 + 2*nx').toBeCloseTo(0.7 * 20 + 2 * nx, 4);
    expect(field.vz[0], 'vz = 0 + 2*nz').toBeCloseTo(2 * nz, 4);
    const ax = field.spinAxisX[0];
    const az = field.spinAxisZ[0];
    expect(Math.hypot(ax, az), 'unit axis').toBeCloseTo(1, 5);
    expect(ax * field.vx[0] + az * field.vz[0], 'axis perpendicular to velocity').toBeCloseTo(0, 4);
  });

  it('EDGE3: with yaw 0 (forward -z) halfLength lies along -z and halfWidth across x; independent bollards', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 7.3], [101.2, 10], [102.7, 10]]));
    const car = carA(100, 10, 0, 5, 0); // OBB x in [99,101], z in [7.5,12.5]
    step(field, [car], FIXED_DT);
    expect(field.state[0], 'front face touch (7.5-7.3 = radius)').toBe(1);
    expect(field.state[1], 'side face touch (101.2-101 = radius)').toBe(1);
    expect(field.state[2], 'beyond halfWidth + radius stays standing').toBe(0);
  });

  it('EDGE4: rear face counts (inclusive OBB) and the normal points away from the car centre', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    const car = carA(102.7, 5); // rear face at 100.2, bollard touching it, car drives away (+x)
    step(field, [car], FIXED_DT);
    expect(field.state[0]).toBe(1);
    expect(field.vx[0], 'vx = 0.7*20 + 2*(-1)').toBeCloseTo(0.7 * 20 - 2, 4);
    expect(field.vz[0]).toBeCloseTo(0, 4);
  });

  it('EDGE5: a resting bollard is not re-triggered by an overlapping car and its timer keeps counting', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    field.state[0] = 2;
    field.timer[0] = 10;
    field.angle[0] = 1.5;
    field.x[0] = 100.1;
    field.y[0] = 0;
    field.z[0] = 5.05;
    const car = carA(100, 5);
    step(field, [car], FIXED_DT);
    expect(field.state[0], 'still resting').toBe(2);
    expect(field.timer[0], 'timer counts from the hit').toBeCloseTo(10 + FIXED_DT, 5);
    expect(field.vx[0] + field.vy[0] + field.vz[0], 'velocity stays zero').toBe(0);
  });

  it('EDGE6: with no cars a standing bollard never moves, a track without bollards yields count 0, and creation y is the ground height', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    for (let i = 0; i < 5; i++) step(field, [], FIXED_DT);
    expect(field.state[0]).toBe(0);
    expect(field.x[0]).toBe(100);
    expect(field.z[0]).toBe(5);
    expect(field.timer[0]).toBe(0);
    const raised = straightTrack();
    raised.terrain = { originX: 0, originZ: 0, sizeX: 100, sizeZ: 100, rows: 1, cols: 1, heights: [2.5, 2.5, 2.5, 2.5] };
    raised.bollards = [{ x: 100, z: 5, index: 0, side: 'right' }];
    const field2 = create(raised);
    expect(field2.y[0], 'initial y = groundHeightAt').toBeCloseTo(groundHeightAt(raised, 100, 5), 5);
    const empty = straightTrack();
    delete (empty as { bollards?: unknown }).bollards;
    const field3 = create(empty);
    expect(field3.count).toBe(0);
    expect(field3.state.length).toBe(0);
    expect(() => step(field3, [carA(90, 5)], FIXED_DT)).not.toThrow();
  });

  it('EDGE7: a flying bollard integrates gravity 9.81 from vy 3 and lands with zero velocity, with no cars present', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const field = create(withBollards([[100, 5]]));
    field.state[0] = 1;
    field.y[0] = 0.5;
    field.vy[0] = 3;
    field.vx[0] = 1.5;
    field.vz[0] = 0;
    field.angle[0] = 0;
    step(field, [], FIXED_DT);
    expect(field.vy[0], 'vy after one step = 3 - 9.81*dt').toBeCloseTo(3 - 9.81 * FIXED_DT, 5);
    let apex = 0.5;
    let steps = 1;
    while (field.state[0] === 1 && steps < Math.round(2 / FIXED_DT)) {
      step(field, [], FIXED_DT);
      if (field.y[0] > apex) apex = field.y[0];
      steps++;
    }
    expect(field.state[0], 'landed').toBe(2);
    expect(apex - 0.5, 'apex rise ~ 3^2/(2*9.81)').toBeCloseTo(9 / (2 * 9.81), 1);
    expect(steps * FIXED_DT, 'flight time ~ (3+sqrt(9+2*9.81*0.5))/9.81').toBeCloseTo((3 + Math.sqrt(9 + 2 * 9.81 * 0.5)) / 9.81, 1);
    expect(Math.abs(field.y[0] - groundHeightAt(withBollards([[100, 5]]), field.x[0], field.z[0])), 'y clamped to ground').toBeLessThanOrEqual(1e-6);
    expect(field.vx[0] + field.vy[0] + field.vz[0], 'velocity zeroed at rest').toBe(0);
  });

  it('EDGE8: respawn uses the dt parameter, never fires before 20 s, and fully resets the bollard', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const track = withBollards([[100, 5]]);
    const field = create(track);
    field.state[0] = 2;
    field.timer[0] = 0;
    field.angle[0] = 1.5;
    field.x[0] = 102;
    field.y[0] = 0;
    field.z[0] = 5.3;
    field.vx[0] = 1;
    field.vy[0] = 2;
    field.vz[0] = -3;
    for (let i = 0; i < 39; i++) step(field, [], 0.5);
    expect(field.state[0], '19.5 s elapsed: still resting').toBe(2);
    for (let i = 0; i < 3 && field.state[0] !== 0; i++) step(field, [], 0.5);
    expect(field.state[0], 'respawned once timer >= 20 s').toBe(0);
    expect(field.x[0], 'x = home').toBeCloseTo(100, 6);
    expect(field.z[0], 'z = home').toBeCloseTo(5, 6);
    expect(field.y[0], 'y = ground').toBeCloseTo(groundHeightAt(track, 100, 5), 5);
    expect(field.vx[0] + field.vy[0] + field.vz[0], 'velocity zeroed').toBe(0);
    expect(field.angle[0], 'angle zeroed').toBe(0);
    expect(field.timer[0], 'timer zeroed').toBe(0);
  });

  it('EDGE9: bollardCarFromState maps rotation quaternion and forwardSpeed to yaw and (vx, vz), copies position and extents, and returns out', async () => {
    const fromState = await load<BollardCarFromStateFn>(BOLLARDS_MODULE, 'bollardCarFromState');
    const s2 = Math.SQRT1_2;
    const out: BollardCar = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, halfLength: 0, halfWidth: 0 };
    const state: VehicleState = {
      position: { x: 90, y: 1.5, z: 5 },
      rotation: { x: 0, y: -s2, z: 0, w: s2 }, // yaw -pi/2 => forward (+1, 0)
      forwardSpeed: 20,
      wheels: [],
    };
    const returned = fromState(state, 2.5, 1, out);
    expect(returned).toBe(out);
    expect(out.x).toBe(90);
    expect(out.z).toBe(5);
    expect(out.yaw).toBeCloseTo(-Math.PI / 2, 6);
    expect(out.vx).toBeCloseTo(20, 5);
    expect(out.vz).toBeCloseTo(0, 5);
    expect(out.halfLength).toBe(2.5);
    expect(out.halfWidth).toBe(1);
    fromState(
      { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, forwardSpeed: -10, wheels: [] },
      2, 0.9, out,
    );
    expect(out.yaw, 'identity rotation => yaw 0').toBeCloseTo(0, 6);
    expect(out.vx, 'reverse: forward (0,-1) * -10').toBeCloseTo(0, 5);
    expect(out.vz).toBeCloseTo(10, 5);
  });

  it('EDGE10: renderer update() leaves a standing matrix untouched and restores the home matrix after respawn', async () => {
    const create = await load<CreateBollardFieldFn>(BOLLARDS_MODULE, 'createBollardField');
    const step = await load<StepBollardsFn>(BOLLARDS_MODULE, 'stepBollards');
    const createRenderer = await load<CreateBollardRendererFn>(BOLLARD_RENDERER_MODULE, 'createBollardRenderer');
    const field = create(withBollards([[100, 5]]));
    const renderer = createRenderer(field);
    const home = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, home);
    const homeArr = home.toArray();
    renderer.update();
    renderer.update();
    const afterIdle = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, afterIdle);
    expect(afterIdle.toArray(), 'standing matrix untouched by idle update').toEqual(homeArr);
    const car = carA(90, 5);
    for (let i = 0; i < Math.round(2 / FIXED_DT) && field.state[0] === 0; i++) {
      advance(car);
      step(field, [car], FIXED_DT);
    }
    expect(field.state[0], 'hit happened').not.toBe(0);
    car.x = 5000;
    for (let i = 0; i < Math.round(23 / FIXED_DT) && field.state[0] !== 0; i++) {
      advance(car);
      step(field, [car], FIXED_DT);
    }
    expect(field.state[0], 'respawned').toBe(0);
    renderer.update();
    const restored = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, restored);
    const restoredArr = restored.toArray();
    for (let i = 0; i < 16; i++) {
      expect(restoredArr[i], `restored matrix element ${i}`).toBeCloseTo(homeArr[i], 5);
    }
  });
});
