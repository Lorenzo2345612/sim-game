import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import { createSurfaceMaterial as createSurfaceMaterialBase, type SurfaceMaterialKind } from '../../../src/render/surfaceMaterials';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

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

const KERBS: TrackSegment[] = [
  { start: 0, end: 20, side: 'left' },
  { start: 40, end: 60, side: 'left' },
];
const RUNOFF: RunoffSegment = { start: 0, end: 20, side: 'left', surface: 'runoff', widthMeters: 8 };
const RUNOFF2: RunoffSegment = { start: 40, end: 60, side: 'left', surface: 'runoff', widthMeters: 8 };
const GRAVEL: RunoffSegment = { start: 70, end: 90, side: 'left', surface: 'gravel', widthMeters: 8 };

const loadTexture = (): THREE.Texture => new THREE.Texture();

function styleOf(raw: Record<string, unknown>): ResolvedTrackStyle {
  return parseTrackStyle({ version: 1, ...raw }, 100).style;
}

function withTrack(patch: Partial<TrackDataV2>): TrackDataV2 {
  return { ...STRAIGHT, ...patch };
}

function create(track: TrackDataV2, style: ResolvedTrackStyle): THREE.Mesh[] {
  return createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture, style, track }).group.children as THREE.Mesh[];
}

function named(meshes: THREE.Object3D[], prefix: string): THREE.Mesh[] {
  return meshes.filter((m): m is THREE.Mesh => m.name === prefix || m.name.startsWith(`${prefix}:`));
}

function triangles(meshes: THREE.Mesh[]): number {
  return meshes.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0);
}

function stripeColors(mesh: THREE.Mesh): unknown {
  return (mesh.material as THREE.Material).userData.stripeColors;
}

interface SurfacePaint { stripeColors?: [string, string]; pattern?: 'solid' | 'stripes' | 'bands'; colors?: string[]; stripeMeters?: number }
const createSurfaceMaterial = createSurfaceMaterialBase as unknown as (
  kind: SurfaceMaterialKind,
  loadTexture?: (url: string) => THREE.Texture,
  macro?: THREE.Texture,
  style?: ResolvedTrackStyle,
  paint?: SurfacePaint,
) => THREE.MeshStandardMaterial;

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

const A: [string, string] = ['#da0000', '#00da00'];
const B: [string, string] = ['#dac400', '#1f4fbf'];

describe('183 edge cases', () => {
  const kerbTrack = withTrack({ kerbs: KERBS });

  it('EDGE1: segments outside a kerb range use the section colours, inside use the range colours', () => {
    const style = styleOf({ kerbs: { colors: A, ranges: [{ start: 35, end: 70, side: 'left', colors: B }] } });
    const meshes = named(create(kerbTrack, style), 'kerbs');
    expect(meshes.map((m) => m.name)).toEqual(['kerbs', 'kerbs:1']);
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      const isSecond = Math.abs(m.geometry.boundingBox!.min.x - 400) < 5;
      expect(stripeColors(m)).toEqual(isSecond ? B : A);
    }
  });

  it('EDGE2: without style and track options kerbs stay one default mesh', () => {
    const track = kerbTrack;
    const group = createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture }).group.children;
    const meshes = named(group, 'kerbs');
    expect(meshes.map((m) => m.name)).toEqual(['kerbs']);
    expect(stripeColors(meshes[0])).toBeNull();
  });

  it('EDGE3: untagged strips are never recoloured or painted', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF] });
    const strips = buildTrackSurfaces(track).map((s: SurfaceStrip) => {
      const copy = { ...s } as Partial<SurfaceStrip>;
      delete copy.segment;
      return copy as SurfaceStrip;
    });
    const style = styleOf({
      kerbs: { colors: A },
      runoffPaint: { pattern: 'solid', colors: ['#58d23a'] },
    });
    const children = createTrackSurfaceObject(strips, { loadTexture, style, track }).group.children;
    const kerbs = named(children, 'kerbs');
    expect(kerbs).toHaveLength(1);
    expect(stripeColors(kerbs[0])).toBeNull();
    expect(named(children, 'runoffPaint')).toHaveLength(0);
    expect(named(children, 'runoff').length).toBeGreaterThan(0);
  });

  it('EDGE4: built strips are tagged with their kerb and run-off index', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF, GRAVEL] });
    const strips = buildTrackSurfaces(track);
    const kerbIdx = strips.filter((s) => s.segment?.kind === 'kerb').map((s) => s.segment!.index).sort();
    expect(kerbIdx).toEqual([0, 1]);
    const runoffTags = strips.filter((s) => s.segment?.kind === 'runoff');
    expect(runoffTags.map((s) => `${s.surface}:${s.segment!.index}`).sort()).toEqual(['gravel:1', 'runoff:0']);
  });

  it('EDGE5: different paints on different run-offs make separate runoffPaint meshes', () => {
    const track = withTrack({ runoffs: [RUNOFF, RUNOFF2] });
    const style = styleOf({
      runoffPaint: {
        pattern: 'stripes',
        colors: ['#d0432d', '#dadada'],
        stripeMeters: 2,
        ranges: [{ start: 35, end: 70, side: 'left', pattern: 'solid', colors: ['#58d23a'] }],
      },
    });
    const paint = named(create(track, style), 'runoffPaint');
    expect(paint.map((m) => m.name)).toEqual(['runoffPaint', 'runoffPaint:1']);
    expect(paint.map((m) => m.userData.pattern).sort()).toEqual(['solid', 'stripes']);
    const solid = paint.find((m) => m.userData.pattern === 'solid')!;
    expect(solid.userData.colors).toEqual(['#58d23a']);
  });

  it('EDGE6: when every run-off strip is painted the runoff mesh is absent and gravel is untouched', () => {
    const track = withTrack({ runoffs: [RUNOFF, RUNOFF2, GRAVEL] });
    const base = create(track, styleOf({}));
    const style = styleOf({ runoffPaint: { pattern: 'bands', colors: ['#d0432d'], stripeMeters: 2 } });
    const meshes = create(track, style);
    expect(named(meshes, 'runoff')).toHaveLength(0);
    expect(triangles(named(meshes, 'runoffPaint'))).toBe(triangles(named(base, 'runoff')));
    expect(triangles(named(meshes, 'gravel'))).toBe(triangles(named(base, 'gravel')));
  });

  it('EDGE7: run-offs with identical paint share one runoffPaint mesh', () => {
    const track = withTrack({ runoffs: [RUNOFF, RUNOFF2] });
    const style = styleOf({ runoffPaint: { pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 2 } });
    const paint = named(create(track, style), 'runoffPaint');
    expect(paint.map((m) => m.name)).toEqual(['runoffPaint']);
  });

  it('EDGE8: a single-colour bands paint pads the colour uniforms and sets mode 2', () => {
    const mat = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern: 'bands', colors: ['#d0432d'], stripeMeters: 3 });
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const list = shader.uniforms.uPaintColors.value as THREE.Vector3[];
    const c = new THREE.Color('#d0432d');
    expect(list).toHaveLength(4);
    for (const v of list) {
      expect(v.x).toBeCloseTo(c.r, 3);
      expect(v.y).toBeCloseTo(c.g, 3);
      expect(v.z).toBeCloseTo(c.b, 3);
    }
    expect(shader.uniforms.uPaintCount.value).toBe(1);
    expect(shader.uniforms.uPaintStripe.value).toBe(3);
    expect(shader.uniforms.uPaintMode.value).toBe(2);
  });

  it('EDGE9: the default kerb material keeps null stripeColors, default uniforms and the cache key', () => {
    const mat = createSurfaceMaterial('kerb', loadTexture);
    expect(mat.userData.stripeColors).toBeNull();
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const a = shader.uniforms.uStripeA.value as THREE.Vector3;
    const b = shader.uniforms.uStripeB.value as THREE.Vector3;
    expect([a.x, a.y, a.z].map((n) => Math.round(n * 100))).toEqual([78, 10, 10]);
    expect([b.x, b.y, b.z].map((n) => Math.round(n * 100))).toEqual([70, 70, 70]);
    expect(mat.customProgramCacheKey()).toBe('surface-kerb');
    const custom = createSurfaceMaterial('kerb', loadTexture, undefined, undefined, { stripeColors: A });
    expect(custom.customProgramCacheKey()).toBe('surface-kerb');
  });

  it('EDGE10: paint program cache key differs per pattern', () => {
    const mk = (pattern: 'solid' | 'stripes' | 'bands'): string =>
      createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern, colors: ['#d0432d', '#dadada'], stripeMeters: 2 }).customProgramCacheKey();
    const keys = new Set([mk('solid'), mk('stripes'), mk('bands')]);
    expect(keys.size).toBe(3);
  });
});
