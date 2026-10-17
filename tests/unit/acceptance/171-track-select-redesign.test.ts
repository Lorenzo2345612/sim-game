import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRACK_CHOICES } from '../../../src/ui/menu';

const ROOT = join(__dirname, '..', '..', '..');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

describe('171 track select redesign', () => {
  it('AT1: buildTrackIndexEntry on monza returns id, country, lengthKm 5.793 and a normalized outline', async () => {
    const { buildTrackIndexEntry } = await import('../../../tools/track-builder/buildTrackIndex');
    const track = readJson<unknown>('public/tracks/monza.json');
    const entry = buildTrackIndexEntry(track, { country: 'Italy' });
    expect(entry.id).toBe('monza');
    expect(entry.country).toBe('Italy');
    expect(entry.lengthKm).toBeCloseTo(5.793, 3);
    expect(entry.outline.length).toBeGreaterThanOrEqual(20);
    expect(entry.outline.length).toBeLessThanOrEqual(128);
    for (const [x, y] of entry.outline) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    const first = entry.outline[0];
    const last = entry.outline[entry.outline.length - 1];
    const firstEqualsLast = first[0] === last[0] && first[1] === last[1];
    const menuSource = readFileSync(join(ROOT, 'src', 'ui', 'menu.ts'), 'utf8');
    const menuClosesPath = /(^|[^A-Za-z])[Zz]([^A-Za-z]|$)/.test(menuSource);
    expect(firstEqualsLast || menuClosesPath, 'outline repeats its first point or the menu closes the SVG path').toBe(true);
  });

  it('AT2: index.json has 19 entries in TRACK_CHOICES order with country and lengthKm > 2', () => {
    const entries = readJson<Array<{ id: string; country: string; lengthKm: number }>>(
      'public/tracks/index.json',
    );
    expect(entries).toHaveLength(TRACK_CHOICES.length);
    expect(entries.map((entry) => entry.id)).toEqual(TRACK_CHOICES.map((choice) => choice.id));
    for (const entry of entries) {
      expect(entry.country).not.toBe('');
      expect(entry.lengthKm).toBeGreaterThan(2);
    }
  });
});
