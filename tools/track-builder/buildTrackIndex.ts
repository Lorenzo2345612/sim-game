import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TrackChoice } from '../../src/ui/menu';

export interface TrackIndexEntry {
  id: string;
  name: string;
  country: string;
  lengthKm: number;
  outline: Array<[number, number]>;
}

const MAX_OUTLINE_POINTS = 128;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toPoint(value: unknown): [number, number] {
  const pair = value as [unknown, unknown];
  return [Number(pair[0]), Number(pair[1])];
}

function readCenterline(track: Record<string, unknown>): Array<[number, number]> {
  const raw = track.centerline;
  if (!Array.isArray(raw) || raw.length < 3) {
    throw new Error('Invalid track JSON: missing centerline');
  }
  return raw.map(toPoint);
}

function readLengthMeters(track: Record<string, unknown>): number {
  const official = track.officialLengthMeters;
  if (typeof official === 'number') return official;
  const length = track.lengthMeters;
  if (typeof length === 'number') return length;
  throw new Error('Invalid track JSON: missing length');
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

// Iterative Ramer–Douglas–Peucker; keeps the first and last point.
function rdp(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const segment = stack.pop() as [number, number];
    const [start, end] = segment;
    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    let maxDist = -1;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const dist = distanceToSegment(points[i][0], points[i][1], ax, ay, bx, by);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function decimate(points: Array<[number, number]>, target: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < target; i += 1) {
    out.push(points[Math.round((i * (points.length - 1)) / (target - 1))]);
  }
  return out;
}

function simplifyOutline(points: Array<[number, number]>): Array<[number, number]> {
  let epsilon = 1;
  let out = rdp(points, epsilon);
  while (out.length > MAX_OUTLINE_POINTS && epsilon < 1e6) {
    epsilon *= 2;
    out = rdp(points, epsilon);
  }
  return out.length > MAX_OUTLINE_POINTS ? decimate(out, MAX_OUTLINE_POINTS) : out;
}

// Top-down outline (x right, z down) scaled uniformly into [0,1]² and centred.
function normalizeOutline(points: Array<[number, number]>): Array<[number, number]> {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  if (extentX === 0 || extentZ === 0) {
    throw new Error('Invalid track JSON: degenerate outline');
  }
  const scale = 1 / Math.max(extentX, extentZ);
  const offsetX = (1 - extentX * scale) / 2;
  const offsetZ = (1 - extentZ * scale) / 2;
  return points.map(([x, z]): [number, number] => [
    round3((x - minX) * scale + offsetX),
    round3((z - minZ) * scale + offsetZ),
  ]);
}

export function buildTrackIndexEntry(track: unknown, meta: { country: string }): TrackIndexEntry {
  if (!track || typeof track !== 'object') throw new Error('Invalid track JSON: not an object');
  const data = track as Record<string, unknown>;
  const id = data.id;
  const name = data.name;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') {
    throw new Error('Invalid track JSON: missing id or name');
  }
  const centerline = readCenterline(data);
  return {
    id,
    name,
    country: meta.country,
    lengthKm: round3(readLengthMeters(data) / 1000),
    outline: normalizeOutline(simplifyOutline(centerline)),
  };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface TrackConfig {
  id: string;
  country?: string;
}

// src/ui/menu.ts imports its CSS, which Node cannot load; serve it as an empty module.
const CSS_STUB_HOOK =
  'export async function load(url, context, nextLoad) {' +
  'if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };' +
  'return nextLoad(url, context);' +
  '}';

async function loadTrackChoices(): Promise<TrackChoice[]> {
  register('data:text/javascript,' + encodeURIComponent(CSS_STUB_HOOK));
  const { TRACK_CHOICES } = await import('../../src/ui/menu');
  return TRACK_CHOICES;
}

async function main(): Promise<void> {
  const config = JSON.parse(readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8')) as TrackConfig[];
  const countryById = new Map(config.map((entry) => [entry.id, entry.country]));
  const entries: TrackIndexEntry[] = [];
  for (const choice of await loadTrackChoices()) {
    const country = countryById.get(choice.id);
    if (typeof country !== 'string' || country === '') {
      throw new Error(`tracks.json: missing country for ${choice.id}`);
    }
    const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${choice.id}.json`), 'utf8')) as unknown;
    entries.push(buildTrackIndexEntry(track, { country }));
  }
  writeFileSync(join(ROOT, 'public', 'tracks', 'index.json'), `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`wrote ${entries.length} tracks to public/tracks/index.json`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
