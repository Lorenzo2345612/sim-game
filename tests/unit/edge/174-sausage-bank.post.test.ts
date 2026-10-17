import { describe, expect, it } from 'vitest';
import { sausagePose } from '../../../src/track/sausages';
import type { Sausage, TrackDataV2 } from '../../../src/core/types';

const DEG = Math.PI / 180;

// Straight 60 points 2 m apart along -Z: right normal +X.
function straightTrack(bank: number[] | undefined, elevation = 3): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: 60 }, (_, i) => [0, -2 * i]);
  const track: TrackDataV2 = {
    version: 2,
    id: 'sausage-bank',
    name: 'Sausage Bank',
    widthMeters: 12,
    lengthMeters: 236,
    officialLengthMeters: 236,
    centerline,
    sectors: [0, 20, 40],
    elevation: centerline.map(() => elevation),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: -58, sizeX: 40, sizeZ: 130, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    sausages: [],
    source: { dataset: 'synthetic', license: 'CC0', url: '', dem: '' },
  };
  if (bank !== undefined) track.bank = bank;
  return track;
}

describe('174 banked sausage bases post-coder gaps', () => {
  it('POST1: a sausage base sits at elevation + signed offset * tan(bank) of its index', () => {
    const tan = Math.tan(10 * DEG);
    const track = straightTrack(Array.from({ length: 60 }, () => 10 * DEG));
    const right: Sausage = { index: 15, side: 'right', offset: 7.8, length: 6 };
    const left: Sausage = { index: 20, side: 'left', offset: 5, length: 6 };
    const pr = sausagePose(track, right);
    const pl = sausagePose(track, left);
    expect(pr.position.y).toBeCloseTo(3 + 7.8 * tan, 9);
    expect(pl.position.y).toBeCloseTo(3 - 5 * tan, 9);
    expect(pr.position.x).toBeCloseTo(7.8, 6);
    expect(pl.position.x).toBeCloseTo(-5, 6);
  });

  it('POST2: an out-of-range sausage index wraps and takes that index bank', () => {
    const bank = new Array<number>(60).fill(0);
    bank[2] = 0.2;
    bank[3] = -0.1;
    const track = straightTrack(bank, 1);
    const s: Sausage = { index: 62, side: 'right', offset: 4, length: 6 };
    expect(sausagePose(track, s).position.y).toBeCloseTo(1 + 4 * Math.tan(0.2), 9);
  });

  it('POST3: an all-zero bank array leaves every sausage base at its elevation', () => {
    const track = straightTrack(new Array<number>(60).fill(0), 2);
    for (const side of ['right', 'left'] as const) {
      const pose = sausagePose(track, { index: 10, side, offset: 7.8, length: 6 });
      expect(pose.position.y).toBeCloseTo(2, 12);
    }
  });

  it('POST4: a zero offset sits on the centerline even when the index is banked', () => {
    const track = straightTrack(Array.from({ length: 60 }, () => 15 * DEG), 4);
    const pose = sausagePose(track, { index: 8, side: 'right', offset: 0, length: 6 });
    expect(pose.position.y).toBeCloseTo(4, 12);
    expect(pose.position.x).toBeCloseTo(0, 12);
  });
});
