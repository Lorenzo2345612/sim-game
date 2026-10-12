import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GHOST_HZ,
  GhostRecorder,
  ghostAt,
  ghostKey,
  loadGhost,
  saveGhostIfFaster,
  type GhostLap,
  type GhostSample,
  type GhostStorage,
} from '../../../src/game/ghost';
import { CarRenderer, WHEEL_NODE_NAMES } from '../../../src/render/carRenderer';
import type { Quat, Vec3 } from '../../../src/core/types';

class MemoryStorage implements GhostStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

function lap(samples: GhostSample[], lapTime = 1): GhostLap {
  return { trackId: 'monza', lapTime, samples };
}

function outs() {
  return {
    p: { x: 0, y: 0, z: 0 } as Vec3,
    q: { x: 0, y: 0, z: 0, w: 1 } as Quat,
  };
}

describe('ghost recorder gaps', () => {
  it('zero dt advances no time and records only the t = 0 sample', () => {
    const r = new GhostRecorder('monza');
    r.start();
    for (let i = 0; i < 500; i++) r.record(0, { x: i, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const l = r.finishLap(true, 0);
    expect(l?.samples).toHaveLength(1);
    expect(l?.samples[0][0]).toBe(0);
  });

  it('one huge dt yields at most one sample per record call', () => {
    const r = new GhostRecorder('monza');
    r.start();
    r.record(1000, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(r.finishLap(true, 1000)?.samples).toHaveLength(1);
    r.start();
    r.record(1000, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    r.record(1000, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const l = r.finishLap(true, 2000);
    expect(l?.samples).toHaveLength(2);
    expect(l?.samples[1][0]).toBe(1000);
  });

  it('samples copy the pose values, not the input objects', () => {
    const r = new GhostRecorder('monza');
    r.start();
    const position: Vec3 = { x: 1, y: 2, z: 3 };
    const rotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
    r.record(1 / GHOST_HZ, position, rotation);
    position.x = 99;
    rotation.w = -1;
    const l = r.finishLap(true, 1 / GHOST_HZ);
    expect(l?.samples[0].slice(1, 4)).toEqual([1, 2, 3]);
    expect(l?.samples[0][7]).toBe(1);
  });

  it('finishLap without start() returns a valid lap with empty samples', () => {
    const r = new GhostRecorder('monza');
    const l = r.finishLap(true, 5);
    expect(l).toEqual({ trackId: 'monza', lapTime: 5, samples: [] });
  });

  it('finishLap is non-destructive and guards the internal samples against external mutation', () => {
    const r = new GhostRecorder('monza', 10);
    r.start();
    r.record(0.5, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const a = r.finishLap(true, 1);
    if (!a) throw new Error('lap must be valid');
    const count = a.samples.length;
    a.samples.length = 0;
    const b = r.finishLap(true, 1);
    expect(b?.samples).toHaveLength(count);
    expect(b?.samples[0]).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
  });
});

describe('ghostAt gaps', () => {
  it('t exactly on a sample timestamp returns that sample pose', () => {
    const l = lap([
      [0, 0, 0, 0, 0, 0, 0, 1],
      [1, 10, 0, 0, 0, 0, 0, 1],
      [2, 20, 0, 0, 0, 0, 0, 1],
    ]);
    const { p, q } = outs();
    ghostAt(l, 1, p, q);
    expect(p).toEqual({ x: 10, y: 0, z: 0 });
    ghostAt(l, 2, p, q);
    expect(p).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('interpolates between the correct neighbours in a longer lap', () => {
    const l = lap([
      [0, 0, 0, 0, 0, 0, 0, 1],
      [1, 10, 0, 0, 0, 0, 0, 1],
      [2, 20, 0, 0, 0, 0, 0, 1],
      [3, 30, 0, 0, 0, 0, 0, 1],
      [4, 40, 0, 0, 0, 0, 0, 1],
    ]);
    const { p, q } = outs();
    ghostAt(l, 2.5, p, q);
    expect(p.x).toBeCloseTo(25, 6);
  });

  it('duplicate sample timestamps do not produce NaN outputs', () => {
    const l = lap([
      [0, 1, 0, 0, 0, 0, 0, 1],
      [0, 5, 0, 0, 0, 0, 0, 1],
      [1, 9, 0, 0, 0, 0, 0, 1],
    ]);
    const { p, q } = outs();
    for (const t of [0, 0.5, 1]) {
      ghostAt(l, t, p, q);
      expect(Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z + q.w)).toBe(true);
    }
  });

  it('normalises non-unit quaternion samples', () => {
    const l = lap([
      [0, 0, 0, 0, 0, 0, 0, 2],
      [1, 1, 0, 0, 0, 0, 0, 2],
    ]);
    const { p, q } = outs();
    ghostAt(l, 0.5, p, q);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    expect(q.w).toBeCloseTo(1, 6);
  });

  it('writes the out objects in place and returns void', () => {
    const l = lap([[0, 3, 4, 5, 0, 0, 0, 1]]);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const result = ghostAt(l, 0.5, p, q);
    expect(result).toBeUndefined();
    expect(p.x).toBe(3);
    expect(q.w).toBe(1);
  });
});

describe('storage gaps', () => {
  it('loadGhost rejects samples containing non-finite entries', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), JSON.stringify({ trackId: 'monza', lapTime: 1, samples: [[0, 1, 2, 3, 4, 5, 6, null]] }));
    expect(loadGhost(storage, 'monza')).toBeNull();
    storage.setItem(ghostKey('monza'), JSON.stringify({ trackId: 'monza', lapTime: 1, samples: [[0, 1, 2, 3, 4, 5, 6, 'x']] }));
    expect(loadGhost(storage, 'monza')).toBeNull();
  });

  it('loadGhost rejects a non-finite lapTime', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), JSON.stringify({ trackId: 'monza', lapTime: null, samples: [] }));
    expect(loadGhost(storage, 'monza')).toBeNull();
  });

  it('empty trackId still round-trips under its key', () => {
    const storage = new MemoryStorage();
    expect(ghostKey('')).toBe('ghost:');
    const l: GhostLap = { trackId: '', lapTime: 3, samples: [[0, 0, 0, 0, 0, 0, 0, 1]] };
    expect(saveGhostIfFaster(storage, l)).toBe(true);
    expect(loadGhost(storage, '')).toEqual(l);
  });
});

describe('src/game/ghost.ts purity', () => {
  it('imports nothing from three, window or document', () => {
    const src = readFileSync(join(process.cwd(), 'src/game/ghost.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three/);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).not.toMatch(/\bdocument\b/);
  });
});

function makeScene(): THREE.Object3D {
  const scene = new THREE.Object3D();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
  body.name = 'body';
  scene.add(body);
  for (const name of WHEEL_NODE_NAMES) {
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
    wheel.name = name;
    scene.add(wheel);
  }
  return scene;
}

function allMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  return meshes;
}

describe('CarRenderer.makeGhost', () => {
  it('clones materials: originals keep their color and are not shared', () => {
    const scene = makeScene();
    const body = scene.getObjectByName('body') as THREE.Mesh;
    const original = body.material as THREE.MeshStandardMaterial;
    const renderer = CarRenderer.fromGltfScene(scene);
    renderer.makeGhost();
    const ghostMat = body.material as THREE.MeshStandardMaterial;
    expect(ghostMat).not.toBe(original);
    expect(original.color.getHex()).toBe(0xff0000);
    expect(ghostMat.color.getHex()).toBe(0x66ccff);
  });

  it('makes every mesh translucent with depthWrite off, using defaults or custom args', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    renderer.makeGhost();
    for (const mesh of allMeshes(renderer.root)) {
      const m = mesh.material as THREE.Material;
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeCloseTo(0.35, 6);
      expect(m.depthWrite).toBe(false);
    }

    const custom = CarRenderer.fromGltfScene(makeScene());
    custom.makeGhost(0xff00ff, 0.5);
    for (const mesh of allMeshes(custom.root)) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      expect(m.opacity).toBeCloseTo(0.5, 6);
      expect(m.color.getHex()).toBe(0xff00ff);
    }
  });

  it('handles material arrays', () => {
    const scene = makeScene();
    const body = scene.getObjectByName('body') as THREE.Mesh;
    body.material = [new THREE.MeshStandardMaterial({ color: 0xff0000 }), new THREE.MeshStandardMaterial({ color: 0x0000ff })];
    const renderer = CarRenderer.fromGltfScene(scene);
    renderer.makeGhost(0x123456, 0.2);
    const mats = body.material as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(2);
    for (const m of mats) {
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeCloseTo(0.2, 6);
      expect(m.color.getHex()).toBe(0x123456);
    }
  });

  it('tints only standard/basic materials, leaving other types translucent but un-tinted', () => {
    const scene = makeScene();
    const body = scene.getObjectByName('body') as THREE.Mesh;
    body.material = new THREE.MeshPhongMaterial({ color: 0xaa0000 });
    const renderer = CarRenderer.fromGltfScene(scene);
    renderer.makeGhost();
    const m = body.material as THREE.MeshPhongMaterial;
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(0.35, 6);
    expect(m.depthWrite).toBe(false);
    expect(m.color.getHex()).toBe(0xaa0000);
  });
});
