import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { pitBuildingPieces, type PitPiece } from '../../../src/track/placement';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { createPitBuilding } from '../../../src/render/pitAndStart';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

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
  pit: { start: 190, end: 20, side: 'right' },
};

// Segment k leaves Pk at angle k × turnDeg; the extra segments past the pit
// range keep the seam tangent out of the walked vertices.
function zigzagTrack(lengths: number[], turnDeg: number, end: number): TrackDataV2 {
  const pts: [number, number][] = [[0, 0]];
  let x = 0;
  let z = 0;
  for (let k = 0; k < lengths.length; k++) {
    const a = (k * turnDeg * Math.PI) / 180;
    x += lengths[k] * Math.cos(a);
    z += lengths[k] * Math.sin(a);
    pts.push([x, z]);
  }
  return {
    ...fixture,
    id: `zz-${turnDeg}`,
    name: 'Zigzag',
    centerline: pts,
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    pit: { start: 1, end, side: 'right' },
  };
}

// Short 8.5 m stub at 0 deg, then a 9 deg kink and three 44 m straights: the
// stub's offset chord lands in [6, sum/20) so its door share rounds to zero.
function kinkTrack(): TrackDataV2 {
  const a = (9 * Math.PI) / 180;
  const pts: [number, number][] = [[0, 0], [40, 0], [48.5, 0]];
  let x = 48.5;
  let z = 0;
  for (let k = 0; k < 4; k++) {
    x += 44 * Math.cos(a);
    z += 44 * Math.sin(a);
    pts.push([x, z]);
  }
  return {
    ...fixture,
    id: 'kink',
    name: 'Kink',
    centerline: pts,
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    pit: { start: 1, end: 5, side: 'right' },
  };
}

function pitPath(track: TrackDataV2): number {
  let path = 0;
  let i = track.pit.start;
  while (i !== track.pit.end) {
    const j = (i + 1) % track.centerline.length;
    path += Math.hypot(
      track.centerline[j][0] - track.centerline[i][0],
      track.centerline[j][1] - track.centerline[i][1],
    );
    i = j;
  }
  return path;
}

function countByName(group: THREE.Object3D, name: string): number {
  let n = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) n++;
  });
  return n;
}

function meshesByName(group: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

function doorsPerPiece(group: THREE.Object3D, pieces: PitPiece[]): number[] {
  const counts = pieces.map(() => 0);
  for (const door of meshesByName(group, 'garageDoor')) {
    let owner = -1;
    pieces.forEach((p, i) => {
      const cos = Math.cos(p.yaw);
      const sin = Math.sin(p.yaw);
      const dx = door.position.x - p.x;
      const dz = door.position.z - p.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lz + p.depth / 2) < 1e-6 && Math.abs(lx) <= p.length / 2 + 1e-6) owner = i;
    });
    expect(owner, 'door outside every piece').toBeGreaterThanOrEqual(0);
    counts[owner]++;
  }
  return counts;
}

describe('236 pit building pieces post-code gaps', () => {
  it('GAP1: pitBuildingPieces and createPitBuilding do not mutate the track or style inputs', () => {
    const style: ResolvedTrackStyle = {
      ...DEFAULT_TRACK_STYLE,
      pitBuilding: { ...DEFAULT_TRACK_STYLE.pitBuilding, depthMeters: 12, storeys: 2 },
    };
    const trackBefore = JSON.stringify(ARC);
    const styleBefore = JSON.stringify(style);
    pitBuildingPieces(ARC, style);
    createPitBuilding(ARC, style);
    expect(JSON.stringify(ARC)).toBe(trackBefore);
    expect(JSON.stringify(style)).toBe(styleBefore);
  });

  it('GAP2: a short head run folds into the next piece instead of staying below 6 m', () => {
    const pieces = pitBuildingPieces({ ...ZIG, pit: { start: 2, end: 7, side: 'right' } });
    expect(pieces.length).toBe(4);
    let sum = 0;
    for (const p of pieces) {
      expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
      sum += p.length;
    }
    expect(sum).toBeGreaterThanOrEqual(30);
    expect(sum).toBeLessThanOrEqual(34);
  });

  it('GAP3: runs accumulate from the piece start, so 3.95 deg groups two segments and 4.05 deg splits them', () => {
    const grouped = pitBuildingPieces(zigzagTrack([20, 20, 20, 20, 20, 20, 20, 20], 3.95, 7));
    expect(grouped.length).toBe(3);
    for (const p of grouped) expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
    const split = pitBuildingPieces(zigzagTrack([20, 20, 20, 20, 20, 20, 20, 20], 4.05, 7));
    expect(split.length).toBe(6);
    for (const p of split) expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
  });

  it('GAP4: a ground spread of 0.04 m keeps the reported plinth but suppresses the plinth mesh', () => {
    // Terrain rising 0.005 m per metre in z: the footprint (z 16..24) spans 0.04 m.
    const shallow: Terrain = {
      originX: 0,
      originZ: 0,
      sizeX: 200,
      sizeZ: 100,
      cols: 20,
      rows: 10,
      heights: Array.from({ length: 21 * 11 }, (_, k) => 0.005 * (-50 + 10 * (k % 11))),
    };
    const slope = 0.005;
    const track: TrackDataV2 = { ...STRAIGHT, terrain: shallow };
    const pieces = pitBuildingPieces(track);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].baseY).toBeCloseTo(24 * slope, 6);
    expect(pieces[0].plinthBottom).toBeCloseTo(16 * slope - 0.05, 6);
    expect(pieces[0].baseY - pieces[0].plinthBottom).toBeLessThanOrEqual(0.1);
    const group = createPitBuilding(track);
    expect(countByName(group, 'pitPlinth')).toBe(0);
    const box = new THREE.Box3().setFromObject(meshesByName(group, 'pit')[0]);
    expect(box.min.y).toBeCloseTo(24 * slope, 6);
  });

  it('GAP5: each piece gets max(1, round(total x length / sumLength)) doors and storeys survive', () => {
    const style: ResolvedTrackStyle = {
      ...DEFAULT_TRACK_STYLE,
      pitBuilding: { ...DEFAULT_TRACK_STYLE.pitBuilding, storeys: 2, heightMeters: 8 },
    };
    const track = kinkTrack();
    const pieces = pitBuildingPieces(track, style);
    expect(pieces.length).toBe(2);
    for (const p of pieces) expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);

    const total = Math.max(10, Math.floor(pitPath(track) / 15));
    const sumLength = pieces.reduce((s, p) => s + p.length, 0);

    const group = createPitBuilding(track, style);
    expect(group.userData.storeys).toBe(2);
    expect(countByName(group, 'pit')).toBe(2);
    const actual = doorsPerPiece(group, pieces);
    let floored = 0;
    pieces.forEach((p, k) => {
      const share = (total * p.length) / sumLength;
      if (share < 0.5) floored++;
      expect(actual[k], `piece ${k}`).toBe(Math.max(1, Math.round(share)));
    });
    expect(floored).toBeGreaterThanOrEqual(1);
    expect(group.userData.garageCount).toBe(actual.reduce((s, c) => s + c, 0));
  });

  it('GAP6: degenerate geometry (out-and-back spike, duplicate points) stays finite', () => {
    const spike: TrackDataV2 = {
      ...fixture,
      id: 'spike',
      name: 'Spike',
      centerline: [[0, 0], [10, 0], [20, 0], [10, 0], [0, 0], [-10, 0]],
      elevation: [0, 0, 0, 0, 0, 0],
      kerbs: [],
      runoffs: [],
      barriers: [],
      pit: { start: 1, end: 3, side: 'right' },
    };
    const spikePieces = pitBuildingPieces(spike);
    expect(spikePieces.length).toBe(2);
    for (const p of spikePieces) {
      for (const v of [p.x, p.z, p.yaw, p.length, p.baseY, p.plinthBottom]) expect(Number.isFinite(v)).toBe(true);
      expect(p.length).toBeGreaterThanOrEqual(6 - 1e-9);
    }

    const dup: TrackDataV2 = {
      ...fixture,
      id: 'dup',
      name: 'Dup',
      centerline: [[0, 0], [10, 0], [10, 0], [20, 0]],
      elevation: [0, 0, 0, 0],
      kerbs: [],
      runoffs: [],
      barriers: [],
      pit: { start: 1, end: 2, side: 'right' },
    };
    const dupPieces = pitBuildingPieces(dup);
    expect(dupPieces).toHaveLength(1);
    for (const v of [dupPieces[0].x, dupPieces[0].z, dupPieces[0].yaw, dupPieces[0].baseY]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('GAP7: a wrapping pit range distributes doors from the wrapped path length', () => {
    const pieces = pitBuildingPieces(ARC);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    const total = Math.max(10, Math.floor(pitPath(ARC) / 15));
    expect(total).toBeGreaterThan(10);
    const sumLength = pieces.reduce((s, p) => s + p.length, 0);
    const group = createPitBuilding(ARC);
    const actual = doorsPerPiece(group, pieces);
    pieces.forEach((p, k) => {
      expect(actual[k], `piece ${k}`).toBe(Math.max(1, Math.round((total * p.length) / sumLength)));
    });
    expect(group.userData.garageCount).toBe(actual.reduce((s, c) => s + c, 0));
    expect(countByName(group, 'garageDoor')).toBe(group.userData.garageCount);
  });

  it('GAP8: a lone 3 m piece still gets the 10-door floor', () => {
    const group = createPitBuilding(WEDGE);
    expect(countByName(group, 'pit')).toBe(1);
    expect(countByName(group, 'pitPlinth')).toBe(0);
    expect(countByName(group, 'garageDoor')).toBe(10);
    expect(group.userData.garageCount).toBe(10);
  });
});
