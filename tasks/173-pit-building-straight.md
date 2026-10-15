# 173 — Pit building only along the straight

Status: pending
Phase: 1
Depends on: 106
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The pit building follows only a straight stretch next to the start line and never sits on or across the track.

## Context

User report: in Lusail the pit building sits in the middle of the track around turn 2. `createPitBuilding` in `src/render/pitAndStart.ts` draws one straight box along the chord from `centerline[pit.start]` to `centerline[pit.end]`. The range comes from `tools/track-builder/tracks.json` `pit: {fromMeters,toMeters,side}` (lusail -290..+290) and in 9 tracks spans curves (max centerline-to-chord distance: lusail 128 m, singapore 175, spielberg 175, braselton 227, budapest 147, baku 111, mexico 85, daytona 70, lasvegas 63, fontana 136, cleveland 54; monza/spa/silverstone/bahrain/sepang/elkhart ≤ 6 m). Fix is builder-side so data stays right for later pit lanes. Start line = centerline index 0.

## Files

- `tools/track-builder/pitRange.ts` — create — `clipPitRange`.
- `tools/track-builder/buildTrack.ts` — modify — use it where `pit.start/end` are computed (~line 121).
- `src/render/pitAndStart.ts` — modify — building y.
- `public/tracks/*.json` — modify — regenerate with `npm run build:tracks` (per-track command if the repo uses one), commit.
- `tests/unit/acceptance/173-pit-range.test.ts`, `tests/e2e/acceptance/173-pit-building.spec.ts` — create (acceptance worker).

## Steps

```ts
export function clipPitRange(
  centerline: Array<[number, number]>, startIndex: number,
  fromMeters: number, toMeters: number, maxChordDevM = 2,
): { start: number; end: number };
```

1. Begin at `startIndex`; extend backward and forward (wrap-around indices) while the max distance of covered centerline points from the chord (first to last covered point) stays ≤ `maxChordDevM`, and within `fromMeters` (≤ 0) / `toMeters` (≥ 0) along the centerline.
2. Minimum result length 120 m. If the start line sits in a curve so the window is shorter, slide the window to the nearest straight of ≥ 120 m within ±600 m of the start and `console.warn` with the track id/context; if none exists, throw.
3. `buildTrack.ts` stores the returned indices as `pit.start/end`; `side` unchanged.
4. `createPitBuilding`: building base y = min of (elevation over the pit range, bilinear terrain height from `track.terrain` at the footprint corners and edge midpoints — same grid convention as trackColliders' heightfield) − 0.3 m, keeping the roof height above the highest of those samples (no floating, user saw it floating in Baku). Footprint logic otherwise unchanged.
5. Rebuild all `public/tracks/*.json`; only `pit` (and pit-dependent barrier data) may change.

Conventions: distances in metres; chord deviation inclusive (`<=`); indices wrap modulo length, `start` may be greater than `end`; invalid input (empty centerline, startIndex out of range) throws; input not mutated; tie-break when sliding: smaller |offset| from the start line.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit: synthetic closed centerline (1 m spacing): 400 m straight, then 90° arc radius 50 m, …; start index at 300 m along the straight | `clipPitRange(cl, 300, -290, 290)` | end index stops before the arc (chord deviation of covered points ≤ 2 m); start = index 10 (−290 m) |
| AT2 | unit: every `public/tracks/*.json` with `pit` | measure max distance of centerline points between pit.start and pit.end from their chord | ≤ 2.0 m for every track |
| AT3 | unit: every `public/tracks/*.json` with `pit` | pit range length along centerline | ≥ 120 m |
| AT4 | unit: every track; building footprint = chord rectangle offset to `side` by widthMeters/2 + EDGE_OFFSET … + depth (as in pitAndStart.ts) | distance from footprint to every centerline point outside the pit range | ≥ widthMeters/2 + 1 m (the building never overlaps the track) |
| AT5 | e2e `/?track=lusail` | ready | `sceneStats().pitBuildings` === 1 |
| AT6 | unit: every `public/tracks/*.json` with `pit` and `terrain` | `createPitBuilding(track)` | the `pit` mesh's world bounding-box min y ≤ min(elevation over the pit range, terrain height at the footprint corners) + 0.01 m |

## Acceptance criteria

- [ ] All AT rows pass; all `public/tracks/*.json` regenerated and committed.
- [ ] Pit `side` values unchanged in every track.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 173-
```

## Planner-authorised test edits

AT2 forces new pit ranges on monza/spa/silverstone (old chord deviation 2.13 / 2.19 / 6.14 m). In these legacy "unchanged vs base revision" checks, exclude only the `pit` field from the comparison (delete it from both copies or drop `'pit'` from the key list); change nothing else:
- `tests/unit/acceptance/097-terrain-below-strips.test.ts` AT3 (pin)
- `tests/unit/acceptance/098-osm-runoffs.test.ts` AT5
- `tests/unit/acceptance/106-new-tracks-in-game.test.ts` AT5 (strip)
- `tests/unit/acceptance/140-paved-runoffs.test.ts` AT5
- `tests/unit/acceptance/142-kerbs-every-corner.test.ts` AT5
- `tests/unit/acceptance/155-close-parallel.test.ts` AT5
- `tests/unit/edge/142-kerbs-every-corner.post.test.ts` (key list `centerline, elevation, pit`)

In the full-object comparisons of 106 AT5 and 155 AT5, also exclude `barriers` (pit-dependent, step 5).

Leave the regenerated `public/tracks/*.json` in the worktree; the orchestrator commits them. The elkhart 1.16 % length warning from `build:tracks` is pre-existing and accepted.

## Out of scope

- Pit lane geometry, pit stops, changing `side` or the configured from/to meters in `tracks.json`.
- Building size/model changes.
