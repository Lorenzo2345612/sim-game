import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import type { Document } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { parseCredits } from '../../../tools/assets/buildCredits';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const GLB = join(ROOT, 'public', 'models', 'ow26.glb');
const META = join(ROOT, 'public', 'models', 'ow26.json');
const CONFIG = join(ROOT, 'assets', 'cars', 'ow26.pipeline.json');
const SOURCE = join(ROOT, 'assets', 'vendor', 'cars', 'ow26-src', 'ow26-source.glb');

interface Config {
  source: string;
  wheelMaterials: string[];
  neutralMaterials?: string[];
}

interface Meta {
  paintMaterials: string[];
}

function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG, 'utf8')) as Config;
}

function readMeta(): Meta {
  return JSON.parse(readFileSync(META, 'utf8')) as Meta;
}

function matches(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

function materialTriangles(doc: Document): Map<string, number> {
  const out = new Map<string, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const n = idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
      out.set(name, (out.get(name) ?? 0) + n);
    }
  }
  return out;
}

function readDoc(path: string = GLB) {
  return new NodeIO().registerExtensions([KHRTextureTransform]).read(path);
}

describe('224 ow26 post-code gaps', () => {
  it('GAP1: credits.json is exactly what build:credits derives from ASSETS_LICENSES.md', () => {
    const markdown = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    const expected = parseCredits(markdown);
    const committed = JSON.parse(readFileSync(join(ROOT, 'public', 'credits.json'), 'utf8')) as unknown;
    expect(committed).toEqual(expected);
    const ow = expected.filter((entry) => entry.url.includes('fia-f1-2026-car'));
    expect(ow).toHaveLength(1);
    expect(ow[0].asset).toBe('OW-26 car source');
    expect(ow[0].author).toContain('Abu Saif');
    expect(ow[0].license).toBe('CC-BY 4.0');
  });

  it('GAP2: the OW-26 licence row path cell is the pipeline source', () => {
    const cfg = readConfig();
    const rows = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('OW-26 car source'));
    expect(rows).toHaveLength(1);
    const cells = rows[0].split('|').slice(1, -1).map((cell) => cell.trim());
    expect(cells[1].replace(/`/g, '')).toBe(cfg.source);
  });

  it('GAP3: paintMaterials names the largest body material and no livery exists', async () => {
    const doc = await readDoc();
    const meta = readMeta();
    const names = doc.getRoot().listMaterials().map((m) => m.getName());
    expect(names).not.toContain('livery');
    const bodyTris = [...materialTriangles(doc).entries()].filter(([name]) => /^body_\d+$/.test(name));
    expect(bodyTris.length).toBeGreaterThan(0);
    const largest = bodyTris.sort((a, b) => b[1] - a[1])[0][0];
    expect(meta.paintMaterials).toEqual([largest]);
  });

  it('GAP4: the neutralised materials contribute no textures to the output', async () => {
    const cfg = readConfig();
    const src = await readDoc(SOURCE);
    const withGeom = new Set<string>();
    for (const mesh of src.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName();
        if (name) withGeom.add(name);
      }
    }
    const kept = new Set<unknown>();
    for (const material of src.getRoot().listMaterials()) {
      const name = material.getName();
      if (!withGeom.has(name) || matches(name, cfg.wheelMaterials) || matches(name, cfg.neutralMaterials ?? [])) {
        continue;
      }
      for (const tex of [
        material.getBaseColorTexture(),
        material.getMetallicRoughnessTexture(),
        material.getNormalTexture(),
        material.getOcclusionTexture(),
        material.getEmissiveTexture(),
      ]) {
        if (tex) kept.add(tex);
      }
    }
    expect(kept.size).toBeGreaterThan(0);
    const out = await readDoc();
    expect(out.getRoot().listTextures().length).toBeGreaterThan(0);
    expect(out.getRoot().listTextures().length).toBeLessThanOrEqual(kept.size);
  });

  it('GAP5: the committed ow26 outputs are what the current source and config build', async () => {
    const glbBefore = readFileSync(GLB);
    const jsonBefore = readFileSync(META);
    await buildCar('ow26');
    expect(readFileSync(GLB).equals(glbBefore), 'glb').toBe(true);
    expect(readFileSync(META).equals(jsonBefore), 'json').toBe(true);
  }, 120000);
});
