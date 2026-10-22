# 339 — DRS zones from the track

Status: pending
Phase: 7
Depends on: 338
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Derive DRS zones (with detection points) from the existing aero zones of a track.

## Context

Design: `docs/design/ow-ladder.md`. `deriveAeroZones` (`src/track/aeroZones.ts`) finds straights >= 300 m as `AeroZone {start,end}`; DRS zones reuse them. Track JSON may later carry hand-placed `drsZones`; this task only parses an optional override array.

## Files

- `src/track/drsZones.ts` — create
- `tests/unit/acceptance/339-drs-zones-from-track.test.ts` — create

## Steps

```ts
import type { AeroZone } from './aeroZones';
import type { DrsZone } from '../race/drs'; // 338
export const DRS_DETECTION_LEAD_M = 120;
export const DRS_MAX_ZONE_M = 900;
export const DRS_MAX_ZONES = 3;
export function deriveDrsZones(aero: readonly AeroZone[], lapLength: number): DrsZone[];
export function parseDrsZones(raw: unknown, lapLength: number): DrsZone[];
```
1. Per aero zone: `start` same, `end` = min(end, start + 900), `detection` = (start − 120) wrapped into [0, lapLength).
2. Keep the 3 longest zones (post-cap length), sorted by `start` ascending.
3. `parseDrsZones`: array of `{detection,start,end}`, all finite, detection/start in [0, lapLength), `start < end <= lapLength`, at most 3; otherwise throw `Error('Invalid drs zones: <field>')`.

Conventions: wrap with ((x % L) + L) % L; length ties keep the earlier start; empty input gives []; input not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/339-drs-zones-from-track.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | aero [{100,700}], lapLength 3000 | derive | [{detection 2980, start 100, end 700}] |
| AT2 | aero [{50,1250}], lapLength 3000 | derive | end 950, detection 2930 |
| AT3 | aero 4 zones of lengths 400, 500, 600, 700 at increasing starts | derive | the 500, 600, 700 zones in start order |
| AT4 | aero [] | derive | [] |
| AT5 | raw with start >= end / NaN / 4 entries / non-array | parseDrsZones | each throws `Invalid drs zones` |

## Acceptance criteria

- [ ] All ATs pass; no `three` import.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Reading `drsZones` from track JSON files; DRS state (338); detection by RaceGame (341).
