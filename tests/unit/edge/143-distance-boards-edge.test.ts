import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBoards } from '../../../tools/track-builder/boards';
import { classifyCorners } from '../../../tools/track-builder/hazards';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, Side, TrackDataV2 } from '../../../src/core/types';

// Mirrors of task 143's Board / TrackDataV2.boards so this test-first file type-checks.
interface Board143 {
  index: number;
  side: Side;
  offset: number;
  label: 50 | 100 | 150 | 200;
}
type TrackV2_143 = TrackDataV2 & { boards?: Board143[] };

const ROOT = join(__dirname, '..', '..', '..');
const HALF = 6;
const NO_BARRIERS: BarrierSegment[] = [];

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const inRun = (run: { start: number; end: number }, i: number, n: number) =>
  wrap(i - run.start, n) <= wrap(run.end - run.start, n);
const covers = (seg: { start: number; end: number }, i: number, n: number) =>
  wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);

// Rounded square: `straight` metres per side + 4 quarter arcs of radius R, ~2 m spacing.
function roundedSquare(R: number, straight: number): Point2[] {
  const L = straight + 2 * R;
  const pts: Point2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    const k = Math.round(((Math.PI / 2) * R) / 2);
    for (let j = 1; j <= k; j++) {
      const a = ((a0 + (90 * j) / k) * Math.PI) / 180;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  };
  for (let i = 1; i <= straight / 2; i++) pts.push([R + 2 * i, 0]);
  arc(L - R, R, -90);
  for (let i = 1; i <= straight / 2; i++) pts.push([L, R + 2 * i]);
  arc(L - R, L - R, 0);
  for (let i = 1; i <= straight / 2; i++) pts.push([L - R - 2 * i, L]);
  arc(R, L - R, 90);
  for (let i = 1; i <= straight / 2; i++) pts.push([0, L - R - 2 * i]);
  arc(R, R, 180);
  return pts;
}

function cumOf(points: Point2[]): { cum: number[]; lap: number } {
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const n = points.length;
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

const arcDist = (a: number, b: number, lap: number) => {
  const d = wrap(a - b, lap);
  return Math.min(d, lap - d);
};

function nearestIndex(cum: number[], lap: number, target: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < cum.length; i++) {
    const d = arcDist(cum[i], target, lap);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

const labelsFor = (dropKmh: number): number[] =>
  dropKmh >= 120 ? [200, 150, 100, 50] : dropKmh >= 40 ? [150, 100, 50] : [];

// Spec step 2: labels by dropKmh, position = cum[start] - label on the closed lap, skip inside previous run.
function expectedCorners(points: Point2[]) {
  const { cum, lap } = cumOf(points);
  const n = points.length;
  const corners = classifyCorners(points);
  return corners.map((corner, i) => {
    const prev = corners[(i - 1 + corners.length) % corners.length];
    const targetOf = (label: number) => wrap(cum[corner.start] - label, lap);
    const kept = labelsFor(corner.dropKmh).filter(
      (label) => !inRun(prev, nearestIndex(cum, lap, targetOf(label)), n),
    );
    return { corner, prev, kept, targetOf, cum, lap, n };
  });
}

// Boards of `boards` whose label is one of this corner's kept labels and which sit within 2 m of its target.
function boardsOf(e: ReturnType<typeof expectedCorners>[number], boards: Board143[]): Board143[] {
  return boards.filter(
    (b) => e.kept.includes(b.label) && arcDist(e.cum[b.index], e.targetOf(b.label), e.lap) <= 2,
  );
}

const RECT: Point2[] = [
  [0, 0], [0, -100], [0, -200], [100, -200], [100, -100], [100, 0],
];
const RECT_ELEV = [0, 5, 10, 4, 2, 6];

function renderTrack(boards?: Board143[]): TrackV2_143 {
  return {
    version: 2,
    widthMeters: 12,
    centerline: RECT.map((p): Point2 => [p[0], p[1]]),
    elevation: [...RECT_ELEV],
    boards,
  } as unknown as TrackV2_143;
}

const rightNormal = (points: Point2[], i: number, n: number): Point2 => {
  const prev = points[wrap(i - 1, n)];
  const next = points[wrap(i + 1, n)];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, -1] : [-dz / len, dx / len];
};

const tangent = (points: Point2[], i: number, n: number): Point2 => {
  const prev = points[wrap(i - 1, n)];
  const next = points[wrap(i + 1, n)];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, -1] : [dx / len, dz / len];
};

function instances(group: THREE.Group): { pos: THREE.Vector3; normal: THREE.Vector3 }[] {
  group.updateWorldMatrix(true, true);
  const out: { pos: THREE.Vector3; normal: THREE.Vector3 }[] = [];
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
      out.push({ pos: p.clone(), normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize() });
    }
  });
  return out;
}

describe('143 distance boards edge', () => {
  it('EDGE1: buildBoards returns boards sorted by ascending index, label descending within one index', () => {
    const boards = buildBoards(roundedSquare(30, 600), 12, NO_BARRIERS);
    expect(boards).toHaveLength(16);
    for (let i = 1; i < boards.length; i++) {
      expect(boards[i].index, `index at ${i}`).toBeGreaterThanOrEqual(boards[i - 1].index);
      if (boards[i].index === boards[i - 1].index) {
        expect(boards[i].label, `label at ${i}`).toBeLessThan(boards[i - 1].label);
      }
    }
  });

  it('EDGE2: corners whose dropKmh is below 40 get no boards at all', () => {
    const pts = roundedSquare(30, 20);
    const corners = classifyCorners(pts);
    expect(corners).toHaveLength(4);
    for (const c of corners) expect(c.dropKmh).toBeLessThan(40);
    expect(buildBoards(pts, 12, NO_BARRIERS)).toHaveLength(0);
  });

  it('EDGE3: a board position lying inside the previous corner run is skipped and the other labels are kept', () => {
    const boards = buildBoards(roundedSquare(30, 185), 12, NO_BARRIERS);
    const expected = expectedCorners(roundedSquare(30, 185));
    expect(expected).toHaveLength(4);
    for (const e of expected) {
      // Premise: this corner asks for a 200 board and its index falls inside the previous run.
      expect(e.corner.dropKmh).toBeGreaterThanOrEqual(120);
      expect(inRun(e.prev, nearestIndex(e.cum, e.lap, e.targetOf(200)), e.n)).toBe(true);
      expect(e.kept).toEqual([150, 100, 50]);
      expect(boardsOf(e, boards)).toHaveLength(3);
      for (const b of boardsOf(e, boards)) expect(b.side).toBe(opp(e.corner.side));
    }
    expect(boards).toHaveLength(12);
    expect(boards.filter((b) => b.label === 200)).toHaveLength(0);
  });

  it('EDGE4: positions and indices wrap with positive modulo when the start line sits close before a corner', () => {
    const base = roundedSquare(30, 600);
    const pts = base.slice(250).concat(base.slice(0, 250));
    const n = pts.length;
    const boards = buildBoards(pts, 12, NO_BARRIERS);
    expect(boards).toHaveLength(16);
    const expected = expectedCorners(pts);
    const wrapped = expected.filter((e) => e.cum[e.corner.start] < 200);
    expect(wrapped.length).toBeGreaterThanOrEqual(1);
    for (const e of expected) expect(boardsOf(e, boards)).toHaveLength(e.kept.length);
    for (const b of boards) {
      expect(b.index).toBeGreaterThanOrEqual(0);
      expect(b.index).toBeLessThan(n);
    }
    const e = wrapped[0];
    const far = boards.filter((b) => b.label === 200 && arcDist(e.cum[b.index], e.targetOf(200), e.lap) <= 2);
    expect(far).toHaveLength(1);
    expect(far[0].index).toBeGreaterThan(n - 100);
  });

  it('EDGE5: board offset comes from the barrier covering that index on the board side, else half + 7', () => {
    const pts = roundedSquare(30, 600);
    const n = pts.length;
    const none = buildBoards(pts, 12, NO_BARRIERS);
    expect(none).toHaveLength(16);
    expect(none.some((b) => b.side === 'left')).toBe(true);
    for (const b of none) expect(b.offset, `index ${b.index}`).toBeCloseTo(HALF + 7, 9);

    const partial: BarrierSegment[] = [{ start: 400, end: 700, side: 'left', type: 'armco', offsetMeters: 30 }];
    for (const b of buildBoards(pts, 12, partial)) {
      const covered = b.side === 'left' && covers(partial[0], b.index, n);
      expect(b.offset, `index ${b.index} side ${b.side}`).toBeCloseTo(covered ? 12 : HALF + 7, 9);
    }

    // A barrier on the opposite side of every board never applies.
    const wrong: BarrierSegment[] = [{ start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: 30 }];
    for (const b of buildBoards(pts, 12, wrong)) {
      expect(b.offset, `side ${b.side}`).toBeCloseTo(b.side === 'right' ? 12 : HALF + 7, 9);
    }
  });

  it('EDGE6: buildBoards does not mutate its inputs and repeats identically', () => {
    const pts = roundedSquare(30, 600);
    const barriers: BarrierSegment[] = [
      { start: 100, end: 500, side: 'left', type: 'armco', offsetMeters: 30 },
      { start: 900, end: 1200, side: 'right', type: 'wall', offsetMeters: 9 },
    ];
    const ptsSnap = JSON.stringify(pts);
    const barSnap = JSON.stringify(barriers);
    const first = buildBoards(pts, 12, barriers);
    expect(JSON.stringify(pts)).toBe(ptsSnap);
    expect(JSON.stringify(barriers)).toBe(barSnap);
    expect(buildBoards(pts, 12, barriers)).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('EDGE7: parseTrackData defaults boards to an empty array for v2 JSON that has none', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8')) as Record<string, unknown>;
    delete raw.boards;
    const parsed = parseTrackData(raw) as TrackV2_143;
    expect(parsed.version).toBe(2);
    expect(parsed.boards).toEqual([]);
  });

  it('EDGE8: createDistanceBoards tolerates a track whose boards field is missing and reports count 0', () => {
    const atlas = new THREE.Texture();
    atlas.dispose = (): void => {};
    const bd = createDistanceBoards(renderTrack(undefined), () => atlas);
    expect(bd.count).toBe(0);
    expect(instances(bd.group)).toHaveLength(0);
    expect(() => bd.dispose()).not.toThrow();
    expect(createDistanceBoards(renderTrack([]), () => atlas).count).toBe(0);
  });

  it('EDGE9: each board face sits at the centerline plus signed offset along the right normal, 1.2 m above the track elevation, facing oncoming cars', () => {
    const boards: Board143[] = [
      { index: 1, side: 'right', offset: 13, label: 200 },
      { index: 1, side: 'left', offset: 13, label: 50 },
      { index: 3, side: 'left', offset: 9.2, label: 100 },
    ];
    const atlas = new THREE.Texture();
    atlas.dispose = (): void => {};
    const bd = createDistanceBoards(renderTrack(boards), () => atlas);
    expect(bd.count).toBe(3);
    const inst = instances(bd.group);
    const n = RECT.length;
    for (const b of boards) {
      const c = RECT[b.index];
      const [rx, rz] = rightNormal(RECT, b.index, n);
      const [tx, tz] = tangent(RECT, b.index, n);
      const sign = b.side === 'right' ? 1 : -1;
      const expected = new THREE.Vector3(
        c[0] + rx * sign * b.offset,
        RECT_ELEV[b.index] + 1.2,
        c[1] + rz * sign * b.offset,
      );
      const faces = inst.filter((i) => i.pos.distanceTo(expected) < 0.05);
      expect(faces.length, `board ${b.label} side ${b.side}`).toBeGreaterThanOrEqual(1);
      const facingBack = faces.some((f) => f.normal.dot(new THREE.Vector3(tx, 0, tz)) < -0.9);
      expect(facingBack, `board ${b.label} faces approaching cars`).toBe(true);
    }
    bd.dispose();
  });

  it('EDGE10: dispose frees the atlas texture, every instanced geometry and every instanced material', () => {
    const boards: Board143[] = [
      { index: 1, side: 'right', offset: 13, label: 200 },
      { index: 3, side: 'left', offset: 9.2, label: 100 },
    ];
    const freed = new Set<object>();
    const atlas = new THREE.Texture();
    atlas.dispose = (): void => {
      freed.add(atlas);
    };
    const bd = createDistanceBoards(renderTrack(boards), () => atlas);
    expect(bd.count).toBe(2);
    const meshes: THREE.InstancedMesh[] = [];
    bd.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThan(0);
    const parts: { dispose: () => void }[] = [];
    for (const m of meshes) {
      parts.push(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) parts.push(mat);
    }
    for (const part of parts) {
      const obj = part as unknown as { dispose: () => void };
      const original = obj.dispose.bind(obj);
      obj.dispose = (): void => {
        freed.add(part);
        original();
      };
    }
    bd.dispose();
    expect(freed.has(atlas), 'atlas disposed').toBe(true);
    for (const part of parts) expect(freed.has(part), 'resource disposed').toBe(true);
  });
});
