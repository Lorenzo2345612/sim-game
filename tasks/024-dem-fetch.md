# 024 — Fetch DEM windows for the three tracks

Status: pending
Phase: 1
Depends on: 023
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`npm run fetch:dem` downloads small elevation windows (Copernicus GLO-30) around Monza, Spa and Silverstone into committed JSON files.

## Context

Verified facts in `ai/guides/phase1.md` "Verified facts": tile naming by SW corner, URL pattern, COG with HTTP range requests (read only a window, never whole 44 MB tiles). Tile is 3600×3600 px, 1/3600° per pixel, north-up. GeoJSON sources are in `assets/source/tracks/` (`it-1922`→monza, `be-1925`→spa, `gb-1948`→silverstone). Use `projectLonLat`/`unprojectXZ` from `src/track/geo.ts` to turn the +600 m margin into degrees.

## Files

- `tools/dem/fetchDem.ts` — create
- `package.json` — modify — devDependency `geotiff@3.0.5` (exact), script `"fetch:dem": "tsx tools/dem/fetchDem.ts"`
- `assets/source/dem/{monza,spa,silverstone}.json` — create by running the script (commit them)
- `tests/unit/acceptance/024-dem-fetch.test.ts` — create by the acceptance role

## Steps

1. Exports from `fetchDem.ts` (guard the CLI part so importing does not run network code):
```ts
export type Bbox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
export interface DemGrid { lon0: number; lat0: number; dLon: number; dLat: number; rows: number; cols: number; heights: number[] }
export interface RawWindow extends Omit<DemGrid, 'heights'> { heights: ArrayLike<number> }
export type DemReader = (bbox: Bbox) => Promise<RawWindow>;
export function demTileName(lon: number, lat: number): string;   // "N45_00_E009_00", "W002" for negative lon
export function demTileUrls(bbox: Bbox): string[];               // one URL per tile touched by bbox
export function writeDemGrid(reader: DemReader, bbox: Bbox, outPath: string): Promise<DemGrid>;
```
2. `DemGrid`: `lon0/lat0` = centre of the north-west cell; `dLon`/`dLat` positive degrees per cell; `heights` row-major north→south (row 0 = northernmost), west→east, metres, rounded to 0.1.
3. `writeDemGrid` calls the reader, copies to a plain `DemGrid`, writes JSON (creating directories) and returns it.
4. CLI: for each of the three tracks compute the GeoJSON bbox, expand by 600 m, read the window with `geotiff` (`fromUrl` + `readRasters({ window })`), write `assets/source/dem/<id>.json`. If the bbox spans two tiles, fail with a clear error.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | — | `demTileName(9.28, 45.62)` / `(5.97, 50.43)` / `(-1.02, 52.07)` | `N45_00_E009_00` / `N50_00_E005_00` / `N52_00_W002_00` |
| AT2 | bbox [lonMin, latMin, lonMax, latMax] crossing no tile edge | `demTileUrls(bbox)` | exactly 1 URL with the Copernicus pattern from ai/guides/phase1.md |
| AT3 | a fake raster reader returning a 3×4 window | `writeDemGrid` | JSON `{lon0, lat0, dLon, dLat, rows: 3, cols: 4, heights}` with heights row-major north→south and lon0/lat0 = north-west cell centre |
| AT4 | committed files | read `assets/source/dem/monza.json`, `spa.json`, `silverstone.json` | each exists, covers its track bbox + 600 m, heights within 50–700 m, no NaN |

## Acceptance criteria

- [ ] Three JSON files committed, each < 2 MB.
- [ ] Acceptance tests pass (unit rows without network).

## Verification

```
npm run typecheck
npm run lint
npm test
```
npm run fetch:dem

## Out of scope

- Sampling/interpolation (task 025); other data sources; tiles spanning edges.
