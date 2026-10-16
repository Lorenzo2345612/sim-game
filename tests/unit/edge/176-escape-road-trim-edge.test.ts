import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');

function loadV2Tracks(): Array<{ id: string; track: TrackDataV2 }> {
  const dir = join(ROOT, 'public', 'tracks');
  const out: Array<{ id: string; track: TrackDataV2 }> = [];
  for (const name of readdirSync(dir)) {
    if (
      !name.endsWith('.json') ||
      name === 'index.json' ||
      name.endsWith('-env.json') ||
      name.endsWith('.style.json')
    )
      continue;
    const track = JSON.parse(readFileSync(join(dir, name), 'utf8')) as TrackDataV2;
    if (track.version === 2) out.push({ id: track.id, track });
  }
  return out;
}

describe('176 escape road trim edge cases', () => {
  it('EDGE10: every escape road point lies outside the asphalt of every centerline point', () => {
    for (const { id, track } of loadV2Tracks()) {
      const owner = asphaltOwner(track);
      for (const road of track.escapeRoads ?? []) {
        for (const [x, z] of road.points) {
          expect(owner(x, z), `${id}: escape road point (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(-1);
        }
      }
    }
  }, 120000);
});
