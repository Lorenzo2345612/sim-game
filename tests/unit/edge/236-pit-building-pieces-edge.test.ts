import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { pitBuildingPieces } from '../../../src/track/placement';
import { DEFAULT_TRACK_STYLE } from '../../../src/track/trackStyle';
import { createPitBuilding } from '../../../src/render/pitAndStart';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const RAMP = {
  originX: 0,
  originZ: 0,
  sizeX: 200,
  sizeZ: 100,
  cols: 20,
  rows: 10,
  heights: Array.from({ length: 21 * 11 }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
};

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  id: 'straight',
  name: 'Straight',
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const ARC: TrackDataV2 = {
  ...fixture,
  id: 'arc',
  name: 'Arc',
  centerline: Array.from({ length: 200 }, (_, i): [number, number] => [
    200 * Math.cos((2 * Math.PI * i) / 200),
    -200 * Math.sin((2 * Math.PI * i) / 200),
  ]),
  elevation: Array.from({ length: 200 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 0, end: 50, side: 'right' },
};

const LINE: TrackDataV2 = {
  ...fixture,
  id: 'line',
  name: 'Line',
  centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
  elevation: Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain: RAMP,
  pit: { start: 20, end: 70, side: 'right' },
};

const WEDGE: TrackDataV2 = {
  ...fixture,
  id: 'wedge',
  name: 'Wedge',
  centerline: [[0, 0], [10, 0], [20, 0], [23, 0], [33, 0]],
  elevation: [0, 0, 0, 0, 0],
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 2, end: 3, side: 'right' },
};

const TURN = (9 * Math.PI) / 180;
const ZIG_POINTS: [number, number][] = (() => {
  const pts: [number, number][] = [[-10, 0], [0, 0]];
  let cx = 0;
  let cz = 0;
  for (const len of [10, 10, 3, 10, 10, 10]) {
    const k = pts.length - 2;
    cx += len * Math.cos(k * TURN);
    cz += len * Math.sin(k * TURN);
    pts.push([cx, cz]);
  }
  pts.push([cx + 10 * Math.cos(5 * TURN), cz + 10 * Math.sin(5 * TURN)]);
  return pts;
})();

const ZIG: TrackDataV2 = {
  ...fixture,
  id: 'zig',
  name: 'Zig',
  centerline: ZIG_POINTS,
  elevation: ZIG_POINTS.map(() => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 1, end: 7, side: 'right' },
};

function meshBox(group: THREE.Object3D, name: string): THREE.Box3 {
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) box.expandByObject(o);
  });
  return box;
}

function countByName(group: THREE.Object3D, name: string): number {
  let n = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) n++;
  });
  return n;
}

describe('236 pit building pieces edges', () => {
  it('EDGE1: pit.start === pit.end yields no pieces and an empty group', () => {
    const track: TrackDataV2 = { ...STRAIGHT, pit: { start: 10, end: 10, side: 'right' } };
    expect(pitBuildingPieces(track)).toEqual([]);
    expect(createPitBuilding(track).children).toHaveLength(0);
  });

  it('EDGE2: left side mirrors the box to z −20 with yaw π and near edge at |z| 16', () => {
    const track: TrackDataV2 = { ...STRAIGHT, pit: { start: 10, end: 30, side: 'left' } };
    const pieces = pitBuildingPieces(track);
    expect(pieces).toHaveLength(1);
    const p = pieces[0];
    expect(p.length).toBeCloseTo(200, 6);
    expect(p.depth).toBe(8);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.z).toBeCloseTo(-20, 6);
    expect(p.yaw).toBeCloseTo(Math.PI, 6);
    const nearZ = p.z - (p.depth / 2) * Math.cos(p.yaw);
    expect(nearZ).toBeCloseTo(-16, 6);
  });

  it('EDGE3: style depthMeters 12 gives depth 12 and centre z 22', () => {
    const style = { ...DEFAULT_TRACK_STYLE, pitBuilding: { ...DEFAULT_TRACK_STYLE.pitBuilding, depthMeters: 12 } };
    const pieces = pitBuildingPieces(STRAIGHT, style);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].depth).toBe(12);
    expect(pieces[0].z).toBeCloseTo(6 + 10 + 6, 6);
    expect(pieces[0].length).toBeCloseTo(200, 6);
  });

  it('EDGE4: per-index halfWidthRight 10 offsets the box to z 24', () => {
    const track: TrackDataV2 = {
      ...STRAIGHT,
      halfWidthRight: Array.from({ length: 100 }, () => 10),
    };
    const pieces = pitBuildingPieces(track);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].z).toBeCloseTo(10 + 10 + 4, 6);
    expect(pieces[0].length).toBeCloseTo(200, 6);
  });

  it('EDGE5: a lone 3 m piece is kept', () => {
    const pieces = pitBuildingPieces(WEDGE);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBeCloseTo(3, 6);
  });

  it('EDGE6: a sub-6 m piece merges into the previous one on a sharp zigzag', () => {
    const pieces = pitBuildingPieces(ZIG);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.length).toBeLessThanOrEqual(5);
    let sum = 0;
    for (const p of pieces) {
      expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
      sum += p.length;
    }
    expect(sum).toBeGreaterThanOrEqual(50);
    expect(sum).toBeLessThanOrEqual(53 + 1e-6);
  });

  it('EDGE7: a pit range wrapping across the seam covers the offset arc within 2%', () => {
    const track: TrackDataV2 = { ...ARC, pit: { start: 190, end: 20, side: 'right' } };
    const pieces = pitBuildingPieces(track);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    const arcLength = 216 * 30 * ((2 * Math.PI) / 200);
    let sum = 0;
    for (const p of pieces) sum += p.length;
    expect(Math.abs(sum - arcLength) / arcLength).toBeLessThanOrEqual(0.02);
    if (pieces.length > 1) {
      for (const p of pieces) expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
    }
  });

  it('EDGE8: STRAIGHT building has exactly 13 doors, no extras and a 4 m facade from y 0', () => {
    const group = createPitBuilding(STRAIGHT);
    expect(countByName(group, 'pit')).toBe(1);
    expect(countByName(group, 'garageDoor')).toBe(13);
    expect(group.userData.garageCount).toBe(13);
    expect(group.userData.storeys).toBe(1);
    expect(countByName(group, 'pitPlinth')).toBe(0);
    expect(countByName(group, 'pitGlass')).toBe(0);
    expect(countByName(group, 'pitRoof')).toBe(0);
    expect(countByName(group, 'pitAccent')).toBe(0);
    const box = meshBox(group, 'pit');
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(4, 6);
  });

  it('EDGE9: a multi-piece building gets facade, glass, roof and accent per piece and door count matches userData', () => {
    const style = {
      ...DEFAULT_TRACK_STYLE,
      pitBuilding: {
        ...DEFAULT_TRACK_STYLE.pitBuilding,
        storeys: 2,
        heightMeters: 8,
        glazing: 0.5,
        roof: '#333333',
        roofStyle: 'canopy' as const,
        accent: '#ff0000',
      },
    };
    const pieces = pitBuildingPieces(ZIG, style);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    const group = createPitBuilding(ZIG, style);
    expect(countByName(group, 'pit')).toBe(pieces.length);
    expect(countByName(group, 'pitGlass')).toBe(pieces.length);
    expect(countByName(group, 'pitRoof')).toBe(pieces.length);
    expect(countByName(group, 'pitAccent')).toBe(pieces.length);
    expect(countByName(group, 'garageDoor')).toBe(group.userData.garageCount);
  });

  it('EDGE10: LINE facade sits from baseY 5 up 4 m and the plinth reaches −5.05', () => {
    const group = createPitBuilding(LINE);
    expect(countByName(group, 'pit')).toBe(1);
    expect(countByName(group, 'pitPlinth')).toBe(1);
    const facade = meshBox(group, 'pit');
    expect(facade.min.y).toBeCloseTo(5, 6);
    expect(facade.max.y).toBeCloseTo(9, 6);
    const plinth = meshBox(group, 'pitPlinth');
    expect(plinth.min.y).toBeCloseTo(-5.05, 6);
    expect(plinth.max.y).toBeCloseTo(5, 6);
  });
});
