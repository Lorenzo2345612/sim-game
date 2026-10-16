# 181 — Tools: `track:locate` and `check:styles`

Status: pending
Phase: 1
Depends on: 179
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Two CLI tools for authoring style files: `track:locate` maps lat/lon to a centerline index; `check:styles` validates every `public/tracks/*.style.json`.

## Context

Design: `docs/design/track-style.md` ("Tooling", "Open notes"). Track JSON has no geo origin. The builder projects with origin `bboxCenter` of the geojson coordinates (`tools/track-builder/buildTrack.ts`: `bboxCenter(geojson.features[0].geometry.coordinates)`; the `reverse` flag and the dropped closing point do not change the bbox, so the origin is independent of them). Config: `tools/track-builder/tracks.json` entries have `id` and `geojson` (file `assets/source/tracks/<geojson>.geojson`). Use `src/track/geo.ts` (`bboxCenter`, `projectLonLat`, `unprojectXZ`, `LonLat`, `Point2`). Tools may import `src/core`, `src/track`.

## Files

- `tools/track-style/locate.ts` — create.
- `tools/track-style/checkStyles.ts` — create.
- `package.json` — modify: scripts `"track:locate": "tsx tools/track-style/locate.ts"`, `"check:styles": "tsx tools/track-style/checkStyles.ts"`.
- `tests/unit/acceptance/181-track-style-tools.test.ts` — create (acceptance role).

## Steps

```ts
// locate.ts
export function trackOrigin(id: string): LonLat; // throws Error containing the id if unknown
export function locateIndex(track: { centerline: Point2[] }, x: number, z: number): { index: number; side: 'left' | 'right'; distanceMeters: number };
// checkStyles.ts
export function checkStyles(dir: string): { id: string; errors: string[]; warnings: string[] }[];
```

- `locateIndex`: nearest centerline vertex by Euclidean distance (no segment projection); ties → lowest index; `distanceMeters` unrounded. Side: sign of the cross product of the forward direction `centerline[(i+1) % n] - centerline[i]` and the vector vertex→point, in the world frame (Y up, +X east, -Z north, car faces -Z): forward `+X` with the point at `+Z` is `'right'`; exactly 0 → `'right'`.
- `locate.ts` CLI (`<id> <lat> <lon>`; runs only when executed directly, not on import): projects the point with `trackOrigin(id)`, reads `public/tracks/<id>.json`, prints a human line then, as the LAST stdout line, `JSON.stringify({index, side, distanceMeters})`. Unknown id or bad args → message with the id on stderr, exit code 1.
- `checkStyles(dir)`: for every `*.style.json` in `dir`, id = file name without `.style.json`; pointCount from `<dir>/<id>.json` `centerline.length`; missing track json → error `no <id>.json`; invalid JSON → error containing `JSON`; else `parseTrackStyle` errors/warnings. CLI (`[dir]`, default `public/tracks`): prints one line per message as `<id>: <message>` on stdout; exit 1 if any error or warning, else 0. Sorted by id.

Conventions: distances in metres; ties lowest index; empty centerline → throw; no input mutation.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture `STRAIGHT`: a TrackDataV2 with centerline `[i*10, 0]` for i = 0..99, widthMeters 12, flat elevation, no kerbs/runoffs/barriers unless the row adds them, pit `{start: 10, end: 30, side: 'right'}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | STRAIGHT | `locateIndex(STRAIGHT, 152, -30)` | `{index: 15, side: 'left', distanceMeters: 30.07 ± 0.01}` |
| AT2 | STRAIGHT | `locateIndex(STRAIGHT, 152, 30)` | side 'right', index 15 |
| AT3 | monza | `trackOrigin('monza')` | [lon, lat] within 0.05° of [9.28, 45.62] |
| AT4 | monza centerline[100] unprojected with `trackOrigin('monza')` | `npm run -s track:locate -- monza <lat> <lon>` | exit 0; stdout last line parses as JSON with index 100 ± 1 and distanceMeters < 1 |
| AT5 | unknown id `nope` | track:locate | exit code ≠ 0, stderr contains `nope` |
| AT6 | temp dir with `t.json` (10-point centerline) and `t.style.json` = `{"version":1}` | `npx tsx tools/track-style/checkStyles.ts <dir>` | exit 0 |
| AT7 | same with `{"version":1,"foo":1}` | check | exit 1; output contains `t` and `foo` |
| AT8 | same with `{"version":1,"barriers":{"ranges":[{"start":0,"end":10}]}}` (index 10 ≥ 10 points) | check | exit 1; output contains `barriers.ranges[0]` |
| AT9 | dir with `u.style.json` and no `u.json` | check | exit 1; output contains `u` |
| AT10 | repo as-is | `npm run -s check:styles` | exit 0 |

## Acceptance criteria

- [ ] All AT rows pass; both npm scripts exist.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Writing style files, changing the builder or `tracks.json`, snapping to segments, new npm dependencies.
