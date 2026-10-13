# 097 — Keep the terrain below every track surface strip

Status: pending
Phase: 1
Depends on: 096, 085
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer (complex adds tester-pre and tester)

## Goal

The carved terrain never pokes through asphalt, kerbs, run-offs or verges: everywhere a strip exists the terrain heightfield is at least 0.10 m below it.

## Context

`tools/track-builder/terrain.ts` carves each terrain vertex to `elevation[nearest index] − DIP` (0.15 m). On 8 m cells this is not enough where strip heights vary faster than the grid (hairpin insides, steep Spa sections): found while verifying 096, the terrain is up to 0.59 m above gravel (Monza idx 316 left lat 21.6: terrain 4.359 vs gravel 4.321). Those spots render as grass bumps over the gravel and act as obstacles. Strips come from `buildTrackSurfaces` (`src/track/surfaces.ts`, tools may import `src/track`).

## Files

- `tools/track-builder/terrain.ts` — modify (post-carve clamp)
- `tools/track-builder/buildTrack.ts` — modify only if the strips must be passed in
- `public/tracks/monza.json`, `spa.json`, `silverstone.json` — regenerate with the builder
- `tests/unit/track/terrainBelowStrips.test.ts` — create (edge cases)

## Steps

- After the existing carve and blend, clamp: for every terrain vertex, h ≤ min(y − DIP) over all strip vertices lying in any of the (up to 4) cells that share that vertex. Bilinear interpolation inside a cell is then bounded by its corners, so the whole cell stays below its strips.
- Strips = `buildTrackSurfaces(track)` of the track being built (all surfaces incl. grass verges).
- Vertices not touching a cell with strip vertices are unchanged.
- Regenerate the three tracks (`npm run build:tracks` or the builder's existing command); no other JSON field may change.

Conventions: terrain layout unchanged (Rapier heightfield, origin = centre); deterministic output.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fixture: flat terrain at 0, one strip triangle at y −1.0 covering part of one cell | clamp | the 4 corners of that cell ≤ −1.15; vertices of cells not touching the triangle unchanged (exactly) |
| AT2 | public/tracks/monza.json, spa.json, silverstone.json | for every strip vertex and every triangle centroid from buildTrackSurfaces: terrain height at (x, z) by bilinear interpolation of the heightfield (Rapier layout) | ≤ strip y − 0.10 |
| AT3 | same tracks | compare with the previous JSON (git HEAD before the task) | only `terrain.heights` changed; every changed height decreased; centerline, elevation, kerbs, runoffs, barriers, trees identical |
| AT4 | same tracks in a Rapier world (addTrackColliders) | downward rays at every 4th index chord midpoint across asphalt/kerb/run-off/verge lateral bands every 0.5 m | the first hit is never the terrain heightfield where a strip collider exists below it |

## Acceptance criteria

- [ ] AT1–AT4 pass; all other tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Changing DIP, BLEND, grid size, strip geometry or elevation smoothing; tree placement.
