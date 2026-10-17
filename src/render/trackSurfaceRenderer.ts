import * as THREE from 'three';
import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
import { segmentOverride, type ResolvedTrackStyle } from '../track/trackStyle';
import {
  createSurfaceMaterial,
  type SurfaceMaterialKind,
  type SurfaceMaterialUserData,
  type SurfacePaint,
} from './surfaceMaterials';

export interface TrackSurfaceOptions {
  loadTexture?: (url: string) => THREE.Texture;
  style?: ResolvedTrackStyle;
  track?: TrackDataV2;
}
export interface TrackSurfaceObject { group: THREE.Group; dispose(): void }

const MESH_NAME: Partial<Record<Surface, string>> = {
  asphalt: 'asphalt',
  kerb: 'kerbs',
  grass: 'grass',
  gravel: 'gravel',
  runoff: 'runoff',
};

interface PaintUserData {
  pattern: 'solid' | 'stripes' | 'bands';
  colors: string[];
  stripeMeters: number;
}

interface BucketPlan {
  key: string;
  prefix: string;
  kind: SurfaceMaterialKind;
  paint?: SurfacePaint;
  meshPaint?: PaintUserData;
}

interface Bucket extends Omit<BucketPlan, 'key' | 'prefix'> {
  name: string;
  strips: SurfaceStrip[];
}

function defaultLoadTexture(url: string): THREE.Texture {
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

/** Kerb colour pair of a strip: range override, section colours, or null (renderer default). */
function kerbColors(
  style: ResolvedTrackStyle | undefined,
  track: TrackDataV2 | undefined,
  strip: SurfaceStrip,
): [string, string] | null {
  if (!style || !track || strip.segment?.kind !== 'kerb') return null;
  const seg = track.kerbs[strip.segment.index];
  if (!seg) return null;
  return segmentOverride(style.kerbs.ranges, seg, track.centerline.length)?.colors ?? style.kerbs.colors ?? null;
}

/** Paint of a run-off strip; undefined when it stays on the plain runoff mesh. */
function runoffPaintOf(
  style: ResolvedTrackStyle | undefined,
  track: TrackDataV2 | undefined,
  strip: SurfaceStrip,
): PaintUserData | undefined {
  if (!style || !track || strip.segment?.kind !== 'runoff') return undefined;
  const seg = track.runoffs[strip.segment.index];
  if (!seg) return undefined;
  const over = segmentOverride(style.runoffPaint.ranges, seg, track.centerline.length);
  const pattern = over?.pattern ?? style.runoffPaint.pattern;
  const colors = over?.colors ?? style.runoffPaint.colors;
  if (pattern === 'none' || colors.length === 0) return undefined;
  return { pattern, colors, stripeMeters: over?.stripeMeters ?? style.runoffPaint.stripeMeters };
}

function planBucket(
  strip: SurfaceStrip,
  style?: ResolvedTrackStyle,
  track?: TrackDataV2,
): BucketPlan {
  if (strip.surface === 'kerb') {
    const colors = kerbColors(style, track, strip);
    return {
      key: `kerb:${colors ? colors.join('|') : 'default'}`,
      prefix: 'kerbs',
      kind: 'kerb',
      paint: colors ? { stripeColors: colors } : undefined,
    };
  }
  if (strip.surface === 'runoff') {
    const meshPaint = runoffPaintOf(style, track, strip);
    if (meshPaint) {
      return {
        key: `paint:${meshPaint.pattern}:${meshPaint.colors.join('|')}:${meshPaint.stripeMeters}`,
        prefix: 'runoffPaint',
        kind: 'runoff',
        paint: { pattern: meshPaint.pattern, colors: meshPaint.colors, stripeMeters: meshPaint.stripeMeters },
        meshPaint,
      };
    }
  }
  return { key: strip.surface, prefix: MESH_NAME[strip.surface] ?? strip.surface, kind: strip.surface };
}

export function createTrackSurfaceObject(
  strips: SurfaceStrip[],
  options?: TrackSurfaceOptions,
): TrackSurfaceObject {
  const loadTexture = options?.loadTexture ?? defaultLoadTexture;
  const style = options?.style;
  const track = options?.track;
  const buckets = new Map<string, Bucket>();
  const nameCount = new Map<string, number>();
  for (const strip of strips) {
    if (!MESH_NAME[strip.surface]) continue;
    const plan = planBucket(strip, style, track);
    const existing = buckets.get(plan.key);
    if (existing) {
      existing.strips.push(strip);
      continue;
    }
    const count = nameCount.get(plan.prefix) ?? 0;
    nameCount.set(plan.prefix, count + 1);
    buckets.set(plan.key, {
      name: count === 0 ? plan.prefix : `${plan.prefix}:${count}`,
      kind: plan.kind,
      paint: plan.paint,
      meshPaint: plan.meshPaint,
      strips: [strip],
    });
  }

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const textures = new Set<THREE.Texture>();
  const macro = buckets.size > 0 ? loadTexture('textures/macro-noise.png') : undefined;

  for (const bucket of buckets.values()) {
    const same = bucket.strips;
    const vertexCount = same.reduce((n, s) => n + s.positions.length / 3, 0);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(same.reduce((n, s) => n + s.indices.length, 0));
    let base = 0;
    let offset = 0;
    for (const strip of same) {
      positions.set(strip.positions, base * 3);
      uvs.set(strip.uvs, base * 2);
      for (let i = 0; i < strip.indices.length; i++) indices[offset + i] = strip.indices[i] + base;
      base += strip.positions.length / 3;
      offset += strip.indices.length;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometries.push(geometry);

    const material = createSurfaceMaterial(bucket.kind, loadTexture, macro, style, bucket.paint);
    materials.push(material);
    for (const texture of (material.userData as SurfaceMaterialUserData).textures) {
      textures.add(texture);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = bucket.name;
    if (bucket.meshPaint) mesh.userData = bucket.meshPaint;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  let disposed = false;
  return {
    group,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
