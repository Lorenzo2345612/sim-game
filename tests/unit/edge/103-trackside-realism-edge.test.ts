import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const N = 60;

function makeTrack(spacing: number, barriers: BarrierSegment[]): TrackDataV2 {
  const centerline = Array.from({ length: N }, (_, i): [number, number] => [0, -spacing * i]);
  return {
    ...fixture,
    centerline,
    lengthMeters: spacing * (N - 1),
    elevation: Array.from({ length: N }, () => 0),
    barriers,
  };
}

function makeDupPointTrack(barriers: BarrierSegment[]): TrackDataV2 {
  const centerline = Array.from({ length: N }, (_, i): [number, number] => [
    0,
    i <= 7 ? -2 * i : -2 * (i - 1),
  ]);
  return {
    ...fixture,
    centerline,
    lengthMeters: 116,
    elevation: Array.from({ length: N }, () => 0),
    barriers,
  };
}

function stubTextures(): { load: (url: string) => THREE.Texture; byUrl: Map<string, THREE.Texture> } {
  const byUrl = new Map<string, THREE.Texture>();
  const load = (url: string): THREE.Texture => {
    let texture = byUrl.get(url);
    if (!texture) {
      texture = new THREE.Texture();
      texture.name = url;
      byUrl.set(url, texture);
    }
    return texture;
  };
  return { load, byUrl };
}

function hasUrl(byUrl: Map<string, THREE.Texture>, suffix: string): boolean {
  for (const url of byUrl.keys()) if (url.endsWith(suffix)) return true;
  return false;
}

function instancePositions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  return out;
}

function instanced(group: THREE.Group, name: string): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) found = object;
  });
  return found;
}

const TYRE_COLOR_A = new THREE.Color(0.9, 0.9, 0.9);
const TYRE_COLOR_B = new THREE.Color(0.75, 0.1, 0.1);

describe('103 trackside realism edge cases', () => {
  it('EDGE1: barrierProfiles constants match the spec and wBeamProfile is 9 points inside the rail envelope with two lobes toward the track', async () => {
    const mod = await import('../../../src/render/barrierProfiles');
    expect(mod.TYRE_PITCH).toBe(0.62);
    expect(mod.TYRE_ROWS).toBe(4);
    expect(mod.TYRE_ROW_HEIGHT).toBe(0.25);
    expect(mod.TYRE_OUTER_RADIUS).toBe(0.31);
    expect(mod.ARMCO_RAIL_HEIGHT).toBe(0.31);
    expect(mod.ARMCO_RAIL_CENTER).toBe(0.6);
    expect(mod.ARMCO_POST_SPACING).toBe(2.0);
    expect(mod.FENCE_HEIGHT).toBe(3.0);
    expect(mod.FENCE_OFFSET).toBe(1.0);
    const pts = mod.wBeamProfile();
    expect(pts.length).toBe(9);
    const ys = pts.map((p: [number, number]) => p[1]);
    const ts = pts.map((p: [number, number]) => p[0]);
    expect(Math.min(...ys)).toBeCloseTo(0.445, 6);
    expect(Math.max(...ys)).toBeCloseTo(0.755, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0.6, 6);
    for (const t of ts) expect(Math.abs(t)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(ts.filter((t) => t < 0).length).toBeGreaterThanOrEqual(2);
  });

  it('EDGE2: a 10 m tyre span stacks 17/16/17/16 tyres row-major with odd rows staggered 0.31 m and colours alternating by instance index', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [{ start: 5, end: 10, side: 'right', type: 'tyres', offsetMeters: 8 }]),
      stubTextures().load,
    );
    const tyres = instanced(group, 'tyres');
    if (!tyres) throw new Error('no tyres InstancedMesh');
    const rows = [17, 16, 17, 16];
    expect(tyres.count).toBe(66);
    const positions = instancePositions(tyres);
    const color = new THREE.Color();
    let i = 0;
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < rows[r]; k++, i++) {
        const p = positions[i];
        expect(p.x).toBeCloseTo(8 + 0.31, 4);
        expect(p.y).toBeCloseTo(r * 0.25 + 0.125, 4);
        expect(p.z).toBeCloseTo(-(10 + (r % 2) * 0.31 + k * 0.62), 4);
        tyres.getColorAt(i, color);
        const expected = i % 2 === 0 ? TYRE_COLOR_A : TYRE_COLOR_B;
        expect(color.r).toBeCloseTo(expected.r, 3);
        expect(color.g).toBeCloseTo(expected.g, 3);
        expect(color.b).toBeCloseTo(expected.b, 3);
      }
    }
    dispose();
  });

  it('EDGE3: a tyre exactly at s = length exists (s <= length inclusive): a 12.4 m span stacks 21/20/21/20 tyres', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(6.2, [{ start: 1, end: 3, side: 'right', type: 'tyres', offsetMeters: 8 }]),
      stubTextures().load,
    );
    const tyres = instanced(group, 'tyres');
    if (!tyres) throw new Error('no tyres InstancedMesh');
    const rows = [21, 20, 21, 20];
    expect(tyres.count).toBe(82);
    const positions = instancePositions(tyres);
    let i = 0;
    for (let r = 0; r < 4; r++) {
      expect(positions[i].z).toBeCloseTo(-(6.2 + (r % 2) * 0.31), 4);
      for (let k = 0; k < rows[r]; k++, i++);
      expect(positions[i - 1].z).toBeCloseTo(-(6.2 + (r % 2) * 0.31 + (rows[r] - 1) * 0.62), 4);
      expect(positions[i - 1].z).toBeGreaterThanOrEqual(-6.2 - 12.4 - 1e-6);
    }
    // Row 0's last tyre sits exactly at s = 12.4 = length.
    expect(positions[20].z).toBeCloseTo(-18.6, 4);
    dispose();
  });

  it('EDGE4: a zero-length span (two coincident path points) creates no tyre or post instances', () => {
    const { group, dispose } = createBarrierObject(
      makeDupPointTrack([
        { start: 7, end: 8, side: 'right', type: 'tyres', offsetMeters: 8 },
        { start: 7, end: 8, side: 'left', type: 'armco', offsetMeters: 8 },
      ]),
      stubTextures().load,
    );
    const tyres = instanced(group, 'tyres');
    const posts = instanced(group, 'armcoPosts');
    if (tyres) expect(tyres.count).toBe(0);
    if (posts) expect(posts.count).toBe(0);
    dispose();
  });

  it('EDGE5: an 11 m armco span gets floor(11/2)+1 = 6 posts from s = 0 every 2 m, centred 0.1 m behind the rail line', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2.2, [{ start: 1, end: 6, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTextures().load,
    );
    const posts = instanced(group, 'armcoPosts');
    if (!posts) throw new Error('no armcoPosts InstancedMesh');
    expect(posts.count).toBe(6);
    const positions = instancePositions(posts).sort((a, b) => b.z - a.z);
    for (let k = 0; k < 6; k++) {
      expect(positions[k].x).toBeCloseTo(10 + 0.1, 4);
      expect(positions[k].z).toBeCloseTo(-(2.2 + k * 2.0), 4);
    }
    dispose();
  });

  it('EDGE6: the fence sits 1.0 m behind the rail line, uv u = arc/3 and v = height/3, DoubleSide, with a fence color map', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [{ start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTextures().load,
    );
    const fence = group.getObjectByName('fence');
    if (!(fence instanceof THREE.Mesh)) throw new Error('fence is not a Mesh');
    fence.geometry.computeBoundingBox();
    const box = fence.geometry.boundingBox;
    if (!box) throw new Error('missing fence bounding box');
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(11.0, 2);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeCloseTo(3.0, 3);
    const uv = fence.geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv).toBeTruthy();
    let maxU = 0;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU).toBeCloseTo(10 / 3, 3);
    expect(minV).toBeCloseTo(0, 6);
    expect(maxV).toBeCloseTo(1, 6);
    const material = fence.material as THREE.MeshStandardMaterial;
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.map?.name?.endsWith('textures/fence/color.jpg')).toBe(true);
    dispose();
  });

  it('EDGE7: on the left side offsets go outward: tyre centre at line - 0.31 m with the inner face flush, fence at line - 1.0 m', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [
        { start: 5, end: 7, side: 'left', type: 'tyres', offsetMeters: 10 },
        { start: 8, end: 10, side: 'left', type: 'armco', offsetMeters: 10 },
      ]),
      stubTextures().load,
    );
    const tyres = instanced(group, 'tyres');
    if (!tyres) throw new Error('no tyres InstancedMesh');
    expect(tyres.count).toBe(26); // rows 7/6/7/6 over a 4 m span
    for (const p of instancePositions(tyres)) expect(p.x).toBeCloseTo(-10.31, 4);
    tyres.computeBoundingBox();
    const tyreBox = tyres.boundingBox;
    if (!tyreBox) throw new Error('missing tyres bounding box');
    expect(tyreBox.max.x).toBeCloseTo(-10.0, 2); // inner face flush with the barrier line
    const fence = group.getObjectByName('fence');
    if (!(fence instanceof THREE.Mesh)) throw new Error('fence is not a Mesh');
    fence.geometry.computeBoundingBox();
    const box = fence.geometry.boundingBox;
    if (!box) throw new Error('missing fence bounding box');
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(-11.0, 2);
    dispose();
  });

  it('EDGE8: three right spans share one mesh per name (draw calls <= 5): 12 posts across the two armco spans and 66 tyres', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [
        { start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 },
        { start: 10, end: 15, side: 'right', type: 'tyres', offsetMeters: 10 },
        { start: 15, end: 20, side: 'right', type: 'armco', offsetMeters: 10 },
        { start: 25, end: 30, side: 'left', type: 'wall', offsetMeters: 6 },
      ]),
      stubTextures().load,
    );
    const counts = new Map<string, number>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) counts.set(object.name, (counts.get(object.name) ?? 0) + 1);
    });
    for (const name of ['armco', 'armcoPosts', 'tyres', 'wall', 'fence']) {
      expect(counts.get(name)).toBe(1);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5);
    expect(instanced(group, 'armcoPosts')?.count).toBe(12); // floor(8/2)+1 + floor(12/2)+1
    expect(instanced(group, 'tyres')?.count).toBe(66);
    dispose();
  });

  it('EDGE9: tyres use a flat torus of outer radius 0.31 and height 0.25 with <= 150 triangles, textured with the three rubber maps; no fence without armco', () => {
    const tex = stubTextures();
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [
        { start: 5, end: 10, side: 'right', type: 'tyres', offsetMeters: 8 },
        { start: 20, end: 25, side: 'right', type: 'wall', offsetMeters: 8 },
      ]),
      tex.load,
    );
    expect(group.getObjectByName('fence')).toBeUndefined();
    const tyres = instanced(group, 'tyres');
    if (!tyres) throw new Error('no tyres InstancedMesh');
    const geo = tyres.geometry;
    const triangles = (geo.index?.count ?? geo.getAttribute('position').count) / 3;
    expect(triangles).toBeLessThanOrEqual(150);
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error('missing tyre geometry bounding box');
    expect(box.max.y).toBeCloseTo(0.125, 3);
    expect(box.min.y).toBeCloseTo(-0.125, 3);
    expect(box.max.x).toBeLessThanOrEqual(0.311);
    expect(box.max.x).toBeGreaterThanOrEqual(0.29);
    const material = tyres.material as THREE.MeshStandardMaterial;
    expect(material.map?.name?.endsWith('textures/rubber/color.jpg')).toBe(true);
    expect(material.normalMap?.name?.endsWith('textures/rubber/normal.jpg')).toBe(true);
    expect(material.roughnessMap?.name?.endsWith('textures/rubber/roughness.jpg')).toBe(true);
    dispose();
  });

  it('EDGE10: dispose() disposes every geometry, material and texture — including rubber and fence textures — exactly once, and a second call is a no-op', () => {
    const tex = stubTextures();
    const { group, dispose } = createBarrierObject(
      makeTrack(2, [
        { start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 },
        { start: 15, end: 20, side: 'right', type: 'tyres', offsetMeters: 10 },
        { start: 25, end: 30, side: 'left', type: 'wall', offsetMeters: 6 },
      ]),
      tex.load,
    );
    for (const suffix of [
      'textures/metal/color.jpg',
      'textures/metal/normal.jpg',
      'textures/metal/roughness.jpg',
      'textures/rubber/color.jpg',
      'textures/rubber/normal.jpg',
      'textures/rubber/roughness.jpg',
      'textures/fence/color.jpg',
      'textures/fence/opacity.jpg',
    ]) {
      expect(hasUrl(tex.byUrl, suffix)).toBe(true);
    }
    const disposables: Array<{ dispose(): void }> = [];
    const counts = new Map<{ dispose(): void }, number>();
    const seen = new Set<unknown>();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const item of [object.geometry, object.material]) {
        if (seen.has(item)) continue;
        seen.add(item);
        disposables.push(item as { dispose(): void });
      }
    });
    for (const texture of tex.byUrl.values()) disposables.push(texture);
    for (const item of disposables) {
      const original = item.dispose.bind(item);
      const wrapped = (): void => {
        counts.set(item, (counts.get(item) ?? 0) + 1);
        original();
      };
      Object.defineProperty(item, 'dispose', { value: wrapped, configurable: true });
      counts.set(item, 0);
    }
    dispose();
    for (const item of disposables) expect(counts.get(item)).toBe(1);
    dispose();
    for (const item of disposables) expect(counts.get(item)).toBe(1);
  });
});
