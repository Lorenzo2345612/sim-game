import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SurfaceStrip } from '../../../src/core/types';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { createSurfaceMaterial } from '../../../src/render/surfaceMaterials';
import {
  createTrackMarkingsObject as createMarkingsBase,
  type TrackMarkingsObject,
} from '../../../src/render/trackMarkingsRenderer';
import * as environment from '../../../src/render/environment';
import { registerWhitePaint } from '../../../src/render/sceneSetup';

vi.mock('../../../src/render/sceneSetup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/render/sceneSetup')>();
  return { ...actual, registerWhitePaint: vi.fn() };
});

// Spec-184 signatures; typed locally so this test-first file compiles before the exports exist.
interface EnvHelpers {
  envNameFor(trackId: string, style?: ResolvedTrackStyle): string;
  fogDensityFor(trackId: string, style?: ResolvedTrackStyle): number;
}
const { envNameFor, fogDensityFor } = environment as unknown as EnvHelpers;
const { ENV_TABLE, FOG_TABLE } = environment;

type MarkingsFn = (strips: SurfaceStrip[], style?: ResolvedTrackStyle) => TrackMarkingsObject;
const createTrackMarkingsObject = createMarkingsBase as unknown as MarkingsFn;

const loadTexture = (): THREE.Texture => new THREE.Texture();
const macro = new THREE.Texture();

const STRIPS: SurfaceStrip[] = [
  {
    surface: 'asphalt',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  },
];

function styleOf(raw: Record<string, unknown>): ResolvedTrackStyle {
  return parseTrackStyle({ version: 1, ...raw }, 100).style;
}

function markingMaterial(object: TrackMarkingsObject): THREE.MeshStandardMaterial {
  const mesh = object.group.getObjectByName('markings') as THREE.Mesh;
  return mesh.material as THREE.MeshStandardMaterial;
}

describe('184 palette tints, edge line colour and sky overrides', () => {
  it('AT1: default style keeps asphalt, grass and gravel white', () => {
    for (const kind of ['asphalt', 'grass', 'gravel'] as const) {
      const material = createSurfaceMaterial(kind, loadTexture, macro, DEFAULT_TRACK_STYLE);
      expect(material.color.r).toBeCloseTo(1, 6);
      expect(material.color.g).toBeCloseTo(1, 6);
      expect(material.color.b).toBeCloseTo(1, 6);
    }
  });

  it('AT2: palette hexes reach asphalt, grass and gravel materials in sRGB', () => {
    const palette = { asphalt: '#808080', grass: '#c0d080', gravel: '#dac090' };
    const style = styleOf({ palette });
    for (const kind of ['asphalt', 'grass', 'gravel'] as const) {
      const material = createSurfaceMaterial(kind, loadTexture, macro, style);
      expect(material.color.getHexString()).toBe(palette[kind].slice(1));
    }
  });

  it('AT3: a non-white edgeLines colour sets the marking colour and skips white registration', () => {
    vi.mocked(registerWhitePaint).mockClear();
    const object = createTrackMarkingsObject(STRIPS, styleOf({ edgeLines: { color: '#dac400' } }));
    expect(markingMaterial(object).color.getHexString()).toBe('dac400');
    expect(registerWhitePaint).not.toHaveBeenCalled();
    object.dispose();
  });

  it('AT4: default style keeps the linear 0.7 markings and registers them as white paint', () => {
    vi.mocked(registerWhitePaint).mockClear();
    const object = createTrackMarkingsObject(STRIPS, DEFAULT_TRACK_STYLE);
    const material = markingMaterial(object);
    expect(material.color.r).toBeCloseTo(0.7, 6);
    expect(material.color.g).toBeCloseTo(0.7, 6);
    expect(material.color.b).toBeCloseTo(0.7, 6);
    expect(registerWhitePaint).toHaveBeenCalledTimes(1);
    const registered = vi.mocked(registerWhitePaint).mock.calls[0][0];
    expect(registered.color.r).toBeCloseTo(0.7, 6);
    expect(registered.color.g).toBeCloseTo(0.7, 6);
    expect(registered.color.b).toBeCloseTo(0.7, 6);
    object.dispose();
  });

  it('AT5: sky.hdri overrides envNameFor and the default falls back to ENV_TABLE.monza', () => {
    const style = styleOf({ sky: { hdri: 'kloofendal_overcast_puresky' } });
    expect(envNameFor('monza', style)).toBe('kloofendal_overcast_puresky');
    expect(envNameFor('monza', DEFAULT_TRACK_STYLE)).toBe(ENV_TABLE.monza);
  });

  it('AT6: fogDensityScale 2 doubles the monza fog density and the default leaves it unchanged', () => {
    const style = styleOf({ sky: { fogDensityScale: 2 } });
    expect(fogDensityFor('monza', style)).toBeCloseTo(2 * FOG_TABLE.monza.density, 12);
    expect(fogDensityFor('monza', DEFAULT_TRACK_STYLE)).toBeCloseTo(FOG_TABLE.monza.density, 12);
  });
});
