import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RAPIER, createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import type { Point2 } from '../../../src/track/geo';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { Sausage, TrackDataV2, Vec3 } from '../../../src/core/types';
import { detectCorners, radii, type CornerRun } from '../../../tools/track-builder/corners';
import { buildSausages, type SausageOverride } from '../../../tools/track-builder/sausages';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const SAUSAGE_MODULE = '../../../src/track/sausages';
const RENDERER_MODULE = '../../../src/render/sausageRenderer';
const CLEARANCE = 0.6;

interface SausagePiece247 {
  position: Vec3;
  yaw: number;
  length: number;
}

type SausagePiecesFn = (track: TrackDataV2, s: Sausage) => SausagePiece247[];

async function loadSausagePieces(): Promise<SausagePiecesFn> {
  const mod = (await import(SAUSAGE_MODULE)) as unknown as { sausagePieces: SausagePiecesFn };
  return mod.sausagePieces;
}

interface RendererMod {
  createSausages(track: TrackDataV2): { group: THREE.Group; count: number; dispose(): void };
  createSausageBodyGeometry(): THREE.BufferGeometry;
}

async function loadRenderer(): Promise<RendererMod> {
  return (await import(RENDERER_MODULE)) as unknown as RendererMod;
}

interface HalfWidths {
  left: number[];
  right: number[];
}

type BuildSausagesFn = (
  points: Point2[],
  widthMeters: number,
  overrides?: SausageOverride[],
  halfWidths?: HalfWidths,
) => Sausage[];

const build = buildSausages as unknown as BuildSausagesFn;

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

function arcLength(points: Point2[], from: number, to: number): number {
  const n = points.length;
  let len = 0;
  let i = wrap(from, n);
  const target = wrap(to, n);
  while (i !== target) {
    const j = (i + 1) % n;
    len += Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
    i = j;
  }
  return len;
}

function apexIndex(rs: number[], run: CornerRun, n: number): number {
  const span = wrap(run.end - run.start, n);
  let best = run.start;
  let bestR = Infinity;
  for (let k = 0; k <= span; k++) {
    const i = wrap(run.start + k, n);
    if (rs[i] < bestR) {
      bestR = rs[i];
      best = i;
    }
  }
  return best;
}

function nearestIndexAt(points: Point2[], atMeters: number): number {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const per = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  const target = wrap(atMeters, per);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(cum[i] - target);
    const dist = Math.min(d, per - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}

function cumulative(points: [number, number][]): { cum: number[]; lap: number } {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

// S-chicane of `R`-metre 60/R-degree arcs closed by R 300 quarter arcs (task 149 fixture, parameterised).
function chicanePts(R: number, deg: number): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let px = 0;
  let pz = 0;
  let phi = -Math.PI / 2;
  const straight = (m: number): void => {
    let d = m;
    while (d > 1e-9) {
      const s = Math.min(2, d);
      d -= s;
      px += s * Math.cos(phi);
      pz += s * Math.sin(phi);
      pts.push([px, pz]);
    }
  };
  const arc = (radius: number, degrees: number, s: number): void => {
    const span = (degrees * Math.PI) / 180;
    const k = Math.max(1, Math.ceil((radius * span) / 2));
    const cx = px + s * radius * -Math.sin(phi);
    const cz = pz + s * radius * Math.cos(phi);
    const vx = px - cx;
    const vz = pz - cz;
    for (let j = 1; j <= k; j++) {
      const th = (s * span * j) / k;
      px = cx + vx * Math.cos(th) - vz * Math.sin(th);
      pz = cz + vx * Math.sin(th) + vz * Math.cos(th);
      pts.push([px, pz]);
    }
    phi += s * span;
  };
  straight(500);
  arc(R, deg, -1);
  straight(50);
  arc(R, deg, 1);
  straight(500);
  const phi0 = phi;
  const dx = -px;
  const dz = -pz;
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + (3 * Math.PI) / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + 2 * Math.PI), 0));
  if (Math.hypot(px, pz) < 1e-6) pts.pop();
  return pts;
}

const POINTS = 60;

function straightTrack(
  o: {
    sausages?: Sausage[];
    elevation?: number[];
    bank?: number[];
    kerbs?: TrackDataV2['kerbs'];
  } = {},
): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: POINTS }, (_, i) => [0, -2 * i]);
  const track: TrackDataV2 = {
    ...fixture,
    centerline,
    lengthMeters: 236,
    elevation: o.elevation ?? centerline.map(() => 0),
    kerbs: o.kerbs ?? [],
    runoffs: [],
    barriers: [],
  };
  if (o.bank !== undefined) track.bank = o.bank;
  if (o.sausages !== undefined) track.sausages = o.sausages;
  return track;
}

function circleTrack(radius: number, n: number): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: n }, (_, j) => {
    const a = (2 * Math.PI * j) / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  });
  return {
    ...fixture,
    centerline,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    sausages: [],
  };
}

type World = ReturnType<typeof createPhysicsWorld>;

describe('247 sausage fit corner edge', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: buildSausages offsets auto sausages from per-index half-widths and falls back to half the track width', () => {
    const pts = chicanePts(40, 60);
    const n = pts.length;
    const rs = radii(pts);
    const runs = detectCorners(pts).filter((r) => r.minRadius < 80);
    expect(runs).toHaveLength(2);
    const apexL = apexIndex(rs, runs[0], n);
    const apexR = apexIndex(rs, runs[1], n);
    expect(runs[0].side).toBe('left');
    expect(runs[1].side).toBe('right');
    const left: number[] = [];
    left[apexL] = 10;
    const sausages = build(pts, 12, undefined, { left, right: [] });
    expect(sausages).toHaveLength(2);
    const sLeft = sausages.find((s) => s.side === 'left');
    const sRight = sausages.find((s) => s.side === 'right');
    expect(sLeft?.index).toBe(apexL);
    expect(sLeft?.offset).toBeCloseTo(10 + KERB_WIDTH + CLEARANCE, 9);
    expect(sRight?.index).toBe(apexR);
    expect(sRight?.offset).toBeCloseTo(12 / 2 + KERB_WIDTH + CLEARANCE, 9);
  });

  it('EDGE2: buildSausages drops an auto sausage exactly when its offset reaches 0.8 of the apex radius', () => {
    const pts = chicanePts(40, 60);
    const n = pts.length;
    const rs = radii(pts);
    const runs = detectCorners(pts).filter((r) => r.minRadius < 80);
    const apexL = apexIndex(rs, runs[0], n);
    const apexR = apexIndex(rs, runs[1], n);
    const left: number[] = [];
    const right: number[] = [];
    left[apexL] = 0.8 * rs[apexL] - KERB_WIDTH - CLEARANCE;
    right[apexR] = 0.8 * rs[apexR] - KERB_WIDTH - CLEARANCE - 0.05;
    const sausages = build(pts, 12, undefined, { left, right });
    expect(sausages).toHaveLength(1);
    expect(sausages[0].side).toBe('right');
    expect(sausages[0].index).toBe(apexR);
    expect(sausages[0].offset).toBeCloseTo(0.8 * rs[apexR] - 0.05, 6);
  });

  it('EDGE3: buildSausages keeps override values verbatim and fills omitted override fields with the defaults', () => {
    const pts = chicanePts(40, 60);
    const n = pts.length;
    const rs = radii(pts);
    const runs = detectCorners(pts).filter((r) => r.minRadius < 80);
    const apexL = apexIndex(rs, runs[0], n);
    const apexR = apexIndex(rs, runs[1], n);
    const cum = cumulative(pts as [number, number][]).cum;
    const overrides: SausageOverride[] = [
      { atMeters: cum[apexL], side: 'left', offsetMeters: 40, lengthMeters: 3.3 },
      { atMeters: 100, side: 'right' },
    ];
    const sausages = build(pts, 12, overrides);
    expect(sausages).toHaveLength(3);
    const explicit = sausages.find((s) => s.side === 'left');
    expect(explicit?.index).toBe(apexL);
    expect(explicit?.offset).toBe(40);
    expect(explicit?.length).toBeCloseTo(3.3, 9);
    const defaulted = sausages.find(
      (s) => s.side === 'right' && s.index === nearestIndexAt(pts, 100),
    );
    expect(defaulted?.offset).toBeCloseTo(12 / 2 + KERB_WIDTH + CLEARANCE, 9);
    expect(defaulted?.length).toBe(6);
    expect(sausages.some((s) => s.side === 'right' && s.index === apexR)).toBe(true);
  });

  it('EDGE4: sausagePieces splits the length into one-metre pieces centred on the apex arc', async () => {
    const sausagePieces = await loadSausagePieces();
    const track = straightTrack();
    const cases: Array<{ length: number; count: number; piece: number }> = [
      { length: 10, count: 10, piece: 1 },
      { length: 4.5, count: 5, piece: 0.9 },
      { length: 0.5, count: 1, piece: 0.5 },
    ];
    for (const c of cases) {
      const pieces = sausagePieces(track, { index: 20, side: 'right', offset: 7.8, length: c.length });
      expect(pieces.length, `${c.length} m piece count`).toBe(c.count);
      let sum = 0;
      for (let k = 0; k < pieces.length; k++) {
        const p = pieces[k];
        expect(p.length, `${c.length} m piece ${k} length`).toBeCloseTo(c.piece, 9);
        sum += p.length;
        const centreArc = 40 - c.length / 2 + (k + 0.5) * c.piece;
        expect(p.position.x, `${c.length} m piece ${k} x`).toBeCloseTo(7.8, 6);
        expect(p.position.y, `${c.length} m piece ${k} y`).toBeCloseTo(0, 6);
        expect(p.position.z, `${c.length} m piece ${k} z`).toBeCloseTo(-centreArc, 6);
        expect(Math.sin(p.yaw), `${c.length} m piece ${k} yaw sin`).toBeCloseTo(0, 6);
        expect(Math.cos(p.yaw), `${c.length} m piece ${k} yaw cos`).toBeCloseTo(-1, 6);
      }
      expect(sum, `${c.length} m total length`).toBeCloseTo(c.length, 9);
    }
  });

  it('EDGE5: sausagePieces wraps piece arcs past the lap start onto the closing edge', async () => {
    const sausagePieces = await loadSausagePieces();
    const track = circleTrack(40, 126);
    const pieces = sausagePieces(track, { index: 0, side: 'right', offset: 7.8, length: 6 });
    expect(pieces).toHaveLength(6);
    const pts = track.centerline as [number, number][];
    const n = pts.length;
    const { cum, lap } = cumulative(pts);
    for (let k = 0; k < 6; k++) {
      const a = wrap(cum[0] - 3 + (k + 0.5), lap);
      let seg = n - 1;
      for (let i = 0; i < n; i++) {
        const next = i + 1 < n ? cum[i + 1] : lap;
        if (a < next) {
          seg = i;
          break;
        }
      }
      const j = (seg + 1) % n;
      const segLen = (seg + 1 < n ? cum[seg + 1] : lap) - cum[seg];
      const t = (a - cum[seg]) / segLen;
      const ax = pts[seg][0];
      const az = pts[seg][1];
      const dx = pts[j][0] - ax;
      const dz = pts[j][1] - az;
      const len = Math.hypot(dx, dz);
      const ux = dx / len;
      const uz = dz / len;
      const ex = ax + t * dx + -uz * 7.8;
      const ez = az + t * dz + ux * 7.8;
      expect(pieces[k].position.x, `piece ${k} x`).toBeCloseTo(ex, 6);
      expect(pieces[k].position.z, `piece ${k} z`).toBeCloseTo(ez, 6);
      expect(pieces[k].position.y, `piece ${k} y`).toBeCloseTo(0, 6);
      expect(Math.sin(pieces[k].yaw), `piece ${k} yaw sin`).toBeCloseTo(Math.sin(Math.atan2(ux, uz)), 6);
      expect(Math.cos(pieces[k].yaw), `piece ${k} yaw cos`).toBeCloseTo(Math.cos(Math.atan2(ux, uz)), 6);
      expect(pieces[k].length, `piece ${k} length`).toBeCloseTo(1, 9);
    }
  });

  it('EDGE6: sausagePieces lifts pieces by interpolated elevation plus lateral times the interpolated bank tangent', async () => {
    const sausagePieces = await loadSausagePieces();
    const elevation = Array.from({ length: POINTS }, () => 0);
    elevation[30] = 2;
    const bank = Array.from({ length: POINTS }, () => 0);
    bank[30] = 0.2;
    const track = straightTrack({ elevation, bank });
    const tanBank = Math.tan(0.2);
    for (const side of ['right', 'left'] as const) {
      const sign = side === 'right' ? 1 : -1;
      const pieces = sausagePieces(track, { index: 30, side, offset: 5, length: 2 });
      expect(pieces).toHaveLength(2);
      for (const p of pieces) {
        expect(p.position.y, `${side} piece y`).toBeCloseTo(1.5 + sign * 5 * 0.75 * tanBank, 6);
        expect(p.position.x, `${side} piece x`).toBeCloseTo(sign * 5, 6);
      }
    }
  });

  it('EDGE7: createSausages instances every piece in one mesh, blacks the end pieces and scales Z by the piece length', async () => {
    const mod = await loadRenderer();
    const track = straightTrack({
      sausages: [
        { index: 15, side: 'right', offset: 7.8, length: 3 },
        { index: 25, side: 'right', offset: 7.8, length: 0.5 },
      ],
    });
    const obj = mod.createSausages(track);
    expect(obj.count).toBe(2);
    expect(obj.group.children).toHaveLength(1);
    const mesh = obj.group.children[0] as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.name).toBe('sausages');
    expect(mesh.count).toBe(4);
    const expected = [
      { z: -29, len: 1, black: true },
      { z: -30, len: 1, black: false },
      { z: -31, len: 1, black: true },
      { z: -50, len: 0.5, black: true },
    ];
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const e = m.elements;
      const z = e[14];
      const exp = expected.find((x) => Math.abs(x.z - z) < 1e-4);
      expect(exp, `instance ${i} at z ${z}`).toBeDefined();
      expect(e[12], `instance ${i} x`).toBeCloseTo(7.8, 4);
      expect(Math.hypot(e[8], e[9], e[10]), `instance ${i} z scale`).toBeCloseTo(exp!.len, 4);
      expect(e[10], `instance ${i} local Z`).toBeCloseTo(-exp!.len, 4);
      mesh.getColorAt(i, c);
      if (exp!.black) {
        expect(c.r + c.g + c.b, `instance ${i} end piece black`).toBeLessThan(0.01);
      } else {
        expect(Math.min(c.r, c.g, c.b), `instance ${i} middle piece white`).toBeGreaterThan(0.99);
      }
    }
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    expect(box?.max.z).toBeCloseTo(0.5, 6);
    expect(box?.min.z).toBeCloseTo(-0.5, 6);
    const colors = mesh.geometry.getAttribute('color');
    for (let i = 0; i < colors.count; i++) {
      expect(colors.getX(i), `body vertex ${i} r`).toBeCloseTo(1, 5);
      expect(colors.getY(i), `body vertex ${i} g`).toBeCloseTo(0.78, 5);
      expect(colors.getZ(i), `body vertex ${i} b`).toBeCloseTo(0, 5);
    }
    obj.dispose();
  });

  it('EDGE8: track colliders add one kerb convex hull per sausage piece', () => {
    const track = straightTrack({
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 3 }],
    });
    world = createPhysicsWorld(track);
    world.step();
    let kerbColliders = 0;
    world.forEachCollider((c) => {
      if (surfaceOf(c) === 'kerb') kerbColliders++;
    });
    expect(kerbColliders, 'one hull per piece').toBe(3);
    for (const z of [-29, -30, -31]) {
      const hit = world.castRay(new RAPIER.Ray({ x: 7.8, y: 5, z }, { x: 0, y: -1, z: 0 }), 100, true);
      expect(hit, `downward ray at z ${z}`).not.toBeNull();
      if (hit === null) continue;
      expect(surfaceOf(hit.collider), `z ${z} kerb surface`).toBe('kerb');
      expect(hit.timeOfImpact, `z ${z} top 0.13`).toBeCloseTo(4.87, 3);
    }
    const beyond = world.castRay(
      new RAPIER.Ray({ x: 7.8, y: 5, z: -28.3 }, { x: 0, y: -1, z: 0 }),
      100,
      true,
    );
    if (beyond !== null) expect(surfaceOf(beyond.collider)).not.toBe('kerb');
  });

  it('EDGE9: buildSausages and sausagePieces leave their inputs untouched', async () => {
    const sausagePieces = await loadSausagePieces();
    const pts = chicanePts(40, 60);
    const overrides: SausageOverride[] = [{ atMeters: 100, side: 'right', offsetMeters: 9 }];
    const left: number[] = [];
    left[256] = 10;
    const halfWidths: HalfWidths = { left, right: [] };
    const ptsBefore = JSON.stringify(pts);
    const overridesBefore = JSON.stringify(overrides);
    const halfBefore = JSON.stringify(halfWidths);
    build(pts, 12, overrides, halfWidths);
    expect(JSON.stringify(pts), 'points not mutated').toBe(ptsBefore);
    expect(JSON.stringify(overrides), 'overrides not mutated').toBe(overridesBefore);
    expect(JSON.stringify(halfWidths), 'halfWidths not mutated').toBe(halfBefore);
    const track = straightTrack({
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 6 }],
    });
    const sausage = track.sausages![0];
    const trackBefore = JSON.stringify(track);
    const sausageBefore = JSON.stringify(sausage);
    sausagePieces(track, sausage);
    expect(JSON.stringify(track), 'track not mutated').toBe(trackBefore);
    expect(JSON.stringify(sausage), 'sausage not mutated').toBe(sausageBefore);
  });

  it('EDGE10: buildSausages clamps auto lengths inclusive at 6 and 20 m', () => {
    const cases: Array<{ deg: number; R: number; rawBelow: boolean }> = [
      { R: 12, deg: 10, rawBelow: true },
      { R: 40, deg: 60, rawBelow: false },
    ];
    for (const c of cases) {
      const pts = chicanePts(c.R, c.deg);
      const n = pts.length;
      const rs = radii(pts);
      const runs = detectCorners(pts).filter((r) => r.minRadius < 80);
      const sausages = build(pts, 12);
      expect(sausages, `R ${c.R} deg ${c.deg} auto count`).toHaveLength(2);
      for (const s of sausages) {
        const run = runs.find((r) => r.side === s.side && apexIndex(rs, r, n) === s.index);
        expect(run, `R ${c.R} run for ${s.side} apex ${s.index}`).toBeDefined();
        const raw = 0.5 * arcLength(pts, run!.start, run!.end);
        if (c.rawBelow) {
          expect(raw, `R ${c.R} raw below clamp`).toBeLessThan(6);
          expect(s.length, `R ${c.R} ${s.side} clamped low`).toBeCloseTo(6, 9);
        } else {
          expect(raw, `R ${c.R} raw above clamp`).toBeGreaterThan(20);
          expect(s.length, `R ${c.R} ${s.side} clamped high`).toBeCloseTo(20, 9);
        }
      }
    }
  });
});
