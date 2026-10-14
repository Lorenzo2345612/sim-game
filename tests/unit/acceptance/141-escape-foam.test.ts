import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import * as surfaces from '../../../src/track/surfaces';
import { fixture } from './022-fixture-trackdatav2';

// Task 141 adds escapeRoadStrips to surfaces.ts; the cast keeps this test-first
// file type-checking until the export exists.
const escapeRoadStrips = (
  surfaces as unknown as { escapeRoadStrips: (track: TrackDataV2) => SurfaceStrip[] }
).escapeRoadStrips;

const ROOT = join(__dirname, '..', '..', '..');

// Straight fixture like 038/103: 60 centerline points, 2 m apart along -Z.
// Indices 5..10 span 10 m; the right normal is +X.
const POINTS = 60;

function barrierTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [0, -2 * i]),
    lengthMeters: 236,
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function stubTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
}

function foamMesh(group: THREE.Group, name: string): THREE.InstancedMesh {
  const object = group.getObjectByName(name);
  if (!(object instanceof THREE.InstancedMesh)) throw new Error(`${name} is not an InstancedMesh`);
  return object;
}

function instanceZ(mesh: THREE.InstancedMesh): number[] {
  const matrix = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix).z);
  }
  return out.sort((a, b) => a - b);
}

function nearestIndex(points: [number, number][], p: [number, number]): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

describe('141 escape road and foam acceptance', () => {
  let world: ReturnType<typeof createPhysicsWorld> | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: foam barrier along a 10 m straight builds 10 blocks at 1.0 m pitch, 1.0 m high, colours cycling blue, red, white, one InstancedMesh per colour', () => {
    const { group, dispose } = createBarrierObject(
      barrierTrack([{ start: 5, end: 10, side: 'right', type: 'foam', offsetMeters: 10 }]),
      stubTexture,
    );
    let foamMeshes = 0;
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.name.startsWith('foam')) foamMeshes++;
    });
    expect(foamMeshes, 'one InstancedMesh per colour').toBe(3);

    // Block k centred at arc length (k + 0.5) m from the span start (z = -10 m).
    const expected: [string, number, number[]][] = [
      ['foamBlue', 0x1f4fbf, [-19.5, -16.5, -13.5, -10.5]],
      ['foamRed', 0xcc2222, [-17.5, -14.5, -11.5]],
      ['foamWhite', 0xf0f0f0, [-18.5, -15.5, -12.5]],
    ];
    let total = 0;
    for (const [name, hex, zs] of expected) {
      const mesh = foamMesh(group, name);
      expect(mesh.count, `${name} count`).toBe(zs.length);
      total += mesh.count;
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.color.equals(new THREE.Color(hex)), `${name} colour`).toBe(true);
      const got = instanceZ(mesh);
      got.forEach((z, k) => {
        expect(Math.abs(z - zs[k]), `${name} block ${k} along-path position`).toBeLessThanOrEqual(0.01);
      });
      mesh.computeBoundingBox();
      const box = mesh.boundingBox;
      if (!box) throw new Error(`${name} has no bounding box`);
      expect(Math.abs(box.max.y - box.min.y - 1.0), `${name} height`).toBeLessThanOrEqual(0.02);
    }
    expect(total, '10 blocks at 1.0 m pitch').toBe(10);
    dispose();
  });

  it('AT2: escape road strip of 3 points, width 8, elevation 5 has cross-section width 8 at every point and vertex y = 5.01', () => {
    const track: TrackDataV2 = {
      ...fixture,
      centerline: Array.from({ length: 12 }, (_, i): [number, number] => [0, -2 * i]),
      lengthMeters: 24,
      elevation: Array.from({ length: 12 }, () => 5),
      kerbs: [],
      runoffs: [],
      barriers: [],
      escapeRoads: [{ points: [[0, -4], [0, -8], [0, -12]], width: 8 }],
    };
    const strips = escapeRoadStrips(track);
    expect(strips).toHaveLength(1);
    const positions = strips[0].positions;
    expect(positions.length).toBe(6 * 3);
    for (let i = 0; i < 3; i++) {
      const a = i * 6;
      const dx = positions[a + 3] - positions[a];
      const dz = positions[a + 5] - positions[a + 2];
      expect(Math.abs(Math.hypot(dx, dz) - 8), `cross-section width at point ${i}`).toBeLessThanOrEqual(1e-6);
      for (const v of [0, 1]) {
        expect(
          Math.abs(positions[a + v * 3 + 1] - 5.01),
          `vertex y at point ${i} side ${v}`,
        ).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('AT3: monza colliders: ray down at the middle point of the first escape road hits runoff, ray outward across a foam segment at y + 0.5 hits a barrier collider', () => {
    const track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8'),
    ) as TrackDataV2;
    world = createPhysicsWorld();
    addTrackColliders(world, track);
    world.step();

    const road = track.escapeRoads?.[0];
    if (!road) throw new Error('monza has no escape roads');
    const mid = road.points[Math.floor(road.points.length / 2)];
    const idx = nearestIndex(track.centerline, mid);
    const down = world.castRay(
      new RAPIER.Ray(
        { x: mid[0], y: (track.elevation[idx] ?? 0) + 50, z: mid[1] },
        { x: 0, y: -1, z: 0 },
      ),
      100,
      true,
    );
    expect(down, 'downward ray at the escape road middle').not.toBeNull();
    expect(surfaceOf(down!.collider), 'escape road surface').toBe('runoff');

    const foam = track.barriers.find((b) => b.type === 'foam');
    if (!foam) throw new Error('monza has no foam barrier segment');
    const n = track.centerline.length;
    const i = Math.floor((foam.start + foam.end) / 2) % n;
    const prev = track.centerline[(i - 1 + n) % n];
    const next = track.centerline[(i + 1) % n];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    const rx = -(next[1] - prev[1]) / len;
    const rz = (next[0] - prev[0]) / len;
    const sign = foam.side === 'right' ? 1 : -1;
    const ox = sign * rx;
    const oz = sign * rz;
    const bx = track.centerline[i][0] + sign * foam.offsetMeters * rx;
    const bz = track.centerline[i][1] + sign * foam.offsetMeters * rz;
    // Starts 2 m track-side of the barrier line, aimed outward across the segment.
    const out = world.castRay(
      new RAPIER.Ray(
        { x: bx - ox * 2, y: (track.elevation[i] ?? 0) + 0.5, z: bz - oz * 2 },
        { x: ox, y: 0, z: oz },
      ),
      8,
      true,
    );
    expect(out, 'outward ray across the foam segment').not.toBeNull();
    expect(surfaceOf(out!.collider), 'foam barrier collider surface').toBeNull();
  }, 30000);
});
