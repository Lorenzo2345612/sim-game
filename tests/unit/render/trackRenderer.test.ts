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

describe('createTrackObject', () => {
  it('group has asphalt and start line children', () => {
    const { group } = createTrackObject(ribbon, track);
    expect(group.children).toHaveLength(2);
    expect(group.children[0].name).toBe('asphalt');
    expect(group.children[1].name).toBe('startLine');
  });

  it('asphalt geometry matches ribbon', () => {
    const { group } = createTrackObject(ribbon, track);
    const geometry = namedMesh(group, 'asphalt').geometry;
    expect(geometry.index).not.toBeNull();
    expect(geometry.index!.count).toBe(ribbon.indices.length);
    expect(geometry.getAttribute('position').count).toBe(ribbon.vertexCount);
    expect(geometry.getAttribute('normal')).not.toBeNull();
    expect(geometry.getAttribute('uv')).not.toBeNull();
  });

  it('asphalt uses expected material', () => {
    const { group } = createTrackObject(ribbon, track);
    const material = namedMesh(group, 'asphalt').material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe('3a3a3e');
    expect(material.roughness).toBeCloseTo(0.9, 5);
    expect(material.metalness).toBe(0);
  });

  it('start line sits on first centerline point', () => {
    const { group } = createTrackObject(ribbon, track);
    const { position } = namedMesh(group, 'startLine');
    expect(position.x).toBeCloseTo(centerline[0][0], 4);
    expect(position.z).toBeCloseTo(centerline[0][1], 4);
    expect(position.y).toBeCloseTo(0.03, 4);
  });

  it('start line is oriented along the track', () => {
    const { group } = createTrackObject(ribbon, track);
    const mesh = namedMesh(group, 'startLine');
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    expect(up.x).toBeCloseTo(0, 4);
    expect(up.y).toBeCloseTo(1, 4);
    expect(up.z).toBeCloseTo(0, 4);

    const dx = centerline[1][0] - centerline[0][0];
    const dz = centerline[1][1] - centerline[0][1];
    const len = Math.hypot(dx, dz);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
    const dot = side.x * (dx / len) + side.z * (dz / len);
    expect(dot).toBeCloseTo(0, 4);
  });

  it('dispose does not throw and disposes both geometries', () => {
    const to = createTrackObject(ribbon, track);
    const asphaltSpy = vi.spyOn(namedMesh(to.group, 'asphalt').geometry, 'dispose');
    const startLineSpy = vi.spyOn(namedMesh(to.group, 'startLine').geometry, 'dispose');
    expect(() => to.dispose()).not.toThrow();
    expect(asphaltSpy).toHaveBeenCalled();
    expect(startLineSpy).toHaveBeenCalled();
  });
});
