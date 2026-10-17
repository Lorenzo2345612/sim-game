import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand, TrackDataV2 } from '../../../src/core/types';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { createPitBuilding } from '../../../src/render/pitAndStart';
import { createGrandstand } from '../../../src/render/grandstand';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import { fixture } from './022-fixture-trackdatav2';

// Task 180 lands src/track/trackStyleWiring.ts; the variable specifier keeps
// typecheck green until the module exists.
const WIRING_MODULE = '../../../src/track/trackStyleWiring';

interface StyleResponse {
  ok: boolean;
  json(): Promise<unknown>;
}
interface LoadedTrackStyle {
  style: ResolvedTrackStyle;
  loaded: boolean;
  errors: string[];
  warnings: string[];
}
interface Wiring {
  loadTrackStyle(id: string, pointCount: number, fetchFn?: (url: string) => Promise<StyleResponse>): Promise<LoadedTrackStyle>;
  extraGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[];
}

async function loadWiring(): Promise<Wiring> {
  return (await import(WIRING_MODULE)) as Wiring;
}

function stub(response: StyleResponse | Error): { fn: (url: string) => Promise<StyleResponse>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fn: (url: string) => {
      urls.push(url);
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    },
  };
}

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  lengthMeters: 990,
  officialLengthMeters: 990,
  widthMeters: 12,
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
};

function styleWith(entry: Record<string, unknown>, pointCount: number): ResolvedTrackStyle {
  return parseTrackStyle({ version: 1, extraGrandstands: [entry] }, pointCount).style;
}

const ENTRY = { start: 10, end: 20, side: 'left', offsetMeters: 15, rows: 12, roof: true };

function front(g: Grandstand): [number, number] {
  return [-Math.sin(g.yaw), -Math.cos(g.yaw)];
}

function dotToMid(g: Grandstand): number {
  const dx = 150 - g.x;
  const dz = 0 - g.z;
  const len = Math.hypot(dx, dz);
  const [fx, fz] = front(g);
  return (fx * dx + fz * dz) / len;
}

function meshNames(obj: THREE.Object3D): string[] {
  const names: string[] = [];
  obj.traverse((o) => names.push(o.name));
  return names;
}

const loadTexture = (): THREE.Texture => new THREE.Texture();

describe('180 track style wiring', () => {
  it('AT1: a 404 yields defaults, loaded false and one request', async () => {
    const { loadTrackStyle } = await loadWiring();
    const s = stub({ ok: false, json: () => Promise.resolve({}) });
    const result = await loadTrackStyle('monza', 2894, s.fn);
    expect(result).toEqual({ style: DEFAULT_TRACK_STYLE, loaded: false, errors: [], warnings: [] });
    expect(s.urls).toEqual(['/tracks/monza.style.json']);
  });

  it('AT2: a body with an unknown key loads with one warning', async () => {
    const { loadTrackStyle } = await loadWiring();
    const s = stub({ ok: true, json: () => Promise.resolve({ version: 1, foo: 1 }) });
    const result = await loadTrackStyle('monza', 2894, s.fn);
    expect(result.loaded).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('AT3: invalid JSON yields defaults and one JSON error', async () => {
    const { loadTrackStyle } = await loadWiring();
    const s = stub({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token n in JSON')) });
    const result = await loadTrackStyle('monza', 2894, s.fn);
    expect(result.loaded).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('JSON');
    expect(result.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('AT4: a network failure yields defaults without throwing', async () => {
    const { loadTrackStyle } = await loadWiring();
    const s = stub(new Error('network'));
    const result = await loadTrackStyle('monza', 2894, s.fn);
    expect(result.loaded).toBe(false);
    expect(result.style).toEqual(DEFAULT_TRACK_STYLE);
  });

  it('AT5: a left extra grandstand sits beyond the track edge', async () => {
    const { extraGrandstands } = await loadWiring();
    const stands = extraGrandstands(STRAIGHT, styleWith(ENTRY, 100));
    expect(stands).toHaveLength(1);
    expect(stands[0].lengthMeters).toBeCloseTo(100, 6);
    expect(stands[0].rows).toBe(12);
    expect(stands[0].roof).toBe(true);
    expect(stands[0].x).toBeCloseTo(150, 6);
    expect(stands[0].z).toBeCloseTo(-21, 6);
  });

  it('AT6: a right extra grandstand mirrors to positive z', async () => {
    const { extraGrandstands } = await loadWiring();
    const stands = extraGrandstands(STRAIGHT, styleWith({ ...ENTRY, side: 'right' }, 100));
    expect(stands[0].z).toBeCloseTo(21, 6);
  });

  it('AT7: extra grandstands face the track', async () => {
    const { extraGrandstands } = await loadWiring();
    const left = extraGrandstands(STRAIGHT, styleWith(ENTRY, 100));
    const right = extraGrandstands(STRAIGHT, styleWith({ ...ENTRY, side: 'right' }, 100));
    expect(dotToMid(left[0])).toBeGreaterThanOrEqual(0.99);
    expect(dotToMid(right[0])).toBeGreaterThanOrEqual(0.99);
  });

  it('AT8: a wrapping chord on a ring gives the chord length and offset distance', async () => {
    const { extraGrandstands } = await loadWiring();
    const ring: TrackDataV2 = {
      ...STRAIGHT,
      centerline: Array.from({ length: 100 }, (_, i): [number, number] => {
        const a = (i / 100) * 2 * Math.PI;
        return [500 * Math.cos(a), 500 * Math.sin(a)];
      }),
    };
    const stands = extraGrandstands(ring, styleWith({ start: 95, end: 5, side: 'left', offsetMeters: 15 }, 100));
    expect(stands).toHaveLength(1);
    expect(Math.abs(stands[0].lengthMeters - 309.0)).toBeLessThanOrEqual(0.5);
    const dist = Math.hypot(stands[0].x, stands[0].z);
    const near = Math.min(Math.abs(dist - (475.5 + 21)), Math.abs(dist - (475.5 - 21)));
    expect(near).toBeLessThanOrEqual(1);
  });

  it('AT9: default style builds identical objects to no style', () => {
    const track: TrackDataV2 = {
      ...STRAIGHT,
      barriers: [{ start: 10, end: 30, side: 'left', type: 'armco', offsetMeters: 8 }],
    };
    const g = fixture.grandstands[0];
    const strips = buildTrackSurfaces(track);
    const withStyle = DEFAULT_TRACK_STYLE;

    const pitA = createPitBuilding(track);
    const pitB = (createPitBuilding as (t: TrackDataV2, s?: ResolvedTrackStyle) => THREE.Group)(track, withStyle);
    expect(pitB.children.length).toBe(pitA.children.length);
    expect(meshNames(pitB)).toEqual(meshNames(pitA));

    const barA = createBarrierObject(track, loadTexture);
    const barB = (createBarrierObject as (t: TrackDataV2, l?: typeof loadTexture, s?: ResolvedTrackStyle) => ReturnType<typeof createBarrierObject>)(track, loadTexture, withStyle);
    expect(barB.group.children.length).toBe(barA.group.children.length);
    expect(meshNames(barB.group)).toEqual(meshNames(barA.group));

    const gsA = createGrandstand(g, loadTexture);
    const gsB = (createGrandstand as (g: Grandstand, l?: typeof loadTexture, s?: ResolvedTrackStyle) => THREE.Group)(g, loadTexture, withStyle);
    expect(gsB.children.length).toBe(gsA.children.length);
    expect(meshNames(gsB)).toEqual(meshNames(gsA));

    const surA = createTrackSurfaceObject(strips, { loadTexture });
    const surB = createTrackSurfaceObject(strips, { loadTexture, style: withStyle, track } as Parameters<typeof createTrackSurfaceObject>[1]);
    expect(surB.group.children.length).toBe(surA.group.children.length);
    expect(meshNames(surB.group)).toEqual(meshNames(surA.group));
  });
});
