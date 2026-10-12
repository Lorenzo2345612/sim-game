import type { TrackData } from '../../src/core/types';

const R = 100;
const N = 120;

const centerline: [number, number][] = [];
for (let i = 0; i < N; i++) {
  const a = (2 * Math.PI * i) / N;
  centerline.push([R * Math.cos(a), R * Math.sin(a)]);
}

export const circleTrack: TrackData = {
  id: 'circle',
  name: 'Circle',
  widthMeters: 12,
  lengthMeters: 2 * Math.PI * R,
  officialLengthMeters: 2 * Math.PI * R,
  centerline,
  sectors: [0, 40, 80],
  source: { dataset: 'fixture', license: 'CC0', url: 'https://example.invalid/circle' },
};
