import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrackData } from './buildTrackData';
import type { GeoJsonLineFeatureCollection, TrackSourceConfig } from './buildTrackData';
import { centerlineHeights, limitGrade, removeCanopy, smoothProfile } from './elevation';
import { detectKerbs, detectRunoffs } from './corners';
import { buildSausages, type SausageOverride } from './sausages';
import { applyFoamBarriers, applyPavedRunoffs, classifyCorners, detectEscapeRoads, trimEscapeRoads } from './hazards';
import { buildBoards } from './boards';
import { loadGravelPolygons } from './osmAreas';
import { analyzeParallel, applyMedianWalls, stripParallel } from './parallel';
import { layoutBarriers } from './barriers';
import { buildTerrain, clampTerrainBelowStrips } from './terrain';
import { clipPitRange } from './pitRange';
import { buildTrackSurfaces } from '../../src/track/surfaces';
import { biomeFor, placeTrees, type Biome } from './trees';
import type { DemGrid } from '../dem/fetchDem';
import { bboxCenter, polylineLength, projectLonLat, type Point2 } from '../../src/track/geo';
import type { Grandstand, Landmark, LandmarkKind, PitLane, Side, TrackDataV2, TreeSpecies } from '../../src/core/types';

interface GrandstandConfig {
  atMeters: number;
  side: Side;
  offsetMeters: number;
  lengthMeters: number;
  rows: number;
  roof: boolean;
}

interface TrackConfig extends TrackSourceConfig {
  geojson: string;
  dem: string;
  canopyRadiusCells?: number;
  profileSigmaM?: number;
  maxGrade?: number;
  biome: Biome;
  grandstands: GrandstandConfig[];
  pit: { fromMeters: number; toMeters: number; side: Side };
  sausages?: SausageOverride[];
  landmarks?: { kind: LandmarkKind; lon: number; lat: number; height: number; heading?: number }[];
}

const SPECIES_PRESETS: Record<string, { preset: string; heightMeters: number }> = {
  oak: { preset: 'Oak Medium', heightMeters: 18 },
  ash: { preset: 'Ash Medium', heightMeters: 20 },
  aspen: { preset: 'Aspen Large', heightMeters: 25 },
  pine: { preset: 'Pine Large', heightMeters: 26 },
  'palm-date': { preset: 'Palm Date', heightMeters: 9 },
  'palm-coconut': { preset: 'Palm Coconut', heightMeters: 12 },
  cactus: { preset: 'Cactus', heightMeters: 3 },
  'shrub-dry': { preset: 'Shrub Dry', heightMeters: 1.2 },
};

function cumulativeLengths(centerline: Point2[]): number[] {
  const cum = new Array<number>(centerline.length);
  cum[0] = 0;
  for (let i = 1; i < centerline.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(centerline[i][0] - centerline[i - 1][0], centerline[i][1] - centerline[i - 1][1]);
  }
  return cum;
}

// metres along the lap (negative wraps backwards) -> centerline index
function indexAtMeters(cum: number[], meters: number, lapLength: number): number {
  const target = ((meters % lapLength) + lapLength) % lapLength;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] >= target) return i;
  }
  return cum.length - 1;
}

function placeGrandstands(
  centerline: Point2[], cum: number[], lapLength: number, widthMeters: number,
  stands: GrandstandConfig[],
): Grandstand[] {
  return stands.map((s) => {
    const i = indexAtMeters(cum, s.atMeters, lapLength);
    const [px, pz] = centerline[i];
    const [nx, nz] = centerline[(i + 1) % centerline.length];
    const dx = nx - px;
    const dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const sign = s.side === 'right' ? 1 : -1;
    const dist = widthMeters / 2 + s.offsetMeters;
    // right-hand normal of the track direction
    const x = px + ((sign * -dz) / len) * dist;
    const z = pz + ((sign * dx) / len) * dist;
    const yaw = Math.atan2(-(px - x), -(pz - z));
    return { x, z, yaw, lengthMeters: s.lengthMeters, rows: s.rows, roof: s.roof };
  });
}

function buildTrackV2(config: TrackConfig): { data: TrackDataV2; droppedEscapeRoads: number } {
  const geojson = JSON.parse(
    readFileSync(join('assets/source/tracks', `${config.geojson}.geojson`), 'utf8'),
  ) as GeoJsonLineFeatureCollection;
  const dem = JSON.parse(readFileSync(config.dem, 'utf8')) as DemGrid;
  const grid = removeCanopy(dem, config.canopyRadiusCells ?? 2);

  const base = buildTrackData(geojson, config);
  const centerline = base.centerline;
  const origin = bboxCenter(geojson.features[0].geometry.coordinates);
  const lapLength = polylineLength(centerline, true);
  const cum = cumulativeLengths(centerline);

  const spacing = lapLength / centerline.length;
  const smoothed = smoothProfile(centerlineHeights(grid, centerline, origin), spacing, config.profileSigmaM ?? 60);
  // Grade is Δh per actual segment run, so the shortest segment binds the uniform clamp
  let minRun = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const [x, z] = centerline[i];
    const [nx, nz] = centerline[(i + 1) % centerline.length];
    minRun = Math.min(minRun, Math.hypot(nx - x, nz - z));
  }
  const limited = limitGrade(smoothed, minRun, config.maxGrade ?? 0.08);
  const startHeight = limited[0];
  const elevation = limited.map((h) => h - startHeight);
  const kerbs = detectKerbs(centerline);
  const gravelPolygons = loadGravelPolygons(
    join('assets/source/osm', `${config.id}-areas.json`),
    origin,
  );
  const runoffs = detectRunoffs(centerline, gravelPolygons, config.widthMeters / 2, kerbs);
  const corners = classifyCorners(centerline);
  const paved = applyPavedRunoffs(centerline, runoffs, corners);
  const parallel = analyzeParallel(centerline, config.widthMeters);
  const kerbsFinal = parallel.any ? stripParallel(kerbs, parallel) : kerbs;
  const runoffsFinal = parallel.any ? stripParallel(paved, parallel) : paved;
  // from/to meters are relative to the start line (centerline index 0)
  const pit: PitLane = {
    ...clipPitRange(centerline, 0, config.pit.fromMeters, config.pit.toMeters, 2, config.id),
    side: config.pit.side,
  };
  const barriers = applyMedianWalls(
    applyFoamBarriers(
      layoutBarriers(centerline, config.widthMeters, kerbsFinal, runoffsFinal, pit),
      corners,
    ),
    parallel,
    centerline.length,
  );
  const escapeRoads = detectEscapeRoads(centerline);
  const boards = buildBoards(centerline, config.widthMeters, barriers);
  const maxBarrierOffset = Math.max(...barriers.map((b) => b.offsetMeters));
  const terrain = buildTerrain(grid, centerline, elevation, origin, config.widthMeters, maxBarrierOffset);
  const biome = biomeFor(config.environment ?? 'parkland', config.biome);
  const trees = placeTrees(config.id, centerline, terrain, barriers, biome);
  const grandstands = placeGrandstands(centerline, cum, lapLength, config.widthMeters, config.grandstands);
  const sausages = buildSausages(centerline, config.widthMeters, config.sausages);
  const treeSpecies: TreeSpecies[] = biome.species.map((sp) => ({
    name: sp.name,
    preset: SPECIES_PRESETS[sp.name].preset,
    heightMeters: SPECIES_PRESETS[sp.name].heightMeters,
  }));

  const landmarks: Landmark[] = (config.landmarks ?? []).map((l) => {
    const [[x, z]] = projectLonLat([[l.lon, l.lat]], origin);
    const out: Landmark = { kind: l.kind, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, height: l.height };
    if (l.heading !== undefined) out.heading = l.heading;
    return out;
  });

  const data: TrackDataV2 = {
    ...base,
    version: 2,
    environment: config.environment ?? 'parkland',
    elevation,
    kerbs: kerbsFinal,
    runoffs: runoffsFinal,
    barriers,
    boards,
    escapeRoads,
    terrain,
    treeSpecies,
    trees,
    grandstands,
    pit,
    sausages,
    source: { ...base.source, dem: 'Copernicus GLO-30' },
  };
  if (landmarks.length > 0) data.landmarks = landmarks;
  if (parallel.any) {
    data.halfWidthLeft = parallel.halfLeft;
    data.halfWidthRight = parallel.halfRight;
  }
  const trimmed = trimEscapeRoads(data);
  data.escapeRoads = trimmed.roads;
  clampTerrainBelowStrips(data.terrain, buildTrackSurfaces(data));
  return { data, droppedEscapeRoads: trimmed.dropped };
}

const TRACKS = JSON.parse(
  readFileSync('tools/track-builder/tracks.json', 'utf8'),
) as TrackConfig[];

mkdirSync('public/tracks', { recursive: true });
const only = process.argv.slice(2);
for (const track of TRACKS) {
  if (only.length && !only.includes(track.id)) continue;
  const { data, droppedEscapeRoads } = buildTrackV2(track);
  const dev = Math.abs(data.lengthMeters - data.officialLengthMeters) / data.officialLengthMeters;
  if (dev > 0.01) {
    console.error(`${track.id}: length deviation ${(dev * 100).toFixed(2)}% exceeds 1%`);
    process.exitCode = 1;
  }
  writeFileSync(`public/tracks/${track.id}.json`, JSON.stringify(data));
  console.log(
    `${track.id}: ${data.centerline.length} points, ${data.lengthMeters} m (official ${data.officialLengthMeters} m, deviation ${(dev * 100).toFixed(2)}%), ` +
    `${data.trees.reduce((s, t) => s + t.data.length / 4, 0)} trees, ` +
    `${data.escapeRoads?.length ?? 0} escape roads (${droppedEscapeRoads} dropped)`,
  );
}
