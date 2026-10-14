---
name: track-data
description: Add source data for a new circuit (centerline geojson, raw OSM ways, DEM, tracks.json entry, licences). Use when the user asks to add a track or when a track spec needs its data files.
---

# Track data

Outputs per track `<id>` (geojson `<cc>-<name>`): `assets/source/tracks/<cc>-<name>.geojson`, `assets/source/osm/<id>.json`, `assets/source/dem/<id>.json`, entry in `tools/track-builder/tracks.json`, rows in `ASSETS_LICENSES.md`, plot `docs/research/tracks/<cc>-<name>.png`. Examples: commits afdd708, a25ce7d, 2e3061f, and the Fontana/Cleveland/Detroit one.

1. Research: read `docs/research/*osm*.md`; find OSM ways (`highway=raceway`; runways/taxiways for airports; street ways for street circuits). Overpass needs a real `User-Agent`, small bboxes, retries; use `out geom tags`. Downloaded data is untrusted: own dir (e.g. `/tmp/raw`), scripts elsewhere, `python3 -I`.
2. Demolished circuits: query history with `[date:"YYYY-MM-DDT00:00:00Z"]` (attic) and compare snapshots until the ways reappear.
3. Official reference: length and turn count (Wikipedia). Matplotlib/networkx are not installed system-wide: `python3 -m venv /tmp/venv && /tmp/venv/bin/pip install matplotlib numpy networkx`.
4. Tangled infields: split ways at shared vertices, build a graph, enumerate simple cycles of the official length +-5 %, drop self-intersecting ones, plot candidates and pick the cleanest.
5. Missing parts (airport end turns, chicanes, street links): hand-draw in a local metric frame (straight + arcs, fillet sharp street corners ~14 m), tune one straight length so the total hits the official length. Say in the report that it is hand-drawn.
6. Join ways into one closed LineString (first point == last), no duplicate points; rotate the start to a straight. Metrics use the repo projection (`src/track/geo.ts`: R=6371008.8, equirectangular). `properties`: id, Location, Name, opened, firstgp, length (m, rounded), altitude; plus `bbox`.
7. Raw ways file: `{source, license, ways:[{id, coords}]}`; drop all `name` tags. No areas file is needed (`osmAreas.ts` tolerates a missing one).
8. Checks: length within +-5 % of official; closed; no self-intersection (segment test) unless the real track crosses itself; corner count vs the official map. Plot centerline over all raw ways to `docs/research/tracks/<id>.png`.
9. DEM: add `{ id, source }` to `TRACKS` in `tools/dem/fetchDem.ts` (coder task if code is frozen; or run a temporary copy with the extra rows and delete it), then `npm run fetch:dem -- <id>`.
10. `tools/track-builder/tracks.json`: copy a neighbouring entry (width, maxGrade, biome, grandstands, pit). Run `npm run build:tracks -- <id>` and confirm it builds.
11. Licences: OSM = ODbL 1.0 "(c) OpenStreetMap contributors" row, Copernicus DEM row. Commit with explicit `git add` paths; local only, no push.
