import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner, buildTrackSurfaces } from '../../../src/track/surfaces';
import { barrierRuns } from '../../../src/track/barrierPath';

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

describe('176 non-mutation edge cases', () => {
  it('EDGE9: asphaltOwner, buildTrackSurfaces and barrierRuns leave the track unchanged', () => {
    const track = loadTrack('monza');
    const before = structuredClone(track);
    const owner = asphaltOwner(track);
    owner(track.centerline[10][0], track.centerline[10][1]);
    owner(-1e4, -1e4);
    buildTrackSurfaces(track);
    barrierRuns(track, 'left');
    barrierRuns(track, 'right');
    expect(track).toEqual(before);
  });
});
