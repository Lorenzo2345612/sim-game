import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const NEW_IDS = ['fontana', 'cleveland', 'detroit'];

function sourceOf(id: string): { dataset?: string; license?: string } {
  const data = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
    source?: { dataset?: string; license?: string };
  };
  return data.source ?? {};
}

function centerlineLength(id: string): number {
  const data = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
    centerline: [number, number][];
  };
  const closed = data.centerline;
  let length = 0;
  for (let i = 0; i < closed.length; i++) {
    const a = closed[i];
    const b = closed[(i + 1) % closed.length];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

describe('168 us tracks in game', () => {
  it('AT4: the three track JSONs declare the OpenStreetMap dataset under ODbL 1.0', () => {
    for (const id of NEW_IDS) {
      const source = sourceOf(id);
      expect(source.dataset, `${id}: source.dataset`).toBe('OpenStreetMap');
      expect(source.license, `${id}: source.license`).toBe('ODbL 1.0');
    }
  });

  it('AT6: the closed centerline lengths of the three tracks fall in the expected ranges', () => {
    const ranges: Record<string, [number, number]> = {
      fontana: [2300, 2550],
      cleveland: [3250, 3550],
      detroit: [2450, 2700],
    };
    for (const id of NEW_IDS) {
      const [min, max] = ranges[id];
      const length = centerlineLength(id);
      expect(length, `${id}: length >= ${min}`).toBeGreaterThanOrEqual(min);
      expect(length, `${id}: length <= ${max}`).toBeLessThanOrEqual(max);
    }
  });
});
