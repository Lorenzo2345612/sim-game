import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const GLB = join(ROOT, 'public', 'models', 'ow26.glb');
const META = join(ROOT, 'public', 'models', 'ow26.json');

interface Meta {
  wheelRadius: number;
  wheelbase: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}
const meta = (): Meta => JSON.parse(readFileSync(META, 'utf8')) as Meta;
const wheel = (n: string) => {
  const w = meta().wheels.find((x) => x.name === n);
  if (!w) throw new Error(`missing ${n}`);
  return w;
};

describe('224 ow26 edge', () => {
  it('EDGE1: pipeline config has triBudget 70000, targetLength 5.27 and ow26 outputs', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'assets', 'cars', 'ow26.pipeline.json'), 'utf8')) as Record<string, unknown>;
    expect(cfg.triBudget).toBe(70000);
    expect(cfg.targetLength).toBe(5.27);
    expect(cfg.outGlb).toBe('public/models/ow26.glb');
    expect(cfg.outJson).toBe('public/models/ow26.json');
  });

  it('EDGE2: nose points to -Z so front wheels have smaller z than back wheels', () => {
    expect(wheel('wheel-front-left').z).toBeLessThan(0);
    expect(wheel('wheel-front-right').z).toBeLessThan(0);
    expect(wheel('wheel-back-left').z).toBeGreaterThan(0);
    expect(wheel('wheel-back-right').z).toBeGreaterThan(0);
  });

  it('EDGE3: left wheels have negative x and right wheels positive x', () => {
    expect(wheel('wheel-front-left').x).toBeLessThan(0);
    expect(wheel('wheel-back-left').x).toBeLessThan(0);
    expect(wheel('wheel-front-right').x).toBeGreaterThan(0);
    expect(wheel('wheel-back-right').x).toBeGreaterThan(0);
  });

  it('EDGE4: wheelbase is about 3.40 m and matches front/back wheel z', () => {
    const m = meta();
    expect(Math.abs(m.wheelbase - 3.4)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(wheel('wheel-back-left').z - wheel('wheel-front-left').z - m.wheelbase)).toBeLessThanOrEqual(0.01);
  });

  it('EDGE5: public/cars/ow26.json uses the ow26 model and the model wheel radius', () => {
    const car = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8')) as {
      model: { url: string };
      wheels: { radius: number };
    };
    expect(car.model.url).toBe('/models/ow26.glb');
    expect(Math.abs(car.wheels.radius - meta().wheelRadius)).toBeLessThanOrEqual(1e-3);
  });

  it('EDGE6: decals_layer1 node is dropped and no node or material name contains redbull', async () => {
    expect(existsSync(GLB)).toBe(true);
    const doc = await new NodeIO().read(GLB);
    const names = [
      ...doc.getRoot().listNodes().map((n) => n.getName()),
      ...doc.getRoot().listMaterials().map((m) => m.getName()),
      ...doc.getRoot().listMeshes().map((m) => m.getName()),
    ].map((n) => n.toLowerCase());
    expect(names).not.toContain('decals_layer1');
    expect(names.filter((n) => n.includes('redbull') || n.includes('red bull'))).toEqual([]);
  });

  it('EDGE7: neutralised materials (decal, TAG_DRS_ON, gp21_LCD) carry no textures', async () => {
    const doc = await new NodeIO().read(GLB);
    const targets = ['decal', 'tag_drs_on', 'gp21_lcd', 'redbull_detail', 'redbull_wheel_hub'];
    for (const m of doc.getRoot().listMaterials()) {
      if (!targets.includes(m.getName().toLowerCase())) continue;
      expect(m.getBaseColorTexture(), m.getName()).toBeNull();
      expect(m.getEmissiveTexture(), m.getName()).toBeNull();
    }
  });

  it('EDGE8: ASSETS_LICENSES.md has the OW-26 row with author, license and URL', () => {
    const rows = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('OW-26 car source'));
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('Abu Saif');
    expect(rows[0]).toContain('CC-BY 4.0');
    expect(rows[0]).toContain('https://sketchfab.com/3d-models/fia-f1-2026-car-d242ab0587ee47c683a904bc38cead93');
  });

  it('EDGE9: model json wheels sit on the ground (y equals wheelRadius within 1 cm)', () => {
    const m = meta();
    for (const w of m.wheels) expect(Math.abs(w.y - m.wheelRadius), w.name).toBeLessThanOrEqual(0.01);
  });
});
