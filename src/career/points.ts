import type { GridRule, PointsTable, SessionKind, SessionSpec, WeekendFormat } from './types';

const KINDS: ReadonlySet<string> = new Set<SessionKind>(['practice', 'qualifying', 'sprint', 'race']);
const GRIDS: ReadonlySet<string> = new Set<GridRule>(['qualifying', 'reverse-top8', 'sprint-result']);

function asRecord(json: unknown, prefix: string): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`${prefix}: id`);
  }
  return json as Record<string, unknown>;
}

export function parsePointsTable(json: unknown): PointsTable {
  const P = 'Invalid points table';
  const obj = asRecord(json, P);
  if (typeof obj.id !== 'string' || obj.id.length === 0) throw new Error(`${P}: id`);
  const raw = obj.positions;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${P}: positions`);
  const positions: number[] = [];
  let prev = Infinity;
  for (const p of raw as unknown[]) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > prev) {
      throw new Error(`${P}: positions`);
    }
    positions.push(p);
    prev = p;
  }
  const table: PointsTable = { id: obj.id, positions };
  if (obj.fastestLap !== undefined) {
    const fl = obj.fastestLap;
    if (typeof fl !== 'object' || fl === null || Array.isArray(fl)) {
      throw new Error(`${P}: fastestLap`);
    }
    const f = fl as Record<string, unknown>;
    if (typeof f.points !== 'number' || !Number.isFinite(f.points) || f.points < 0) {
      throw new Error(`${P}: fastestLap`);
    }
    if (typeof f.maxPosition !== 'number' || !Number.isInteger(f.maxPosition) || f.maxPosition < 1) {
      throw new Error(`${P}: fastestLap`);
    }
    table.fastestLap = { points: f.points, maxPosition: f.maxPosition };
  }
  return table;
}

function parseSession(json: unknown, tables: Record<string, PointsTable>): SessionSpec {
  const F = 'Invalid weekend format';
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`${F}: kind`);
  const obj = json as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== 'string' || !KINDS.has(kind)) throw new Error(`${F}: kind`);
  if (obj.grid !== undefined && (typeof obj.grid !== 'string' || !GRIDS.has(obj.grid))) {
    throw new Error(`${F}: grid`);
  }
  const spec: SessionSpec = { kind: kind as SessionKind };
  if (kind === 'practice' || kind === 'qualifying') {
    if (obj.laps !== undefined) throw new Error(`${F}: laps`);
    if (typeof obj.minutes !== 'number' || !Number.isFinite(obj.minutes) || obj.minutes <= 0) {
      throw new Error(`${F}: minutes`);
    }
    spec.minutes = obj.minutes;
  } else {
    if (typeof obj.laps !== 'number' || !Number.isInteger(obj.laps) || obj.laps < 1) {
      throw new Error(`${F}: laps`);
    }
    if (typeof obj.points !== 'string' || !Object.prototype.hasOwnProperty.call(tables, obj.points)) {
      throw new Error(`${F}: points`);
    }
    spec.laps = obj.laps;
    spec.points = obj.points;
    spec.grid = (obj.grid as GridRule | undefined) ?? 'qualifying';
  }
  if (obj.polePoints !== undefined) {
    if (kind !== 'qualifying') throw new Error(`${F}: polePoints`);
    if (typeof obj.polePoints !== 'number' || !Number.isFinite(obj.polePoints) || obj.polePoints < 0) {
      throw new Error(`${F}: polePoints`);
    }
    spec.polePoints = obj.polePoints;
  }
  return spec;
}

export function parseWeekendFormat(json: unknown, tables: Record<string, PointsTable>): WeekendFormat {
  const F = 'Invalid weekend format';
  const obj = asRecord(json, F);
  if (typeof obj.id !== 'string' || obj.id.length === 0) throw new Error(`${F}: id`);
  if (typeof obj.name !== 'string' || obj.name.length === 0) throw new Error(`${F}: name`);
  const raw = obj.sessions;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${F}: sessions`);
  return {
    id: obj.id,
    name: obj.name,
    sessions: (raw as unknown[]).map((s) => parseSession(s, tables)),
  };
}

export function pointsFor(table: PointsTable, position: number, classified: boolean, fastestLap: boolean): number {
  if (!classified || !Number.isInteger(position) || position < 1) return 0;
  let pts = table.positions[position - 1] ?? 0;
  const fl = table.fastestLap;
  if (fastestLap && fl !== undefined && position <= fl.maxPosition) pts += fl.points;
  return pts;
}
