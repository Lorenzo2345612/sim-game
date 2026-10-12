export const EARTH_RADIUS_M = 6371008.8;
export type LonLat = [number, number]; // [lon, lat] degrees
export type Point2 = [number, number]; // [x, z] metres

export function bboxCenter(coords: LonLat[]): LonLat {
  if (coords.length === 0) {
    throw new Error('bboxCenter: empty coords');
  }
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

export function projectLonLat(coords: LonLat[], origin: LonLat): Point2[] {
  const [lon0, lat0] = origin;
  const k = (EARTH_RADIUS_M * Math.PI) / 180;
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  return coords.map(([lon, lat]) => [
    (lon - lon0) * cosLat0 * k,
    -(lat - lat0) * k,
  ]);
}

export function polylineLength(points: Point2[], closed: boolean): number {
  if (points.length < 2) {
    return 0;
  }
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    total += Math.hypot(dx, dz);
  }
  if (closed) {
    const first = points[0];
    const last = points[points.length - 1];
    total += Math.hypot(first[0] - last[0], first[1] - last[1]);
  }
  return total;
}
