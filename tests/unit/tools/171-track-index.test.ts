import { describe, expect, it } from 'vitest';
import { buildTrackIndexEntry } from '../../../tools/track-builder/buildTrackIndex';

type Pt = [number, number];

function ring(count: number, radius: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

function ellipse(count: number, rx: number, ry: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    points.push([Math.cos(angle) * rx, Math.sin(angle) * ry]);
  }
  return points;
}

describe('buildTrackIndexEntry', () => {
  it('falls back to lengthMeters with 3 decimals', () => {
    const entry = buildTrackIndexEntry(
      { id: 't', name: 'T', lengthMeters: 3500.55, centerline: ring(200, 500) },
      { country: 'Nowhere' },
    );
    expect(entry.lengthKm).toBe(3.501);
    expect(entry.country).toBe('Nowhere');
  });

  it('prefers officialLengthMeters over lengthMeters', () => {
    const entry = buildTrackIndexEntry(
      { id: 't', name: 'T', officialLengthMeters: 5793, lengthMeters: 9999, centerline: ring(200, 500) },
      { country: 'Nowhere' },
    );
    expect(entry.lengthKm).toBe(5.793);
  });

  it('throws when centerline is missing', () => {
    expect(() =>
      buildTrackIndexEntry({ id: 't', name: 'T', lengthMeters: 1000 }, { country: 'Nowhere' }),
    ).toThrow(/centerline/);
  });

  it('throws on a degenerate zero-extent centerline', () => {
    expect(() =>
      buildTrackIndexEntry({ id: 't', name: 'T', lengthMeters: 1000, centerline: [[0, 0], [0, 0], [0, 0]] }, { country: 'Nowhere' }),
    ).toThrow(/degenerate/);
  });

  it('does not mutate the input track object', () => {
    const track = { id: 't', name: 'T', lengthMeters: 1000, centerline: ring(200, 500) };
    const before = JSON.parse(JSON.stringify(track)) as typeof track;
    buildTrackIndexEntry(track, { country: 'Nowhere' });
    expect(track).toEqual(before);
  });

  it('simplifies a dense ellipse to 20-128 points, normalized and aspect-preserved', () => {
    const entry = buildTrackIndexEntry(
      { id: 't', name: 'T', lengthMeters: 5000, centerline: ellipse(4000, 1000, 400) },
      { country: 'Nowhere' },
    );
    expect(entry.outline.length).toBeGreaterThanOrEqual(20);
    expect(entry.outline.length).toBeLessThanOrEqual(128);
    for (const [x, y] of entry.outline) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    const xs = entry.outline.map((p) => p[0]);
    const ys = entry.outline.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.4, 2);
  });
});
