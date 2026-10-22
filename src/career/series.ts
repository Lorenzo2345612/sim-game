export interface TeamDef {
  id: string;
  name: string;
  colour: string;
  perf: number;
}

export interface EventDef {
  trackId: string;
  name: string;
}

export interface SeriesDef {
  id: string;
  name: string;
  carId: string;
  gridsSeries: string;
  formats: string[];
  teams: TeamDef[];
  calendar: EventDef[];
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const P = 'Invalid series';

function asRecord(json: unknown, field: string): Record<string, unknown> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`${P}: ${field}`);
  return json as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${P}: ${field}`);
  return value;
}

function parseTeam(json: unknown, seen: Set<string>): TeamDef {
  const t = asRecord(json, 'team');
  const id = asNonEmptyString(t.id, 'team id');
  if (seen.has(id)) throw new Error(`${P}: team id`);
  seen.add(id);
  const name = asNonEmptyString(t.name, 'team name');
  if (typeof t.colour !== 'string' || !COLOUR.test(t.colour)) throw new Error(`${P}: colour`);
  if (typeof t.perf !== 'number' || !Number.isFinite(t.perf) || t.perf < 0.9 || t.perf > 1) {
    throw new Error(`${P}: perf`);
  }
  return { id, name, colour: t.colour, perf: t.perf };
}

function parseEvent(json: unknown, trackIds: readonly string[]): EventDef {
  const e = asRecord(json, 'event');
  const trackId = asNonEmptyString(e.trackId, 'trackId');
  if (!trackIds.includes(trackId)) throw new Error(`${P}: trackId`);
  return { trackId, name: asNonEmptyString(e.name, 'event name') };
}

export function parseSeries(json: unknown, trackIds: readonly string[], formatIds: readonly string[]): SeriesDef {
  const obj = asRecord(json, 'id');
  const teamsRaw = obj.teams;
  if (!Array.isArray(teamsRaw) || teamsRaw.length < 2) throw new Error(`${P}: teams`);
  const seen = new Set<string>();
  const teams = teamsRaw.map((t) => parseTeam(t, seen));

  const calendarRaw = obj.calendar;
  if (!Array.isArray(calendarRaw) || calendarRaw.length < 1 || calendarRaw.length > 12) {
    throw new Error(`${P}: calendar`);
  }
  const calendar = calendarRaw.map((e) => parseEvent(e, trackIds));

  const formatsRaw = obj.formats;
  if (!Array.isArray(formatsRaw) || formatsRaw.length === 0) throw new Error(`${P}: formats`);
  const formats = formatsRaw.map((f) => {
    if (typeof f !== 'string' || !formatIds.includes(f)) throw new Error(`${P}: formats`);
    return f;
  });

  return {
    id: asNonEmptyString(obj.id, 'id'),
    name: asNonEmptyString(obj.name, 'name'),
    carId: asNonEmptyString(obj.carId, 'carId'),
    gridsSeries: asNonEmptyString(obj.gridsSeries, 'gridsSeries'),
    formats,
    teams,
    calendar,
  };
}
