import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { buildTrackMarkings } from '../../../src/track/markings';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { createTrackMarkingsObject } from '../../../src/render/trackMarkingsRenderer';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { addTrackColliders } from '../../../src/physics/trackColliders';
import { fixture } from './022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;
const R = 100;
const EDGE_VERTS = 2 * N;
const Y_TOL = 1e-6;
// Same float32 constraint as 077: SurfaceStrip.positions is a Float32Array, and a radial
// distance ~106 quantizes to within ~5e-6 of the true value, so radial checks use 1e-5
// (the spec's 1e-6 cannot be met by float32 storage; y and uv keep 1e-6).
const R_TOL = 1e-5;

function circleV2(): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
  };
}

function radial(strip: SurfaceStrip, v: number): number {
  return Math.hypot(strip.positions[3 * v], strip.positions[3 * v + 2]);
}

function expectEdgeLine(strip: SurfaceStrip, radiusA: number, radiusB: number): void {
  const verts = strip.positions.length / 3;
  expect(verts).toBe(EDGE_VERTS);
  let a = 0;
  let b = 0;
  for (let v = 0; v < verts; v++) {
    expect(Math.abs(strip.positions[3 * v + 1] - 0.025), `y at vertex ${v}`).toBeLessThanOrEqual(Y_TOL);
    const r = radial(strip, v);
    const dA = Math.abs(r - radiusA);
    const dB = Math.abs(r - radiusB);
    expect(Math.min(dA, dB), `radial at vertex ${v}`).toBeLessThanOrEqual(R_TOL);
    if (dA <= R_TOL) a++;
    else b++;
  }
  expect(a).toBe(N);
  expect(b).toBe(N);
}

describe('082 track markings acceptance', () => {
  let world: ReturnType<typeof createPhysicsWorld> | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: circle fixture yields left edge line at radii 105.88 and 106 and right edge line at 94 and 94.12, all at y 0.025', () => {
    const strips = buildTrackMarkings(circleV2());
    expect(strips.length).toBe(3);
    const edges = strips.filter((s: SurfaceStrip) => s.positions.length / 3 === EDGE_VERTS);
    expect(edges.length).toBe(2);
    const left = edges.find((s: SurfaceStrip) => radial(s, 0) > R);
    const right = edges.find((s: SurfaceStrip) => radial(s, 0) < R);
    if (!left || !right) throw new Error('edge lines must lie on opposite sides of the centerline');
    expectEdgeLine(left, 105.88, 106);
    expectEdgeLine(right, 94, 94.12);
  });

  it('AT2: start line strip spans lateral -6..6 and arc length 0..0.6 (uv = (lateral/10, s/10))', () => {
    const strips = buildTrackMarkings(circleV2());
    const start = strips.find((s: SurfaceStrip) => s.positions.length / 3 !== EDGE_VERTS);
    if (!start) throw new Error('missing start line strip');
    expect(start.positions.length / 3).toBe(4);
    const lats: number[] = [];
    const arc: number[] = [];
    for (let v = 0; v < 4; v++) {
      lats.push(start.uvs[2 * v] * 10);
      arc.push(start.uvs[2 * v + 1] * 10);
    }
    lats.sort((x, y) => x - y);
    arc.sort((x, y) => x - y);
    const checks: [number, number][] = [
      [lats[0], -6],
      [lats[1], -6],
      [lats[2], 6],
      [lats[3], 6],
      [arc[0], 0],
      [arc[1], 0],
      [arc[2], 0.6],
      [arc[3], 0.6],
    ];
    for (const [got, exp] of checks) {
      expect(Math.abs(got - exp)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('AT3: addTrackColliders collider count stays terrain plus surface strips with markings available', () => {
    const track = circleV2();
    world = createPhysicsWorld();
    addTrackColliders(world, track);
    let count = 0;
    world.forEachCollider(() => {
      count++;
    });
    expect(buildTrackMarkings(track).length).toBeGreaterThan(0);
    expect(count).toBe(1 + buildTrackSurfaces(track).length);
  });

  it('AT4: renderer group has a mesh named markings with polygonOffset true and colour channels in [0.6, 0.7]', () => {
    const strips = buildTrackMarkings(circleV2());
    const { group } = createTrackMarkingsObject(strips);
    const mesh = group.getObjectByName('markings');
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.polygonOffset).toBe(true);
    expect(material.color.r).toBeGreaterThanOrEqual(0.6);
    expect(material.color.r).toBeLessThanOrEqual(0.7);
    expect(material.color.g).toBeGreaterThanOrEqual(0.6);
    expect(material.color.g).toBeLessThanOrEqual(0.7);
    expect(material.color.b).toBeGreaterThanOrEqual(0.6);
    expect(material.color.b).toBeLessThanOrEqual(0.7);
  });
});
