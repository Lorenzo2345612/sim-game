import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

function stadium(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 400; x += 2) pts.push([x, 0]);
  for (let k = 1; k < 8; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 8;
    pts.push([400 + 15 * Math.cos(a), 15 + 15 * Math.sin(a)]);
  }
  for (let x = 400; x >= 0; x -= 2) pts.push([x, 30]);
  for (let k = 1; k < 8; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 8;
    pts.push([15 * Math.cos(a), 15 + 15 * Math.sin(a)]);
  }
  return pts;
}

function stadiumTrack(): TrackDataV2 {
  const centerline = stadium();
  const n = centerline.length;
  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    length += Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
  }
  return {
    version: 2,
    id: 'edge-stadium',
    name: 'Edge Stadium',
    widthMeters: 12,
    lengthMeters: length,
    officialLengthMeters: length,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [
      { start: 0, end: n - 1, side: 'left', surface: 'runoff', widthMeters: 50 },
      { start: 0, end: n - 1, side: 'right', surface: 'runoff', widthMeters: 50 },
    ],
    barriers: [],
    terrain: { originX: 200, originZ: 15, sizeX: 800, sizeZ: 200, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 straight runoff width edge cases', () => {
  it('EDGE5: runoff on a straight keeps its full width (no curvature clamp)', () => {
    const strips = buildTrackSurfaces(stadiumTrack());
    const leftRunoff = strips.find((s) => s.surface === 'runoff');
    expect(leftRunoff).toBeDefined();
    const p = leftRunoff!.positions;
    let full = 0;
    for (let v = 0; v < p.length; v += 3) {
      if (p[v + 2] <= -55.9) full++;
    }
    expect(full).toBeGreaterThanOrEqual(100);
  });
});
