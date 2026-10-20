import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import type { LonLat, Point2 } from '../../../src/track/geo';
import { createBridgeObject } from '../../../src/render/bridgeRenderer';

const ROOT = join(__dirname, '..', '..', '..');
const ARROYO_MODULE = '../../../tools/track-builder/arroyo';
const BRIDGE_RENDERER_MODULE = '../../../src/render/bridgeRenderer';
const WATER_HEX = 0x2f5d62;

interface Arroyo320 {
  line: Point2[];
  width: number;
  water?: boolean;
}
interface ArroyoModule {
  loadArroyos(path: string, origin: LonLat): Arroyo320[];
}
interface WaterModule {
  buildArroyoWater(
    line: [number, number][],
    width: number,
    terrainY: (x: number, z: number) => number,
  ): THREE.BufferGeometry;
}
type TrackJson = Omit<TrackDataV2, 'arroyos'> & { arroyos?: Arroyo320[] };

async function loadModule<T>(path: string): Promise<T> {
  return (await import(path)) as T;
}

function stripWater(track: { arroyos?: Arroyo320[] }): void {
  for (const a of track.arroyos ?? []) delete a.water;
}

function readTrack(id: string): TrackJson {
  return JSON.parse(readFileSync(join(ROOT, `public/tracks/${id}.json`), 'utf8')) as TrackJson;
}

function waterMeshes(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat.color && mat.color.getHex() === WATER_HEX) out.push(mesh);
  });
  return out;
}

describe('320 ermita river water acceptance', () => {
  it('AT1: loadArroyos marks every width-25 river with water and never a width-6 stream', async () => {
    const { loadArroyos } = await loadModule<ArroyoModule>(ARROYO_MODULE);
    const arroyos = loadArroyos(join(ROOT, 'assets/source/osm/ermita-centro-areas.json'), [0, 0]);
    const rivers = arroyos.filter((a) => a.width === 25);
    const streams = arroyos.filter((a) => a.width === 6);
    expect(rivers.length, 'rivers present').toBeGreaterThan(0);
    expect(streams.length, 'streams present').toBeGreaterThan(0);
    for (const a of rivers) expect(a.water, `river width ${a.width}`).toBe(true);
    for (const a of streams) expect(a.water === true, `stream width ${a.width}`).toBe(false);
  });

  it('AT2: shipped ermita tracks differ from master only in arroyos[].water and every width-25 arroyo has water true', () => {
    const files = readdirSync(join(ROOT, 'public/tracks')).filter(
      (f) => /^ermita-.*\.json$/.test(f) && !f.endsWith('-env.json') && !f.endsWith('.style.json'),
    );
    expect(files.length, 'ermita track files').toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const current = JSON.parse(
        readFileSync(join(ROOT, 'public/tracks', f), 'utf8'),
      ) as { arroyos?: Arroyo320[] };
      for (const a of current.arroyos ?? []) {
        if (a.width === 25) expect(a.water, `${f} width 25 water`).toBe(true);
      }
      const before = JSON.parse(
        execFileSync('git', ['show', `master:public/tracks/${f}`], {
          cwd: ROOT,
          maxBuffer: 64 * 1024 * 1024,
        }).toString('utf8'),
      ) as { arroyos?: Arroyo320[] };
      stripWater(current);
      stripWater(before);
      expect(current, `${f} equals master without water`).toEqual(before);
    }
  });

  it('AT3: buildArroyoWater ribbon is 1.4 m below terrain with z extent ±8.75', async () => {
    const { buildArroyoWater } = await loadModule<WaterModule>(BRIDGE_RENDERER_MODULE);
    const geometry = buildArroyoWater([[0, 0], [50, 0], [100, 0]], 25, () => 10);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(position.count, 'vertices').toBeGreaterThan(0);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getY(i) - 8.6), `vertex ${i} y`).toBeLessThanOrEqual(1e-6);
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
    expect(Math.abs(minZ - -8.75), 'z extent low').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(maxZ - 8.75), 'z extent high').toBeLessThanOrEqual(1e-6);
  });

  it('AT4: poniente and norte get one water mesh per water: true arroyo', () => {
    for (const id of ['ermita-poniente', 'ermita-norte']) {
      const track = readTrack(id);
      const expected = (track.arroyos ?? []).filter((a) => a.water === true).length;
      const { group, dispose } = createBridgeObject(track, () => 0);
      expect(waterMeshes(group).length, `${id} water meshes`).toBe(expected);
      dispose();
    }
  });

  it('AT5: dispose releases each water geometry and the shared water material exactly once', () => {
    const track = readTrack('ermita-poniente');
    const { group, dispose } = createBridgeObject(track, () => 0);
    const waters = waterMeshes(group);
    expect(waters.length, 'water meshes present').toBeGreaterThan(0);
    const geoSpies = waters.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const materials = [...new Set(waters.map((m) => m.material as THREE.Material))];
    const matSpies = materials.map((m) => vi.spyOn(m, 'dispose'));
    dispose();
    for (const s of geoSpies) expect(s, 'water geometry disposed').toHaveBeenCalledTimes(1);
    for (const s of matSpies) expect(s, 'water material disposed').toHaveBeenCalledTimes(1);
  });
});
