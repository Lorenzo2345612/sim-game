# 237 — Track QA report

Status: pending
Phase: 1
Depends on: 235, 236
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11

## Goal

`npm run track:qa -- <id|all> [--out dir]` measures, for each track, how well grandstands and pit pieces clear the road and the ground, how well the centerline matches OSM, and how far barriers are from the ground, and writes a JSON report with ok/warn/fail checks.

## Context

Design: `docs/design/track-fidelity.md` ("237"). Not parallel with 238: both modify `package.json`. Uses `pitBuildingPieces` (236), `footprintGround` (233), `grandstandFootprint` (234, `src/track/placement.ts`), `barrierRuns` (`src/track/barrierPath.ts`, `ground` field from 235), `buildTrackSurfaces` (`src/track/surfaces.ts`), `projectLonLat`/`unprojectXZ`/`LonLat` (`src/track/geo.ts`), `trackOrigin(id)` (`tools/track-style/locate.ts`, = `bboxCenter` of the track geojson). No `three` imports.

## Files

- `tools/track-qa/report.ts` — create: exports `qaReport`, types, CLI (guard like `tools/track-style/locate.ts`).
- `package.json` — modify: script `"track:qa": "tsx tools/track-qa/report.ts"`.
- `tests/unit/acceptance/237-track-qa-report.test.ts` — create; edge tests by tester-pre.

## Steps

```ts
export interface QaCheck { name: string; level: 'ok' | 'warn' | 'fail'; detail: string }
export interface QaReport {
  stands: { index: number; clearance: number; relief: number }[];
  pit: { clearance: number; relief: number }[];
  layout: { rmsMeters: number; maxMeters: number } | null;
  barrierMaxGap: number;
  checks: QaCheck[];
}
export function qaReport(track: TrackDataV2, osmWays: { ways: { coords: [number, number][] }[] } | null, origin: LonLat): QaReport
```

1. `stands[i]` = `track.grandstands[i]` (config only, not style extras); footprint `grandstandFootprint(g)` at `(g.x, g.z, g.yaw)`. `pit[k]` = `pitBuildingPieces(track)[k]` with footprint `[−length/2, length/2] × [−depth/2, depth/2]`.
2. Footprint samples: grid of spacing ≤ 2 m including edges and corners (as `footprintGround`). `relief` = `footprintGround` max − min. `clearance` = 0 if any sample lies inside a triangle (XZ projection) of a `buildTrackSurfaces` strip whose surface is not `grass` (asphalt, kerb, runoff, gravel), else the minimum distance from the samples to any strip vertex.
3. `layout` = null when `osmWays` is null or has no ways; else rms and max over all centerline points of the distance to the nearest OSM way polyline (ways projected with `projectLonLat(coords, origin)`, polyline segments, not vertices).
4. `barrierMaxGap` = max `|y − ground|` over all vertices of `barrierRuns` for both sides (0 when no barriers).
5. `checks` (always present, name prefixes `stand`, `pit`, `layout`, `barrier`): stand or pit `clearance < 2` → `fail`; `relief > 3` → `warn`; layout `rmsMeters > 5` → `warn`, `> 15` → `fail`; otherwise `ok`. One check per stand and per pit piece (`stand <i>`, `pit <k>`) plus one `layout` and one `barrier`.
6. CLI `track:qa -- <id|all> [--out dir]`: ids from `tools/track-builder/tracks.json`; track from `public/tracks/<id>.json` (`parseTrackData` if present, else JSON.parse); ways from `assets/source/osm/<id>.json` (missing → null); writes `<out>/<id>.json` = `{ id, ...QaReport }` (default `.ai/qa`, created); prints `<id> ok|warn|fail <n fails>` (worst level over checks); exit code 1 if any fail, unknown id exits 1.

Conventions: distances in metres, no rounding; `< 2` strict, `> 3` strict, `> 5`/`> 15` strict; a sample exactly on a triangle edge counts as inside; invalid input (empty centerline) throws `RangeError`; inputs not mutated.

Fixtures: `STRAIGHT`: centerline `[i*10, 0]`, i = 0..99, widthMeters 12, elevation 0, no kerbs/runoffs/barriers/terrain, pit `{start: 10, end: 30, side: 'right'}`. `WALLED(h)`: `STRAIGHT` with barriers `[{start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8}]`, terrain `FLAT(h)` (same grid as `RAMP`: `{originX: 495, originZ: 0, sizeX: 1100, sizeZ: 200, cols: 20, rows: 10}`, every height `h`), boards `[{index: 50, side: 'right', offset: 8, label: 100}]`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `STRAIGHT` + grandstand `{x: 100, z: 40, yaw: 0, lengthMeters: 20, rows: 10}` | `qaReport(track, null, [9, 45])` | stands[0].clearance = 34 (±0.5); no fail check for it; layout null |
| AT2 | `STRAIGHT` + grandstand at `z: 3` | qaReport | stands[0].clearance 0; a check with level `fail` whose name contains `stand` |
| AT3 | `STRAIGHT`, ways = the centerline unprojected at origin [9, 45] (`unprojectXZ`) | qaReport | layout.rmsMeters < 0.01 |
| AT4 | ways shifted 10 m (every point z − 10 before unprojecting) | qaReport | layout.rmsMeters 10 (±0.1); a `warn` layout check, no layout fail |
| AT5 | `WALLED(−3)` | qaReport | barrierMaxGap 3 (±1e-6) |
| AT6 | CLI `npm run track:qa -- monza --out <tmp>` | run | `<tmp>/monza.json` parses with keys id, stands, pit, layout, barrierMaxGap, checks; stdout has a line starting `monza ` |
| AT7 | source `tools/track-qa/report.ts` | read | no `from 'three'` |

## Acceptance criteria

- [ ] Table rows pass; `npm run track:qa -- all` runs on the 19+ real tracks and writes one JSON per id.
- [ ] `package.json` has `track:qa` exactly as in Files.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Fixing any failing track; style extra grandstands, trackside props or board QA; screenshots (238); an e2e run.

## Planner-authorised test edits

None: no protected test reads `package.json` scripts other than their own or the files touched here.

## Questions for the planner

- Report covers config grandstands only (style `extraGrandstands` need the style file and are skipped). Confirm.
- AT6 spawns the CLI via `child_process` inside the Vitest test (like task 232); it needs `assets/source` files present.

## Planner answers

- Confirmed: config grandstands only; style `extraGrandstands` are out of scope.
- Confirmed: AT6 spawns the CLI via `child_process`; `assets/source` is in the repo.
