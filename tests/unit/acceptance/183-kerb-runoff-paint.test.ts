import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';
import { createSurfaceMaterial as createSurfaceMaterialBase, type SurfaceMaterialKind } from '../../../src/render/surfaceMaterials';
import { fixture } from './022-fixture-trackdatav2';

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
const GRAVEL: RunoffSegment = { start: 0, end: 20, side: 'left', surface: 'gravel', widthMeters: 8 };

const loadTexture = (): THREE.Texture => new THREE.Texture();

function styleOf(raw: Record<string, unknown>): ResolvedTrackStyle {
  return parseTrackStyle({ version: 1, ...raw }, 100).style;
}

function withTrack(patch: Partial<TrackDataV2>): TrackDataV2 {
  return { ...STRAIGHT, ...patch };
}

function create(track: TrackDataV2, style: ResolvedTrackStyle): THREE.Object3D[] {
  const strips = buildTrackSurfaces(track);
  return createTrackSurfaceObject(strips, { loadTexture, style, track }).group.children;
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

function linear(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

function expectVec(value: THREE.Vector3, hex: string): void {
  const c = linear(hex);
  expect(value.x).toBeCloseTo(c.r, 3);
  expect(value.y).toBeCloseTo(c.g, 3);
  expect(value.z).toBeCloseTo(c.b, 3);
}

describe('183 kerb colours and run-off paint', () => {
  const kerbTrack = withTrack({ kerbs: KERBS });

  it('AT1: default style yields exactly one kerbs mesh', () => {
    const meshes = create(kerbTrack, DEFAULT_TRACK_STYLE);
    expect(meshes.filter((m) => m.name.startsWith('kerbs')).map((m) => m.name)).toEqual(['kerbs']);
  });

  it('AT2: kerbs.colors reach every kerb material userData', () => {
    const meshes = named(create(kerbTrack, styleOf({ kerbs: { colors: ['#da0000', '#00da00'] } })), 'kerbs');
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(stripeColors(mesh)).toEqual(['#da0000', '#00da00']);
  });

  it('AT3: a kerb range splits the kerbs into two meshes with their own colours', () => {
    const style = styleOf({ kerbs: { ranges: [{ start: 35, end: 70, side: 'left', colors: ['#dac400', '#1f4fbf'] }] } });
    const meshes = named(create(kerbTrack, style), 'kerbs');
    expect(meshes.map((m) => m.name)).toEqual(['kerbs', 'kerbs:1']);
    const painted = meshes.filter((m) => {
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox!;
      return Math.abs(box.min.x - 400) < 15 && Math.abs(box.max.x - 600) < 15;
    });
    expect(painted).toHaveLength(1);
    expect(stripeColors(painted[0])).toEqual(['#dac400', '#1f4fbf']);
    const other = meshes.find((m) => m !== painted[0])!;
    expect(stripeColors(other)).toBeNull();
  });

  it('AT4: splitting kerbs keeps the total triangle count', () => {
    const base = triangles(named(create(kerbTrack, DEFAULT_TRACK_STYLE), 'kerbs'));
    const style = styleOf({ kerbs: { ranges: [{ start: 35, end: 70, side: 'left', colors: ['#dac400', '#1f4fbf'] }] } });
    expect(base).toBeGreaterThan(0);
    expect(triangles(named(create(kerbTrack, style), 'kerbs'))).toBe(base);
  });

  it('AT5: a striped run-off paint moves its triangles to the runoffPaint mesh', () => {
    const track = withTrack({ runoffs: [RUNOFF] });
    const base = triangles(named(create(track, DEFAULT_TRACK_STYLE), 'runoff'));
    const style = styleOf({ runoffPaint: { pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 2 } });
    const meshes = create(track, style);
    const paint = named(meshes, 'runoffPaint');
    expect(paint.length).toBeGreaterThan(0);
    expect(paint[0].userData).toEqual({ pattern: 'stripes', colors: ['#d0432d', '#dadada'], stripeMeters: 2 });
    const plain = meshes.filter((m) => m.name === 'runoff' || m.name.startsWith('runoff:')) as THREE.Mesh[];
    expect(triangles(plain) + triangles(paint)).toBe(base);
    expect(triangles(paint)).toBeGreaterThan(0);
  });

  it('AT6: pattern none creates no runoffPaint mesh', () => {
    const meshes = create(withTrack({ runoffs: [RUNOFF] }), DEFAULT_TRACK_STYLE);
    expect(named(meshes, 'runoffPaint')).toHaveLength(0);
  });

  it('AT7: gravel is never painted', () => {
    const track = withTrack({ runoffs: [GRAVEL] });
    const style = styleOf({
      runoffPaint: { pattern: 'none', ranges: [{ start: 0, end: 20, side: 'left', pattern: 'solid', colors: ['#58d23a'] }] },
    });
    const meshes = create(track, style);
    expect(named(meshes, 'runoffPaint')).toHaveLength(0);
    expect(triangles(named(meshes, 'gravel'))).toBe(triangles(named(create(track, DEFAULT_TRACK_STYLE), 'gravel')));
  });

  it('AT8: a solid paint range creates a runoffPaint mesh', () => {
    const style = styleOf({
      runoffPaint: { pattern: 'none', ranges: [{ start: 0, end: 20, side: 'left', pattern: 'solid', colors: ['#58d23a'] }] },
    });
    const paint = named(create(withTrack({ runoffs: [RUNOFF] }), style), 'runoffPaint');
    expect(paint.length).toBeGreaterThan(0);
    expect(paint[0].userData.pattern).toBe('solid');
    expect(paint[0].userData.colors).toEqual(['#58d23a']);
  });

  it('AT9: stripe and paint uniforms are the linear conversion of the hex colours', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const kerb = createSurfaceMaterial('kerb', loadTexture, undefined, undefined, { stripeColors: ['#da0000', '#00da00'] });
    expect(kerb.userData.stripeColors).toEqual(['#da0000', '#00da00']);
    const kerbShader = fakeShader();
    kerb.onBeforeCompile(kerbShader, renderer);
    expectVec(kerbShader.uniforms.uStripeA.value as THREE.Vector3, '#da0000');
    expectVec(kerbShader.uniforms.uStripeB.value as THREE.Vector3, '#00da00');

    const colors = ['#d0432d', '#dadada'];
    const paint = createSurfaceMaterial('runoff', loadTexture, undefined, undefined, { pattern: 'stripes', colors, stripeMeters: 2 });
    expect(paint.userData.pattern).toBe('stripes');
    expect(paint.userData.colors).toEqual(colors);
    expect(paint.userData.stripeMeters).toBe(2);
    const paintShader = fakeShader();
    paint.onBeforeCompile(paintShader, renderer);
    const list = paintShader.uniforms.uPaintColors.value as THREE.Vector3[];
    expect(list).toHaveLength(4);
    expectVec(list[0], colors[0]);
    expectVec(list[1], colors[1]);
    expectVec(list[2], colors[1]);
    expectVec(list[3], colors[1]);
    expect(paintShader.uniforms.uPaintCount.value).toBe(2);
    expect(paintShader.uniforms.uPaintStripe.value).toBe(2);
    expect(paintShader.uniforms.uPaintMode.value).toBe(1);
  });

  it('AT10: buildTrackSurfaces output is unchanged by styled rendering', () => {
    const track = withTrack({ kerbs: KERBS, runoffs: [RUNOFF, GRAVEL] });
    const before = buildTrackSurfaces(track).map((s: SurfaceStrip) => ({
      surface: s.surface,
      positions: Array.from(s.positions),
      indices: Array.from(s.indices),
      uvs: Array.from(s.uvs),
    }));
    const style = styleOf({
      kerbs: { colors: ['#da0000', '#00da00'] },
      runoffPaint: { pattern: 'bands', colors: ['#d0432d'], stripeMeters: 2 },
    });
    createTrackSurfaceObject(buildTrackSurfaces(track), { loadTexture, style, track });
    const after = buildTrackSurfaces(track).map((s: SurfaceStrip) => ({
      surface: s.surface,
      positions: Array.from(s.positions),
      indices: Array.from(s.indices),
      uvs: Array.from(s.uvs),
    }));
    expect(after).toEqual(before);
  });
});
