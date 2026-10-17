import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EscapeRoad, TrackDataV2 } from '../../../src/core/types';
import { escapeRoadStrips, buildTrackSurfaces, bankTanAt } from '../../../src/track/surfaces';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import { createPitBuilding, createStartGantry } from '../../../src/render/pitAndStart';
import { spawnFromTrack } from '../../../src/game/game';

const DEG = Math.PI / 180;
const TAN = Math.tan(10 * DEG);

// Closed rectangle 200 x 100, 5 m spacing: bottom edge runs +X at z = 0 (right = +Z).
function rectPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 5) pts.push([x, 0]);
  for (let z = 5; z <= 100; z += 5) pts.push([200, z]);
  for (let x = 195; x >= 5; x -= 5) pts.push([x, 100]);
  for (let z = 95; z >= 5; z -= 5) pts.push([0, z]);
  return pts;
}

const POINTS = rectPoints();

function track(bank: number[] | undefined, escapeRoads: EscapeRoad[] = [], elevation = 0): TrackDataV2 {
  return {
    version: 2,
    id: 'placed-geometry',
    name: 'Placed Geometry',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
    sectors: [0, 40, 80],
    elevation: POINTS.map(() => elevation),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 100, originZ: 50, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 2, end: 20, side: 'left' },
    escapeRoads,
    boards: [{ index: 10, side: 'right', offset: 9, label: 100 }],
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
}

function banked(bank: number[] | undefined, escapeRoads?: EscapeRoad[], elevation?: number): TrackDataV2 {
  return track(bank, escapeRoads, elevation);
}

const flatBank = (): number[] => POINTS.map(() => 0);
const slopedBank = (): number[] => POINTS.map(() => 10 * DEG);

function bitIdentical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function instances(group: THREE.Group): { pos: THREE.Vector3; up: THREE.Vector3 }[] {
  group.updateWorldMatrix(true, true);
  const out: { pos: THREE.Vector3; up: THREE.Vector3 }[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      m.premultiply(o.matrixWorld);
      m.decompose(p, q, s);
      out.push({ pos: p.clone(), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize() });
    }
  });
  return out;
}

function meshesByName(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

const PERP_ROAD: EscapeRoad[] = [{ points: [[50, 8], [50, 12], [50, 16]], width: 4 }];
const OBLIQUE_ROAD: EscapeRoad[] = [{ points: [[100, 8], [110, 18]], width: 4 }];

describe('174 banked point objects and escape roads post-coder gaps', () => {
  it('POST1: escape-road vertices lift by d*tan(bank) with d measured from the centerline', () => {
    const stripsB = escapeRoadStrips(banked(slopedBank(), PERP_ROAD));
    const stripsF = escapeRoadStrips(banked(flatBank(), PERP_ROAD));
    expect(stripsB).toHaveLength(1);
    const [sb, sf] = [stripsB[0], stripsF[0]];
    expect(sb.positions.length).toBe(3 * 2 * 3);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const p = (r * 2 + c) * 3;
        const d = sb.positions[p + 2]; // right normal of the bottom edge is +Z at z = 0
        expect(Math.abs(d)).toBeGreaterThanOrEqual(7);
        expect(Math.abs(d)).toBeLessThanOrEqual(17);
        expect(Math.abs(sb.positions[p + 1] - sf.positions[p + 1] - d * TAN)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('POST2: each oblique escape-road column uses its own signed offset from the centerline', () => {
    const stripsB = escapeRoadStrips(banked(slopedBank(), OBLIQUE_ROAD));
    const stripsF = escapeRoadStrips(banked(flatBank(), OBLIQUE_ROAD));
    const [sb, sf] = [stripsB[0], stripsF[0]];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const p = (r * 2 + c) * 3;
        const d = sb.positions[p + 2];
        expect(Math.abs(d)).toBeGreaterThanOrEqual(5);
        expect(Math.abs(sb.positions[p + 1] - sf.positions[p + 1] - d * TAN)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('POST3: verge columns lift by d*tan(bank) including the outer sloped column', () => {
    const stripsB = buildTrackSurfaces(banked(slopedBank()));
    const stripsF = buildTrackSurfaces(banked(flatBank()));
    const vb = stripsB.filter((s) => s.surface === 'grass');
    const vf = stripsF.filter((s) => s.surface === 'grass');
    expect(vb).toHaveLength(2);
    for (let k = 0; k < vb.length; k++) {
      const cols = vb[k].positions.length / 3 / POINTS.length;
      expect(cols).toBe(3);
      for (let i = 5; i <= 35; i++) {
        for (let c = 0; c < cols; c++) {
          const p = (i * cols + c) * 3;
          const d = vb[k].positions[p + 2]; // bottom edge rows sit at z = d
          expect(Math.abs(vb[k].positions[p + 1] - vf[k].positions[p + 1] - d * TAN)).toBeLessThanOrEqual(1e-4);
        }
      }
    }
  });

  it('POST4: distance board bases lift by sign*offset*tan(bank) and keep the flat orientation', () => {
    const atlas = () => new THREE.Texture();
    const bd = createDistanceBoards(banked(slopedBank()), atlas);
    const fd = createDistanceBoards(banked(flatBank()), atlas);
    const a = instances(bd.group);
    const b = instances(fd.group);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    let checked = 0;
    for (let i = 0; i < a.length; i++) {
      expect(a[i].pos.x).toBeCloseTo(b[i].pos.x, 6);
      expect(a[i].pos.z).toBeCloseTo(b[i].pos.z, 6);
      expect(Math.abs(a[i].pos.y - b[i].pos.y - 9 * TAN)).toBeLessThanOrEqual(1e-4);
      expect(a[i].up.x).toBeCloseTo(b[i].up.x, 6);
      expect(a[i].up.y).toBeCloseTo(b[i].up.y, 6);
      expect(a[i].up.z).toBeCloseTo(b[i].up.z, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('POST5: start gantry pillars sit at z*tan(bank) in local y and stay vertical', () => {
    const group = createStartGantry(banked(slopedBank()));
    const pillars = meshesByName(group, 'gantry').filter((m) => Math.abs(m.position.z) > 0);
    expect(pillars).toHaveLength(2);
    for (const p of pillars) {
      expect(p.position.y).toBeCloseTo(p.position.z * TAN, 6);
      expect(p.rotation.x).toBe(0);
      expect(p.rotation.z).toBe(0);
    }
    const flat = createStartGantry(banked(flatBank()));
    for (const p of meshesByName(flat, 'gantry').filter((m) => Math.abs(m.position.z) > 0)) {
      expect(p.position.y === 0).toBe(true);
    }
  });

  it('POST6: the pit building pieces sit on the banked ground of their footprint', () => {
    const near = 16;
    const far = near + 8;
    const group = createPitBuilding(banked(slopedBank(), [], 2.5));
    const box = new THREE.Box3().setFromObject(meshesByName(group, 'pit')[0]);
    expect(box.min.y).toBeCloseTo(2.5 - near * TAN, 4);
    const plinths = meshesByName(group, 'pitPlinth');
    expect(plinths.length).toBeGreaterThanOrEqual(1);
    const plinthBox = new THREE.Box3().setFromObject(plinths[0]);
    expect(plinthBox.min.y).toBeCloseTo(2.5 - far * TAN - 0.05, 4);
    const flatGroup = createPitBuilding(banked(flatBank(), [], 2.5));
    const flatBox = new THREE.Box3().setFromObject(meshesByName(flatGroup, 'pit')[0]);
    expect(flatBox.min.y).toBeCloseTo(2.5, 6);
    expect(meshesByName(flatGroup, 'pitPlinth')).toHaveLength(0);
  });

  it('POST7: an all-zero bank keeps every strip vertex bit-identical to the no-bank build', () => {
    const zero = buildTrackSurfaces(banked(flatBank(), PERP_ROAD));
    const none = buildTrackSurfaces(track(undefined, PERP_ROAD));
    expect(zero).toHaveLength(none.length);
    for (let k = 0; k < zero.length; k++) {
      expect(zero[k].surface).toBe(none[k].surface);
      expect(bitIdentical(zero[k].positions, none[k].positions)).toBe(true);
    }
  });

  it('POST8: spawnFromTrack takes roll from bank[n-5] and falls back to 0', () => {
    const n = POINTS.length;
    const withBank = banked(slopedBank());
    withBank.bank = slopedBank();
    withBank.bank[n - 5] = 0.3;
    expect(spawnFromTrack(withBank).roll).toBe(0.3);
    expect(spawnFromTrack(banked(undefined)).roll).toBe(0);
    const v1 = {
      id: 'v1',
      name: 'V1',
      widthMeters: 12,
      lengthMeters: 600,
      officialLengthMeters: 600,
      centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
      sectors: [0, 40, 80] as [number, number, number],
      source: { dataset: 'test', license: 'test', url: '' },
    };
    expect(spawnFromTrack(v1).roll).toBe(0);
  });

  it('POST9: bankTanAt is 0 for absent or zero bank and tan(bank) otherwise', () => {
    expect(bankTanAt(banked(undefined), 3)).toBe(0);
    expect(bankTanAt(banked(flatBank()), 3)).toBe(0);
    expect(bankTanAt(banked(slopedBank()), 3)).toBeCloseTo(TAN, 12);
    expect(bankTanAt(banked(slopedBank()), 9999)).toBe(0);
  });
});
