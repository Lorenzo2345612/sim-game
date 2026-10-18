import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { DebrisRenderer, type DebrisRenderEntry } from '../../../src/render/debrisRenderer';
import type { DebrisKind } from '../../../src/physics/debris';

function entry(kind: DebrisKind, x: number, y = 0.3, z = 0): DebrisRenderEntry {
  return { kind, position: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}

function wheelTemplate(hidden = false): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.3)));
  g.visible = !hidden;
  return g;
}

function nodes(): THREE.Object3D[] {
  return [0, 1, 2, 3].map(() => new THREE.Object3D());
}

describe('147 debris renderer post-code gaps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTR1: sync creates one mesh per entry and copies the pose', () => {
    const scene = new THREE.Group();
    const renderer = new DebrisRenderer(scene);
    const entries: DebrisRenderEntry[] = [
      entry('frontWing', 1, 2, 3),
      entry('rearWing', -4, 5, -6),
    ];
    renderer.sync(entries, 2);
    const root = scene.children[0];
    expect(root).toBeInstanceOf(THREE.Group);
    expect(root.children).toHaveLength(2);
    expect(root.children[0].position.x).toBeCloseTo(1, 9);
    expect(root.children[0].position.y).toBeCloseTo(2, 9);
    expect(root.children[0].position.z).toBeCloseTo(3, 9);
    expect(root.children[1].position.x).toBeCloseTo(-4, 9);
    expect(root.children[1].quaternion.w).toBe(1);
    renderer.dispose();
  });

  it('POSTR2: shrinking the count removes meshes and growing adds them back', () => {
    const scene = new THREE.Group();
    const renderer = new DebrisRenderer(scene);
    const root = () => scene.children[0];
    renderer.sync([entry('wheel', 0), entry('wheel', 1), entry('wheel', 2)], 3);
    expect(root().children).toHaveLength(3);
    renderer.sync([entry('wheel', 0), entry('wheel', 1), entry('wheel', 2)], 1);
    expect(root().children).toHaveLength(1);
    renderer.sync([entry('wheel', 0), entry('wheel', 1), entry('wheel', 2)], 3);
    expect(root().children).toHaveLength(3);
    renderer.dispose();
  });

  it('POSTR3: a kind change at an index replaces the mesh', () => {
    const scene = new THREE.Group();
    const renderer = new DebrisRenderer(scene, { wheelSource: wheelTemplate() });
    renderer.sync([entry('wheel', 0)], 1);
    const before = scene.children[0].children[0];
    expect(before).not.toBeInstanceOf(THREE.Mesh);
    renderer.sync([entry('frontWing', 0)], 1);
    const after = scene.children[0].children[0] as THREE.Mesh;
    expect(after).not.toBe(before);
    expect(after).toBeInstanceOf(THREE.Mesh);
    const geo = after.geometry as THREE.BoxGeometry;
    expect(geo.parameters.width).toBeCloseTo(1.6, 6);
    expect(geo.parameters.height).toBeCloseTo(0.05, 6);
    expect(geo.parameters.depth).toBeCloseTo(0.4, 6);
    renderer.dispose();
  });

  it('POSTR4: car wheel nodes are hidden only for the flagged car and wheel', () => {
    const scene = new THREE.Group();
    const carWheels = [nodes(), nodes()];
    const renderer = new DebrisRenderer(scene, { carWheels });
    const hidden = (car: number, wheel: number): boolean => car === 1 && wheel === 2;
    renderer.sync([entry('wheel', 0)], 1, hidden);
    for (let w = 0; w < 4; w++) {
      expect(carWheels[0][w].visible).toBe(true);
      expect(carWheels[1][w].visible).toBe(w !== 2);
    }
    renderer.sync([entry('wheel', 0)], 1, () => false);
    expect(carWheels[1][2].visible).toBe(true);
    renderer.dispose();
  });

  it('POSTR5: dispose() detaches the root and disposes owned geometry and material only', () => {
    const scene = new THREE.Group();
    const geoSpy = vi.spyOn(THREE.BoxGeometry.prototype, 'dispose');
    const matSpy = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');
    const template = wheelTemplate();
    const templateGeo = (template.children[0] as THREE.Mesh).geometry;
    let sharedDisposals = 0;
    templateGeo.dispose = () => {
      sharedDisposals += 1;
    };
    const renderer = new DebrisRenderer(scene, { wheelSource: template });
    renderer.sync([entry('frontWing', 0), entry('rearWing', 1), entry('wheel', 2)], 3);
    expect(scene.children).toHaveLength(1);
    renderer.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    expect(sharedDisposals).toBe(0);
  });

  it('POSTR6: a wheel debris clones the template node and forces it visible', () => {
    const scene = new THREE.Group();
    const template = wheelTemplate(true);
    const renderer = new DebrisRenderer(scene, { wheelSource: template });
    renderer.sync([entry('wheel', 0)], 1);
    const clone = scene.children[0].children[0];
    expect(clone).not.toBe(template);
    expect(clone.visible).toBe(true);
    template.traverse((o) => {
      expect(o).not.toBe(clone);
    });
    renderer.dispose();
  });
});
