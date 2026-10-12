import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document, Node as GltfNode } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const GLB_PATH = join(ROOT, 'public', 'models', 'f4.glb');
const JSON_PATH = join(ROOT, 'public', 'models', 'f4.json');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
];

interface WheelEntry {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface F4Meta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: WheelEntry[];
}

interface Loaded {
  doc: Document;
  meta: F4Meta;
  byName: Map<string, WheelEntry>;
  nodes: Map<string, GltfNode>;
}

let cached: Loaded | null = null;

async function load(): Promise<Loaded> {
  if (cached) return cached;
  const doc = await new NodeIO().read(GLB_PATH);
  const meta = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as F4Meta;
  const byName = new Map(meta.wheels.map((w) => [w.name, w]));
  const scene = doc.getRoot().listScenes()[0];
  const nodes = new Map(scene.listChildren().map((n) => [n.getName(), n]));
  cached = { doc, meta, byName, nodes };
  return cached;
}

function wheelOf(byName: Map<string, WheelEntry>, name: string): WheelEntry {
  const hit = byName.get(name);
  if (!hit) throw new Error(`missing wheel ${name}`);
  return hit;
}

function nodeOf(nodes: Map<string, GltfNode>, name: string): GltfNode {
  const hit = nodes.get(name);
  if (!hit) throw new Error(`missing node ${name}`);
  return hit;
}

function glbJsonChunk(path: string): Record<string, unknown> {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown>;
}

function materialNames(node: GltfNode): Set<string> {
  const names = new Set<string>();
  const stack: GltfNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        if (mat) names.add(mat.getName());
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return names;
}

function radialSegments(node: GltfNode): number {
  const points: number[][] = [];
  const stack: GltfNode[] = [node];
  const v = [0, 0, 0];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          points.push([v[1], v[2]]);
        }
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  let maxR = 0;
  for (const [y, z] of points) maxR = Math.max(maxR, Math.hypot(y, z));
  const angles = new Set<number>();
  for (const [y, z] of points) {
    if (Math.hypot(y, z) < 0.85 * maxR) continue;
    angles.add(Math.round((Math.atan2(z, y) * 180) / Math.PI));
  }
  return angles.size;
}

describe('053 F4 car model edges', () => {
  it('EDGE1: f4.json lists exactly one wheel entry per WHEEL_NODE_NAMES', async () => {
    const { meta } = await load();
    expect(meta.wheels.map((w) => w.name).sort()).toEqual([...WHEEL_NODE_NAMES].sort());
  });

  it('EDGE2: each wheel node translation equals its f4.json hub coordinates', async () => {
    const { byName, nodes } = await load();
    for (const name of WHEEL_NODE_NAMES) {
      const t = nodeOf(nodes, name).getWorldTranslation();
      const w = wheelOf(byName, name);
      expect(Math.abs(t[0] - w.x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(t[1] - w.y)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(t[2] - w.z)).toBeLessThanOrEqual(0.01);
    }
  });

  it('EDGE3: wheelbase and tracks in f4.json match the hub coordinates within 1 cm', async () => {
    const { meta, byName } = await load();
    const fl = wheelOf(byName, 'wheel-front-left');
    const fr = wheelOf(byName, 'wheel-front-right');
    const bl = wheelOf(byName, 'wheel-back-left');
    const br = wheelOf(byName, 'wheel-back-right');
    const zFront = (fl.z + fr.z) / 2;
    const zRear = (bl.z + br.z) / 2;
    expect(Math.abs(meta.wheelbase - Math.abs(zFront - zRear))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(meta.trackFront - Math.abs(fr.x - fl.x))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(meta.trackRear - Math.abs(br.x - bl.x))).toBeLessThanOrEqual(0.01);
  });

  it('EDGE4: the origin is centred under the axle midpoint with hubs at wheelRadius', async () => {
    const { meta, byName } = await load();
    const xs = WHEEL_NODE_NAMES.map((n) => wheelOf(byName, n).x);
    const fl = wheelOf(byName, 'wheel-front-left');
    const fr = wheelOf(byName, 'wheel-front-right');
    const bl = wheelOf(byName, 'wheel-back-left');
    const br = wheelOf(byName, 'wheel-back-right');
    const xMid = (xs[0] + xs[1] + xs[2] + xs[3]) / 4;
    const zMid = ((fl.z + fr.z) / 2 + (bl.z + br.z) / 2) / 2;
    expect(Math.abs(xMid)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(zMid)).toBeLessThanOrEqual(0.01);
    for (const name of WHEEL_NODE_NAMES) {
      expect(Math.abs(wheelOf(byName, name).y - meta.wheelRadius)).toBeLessThanOrEqual(0.01);
    }
  });

  it('EDGE5: each wheel geometry lies entirely in its own corner of the car', async () => {
    const { nodes } = await load();
    const side: Record<string, { left: boolean; front: boolean }> = {
      'wheel-front-left': { left: true, front: true },
      'wheel-front-right': { left: false, front: true },
      'wheel-back-left': { left: true, front: false },
      'wheel-back-right': { left: false, front: false },
    };
    for (const name of WHEEL_NODE_NAMES) {
      const { min, max } = getBounds(nodeOf(nodes, name));
      const s = side[name];
      if (s.left) expect(max[0]).toBeLessThan(0);
      else expect(min[0]).toBeGreaterThan(0);
      if (s.front) expect(max[2]).toBeLessThan(0);
      else expect(min[2]).toBeGreaterThan(0);
    }
  });

  it('EDGE6: materials are renamed to livery, tyre, disc and caliper', async () => {
    const { doc } = await load();
    const names = doc.getRoot().listMaterials().map((m) => m.getName()).sort();
    expect(names).toEqual(['caliper', 'disc', 'livery', 'tyre']);
  });

  it('EDGE7: body carries livery and caliper geometry, wheels carry tyre and disc geometry', async () => {
    const { nodes } = await load();
    const bodyMats = materialNames(nodeOf(nodes, 'body'));
    expect(bodyMats.has('livery')).toBe(true);
    expect(bodyMats.has('caliper')).toBe(true);
    for (const name of WHEEL_NODE_NAMES) {
      const mats = materialNames(nodeOf(nodes, name));
      expect(mats.has('tyre')).toBe(true);
      expect(mats.has('disc')).toBe(true);
    }
  });

  it('EDGE8: every tyre keeps at least 24 radial segments', async () => {
    const { nodes } = await load();
    for (const name of WHEEL_NODE_NAMES) {
      expect(radialSegments(nodeOf(nodes, name))).toBeGreaterThanOrEqual(24);
    }
  });

  it('EDGE9: asset.extras is stripped from f4.glb', () => {
    const asset = glbJsonChunk(GLB_PATH).asset as Record<string, unknown> | undefined;
    expect(asset).toBeDefined();
    expect(Object.keys(asset as Record<string, unknown>)).not.toContain('extras');
  });

  it('EDGE10: two builds from the same source write byte-identical f4.glb and f4.json', () => {
    // Sandbox so the rebuild never touches the committed outputs read by other tests.
    const work = mkdtempSync(join(tmpdir(), 'buildF4-'));
    try {
      mkdirSync(join(work, 'tools', 'assets'), { recursive: true });
      mkdirSync(join(work, 'public', 'models'), { recursive: true });
      copyFileSync(join(ROOT, 'tools', 'assets', 'buildF4.ts'), join(work, 'tools', 'assets', 'buildF4.ts'));
      cpSync(join(ROOT, 'assets', 'vendor', 'f4'), join(work, 'assets', 'vendor', 'f4'), { recursive: true });
      copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
      symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
      const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
      const build = (): Buffer[] => {
        execFileSync(tsx, ['tools/assets/buildF4.ts'], { cwd: work, stdio: 'pipe' });
        return [
          readFileSync(join(work, 'public', 'models', 'f4.glb')),
          readFileSync(join(work, 'public', 'models', 'f4.json')),
        ];
      };
      const first = build();
      const second = build();
      expect(first[0].length).toBeGreaterThan(0);
      expect(first[1].length).toBeGreaterThan(0);
      expect(Buffer.compare(first[0], second[0])).toBe(0);
      expect(Buffer.compare(first[1], second[1])).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 600_000);
});
