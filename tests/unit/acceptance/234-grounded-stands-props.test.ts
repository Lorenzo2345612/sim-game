import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand, Terrain, TrackDataV2 } from '../../../src/core/types';
import { terrainHeightAt } from '../../../src/track/ground';
import { grandstandFootprint, groundedBase } from '../../../src/track/placement';
import { createGrandstand } from '../../../src/render/grandstand';
import { createTrackProps } from '../../../src/render/trackProps';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle, type TrackProp } from '../../../src/track/trackStyle';

const ROOT = join(__dirname, '..', '..', '..');

const RAMP: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 200,
  sizeZ: 100,
  cols: 20,
  rows: 10,
  heights: Array.from({ length: 21 * 11 }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
};

const LINE: TrackDataV2 = {
  version: 2,
  id: 'line',
  name: 'Line',
  widthMeters: 12,
  lengthMeters: 180,
  officialLengthMeters: 180,
  centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
  sectors: [0, 30, 60],
  elevation: Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain: RAMP,
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
};

const FLAT_LINE: TrackDataV2 = {
  ...LINE,
  elevation: Array.from({ length: 91 }, () => 0),
  terrain: { ...RAMP, heights: Array.from({ length: 21 * 11 }, () => 0) },
};

const STAND: Grandstand = { x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 10, roof: false };
const TENT: TrackProp = {
  type: 'tent',
  index: 45,
  side: 'right',
  offsetMeters: 10,
  lengthMeters: 10,
  heightMeters: 4,
  color: null,
};

const stubTexture = (): THREE.Texture => new THREE.Texture();

function styleWith(props: TrackProp[]): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  style.props = props;
  return style;
}

function tentBox(track: TrackDataV2): THREE.Box3 {
  const result = createTrackProps(track, styleWith([TENT]));
  if (!result) throw new Error('expected a props object');
  const mesh = result.group.getObjectByName('prop:tent');
  if (!(mesh instanceof THREE.Mesh)) throw new Error('missing prop:tent');
  const box = new THREE.Box3().setFromObject(mesh);
  result.dispose();
  return box;
}

describe('234 grounded stands and props acceptance', () => {
  it('AT1: grandstandFootprint of a 60 m, 10-row stand is ±30 × 0..9', () => {
    const fp = grandstandFootprint({ ...STAND, lengthMeters: 60 });
    expect(fp.xMin).toBeCloseTo(-30, 9);
    expect(fp.xMax).toBeCloseTo(30, 9);
    expect(fp.zMin).toBeCloseTo(0, 9);
    expect(fp.zMax).toBeCloseTo(9, 9);
  });

  it('AT2: groundedBase on the RAMP stand gives baseY 1.0 and plinthBottom -1.05', () => {
    const { baseY, plinthBottom } = groundedBase(LINE, STAND.x, STAND.z, STAND.yaw, grandstandFootprint(STAND));
    expect(baseY).toBeCloseTo(1.0, 9);
    expect(plinthBottom).toBeCloseTo(-1.05, 9);
  });

  it('AT3: plinthHeight 2.05 adds a standPlinth box over the footprint', () => {
    const group = createGrandstand(STAND, stubTexture, undefined, 2.05);
    const plinth = group.getObjectByName('standPlinth');
    expect(plinth).toBeInstanceOf(THREE.Mesh);
    const box = new THREE.Box3().setFromObject(plinth as THREE.Object3D);
    expect(box.min.x).toBeCloseTo(-10, 6);
    expect(box.max.x).toBeCloseTo(10, 6);
    expect(box.min.y).toBeCloseTo(-2.05, 6);
    expect(box.max.y).toBeCloseTo(0, 6);
    expect(box.min.z).toBeCloseTo(0, 6);
    expect(box.max.z).toBeCloseTo(9, 6);
  });

  it('AT4: plinthHeight 0.05 and the default add no standPlinth', () => {
    expect(createGrandstand(STAND, stubTexture, undefined, 0.05).getObjectByName('standPlinth')).toBeUndefined();
    expect(createGrandstand(STAND, stubTexture).getObjectByName('standPlinth')).toBeUndefined();
  });

  it('AT5: every public track grandstand stands on the max ground and bottoms below the min', () => {
    const dir = join(ROOT, 'public', 'tracks');
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.json') && !f.endsWith('.style.json') && f !== 'index.json',
    );
    let checked = 0;
    for (const file of files) {
      const track = JSON.parse(readFileSync(join(dir, file), 'utf8')) as TrackDataV2;
      if (!track.terrain) continue;
      const terrain = track.terrain;
      for (const g of track.grandstands) {
        const fp = grandstandFootprint(g);
        const { baseY, plinthBottom } = groundedBase(track, g.x, g.z, g.yaw, fp);
        const cos = Math.cos(g.yaw);
        const sin = Math.sin(g.yaw);
        const samples: [number, number][] = [
          [fp.xMin, fp.zMin],
          [fp.xMax, fp.zMin],
          [fp.xMin, fp.zMax],
          [fp.xMax, fp.zMax],
          [(fp.xMin + fp.xMax) / 2, (fp.zMin + fp.zMax) / 2],
        ];
        for (const [lx, lz] of samples) {
          const h = terrainHeightAt(terrain, g.x + lx * cos + lz * sin, g.z - lx * sin + lz * cos);
          expect(baseY).toBeGreaterThanOrEqual(h - 1e-6);
          expect(plinthBottom).toBeLessThanOrEqual(h - 0.05 + 1e-6);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('AT6: main.ts grounds grandstands with groundedBase and calls no nearestElevation', () => {
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    expect(mainSrc).toMatch(/groundedBase\(/);
    expect(mainSrc).not.toMatch(/nearestElevation\(/);
  });

  it('AT7: the tent prop on the RAMP plinths down to -0.55 with its roof above the body', () => {
    const box = tentBox(LINE);
    expect(box.min.y).toBeCloseTo(-0.55, 4);
    expect(box.max.y).toBeGreaterThanOrEqual(0.5 + 0.5 * TENT.heightMeters);
  });

  it('AT8: the tent prop on flat ground has no plinth below y 0', () => {
    expect(tentBox(FLAT_LINE).min.y).toBeCloseTo(0, 4);
  });
});
