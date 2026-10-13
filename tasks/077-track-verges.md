# 077 — Add grass verges beside the track surfaces

Status: pending
Phase: 1
Depends on: nothing
Complexity: standard
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

No vertical lip beyond the outermost surface strip: a grass verge continues the surface and slopes down to the terrain, so the chassis no longer hits a 15–36 cm step coming back from grass.

## Context

The terrain heightfield (tools/track-builder/terrain.ts) is carved to track elevation − 0.15 m on an 8 m grid, leaving a lip beyond the outermost strip built by `buildTrackSurfaces`. Fix at runtime; no track JSON regeneration. `addTrackColliders` already makes one trimesh per strip mapped to `strip.surface`; verify nothing else is needed there. Guide: `ai/guides/architecture.md` (track and surface types).

## Files

- `src/track/surfaces.ts` — modify — append the verge strips.
- `src/render/trackSurfaceRenderer.ts` — modify — render 'grass'.
- `tests/unit/acceptance/077-track-verges.test.ts` — create (acceptance worker).

## Steps

1. In `buildTrackSurfaces` (signature unchanged) append after all existing strips, per side (left then right), one `'grass'` strip over the whole lap as a closed loop (`makeStrip(..., true)`), 3 vertex columns: inner, flat end, outer. Existing strips stay unchanged and in the same order.
2. Local constants in surfaces.ts (not src/core/constants.ts): `VERGE_FLAT = 6` m, `VERGE_SLOPE = 3` m, `VERGE_DROP = 0.30` m.
3. At each centerline index i, inner lateral = outermost lateral extent on that side of all other strips at i: asphalt half-width, + `KERB_WIDTH` where a kerb on that side covers i, or the runoff's outer edge (kerb offset + runoff `widthMeters`) where a runoff on that side covers i.
4. Heights: inner and flat end at y = elev(i) + 0.00; outer at y = elev(i) − 0.30. Flat end lateral = inner + 6; outer = flat end + 3.
5. Inner side of a corner: cap the outer lateral at 0.8 × local radius of curvature (circumradius of three neighbouring centerline points i−1, i, i+1); shrink the flat part first (flat end = max(inner, min(inner+6, cap−3)); outer = min(flat end + 3, cap)); never below inner. Collinear points = infinite radius = no cap.
6. uv: u = lateral/10, v = s/10 (same scale as asphalt, s cumulative from point 0).
7. Renderer: add `grass: 'grass'` to `MESH_NAME`; it loads `textures/grass/{color,normal,roughness}.jpg` through the existing non-kerb branch (same as gravel; files in public/textures/grass).

Conventions: no rounding; boundaries inclusive at segment ends exactly as kerbs/runoffs already treat them (`segmentCovers`); invalid/empty track returns [] as today; inputs not mutated; only new strips appended.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/077-track-verges.test.ts` before the coder starts. Nobody else may change these rows or tests.

Fixture: the circle helper from tests/unit/acceptance/031-track-surfaces-geometry.test.ts: R 100, N 120, width 12, flat elevation 0, right = towards the centre.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | circle, no kerbs/runoffs | buildTrackSurfaces | exactly 2 strips with surface 'grass'; left (outer side) verge vertices at radial distance 106, 112, 115 from the circle centre (± 1e-6) with y 0, 0, −0.30 |
| AT2 | circle, left kerb on indices 10..30 | same | left verge inner radius 107.2 at indices 10..30, 106 elsewhere; flat end = inner + 6; outer = inner + 9 |
| AT3 | circle, right (inner) side | same | right verge outer radial distance ≥ 100 − 0.8·100 = 20 from centre, i.e. lateral extent ≤ 80 m; with R 100 nothing is capped: inner 94, flat end 88, outer 85 |
| AT4 | public/tracks/monza.json, spa.json, silverstone.json loaded into a Rapier world with addTrackColliders | downward rays every 0.25 m along the lateral line from the centerline to the verge's outer edge at that index, both sides, every 4th centerline index; skip samples whose hit collider has surfaceOf(...) = null (barriers) and samples whose nearest centerline index is more than 25 indices from i (crossovers) | upward step (height of sample k minus sample k+1, moving outward) ≤ 0.05 m for every remaining sample |
| AT5 | strips incl. grass | createTrackSurfaceObject with a stub loadTexture | a mesh named 'grass' exists and its material map was loaded from a URL containing 'textures/grass' |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Existing surface and renderer tests still pass (existing strips unchanged).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Track-builder changes, terrain regeneration, new textures, new constants in src/core/constants.ts, changes to `addTrackColliders`, grip values for grass.
