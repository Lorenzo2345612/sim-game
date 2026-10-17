import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { createFloodlights } from '../../../src/render/floodlights';
import { DEFAULT_TRACK_STYLE, type FloodlightStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');
const POINTS = 100;

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  widthMeters: 12,
  centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * 10, 0]),
  lengthMeters: 990,
  elevation: Array.from({ length: POINTS }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const HAIRPIN_CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 10; i++) HAIRPIN_CENTERLINE.push([i * 10, 0]);
for (let k = 1; k <= 11; k++) {
  const a = (k * Math.PI) / 12;
  HAIRPIN_CENTERLINE.push([100 + 6 * Math.sin(a), -6 + 6 * Math.cos(a)]);
}
HAIRPIN_CENTERLINE.push([100, -12]);
for (let i = 9; i >= 0; i--) HAIRPIN_CENTERLINE.push([i * 10, -12]);

const HAIRPIN: TrackDataV2 = {
  ...fixture,
  id: 'hairpin',
  widthMeters: 12,
  centerline: HAIRPIN_CENTERLINE,
  lengthMeters: 990,
  elevation: HAIRPIN_CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

function flood(p: Partial<FloodlightStyle>): FloodlightStyle {
  return { style: 'arm', heightMeters: 8, heads: 4, spacingMeters: 20, offsetMeters: 6, side: 'left', ranges: [], ...p };
}

function styleWith(floodlights: FloodlightStyle | null): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  style.floodlights = floodlights;
  return style;
}

function build(track: TrackDataV2, fl: FloodlightStyle): { group: THREE.Group; dispose(): void } {
  const result = createFloodlights(track, styleWith(fl));
  if (!result) throw new Error('expected a floodlights object');
  return result;
}

interface PoleInst { x: number; z: number; baseY: number; topY: number }

function poleInstances(group: THREE.Group): PoleInst[] {
  const found: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.geometry.type === 'CylinderGeometry') found.push(o);
  });
  if (found.length !== 1) throw new Error(`expected one pole mesh, got ${found.length}`);
  const mesh = found[0];
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  if (!bb) throw new Error('pole geometry has no bounding box');
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: PoleInst[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    p.setFromMatrixPosition(m);
    const b = bb.clone().applyMatrix4(m);
    out.push({ x: p.x, z: p.z, baseY: b.min.y, topY: b.max.y });
  }
  return out;
}

function minDistanceToCenterline(track: TrackDataV2, x: number, z: number): number {
  let min = Infinity;
  for (const p of track.centerline) min = Math.min(min, Math.hypot(p[0] - x, p[1] - z));
  return min;
}

function lapLength(cx: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < cx.length; i++) {
    const a = cx[i];
    const b = cx[(i + 1) % cx.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

// Bilinear terrain sample, same convention as terrainY in src/render/pitAndStart.ts
// (heights column-major, col * (rows + 1) + row, origin = centre).
function terrainHeight(t: Terrain, x: number, z: number): number {
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  const fx = Math.min(Math.max(((x - minX) / t.sizeX) * t.cols, 0), t.cols);
  const fz = Math.min(Math.max(((z - minZ) / t.sizeZ) * t.rows, 0), t.rows);
  const j = Math.min(Math.floor(fx), t.cols - 1);
  const i = Math.min(Math.floor(fz), t.rows - 1);
  const tx = fx - j;
  const tz = fz - i;
  const h00 = t.heights[j * vertexRows + i];
  const h10 = t.heights[(j + 1) * vertexRows + i];
  const h01 = t.heights[j * vertexRows + i + 1];
  const h11 = t.heights[(j + 1) * vertexRows + i + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

describe('186 floodlights acceptance', () => {
  it('AT1: a null floodlights style creates nothing', () => {
    expect(createFloodlights(STRAIGHT, DEFAULT_TRACK_STYLE)).toBeNull();
    expect(createFloodlights(STRAIGHT, styleWith(null))).toBeNull();
  });

  it('AT2: a left range places 50 poles 12 m outside the left edge, 8 m tall', () => {
    const result = build(
      STRAIGHT,
      flood({ spacingMeters: 20, side: 'left', heightMeters: 8, offsetMeters: 6, ranges: [{ start: 0, end: 99 }] }),
    );
    expect(result.group.userData.poles).toBe(50);
    const poles = poleInstances(result.group);
    expect(poles).toHaveLength(50);
    const xs = poles.map((p) => p.x).sort((a, b) => a - b);
    xs.forEach((x, k) => expect(x).toBeCloseTo(k * 20, 2));
    for (const p of poles) {
      expect(p.z).toBeCloseTo(-12, 2);
      expect(p.baseY).toBeCloseTo(0, 2);
      expect(p.topY).toBeCloseTo(8, 2);
    }
    result.dispose();
  });

  it("AT3: side 'both' places 100 poles, half at each side", () => {
    const result = build(STRAIGHT, flood({ spacingMeters: 20, side: 'both', offsetMeters: 6, ranges: [{ start: 0, end: 99 }] }));
    expect(result.group.userData.poles).toBe(100);
    const poles = poleInstances(result.group);
    const left = poles.filter((p) => p.z < 0);
    const right = poles.filter((p) => p.z > 0);
    expect(left).toHaveLength(50);
    expect(right).toHaveLength(50);
    for (const p of left) expect(p.z).toBeCloseTo(-12, 2);
    for (const p of right) expect(p.z).toBeCloseTo(12, 2);
    result.dispose();
  });

  it('AT4: a half-lap range keeps poles only at x <= 490, count 25 ± 1', () => {
    const result = build(STRAIGHT, flood({ spacingMeters: 20, side: 'left', offsetMeters: 6, ranges: [{ start: 0, end: 49 }] }));
    const poles = poleInstances(result.group);
    expect(result.group.userData.poles).toBeGreaterThanOrEqual(24);
    expect(result.group.userData.poles).toBeLessThanOrEqual(26);
    for (const p of poles) {
      expect(p.x).toBeLessThanOrEqual(490);
      expect(p.z).toBeCloseTo(-12, 2);
    }
    result.dispose();
  });

  it("AT5: mast style with 6 heads keeps heads = poles × 6 in at most 3 instanced draw objects", () => {
    const result = build(STRAIGHT, flood({ style: 'mast', heads: 6, heightMeters: 30, ranges: [{ start: 0, end: 99 }] }));
    expect(result.group.userData.heads).toBe(result.group.userData.poles * 6);
    const meshes: THREE.Mesh[] = [];
    result.group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeLessThanOrEqual(3);
    for (const m of meshes) expect(m).toBeInstanceOf(THREE.InstancedMesh);
    result.dispose();
  });

  it('AT6: a pole within 7 m of any centerline point is skipped; kept poles stay clear', () => {
    const result = build(HAIRPIN, flood({ spacingMeters: 20, side: 'both', offsetMeters: 10, ranges: [] }));
    const poles = poleInstances(result.group);
    expect(poles.length).toBe(result.group.userData.poles);
    expect(poles.length).toBeGreaterThanOrEqual(1);
    const positions = Math.floor((lapLength(HAIRPIN.centerline) - 1e-9) / 20) + 1;
    expect(poles.length).toBeLessThan(positions * 2);
    for (const p of poles) {
      expect(minDistanceToCenterline(HAIRPIN, p.x, p.z)).toBeGreaterThanOrEqual(HAIRPIN.widthMeters / 2 + 1 - 1e-6);
    }
    result.dispose();
  });

  it('AT7: on monza every pole base sits on the terrain under it', () => {
    const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8')) as TrackDataV2;
    const result = build(track, flood({ spacingMeters: 40, side: 'both', heightMeters: 12, ranges: [] }));
    const poles = poleInstances(result.group);
    expect(poles.length).toBeGreaterThan(0);
    expect(poles.length).toBe(result.group.userData.poles);
    for (const p of poles) {
      expect(p.baseY).toBeCloseTo(terrainHeight(track.terrain, p.x, p.z), 0);
    }
    result.dispose();
  });

  it('AT8: dispose is idempotent and disposes every geometry and material', () => {
    const result = build(STRAIGHT, flood({ ranges: [{ start: 0, end: 99 }] }));
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    result.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      const m = o.material;
      for (const mat of Array.isArray(m) ? m : [m]) materials.add(mat);
    });
    const spies = [...geometries, ...materials].map((r) => vi.spyOn(r, 'dispose'));
    expect(spies.length).toBeGreaterThan(0);
    expect(() => result.dispose()).not.toThrow();
    expect(() => result.dispose()).not.toThrow();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });

  it('AT10: floodlights add nothing to the per-frame loop', () => {
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    const start = mainSrc.indexOf('const frameFn');
    const end = mainSrc.indexOf('rafId = requestAnimationFrame(frameFn);');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(mainSrc.slice(start, end)).not.toMatch(/floodlight/i);
    const flSrc = readFileSync(join(ROOT, 'src', 'render', 'floodlights.ts'), 'utf8');
    expect(flSrc).not.toMatch(/requestAnimationFrame/);
  });
});
