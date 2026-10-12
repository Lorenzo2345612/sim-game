import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildRibbon } from '../../../src/track/ribbon';
import { createTrackObject } from '../../../src/render/trackRenderer';

const N = 64;
const RADIUS = 100;
const WIDTH = 12;

const centerline: [number, number][] = Array.from({ length: N }, (_, k) => {
  const a = (2 * Math.PI * k) / N;
  return [RADIUS * Math.cos(a), -RADIUS * Math.sin(a)] as [number, number];
});

const ribbon = buildRibbon(centerline, WIDTH, 0);
const track = { centerline, widthMeters: WIDTH };

function namedMesh(group: THREE.Group, name: string): THREE.Mesh {
  const child = group.children.find((c) => c.name === name);
  expect(child).toBeInstanceOf(THREE.Mesh);
  return child as THREE.Mesh;
}

describe('013 track render acceptance', () => {
  it('AT1: group has children named asphalt and startLine', () => {
    const { group } = createTrackObject(ribbon, track);
    expect(group.children).toHaveLength(2);
    namedMesh(group, 'asphalt');
    namedMesh(group, 'startLine');
  });

  it('AT2: asphalt geometry matches ribbon buffers and has normal and uv attributes', () => {
    const { group } = createTrackObject(ribbon, track);
    const geometry = namedMesh(group, 'asphalt').geometry;
    expect(geometry.index).not.toBeNull();
    expect(geometry.index!.count).toBe(ribbon.indices.length);
    expect(geometry.getAttribute('position').count).toBe(ribbon.vertexCount);
    expect(geometry.getAttribute('normal')).not.toBeNull();
    expect(geometry.getAttribute('uv')).not.toBeNull();
  });

  it('AT3: startLine sits at centerline[0] within 1e-6 and at y 0.03', () => {
    const { group } = createTrackObject(ribbon, track);
    const { position } = namedMesh(group, 'startLine');
    expect(Math.abs(position.x - centerline[0][0])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(position.z - centerline[0][1])).toBeLessThanOrEqual(1e-6);
    expect(position.y).toBeCloseTo(0.03, 6);
  });

  it('AT4: dispose does not throw and disposes both geometries', () => {
    const to = createTrackObject(ribbon, track);
    const disposeSpy = vi.spyOn(namedMesh(to.group, 'asphalt').geometry, 'dispose');
    const startLineDisposeSpy = vi.spyOn(namedMesh(to.group, 'startLine').geometry, 'dispose');
    expect(() => to.dispose()).not.toThrow();
    expect(disposeSpy).toHaveBeenCalled();
    expect(startLineDisposeSpy).toHaveBeenCalled();
  });
});
