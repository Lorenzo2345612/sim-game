import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Grandstand, Terrain, TrackDataV2 } from '../../../src/core/types';
import { grandstandFootprint, groundedBase } from '../../../src/track/placement';
import { createGrandstand, disposeGrandstand } from '../../../src/render/grandstand';
import { createTrackProps } from '../../../src/render/trackProps';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle, type TrackProp } from '../../../src/track/trackStyle';

const ROOT = join(__dirname, '..', '..', '..');
const CELLS = 21 * 11;

function slopeTerrain(s: number): Terrain {
  return {
    originX: 0,
    originZ: 0,
    sizeX: 200,
    sizeZ: 100,
    cols: 20,
    rows: 10,
    heights: Array.from({ length: CELLS }, (_, k) => s * (-100 + 10 * Math.floor(k / 11))),
  };
}

function lineWith(elevation: number[], terrain: Terrain): TrackDataV2 {
  return {
    version: 2,
    id: 'line',
    name: 'Line',
    widthMeters: 12,
    lengthMeters: 180,
    officialLengthMeters: 180,
    centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
    sectors: [0, 30, 60],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain,
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
}

const RAMP = slopeTerrain(0.1);
const LINE = lineWith(
  Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  RAMP,
);
const ELEV0 = Array.from({ length: 91 }, () => 0);

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

function propBox(track: TrackDataV2, prop: TrackProp): THREE.Box3 {
  const result = createTrackProps(track, styleWith([prop]));
  if (!result) throw new Error('expected a props object');
  const mesh = result.group.getObjectByName(`prop:${prop.type}`);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`missing prop:${prop.type}`);
  const box = new THREE.Box3().setFromObject(mesh);
  result.dispose();
  return box;
}

describe('234 grounded stands and props post-code gaps', () => {
  it('POST1: a prop plinth appears only when the ground variation under its footprint exceeds 0.05 m', () => {
    const exact = propBox(lineWith(ELEV0, slopeTerrain(0.005)), TENT);
    expect(exact.min.y).toBeCloseTo(0.025, 6);
    const above = propBox(lineWith(ELEV0, slopeTerrain(0.006)), TENT);
    expect(above.min.y).toBeCloseTo(-0.08, 6);
  });

  it('POST2: every non-bridge prop type grounds on the max ground of its own footprint', () => {
    const cases: [TrackProp['type'], number][] = [
      ['tent', -0.55],
      ['marshalPost', -0.18],
      ['scoreboard', -0.55],
      ['billboardRow', -0.75],
      ['tower', -0.25],
    ];
    for (const [type, minY] of cases) {
      const prop: TrackProp = { ...TENT, type };
      expect(propBox(LINE, prop).min.y, type).toBeCloseTo(minY, 4);
    }
  });

  it('POST3: the prop plinth box spans the footprint local z 0..depth below the prop', () => {
    const result = createTrackProps(LINE, styleWith([TENT]));
    if (!result) throw new Error('expected a props object');
    const mesh = result.group.getObjectByName('prop:tent');
    if (!(mesh instanceof THREE.Mesh)) throw new Error('missing prop:tent');
    const position = mesh.geometry.getAttribute('position');
    const below = new Map<string, THREE.Vector3>();
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      if (v.y < 0) below.set(`${v.x.toFixed(3)},${v.z.toFixed(3)}`, v);
    }
    result.dispose();
    expect([...below.values()]).toHaveLength(4);
    for (const v of below.values()) {
      expect(v.y).toBeCloseTo(-0.55, 4);
      expect(Math.abs(v.x)).toBeCloseTo(5, 4);
      expect(v.z === 16 || v.z === 22).toBe(true);
    }
  });

  it('POST4: a prop stands on the terrain height, not the centerline elevation', () => {
    const raised = lineWith(ELEV0, { ...RAMP, heights: Array.from({ length: CELLS }, () => 3) });
    const box = propBox(raised, TENT);
    expect(box.min.y).toBeCloseTo(3, 4);
    expect(box.max.y).toBeCloseTo(7, 4);
  });

  it('POST5: negative or zero plinthHeight adds no plinth and the same children as the default', () => {
    const names = (plinthHeight?: number): string[] => {
      const group = createGrandstand(STAND, stubTexture, undefined, plinthHeight);
      return group.children.map((c) => c.name);
    };
    expect(names(-1)).toEqual(names());
    expect(names(0)).toEqual(names());
    expect(names()).not.toContain('standPlinth');
  });

  it('POST6: a very deep plinth stays a single finite standPlinth from -plinthHeight to 0', () => {
    const group = createGrandstand(STAND, stubTexture, undefined, 250);
    const plinths = group.children.filter((c) => c.name === 'standPlinth');
    expect(plinths).toHaveLength(1);
    const box = new THREE.Box3().setFromObject(plinths[0]);
    expect(box.min.y).toBeCloseTo(-250, 4);
    expect(box.max.y).toBeCloseTo(0, 4);
    expect(box.isEmpty()).toBe(false);
    disposeGrandstand(group);
  });

  it('POST7: disposeGrandstand disposes the plinth material exactly once', () => {
    const group = createGrandstand(STAND, stubTexture, undefined, 2.05);
    const plinth = group.getObjectByName('standPlinth');
    if (!(plinth instanceof THREE.Mesh)) throw new Error('missing standPlinth');
    const material = plinth.material as THREE.Material;
    const spy = vi.spyOn(material, 'dispose');
    disposeGrandstand(group);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('POST8: main.ts grounds both grandstand loops with groundedBase and no groundHeightAt', () => {
    const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
    expect(mainSrc.match(/groundedBase\(/g)).toHaveLength(2);
    expect(mainSrc).not.toMatch(/groundHeightAt\(/);
  });

  it('POST9: a zero-row stand keeps a degenerate footprint and groundedBase stays finite', () => {
    const g: Grandstand = { ...STAND, rows: 0 };
    const fp = grandstandFootprint(g);
    expect(fp).toEqual({ xMin: -10, xMax: 10, zMin: 0, zMax: 0 });
    const { baseY, plinthBottom } = groundedBase(LINE, g.x, g.z, g.yaw, fp);
    expect(baseY).toBeCloseTo(1.0, 9);
    expect(plinthBottom).toBeCloseTo(-1.05, 9);
  });
});
