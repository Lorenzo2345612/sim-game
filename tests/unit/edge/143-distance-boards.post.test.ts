import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boardOffset, buildBoards } from '../../../tools/track-builder/boards';
import { detectCorners } from '../../../tools/track-builder/corners';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import type { Point2 } from '../../../src/track/geo';
import type { Board, TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const wrap = (v: number, n: number) => ((v % n) + n) % n;
const inRun = (run: { start: number; end: number }, i: number, n: number) =>
  wrap(i - run.start, n) <= wrap(run.end - run.start, n);

type TrackJSON = TrackDataV2 & { boards: Board[] };
const TRACK_IDS = (
  JSON.parse(readFileSync(join(ROOT, 'tools/track-builder', 'tracks.json'), 'utf8')) as { id: string }[]
).map((t) => t.id);
const loadTrack = (id: string): TrackJSON =>
  JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackJSON;

// Rectangle centerline walking -Z, +X, +Z, -X (same shape as the pre-coder edge file).
const RECT: Point2[] = [[0, 0], [0, -100], [0, -200], [100, -200], [100, -100], [100, 0]];
const RECT_ELEV = [0, 5, 10, 4, 2, 6];
const LABELS: Board['label'][] = [200, 150, 100, 50];

function renderTrack(boards: Board[], elevation: number[] = RECT_ELEV): TrackDataV2 {
  return {
    version: 2,
    widthMeters: 12,
    centerline: RECT.map((p): Point2 => [p[0], p[1]]),
    elevation,
    boards,
  } as unknown as TrackDataV2;
}

const stubAtlas = (): THREE.Texture => {
  const tex = new THREE.Texture();
  tex.dispose = (): void => {};
  return tex;
};

const rightNormal = (i: number): Point2 => {
  const n = RECT.length;
  const prev = RECT[wrap(i - 1, n)];
  const next = RECT[wrap(i + 1, n)];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, -1] : [-dz / len, dx / len];
};

const expectedFacePos = (b: Board, elevation: number[]): THREE.Vector3 => {
  const [rx, rz] = rightNormal(b.index);
  const sign = b.side === 'right' ? 1 : -1;
  return new THREE.Vector3(
    RECT[b.index][0] + rx * sign * b.offset,
    (elevation[b.index] ?? 0) + 1.2,
    RECT[b.index][1] + rz * sign * b.offset,
  );
};

const worldPos = (mesh: THREE.InstancedMesh, i: number): THREE.Vector3 => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  m.premultiply(mesh.matrixWorld);
  return new THREE.Vector3().setFromMatrixPosition(m);
};

function splitMeshes(group: THREE.Group): { post: THREE.InstancedMesh | undefined; faces: THREE.InstancedMesh[] } {
  group.updateWorldMatrix(true, true);
  let post: THREE.InstancedMesh | undefined;
  const faces: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    if (o.geometry.type === 'BoxGeometry') post = o;
    else faces.push(o);
  });
  return { post, faces };
}

describe('143 distance boards post-coder gaps', () => {
  it('buildBoards returns no boards for a centerline with fewer than three points', () => {
    expect(buildBoards([], 12, [])).toEqual([]);
    expect(buildBoards([[0, 0]], 12, [])).toEqual([]);
    expect(buildBoards([[0, 0], [0, -100]], 12, [])).toEqual([]);
  });

  it('boardOffset keeps the kerb-clearance floor when the barrier sits at or inside it', () => {
    // floor = half + 1.2 + 2; a barrier whose offset − 1 is below it cannot push the board in.
    expect(boardOffset(6, 7)).toBeCloseTo(9.2, 9);
    expect(boardOffset(6, 10.2)).toBeCloseTo(9.2, 9);
    expect(boardOffset(6, 0)).toBeCloseTo(9.2, 9);
    expect(boardOffset(0, 5)).toBeCloseTo(4, 9); // min(4, 6) = 4 above floor 3.2
  });

  it('every track ships boards exactly as buildBoards derives from its own centerline, width and barriers', () => {
    for (const id of TRACK_IDS) {
      const track = loadTrack(id);
      expect(Array.isArray(track.boards), `${id}: boards field`).toBe(true);
      expect(buildBoards(track.centerline, track.widthMeters, track.barriers), `${id}: rebuilt boards`).toEqual(
        track.boards,
      );
    }
  });

  it('no board on any track lies inside a detected corner run', () => {
    for (const id of TRACK_IDS) {
      const track = loadTrack(id);
      const n = track.centerline.length;
      const runs = detectCorners(track.centerline);
      for (const b of track.boards) {
        expect(b.index, `${id}: index in range`).toBeGreaterThanOrEqual(0);
        expect(b.index, `${id}: index in range`).toBeLessThan(n);
        expect(LABELS, `${id}: label`).toContain(b.label);
        expect(b.offset, `${id}: offset positive`).toBeGreaterThan(0);
        expect(runs.some((r) => inRun(r, b.index, n)), `${id}: board ${b.index} inside a run`).toBe(false);
      }
      for (let i = 1; i < track.boards.length; i++) {
        const prev = track.boards[i - 1];
        const cur = track.boards[i];
        expect(cur.index >= prev.index && (cur.index > prev.index || cur.label < prev.label), `${id}: sorted at ${i}`).toBe(
          true,
        );
      }
    }
  });

  it('createDistanceBoards builds one box post per board and one 1.2 × 0.8 plane mesh per present label', () => {
    const boards: Board[] = [
      { index: 1, side: 'right', offset: 13, label: 200 },
      { index: 2, side: 'right', offset: 13, label: 200 },
      { index: 3, side: 'left', offset: 9.2, label: 150 },
      { index: 4, side: 'right', offset: 13, label: 100 },
    ];
    const bd = createDistanceBoards(renderTrack(boards), stubAtlas);
    expect(bd.count).toBe(4);
    const { post, faces } = splitMeshes(bd.group);
    if (!post) throw new Error('no post mesh');
    const box = post.geometry as THREE.BoxGeometry;
    expect(box.parameters.width).toBeCloseTo(0.08, 9);
    expect(box.parameters.height).toBeCloseTo(1.2, 9);
    expect(box.parameters.depth).toBeCloseTo(0.08, 9);
    expect(post.count).toBe(4);
    for (const b of boards) {
      const face = expectedFacePos(b, RECT_ELEV);
      const at = Array.from({ length: post.count }, (_, i) => worldPos(post, i)).findIndex(
        (p) => Math.abs(p.x - face.x) < 0.05 && Math.abs(p.z - face.z) < 0.05 && Math.abs(p.y - (face.y - 0.6)) < 0.05,
      );
      expect(at, `post for board ${b.label} @${b.index}`).toBeGreaterThanOrEqual(0);
    }
    expect(faces).toHaveLength(3); // labels 50 absent
    for (const [label, mesh] of faces.map((m) => [
      LABELS.find((l) => boards.some((b) => b.label === l && expectedFacePos(b, RECT_ELEV).distanceTo(worldPos(m, 0)) < 0.01)),
      m,
    ] as const)) {
      if (!label) throw new Error(`face mesh matches no label`);
      const plane = mesh.geometry as THREE.PlaneGeometry;
      expect(plane.parameters.width).toBeCloseTo(1.2, 9);
      expect(plane.parameters.height).toBeCloseTo(0.8, 9);
      const expected = boards.filter((b) => b.label === label);
      expect(mesh.count, `count for ${label}`).toBe(expected.length);
      for (const b of expected) {
        const want = expectedFacePos(b, RECT_ELEV);
        expect(mesh.count >= 1 && Array.from({ length: mesh.count }, (_, i) => worldPos(mesh, i)).some((p) => p.distanceTo(want) < 0.01),
          `face for ${label} @${b.index}`).toBe(true);
      }
    }
    bd.dispose();
  });

  it('face UVs of each label mesh select its atlas cell in order 200, 150, 100, 50', () => {
    const boards: Board[] = [
      { index: 1, side: 'right', offset: 13, label: 200 },
      { index: 2, side: 'left', offset: 13, label: 150 },
      { index: 3, side: 'right', offset: 13, label: 100 },
      { index: 4, side: 'left', offset: 13, label: 50 },
    ];
    const bd = createDistanceBoards(renderTrack(boards), stubAtlas);
    const { faces } = splitMeshes(bd.group);
    expect(faces).toHaveLength(4);
    const seen: Board['label'][] = [];
    for (const mesh of faces) {
      const first = worldPos(mesh, 0);
      const board = boards.find((b) => expectedFacePos(b, RECT_ELEV).distanceTo(first) < 0.01);
      if (!board) throw new Error('face mesh matches no board');
      const cell = LABELS.indexOf(board.label);
      const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        min = Math.min(min, uv.getX(i));
        max = Math.max(max, uv.getX(i));
      }
      expect(min, `cell min for ${board.label}`).toBeCloseTo(cell / 4, 6);
      expect(max, `cell max for ${board.label}`).toBeCloseTo((cell + 1) / 4, 6);
      seen.push(board.label);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([50, 100, 150, 200]);
    bd.dispose();
  });

  it('createDistanceBoards calls makeAtlas once with boards and never without', () => {
    let calls = 0;
    const make = (): THREE.Texture => {
      calls += 1;
      return stubAtlas();
    };
    const withBoards = createDistanceBoards(
      renderTrack([
        { index: 1, side: 'right', offset: 13, label: 200 },
        { index: 3, side: 'left', offset: 13, label: 50 },
      ]),
      make,
    );
    expect(calls).toBe(1);
    withBoards.dispose();
    const empty = createDistanceBoards(renderTrack([]), make);
    expect(calls).toBe(1);
    empty.dispose();
  });

  it('a board index beyond the elevation array sits on ground zero with face centre 1.2 m up', () => {
    const short = RECT_ELEV.slice(0, 2);
    const boards: Board[] = [{ index: 3, side: 'right', offset: 13, label: 150 }];
    const bd = createDistanceBoards(renderTrack(boards, short), stubAtlas);
    const { post, faces } = splitMeshes(bd.group);
    if (!post || faces.length !== 1) throw new Error('expected one face mesh and one post mesh');
    // instance matrices are Float32: compare with float32 tolerance.
    expect(worldPos(faces[0], 0).y).toBeCloseTo(1.2, 5);
    expect(worldPos(post, 0).y).toBeCloseTo(0.6, 5);
    bd.dispose();
  });

  it('createDistanceBoards without an injected atlas works in a DOM-less environment and dispose is idempotent', () => {
    const boards: Board[] = [
      { index: 1, side: 'right', offset: 13, label: 200 },
      { index: 3, side: 'left', offset: 9.2, label: 100 },
    ];
    const bd = createDistanceBoards(renderTrack(boards));
    expect(bd.count).toBe(2);
    const { post, faces } = splitMeshes(bd.group);
    expect(post).toBeInstanceOf(THREE.InstancedMesh);
    expect(faces).toHaveLength(2);
    expect(() => {
      bd.dispose();
      bd.dispose();
    }).not.toThrow();
  });
});
