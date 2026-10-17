import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
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
const RUNOFF3: RunoffSegment = { start: 70, end: 90, side: 'left', surface: 'runoff', widthMeters: 8 };

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

function expectVec(value: THREE.Vector3, hex: string): void {
  const c = new THREE.Color(hex);
  expect(value.x).toBeCloseTo(c.r, 3);
  expect(value.y).toBeCloseTo(c.g, 3);
  expect(value.z).toBeCloseTo(c.b, 3);
}

const A: [string, string] = ['#da0000', '#00da00'];
const B: [string, string] = ['#dac400', '#1f4fbf'];

describe('183 post: kerb and run-off paint gaps', () => {
  it('run-off paint range fields fall back individually to the section values', () => {
    const track = withTrack({ runoffs: [RUNOFF, RUNOFF2, RUNOFF3] });
    const style = styleOf({
      runoffPaint: {
        pattern: 'stripes',
        colors: ['#d0432d', '#dadada'],
        stripeMeters: 4,
        ranges: [
          { start: 0, end: 20, side: 'left', colors: ['#58d23a'] },
          { start: 40, end: 60, side: 'left', pattern: 'solid' },
          { start: 70, end: 90, side: 'left', stripeMeters: 1.5 },
        ],
      },
    });
    const paint = named(create(track, style), 'runoffPaint');
    expect(paint.map((m) => m.userData)).toEqual([
      { pattern: 'stripes', colors: ['#58d23a'], stripeMeters: 4 },
      { pattern: 'solid', colors: ['#d0432d', '#dadada'], stripeMeters: 4 },
      { pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 1.5 },
    ]);
  });

  it('a run-off paint range on the opposite side does not apply', () => {
    const style = styleOf({
      runoffPaint: {
        pattern: 'solid',
        colors: ['#58d23a'],
        ranges: [{ start: 0, end: 20, side: 'right', colors: ['#d0432d'] }],
      },
    });
    const paint = named(create(withTrack({ runoffs: [RUNOFF] }), style), 'runoffPaint');
    expect(paint.map((m) => m.userData)).toEqual([{ pattern: 'solid', colors: ['#58d23a'], stripeMeters: 2 }]);
  });

  it('a section paint pattern without colours keeps the plain runoff mesh', () => {
    const track = withTrack({ runoffs: [RUNOFF] });
    const meshes = create(track, styleOf({ runoffPaint: { pattern: 'solid' } }));
    expect(named(meshes, 'runoffPaint')).toHaveLength(0);
    expect(triangles(named(meshes, 'runoff'))).toBe(triangles(named(create(track, DEFAULT_TRACK_STYLE), 'runoff')));
  });

  it('a kerb range without colours falls back to the section colours', () => {
    const style = styleOf({
      kerbs: { colors: A, ranges: [{ start: 0, end: 20, side: 'left', outerStrip: '#1f4fbf' }] },
    });
    const meshes = named(create(withTrack({ kerbs: KERBS }), style), 'kerbs');
    expect(meshes.map((m) => m.name)).toEqual(['kerbs']);
    expect(stripeColors(meshes[0])).toEqual(A);
  });

  it('paint arguments apply only to their own surface kind', () => {
    const kerb = createSurfaceMaterial('kerb', loadTexture, undefined, undefined, {
      pattern: 'solid',
      colors: ['#58d23a'],
      stripeMeters: 2,
    });
    expect(kerb.userData.pattern).toBeUndefined();
    expect(kerb.userData.stripeColors).toBeNull();
    const kerbShader = fakeShader();
    kerb.onBeforeCompile(kerbShader, {} as THREE.WebGLRenderer);
    expect(kerbShader.uniforms.uPaintCount).toBeUndefined();

    const runoff = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { stripeColors: A });
    expect(runoff.userData.pattern).toBeUndefined();
    const runoffShader = fakeShader();
    runoff.onBeforeCompile(runoffShader, {} as THREE.WebGLRenderer);
    expect(runoffShader.uniforms.uPaintCount).toBeUndefined();
    expect(runoffShader.uniforms.uStripeA).toBeUndefined();
  });

  it('paint without stripeMeters defaults to two metres', () => {
    const mat = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern: 'stripes', colors: ['#d0432d'] });
    expect(mat.userData.stripeMeters).toBe(2);
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uPaintStripe.value).toBe(2);
  });

  it('paint colour uniforms are capped at four entries', () => {
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555'];
    const mat = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern: 'solid', colors, stripeMeters: 2 });
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uPaintCount.value).toBe(4);
    const list = shader.uniforms.uPaintColors.value as THREE.Vector3[];
    expect(list).toHaveLength(4);
    for (let i = 0; i < 4; i++) expectVec(list[i], colors[i]);
  });

  it('paint with no colours yields a zero count and black uniforms', () => {
    const mat = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern: 'solid' });
    expect(mat.userData.colors).toEqual([]);
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uPaintCount.value).toBe(0);
    expect(shader.uniforms.uPaintMode.value).toBe(0);
    for (const v of shader.uniforms.uPaintColors.value as THREE.Vector3[]) {
      expect([v.x, v.y, v.z]).toEqual([0, 0, 0]);
    }
  });

  it('the paint shader derives its block index from the run-off uv in metres', () => {
    const mat = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, {
      pattern: 'stripes',
      colors: ['#d0432d', '#dadada'],
      stripeMeters: 2,
    });
    const shader = fakeShader();
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('floor( vMapUv.y * 8.0 / uPaintStripe )');
    expect(shader.fragmentShader).toContain('floor( abs( vMapUv.x ) * 8.0 / uPaintStripe )');
    expect(shader.fragmentShader).toContain('clamp( paintLum / 0.3, 0.6, 1.2 )');
  });

  it('three distinct kerb colour pairs split into three meshes in first-appearance order', () => {
    const track = withTrack({ kerbs: [...KERBS, { start: 80, end: 90, side: 'left' }] });
    const style = styleOf({
      kerbs: {
        ranges: [
          { start: 0, end: 30, side: 'left', colors: B },
          { start: 35, end: 70, side: 'left', colors: A },
        ],
      },
    });
    const meshes = named(create(track, style), 'kerbs');
    expect(meshes.map((m) => m.name)).toEqual(['kerbs', 'kerbs:1', 'kerbs:2']);
    expect(meshes.map((m) => stripeColors(m))).toEqual([B, A, null]);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(3);
  });

  it('a missing style or track option leaves the default look', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF] });
    const style = styleOf({ kerbs: { colors: A }, runoffPaint: { pattern: 'solid', colors: ['#58d23a'] } });
    const styleOnly = createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture, style }).group.children;
    const trackOnly = createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture, track }).group.children;
    for (const children of [styleOnly, trackOnly]) {
      const kerbs = named(children, 'kerbs');
      expect(kerbs.map((m) => m.name)).toEqual(['kerbs']);
      expect(stripeColors(kerbs[0])).toBeNull();
      expect(named(children, 'runoffPaint')).toHaveLength(0);
    }
  });

  it('invalid segment tags fall back to the default meshes', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF, RUNOFF2] });
    const strips = buildTrackSurfaces(track).map((s) => {
      if (s.surface === 'kerb') return { ...s, segment: { kind: 'runoff' as const, index: 0 } };
      if (s.surface === 'runoff' && s.segment?.index === 1) return { ...s, segment: { kind: 'runoff' as const, index: 42 } };
      if (s.surface === 'runoff') return { ...s, segment: { kind: 'kerb' as const, index: 0 } };
      return s;
    });
    const style = styleOf({ kerbs: { colors: A }, runoffPaint: { pattern: 'solid', colors: ['#58d23a'] } });
    const children = createTrackSurfaceObject(strips, { loadTexture, style, track }).group.children;
    const kerbs = named(children, 'kerbs');
    expect(kerbs.map((m) => m.name)).toEqual(['kerbs']);
    expect(stripeColors(kerbs[0])).toBeNull();
    expect(named(children, 'runoffPaint')).toHaveLength(0);
    expect(triangles(named(children, 'runoff'))).toBe(triangles(named(create(track, DEFAULT_TRACK_STYLE), 'runoff')));
  });

  it('segment tags survive the triangle filter that drops run-off triangles near wide asphalt', () => {
    // A wide half-width section makes nearAsphalt drop the runoff rows next to it.
    const track: TrackDataV2 = {
      ...STRAIGHT,
      halfWidthLeft: Array.from({ length: 100 }, (_, i) => (i >= 50 && i <= 55 ? 40 : 6)),
      runoffs: [RUNOFF2],
    };
    const strips = buildTrackSurfaces(track);
    const runoffStrips = strips.filter((s) => s.surface === 'runoff');
    expect(runoffStrips).toHaveLength(1);
    expect(runoffStrips[0].segment).toEqual({ kind: 'runoff', index: 0 });
    // A filtered strip is a subarray view of a larger index buffer.
    expect(runoffStrips[0].indices.buffer.byteLength).toBeGreaterThan(runoffStrips[0].indices.byteLength);

    const defaultRunoff = triangles(named(create(track, DEFAULT_TRACK_STYLE), 'runoff'));
    const style = styleOf({ runoffPaint: { pattern: 'solid', colors: ['#58d23a'] } });
    const children = createTrackSurfaceObject(strips, { loadTexture, style, track }).group.children;
    expect(named(children, 'runoff')).toHaveLength(0);
    expect(triangles(named(children, 'runoffPaint'))).toBe(defaultRunoff);
    expect(defaultRunoff).toBeGreaterThan(0);
  });

  it('dispose releases the geometry, material and unique textures of every split mesh', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF] });
    const style = styleOf({
      kerbs: { ranges: [{ start: 35, end: 70, side: 'left', colors: B }] },
      runoffPaint: { pattern: 'solid', colors: ['#58d23a'] },
    });
    const result = createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture, style, track });
    const meshes = result.group.children as THREE.Mesh[];
    expect(named(meshes, 'kerbs').map((m) => m.name)).toEqual(['kerbs', 'kerbs:1']);
    expect(named(meshes, 'runoffPaint')).toHaveLength(1);

    let geometryDisposals = 0;
    let materialDisposals = 0;
    const textures = new Set<THREE.Texture>();
    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.addEventListener('dispose', () => materialDisposals++);
      for (const texture of (material.userData as { textures: THREE.Texture[] }).textures) textures.add(texture);
    }
    let textureDisposals = 0;
    for (const texture of textures) texture.addEventListener('dispose', () => textureDisposals++);
    result.dispose();
    expect(geometryDisposals).toBe(meshes.length);
    expect(materialDisposals).toBe(meshes.length);
    expect(textures.size).toBeGreaterThan(meshes.length);
    expect(textureDisposals).toBe(textures.size);
  });

  it('createTrackSurfaceObject leaves the input strips untouched', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF] });
    const strips = buildTrackSurfaces(track);
    const snapshot = () =>
      strips.map((s: SurfaceStrip) => ({
        surface: s.surface,
        segment: s.segment,
        positions: Array.from(s.positions),
        indices: Array.from(s.indices),
        uvs: Array.from(s.uvs),
      }));
    const before = snapshot();
    const style = styleOf({ kerbs: { colors: A }, runoffPaint: { pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 2 } });
    createTrackSurfaceObject(strips, { loadTexture, style, track });
    expect(snapshot()).toEqual(before);
  });
});
