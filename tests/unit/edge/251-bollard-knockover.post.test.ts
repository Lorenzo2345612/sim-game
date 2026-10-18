import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import { groundHeightAt } from '../../../src/track/ground';
import {
  BOLLARD_CLEAR_M, BOLLARD_HEIGHT, BOLLARD_RADIUS,
  bollardCarFromState, createBollardField, stepBollards,
  type BollardCar, type BollardField,
} from '../../../src/track/bollards';
import { createBollardRenderer } from '../../../src/render/bollardRenderer';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

function straightTrack(bollards: TrackDataV2['bollards'] = []): TrackDataV2 {
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
    bollards,
  };
}

function posted(x = 100, z = 5): TrackDataV2 {
  return straightTrack([{ x, z, index: 0, side: 'right' }]);
}

function car(x: number, z: number, yaw = -Math.PI / 2, vx = 20, vz = 0): BollardCar {
  return { x, z, yaw, vx, vz, halfLength: 2.5, halfWidth: 1 };
}

function flight(field: BollardField, i = 0): void {
  field.state[i] = 1;
  field.y[i] = 0.5;
  field.vx[i] = 1.5;
  field.vy[i] = 3;
  field.vz[i] = 0;
  field.angle[i] = 0;
  field.timer[i] = 0;
}

describe('251 bollard knockover post', () => {
  it('POST1: dt 0 freezes a flying bollard and leaves an unhit standing bollard unchanged', () => {
    const field = createBollardField(posted());
    flight(field);
    stepBollards(field, [], 0);
    expect(field.state[0], 'still flying').toBe(1);
    expect(field.y[0]).toBe(0.5);
    expect(field.vy[0]).toBe(3);
    expect(field.timer[0]).toBe(0);
    expect(field.angle[0]).toBe(0);
    const field2 = createBollardField(posted());
    stepBollards(field2, [], 0);
    stepBollards(field2, [], -0.01);
    expect(field2.state[0], 'standing with negative dt').toBe(0);
    expect(field2.x[0]).toBe(100);
    expect(field2.timer[0]).toBe(0);
    expect(() => stepBollards(field, [car(100, 5)], -0.01)).not.toThrow();
  });

  it('POST2: a large dt lands a flying bollard clamped to the ground and respawns a resting bollard in one step', () => {
    const track = posted();
    const field = createBollardField(track);
    flight(field);
    stepBollards(field, [], 5);
    expect(field.state[0], 'landed despite overshoot').toBe(2);
    expect(field.y[0], 'clamped to ground').toBe(groundHeightAt(track, field.x[0], field.z[0]));
    expect(field.x[0], 'x advanced by vx*dt').toBeCloseTo(100 + 1.5 * 5, 3);
    expect(field.vx[0] + field.vy[0] + field.vz[0], 'velocity zeroed').toBe(0);
    field.state[0] = 2;
    field.x[0] = 103;
    field.y[0] = 0;
    field.z[0] = 5.4;
    field.timer[0] = 0;
    stepBollards(field, [], 25);
    expect(field.state[0], 'respawned after one large step').toBe(0);
    expect(field.x[0]).toBeCloseTo(100, 6);
    expect(field.timer[0]).toBe(0);
  });

  it('POST3: the respawn check also fires while the bollard is still flying', () => {
    const track = posted();
    const field = createBollardField(track);
    field.state[0] = 1;
    field.x[0] = 100.05;
    field.y[0] = 5;
    field.z[0] = 5;
    field.vy[0] = 3;
    field.vx[0] = 0.6;
    field.timer[0] = 19.99;
    stepBollards(field, [], 0.02);
    expect(field.state[0], 'standing again').toBe(0);
    expect(field.x[0]).toBeCloseTo(100, 6);
    expect(field.y[0], 'y = home ground').toBeCloseTo(groundHeightAt(track, 100, 5), 5);
    expect(field.timer[0]).toBe(0);
  });

  it('POST4: a car at exactly BOLLARD_CLEAR_M from home blocks the respawn; a hair further does not', () => {
    const field = createBollardField(posted());
    field.state[0] = 2;
    field.x[0] = 100.3;
    field.y[0] = 0;
    field.z[0] = 5.2;
    field.timer[0] = 19.99;
    const block = car(100 + BOLLARD_CLEAR_M, 5, 0, 0, 0);
    stepBollards(field, [block], 0.02);
    expect(field.state[0], 'exactly 30 m counts as too close').toBe(2);
    block.x = 100 + BOLLARD_CLEAR_M + 0.001;
    stepBollards(field, [block], 0.02);
    expect(field.state[0], 'beyond 30 m respawns').toBe(0);
    expect(field.x[0]).toBeCloseTo(100, 6);
  });

  it('POST5: a flying bollard under a car is not re-hit and its timer counts from the original hit', () => {
    const field = createBollardField(posted());
    flight(field);
    field.y[0] = 0.3;
    field.vx[0] = 5;
    field.angle[0] = 0.4;
    const atCar = car(100, 5);
    stepBollards(field, [atCar], FIXED_DT);
    expect(field.state[0], 'still flying').toBe(1);
    expect(field.vx[0], 'impulse not recomputed').toBe(5);
    expect(field.timer[0], 'timer counts from the hit, not reset').toBeCloseTo(FIXED_DT, 6);
    expect(field.angle[0], 'spin continues, not reset to 0').toBeCloseTo(0.4 + 8 * FIXED_DT, 5);
  });

  it('POST6: the first overlapping car in the array supplies the impulse', () => {
    const field = createBollardField(posted());
    const slow = car(98, 5, -Math.PI / 2, 4);
    const fast = car(99, 5, -Math.PI / 2, 40);
    stepBollards(field, [slow, fast], FIXED_DT);
    expect(field.state[0]).toBe(1);
    expect(field.vx[0], 'vx = 0.7*4 + 2 from the slow car').toBeCloseTo(0.7 * 4 + 2, 4);
    expect(field.vz[0]).toBeCloseTo(0, 4);
  });

  it('POST7: a cancelling hit (zero horizontal speed) falls back to the normal-direction spin axis', () => {
    const field = createBollardField(posted());
    const back = car(100, 5, -Math.PI / 2, -2 / 0.7, 0); // 0.7*vx + 2 = 0, bollard at the centre
    stepBollards(field, [back], FIXED_DT);
    expect(field.state[0]).toBe(1);
    expect(field.vx[0], 'hvx cancels').toBeCloseTo(0, 4);
    expect(field.vz[0]).toBeCloseTo(0, 4);
    expect(field.spinAxisX[0], 'axis = fallback normal (1, 0)').toBeCloseTo(1, 4);
    expect(field.spinAxisZ[0]).toBeCloseTo(0, 4);
  });

  it('POST8: with yaw pi (forward +z) halfLength lies along z; 1.9 m ahead hits, 2.71 m does not', () => {
    const field = createBollardField(straightTrack([
      { x: 100, z: 11.9, index: 0, side: 'right' },
      { x: 100, z: 12.71, index: 1, side: 'right' },
    ]));
    stepBollards(field, [car(100, 10, Math.PI, 0, 0)], FIXED_DT);
    expect(field.state[0], 'within halfLength + radius').toBe(1);
    expect(field.state[1], 'beyond halfLength + radius').toBe(0);
  });

  it('POST9: a field not produced by createBollardField is a no-op', () => {
    const plain: BollardField = {
      count: 1,
      homeX: new Float32Array([100]), homeZ: new Float32Array([5]),
      x: new Float32Array([100]), y: new Float32Array([0]), z: new Float32Array([5]),
      vx: new Float32Array(1), vy: new Float32Array(1), vz: new Float32Array(1),
      spinAxisX: new Float32Array(1), spinAxisZ: new Float32Array(1), angle: new Float32Array(1),
      state: new Uint8Array(1), timer: new Float32Array(1),
    };
    expect(() => stepBollards(plain, [car(100, 5)], FIXED_DT)).not.toThrow();
    expect(plain.state[0], 'no track, no hit').toBe(0);
    expect(plain.x[0]).toBe(100);
  });

  it('POST10: the resting matrix sits at ground + radius and a spinning matrix advances with angle', () => {
    const field = createBollardField(posted());
    const renderer = createBollardRenderer(field);
    field.state[0] = 2;
    field.x[0] = 100.3;
    field.y[0] = 0;
    field.z[0] = 5.1;
    field.spinAxisX[0] = 1;
    field.spinAxisZ[0] = 0;
    renderer.update();
    const lying = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, lying);
    expect(lying.elements[13], 'lying y = ground + radius').toBeCloseTo(BOLLARD_RADIUS, 5);
    expect(lying.elements[12], 'lying x').toBeCloseTo(100.3, 5);
    field.state[0] = 1;
    field.y[0] = 0.5;
    field.angle[0] = 0.5;
    renderer.update();
    const flyA = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, flyA);
    expect(flyA.elements[13], 'flying y = y + half height').toBeCloseTo(0.5 + BOLLARD_HEIGHT / 2, 5);
    field.angle[0] = 1.2;
    renderer.update();
    const flyB = new THREE.Matrix4();
    renderer.mesh.getMatrixAt(0, flyB);
    expect([...flyB.elements], 'rotation advances with angle').not.toEqual([...flyA.elements]);
  });

  it('POST11: the renderer tolerates an empty field', () => {
    const field = createBollardField(straightTrack([]));
    const renderer = createBollardRenderer(field);
    expect(renderer.mesh.count).toBe(0);
    expect(() => renderer.update()).not.toThrow();
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('POST12: the renderer uses a 0.2 x 0.8 cylinder with a white band in vertex colours', () => {
    const field = createBollardField(posted());
    const renderer = createBollardRenderer(field);
    const geo = renderer.mesh.geometry as THREE.CylinderGeometry;
    expect(geo.parameters.radiusTop).toBe(BOLLARD_RADIUS);
    expect(geo.parameters.radiusBottom).toBe(BOLLARD_RADIUS);
    expect(geo.parameters.height).toBe(BOLLARD_HEIGHT);
    const mat = renderer.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    const colors = geo.getAttribute('color') as THREE.BufferAttribute;
    let white = 0;
    let orange = 0;
    for (let i = 0; i < colors.count; i++) {
      const r = colors.getX(i);
      const g = colors.getY(i);
      const b = colors.getZ(i);
      if (r === 1 && g === 1 && b === 1) white += 1;
      if (r === 1 && Math.abs(g - 0.42) < 1e-6 && b === 0) orange += 1;
    }
    expect(white, 'white band vertices').toBeGreaterThan(0);
    expect(orange, 'orange body vertices').toBeGreaterThan(0);
    renderer.dispose();
  });

  it('POST13: bollardCarFromState with yaw +pi/2 maps forward -x', () => {
    const s2 = Math.SQRT1_2;
    const out: BollardCar = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, halfLength: 0, halfWidth: 0 };
    bollardCarFromState(
      { position: { x: 3, y: 0, z: -2 }, rotation: { x: 0, y: s2, z: 0, w: s2 }, forwardSpeed: 10, wheels: [] },
      2.5, 1, out,
    );
    expect(out.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(out.vx, 'forward (-1, 0) * 10').toBeCloseTo(-10, 5);
    expect(out.vz).toBeCloseTo(0, 5);
    expect(out.x).toBe(3);
    expect(out.z).toBe(-2);
  });

  it('POST14: main.ts wires the field, per-car mapping, per-frame renderer update and disposal; bollards.ts avoids Math.random', () => {
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    expect(mainSrc).toContain('createBollardField(');
    expect(mainSrc).toContain('bollardCarFromState(');
    expect(mainSrc).toContain('bollardRenderer?.update()');
    expect(mainSrc).toContain('disposables.push(bollardRenderer)');
    const bollardsSrc = readFileSync(join(ROOT, 'src', 'track', 'bollards.ts'), 'utf8');
    expect(bollardsSrc).not.toMatch(/Math\.random/);
  });
});
