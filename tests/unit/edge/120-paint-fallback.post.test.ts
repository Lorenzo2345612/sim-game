import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

type Vec3 = [number, number, number];

interface PartSpec {
  material: string;
  colour: [number, number, number, number];
  boxes: [Vec3, Vec3][];
}

const BODY_BOX: [Vec3, Vec3] = [
  [-0.8, 0.15, -2.2],
  [0.8, 0.95, 1.8],
];
const SMALL_BOX: [Vec3, Vec3] = [
  [-0.3, 0.95, -0.5],
  [0.3, 1.05, 0.5],
];
const WHEEL_BOXES: [Vec3, Vec3][] = [
  [
    [-0.97, 0, -1.63],
    [-0.73, 0.66, -0.97],
  ],
  [
    [0.73, 0, -1.63],
    [0.97, 0.66, -0.97],
  ],
  [
    [-0.97, 0, 0.97],
    [-0.73, 0.66, 1.63],
  ],
  [
    [0.73, 0, 0.97],
    [0.97, 0.66, 1.63],
  ],
];

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'paintFallback-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

function boxArrays(min: Vec3, max: Vec3): { position: number[]; normal: number[]; index: number[] } {
  const faces: [number[], Vec3][] = [
    [[0, 1, 3, 2], [-1, 0, 0]],
    [[4, 6, 7, 5], [1, 0, 0]],
    [[0, 4, 5, 1], [0, -1, 0]],
    [[2, 3, 7, 6], [0, 1, 0]],
    [[0, 2, 6, 4], [0, 0, -1]],
    [[1, 5, 7, 3], [0, 0, 1]],
  ];
  const corner = (i: number): Vec3 => [
    i & 4 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 1 ? max[2] : min[2],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const [quad, n] of faces) {
    const base = position.length / 3;
    for (const ci of quad) {
      position.push(...corner(ci));
      normal.push(...n);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position, normal, index };
}

async function writeSource(work: string, name: string, parts: PartSpec[]): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const part of parts) {
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    const position: number[] = [];
    const normal: number[] = [];
    const index: number[] = [];
    for (const [min, max] of part.boxes) {
      const g = boxArrays(min, max);
      const base = position.length / 3;
      position.push(...g.position);
      normal.push(...g.normal);
      for (const v of g.index) index.push(v + base);
    }
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(position)),
      )
      .setAttribute(
        'NORMAL',
        doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(normal)),
      )
      .setIndices(
        doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(index)),
      );
    const mesh = doc.createMesh(part.material).addPrimitive(prim);
    scene.addChild(doc.createNode(part.material).setMesh(mesh));
  }
  await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', name), doc);
}

function writeConfig(work: string, id: string, cfg: Record<string, unknown>): void {
  const full = {
    targetLength: 4,
    triBudget: 10000,
    outGlb: `public/models/${id}.glb`,
    outJson: `public/models/${id}.json`,
    ...cfg,
  };
  writeFileSync(
    join(work, 'assets', 'cars', `${id}.pipeline.json`),
    `${JSON.stringify(full, null, 2)}\n`,
  );
}

function runBuild(work: string, id: string): { status: number; output: string } {
  try {
    const output = execFileSync(TSX, ['tools/assets/buildCar.ts', id], {
      cwd: work,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function readPaint(work: string, id: string): string[] {
  const meta = JSON.parse(readFileSync(join(work, 'public', 'models', `${id}.json`), 'utf8')) as {
    paintMaterials?: string[];
  };
  return meta.paintMaterials ?? [];
}

function triangleCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const n = idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
      counts.set(name, (counts.get(name) ?? 0) + n);
    }
  }
  return counts;
}

function wheelParts(): PartSpec {
  return { material: 'TYRE_BLK', colour: [0.05, 0.05, 0.05, 1], boxes: WHEEL_BOXES };
}

let work: string;

beforeAll(() => {
  work = sandbox();
}, 30000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('120 paintMaterials fallback in buildCar', () => {
  it('POST1: without a livery material the json names the largest body_<n> material', async () => {
    writeConfig(work, 'bodybig', {
      source: 'assets/vendor/synth/bodybig.glb',
      forward: '-z',
      wheelMaterials: ['tyre_blk'],
      liveryMaterials: ['nothing'],
    });
    await writeSource(work, 'bodybig.glb', [
      { material: 'PANEL_A', colour: [0, 0.6, 0, 1], boxes: [BODY_BOX, SMALL_BOX] },
      { material: 'PANEL_B', colour: [0, 0, 0.6, 1], boxes: [SMALL_BOX] },
      wheelParts(),
    ]);
    const result = runBuild(work, 'bodybig');
    expect(result.status, result.output).toBe(0);
    const paint = readPaint(work, 'bodybig');
    expect(paint).toHaveLength(1);
    expect(paint[0]).toMatch(/^body_\d+$/);
    const doc = await new NodeIO().read(join(work, 'public', 'models', 'bodybig.glb'));
    const names = doc.getRoot().listMaterials().map((m) => m.getName());
    expect(names).not.toContain('livery');
    expect(names).toContain(paint[0]);
    const counts = triangleCounts(doc);
    const bodies = [...counts.keys()].filter((n) => /^body_\d+$/.test(n));
    expect(bodies.length).toBeGreaterThan(1);
    for (const name of bodies) {
      expect(counts.get(paint[0])!, `${paint[0]} vs ${name}`).toBeGreaterThanOrEqual(counts.get(name)!);
    }
    expect(counts.get(paint[0])).toBeGreaterThan(counts.get(bodies.find((n) => n !== paint[0])!)!);
  }, 60000);

  it('POST2: with only wheel materials the json names the larger of rim/tyre', async () => {
    writeConfig(work, 'wheelonly', {
      source: 'assets/vendor/synth/wheelonly.glb',
      forward: '-z',
      wheelMaterials: ['grip', 'shiny'],
      liveryMaterials: [],
    });
    const rimBoxes = WHEEL_BOXES.slice(0, 2).map(
      ([min, max]): [Vec3, Vec3] => [
        [(min[0] + max[0]) / 2 - (max[0] - min[0]) / 4, (min[1] + max[1]) / 2 - (max[1] - min[1]) / 4, (min[2] + max[2]) / 2 - (max[2] - min[2]) / 4],
        [(min[0] + max[0]) / 2 + (max[0] - min[0]) / 4, (min[1] + max[1]) / 2 + (max[1] - min[1]) / 4, (min[2] + max[2]) / 2 + (max[2] - min[2]) / 4],
      ],
    );
    await writeSource(work, 'wheelonly.glb', [
      { material: 'GRIP_RUBBER', colour: [0.8, 0.1, 0.1, 1], boxes: WHEEL_BOXES },
      { material: 'SHINY_RIM', colour: [0.1, 0.1, 0.8, 1], boxes: rimBoxes },
    ]);
    const result = runBuild(work, 'wheelonly');
    expect(result.status, result.output).toBe(0);
    const paint = readPaint(work, 'wheelonly');
    expect(paint).toEqual(['tyre']);
    const doc = await new NodeIO().read(join(work, 'public', 'models', 'wheelonly.glb'));
    const names = doc.getRoot().listMaterials().map((m) => m.getName()).sort();
    expect(names).toEqual(['rim', 'tyre']);
    const counts = triangleCounts(doc);
    expect(counts.get('tyre')!).toBeGreaterThan(counts.get('rim')!);
  }, 60000);

  it('POST3: a matched livery material still yields ["livery"]', async () => {
    writeConfig(work, 'liveryhit', {
      source: 'assets/vendor/synth/liveryhit.glb',
      forward: '-z',
      wheelMaterials: ['tyre_blk'],
      liveryMaterials: ['shell'],
    });
    await writeSource(work, 'liveryhit.glb', [
      { material: 'SHELL', colour: [0.5, 0.5, 0.5, 1], boxes: [BODY_BOX] },
      wheelParts(),
    ]);
    const result = runBuild(work, 'liveryhit');
    expect(result.status, result.output).toBe(0);
    expect(readPaint(work, 'liveryhit')).toEqual(['livery']);
    const doc = await new NodeIO().read(join(work, 'public', 'models', 'liveryhit.glb'));
    expect(doc.getRoot().listMaterials().map((m) => m.getName())).toContain('livery');
  }, 60000);
});
