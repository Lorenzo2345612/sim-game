import { readFileSync } from 'node:fs';
import { projectLonLat, type LonLat, type Point2 } from '../../src/track/geo';

interface AreaFeature {
  id: number;
  kind: string;
  closed: boolean;
  tags: Record<string, string>;
  ring: LonLat[];
}

function isGravel(tags: Record<string, string>): boolean {
  return (
    tags.natural === 'sand' ||
    tags.natural === 'shingle' ||
    tags.surface === 'gravel' ||
    tags.surface === 'sand'
  );
}

export function loadGravelPolygons(areasJsonPath: string, origin: LonLat): Point2[][] {
  let raw: string;
  try {
    raw = readFileSync(areasJsonPath, 'utf8');
  } catch {
    return [];
  }
  const areas = JSON.parse(raw) as { features: AreaFeature[] };
  const out: Point2[][] = [];
  for (const f of areas.features ?? []) {
    if (!f.closed || !isGravel(f.tags)) continue;
    out.push(projectLonLat(f.ring, origin));
  }
  return out;
}
