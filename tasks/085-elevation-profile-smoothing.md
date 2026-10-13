# 085 — Smooth the track elevation profile and limit its grade

Status: pending
Phase: 1
Depends on: 079
Complexity: standard
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Asphalt elevation is smooth and gently rolling instead of following DEM noise: Monza and Silverstone max grade ≤ 4 %, Spa ≤ 20 %.

## Context

Today (`buildTrack.ts`) the profile is a 25-point moving average, leaving Monza at 15.9 % max grade with 14 sign flips per km, Silverstone 6.1 %, Spa 23.9 %. Offline track-builder only. `elevationProfile` is pinned by `tests/unit/acceptance/025-dem-elevation-profile.test.ts`: keep it intact and add new functions. Centerline points are not exactly uniform: pass `spacingM = lapLength / centerline.length`.

## Files

- `tools/track-builder/elevation.ts` — modify — add `smoothProfile`, `limitGrade`.
- `tools/track-builder/buildTrack.ts` — modify — use the new pipeline; add optional `profileSigmaM?: number` and `maxGrade?: number` to `TrackConfig`.
- `tools/track-builder/tracks.json` — modify — `"maxGrade": 0.04` for monza and silverstone, `0.20` for spa.
- `public/tracks/*.json` — regenerate with `npm run build:tracks` and commit.
- `tests/unit/acceptance/085-elevation-profile-smoothing.test.ts` — create (acceptance worker).

## Steps

1. Export `function smoothProfile(raw: number[], spacingM: number, sigmaM: number): number[]`: closed-loop (wrap-around) gaussian convolution, kernel truncated at ±3σ (in samples: `ceil(3σ/spacingM)`), normalised to sum 1. Returns a new array.
2. Export `function limitGrade(profile: number[], spacingM: number, maxGrade: number): number[]`: closed loop; output satisfies `|h[i+1]−h[i]| ≤ maxGrade·spacingM` for every i including last→first. Suggested approach: alternate forward/backward clamping passes (wrapping) until stable (cap iterations, e.g. 100), then distribute any remaining loop-closure residual linearly along the loop. Returns a new array; already-compliant input is returned unchanged in value.
3. In `buildTrackV2`, replace `elevationProfile(...)` with: raw heights → `smoothProfile(raw, spacing, config.profileSigmaM ?? 60)` → `limitGrade(..., config.maxGrade ?? 0.08)` → subtract element 0 from all. `buildTerrain` receives this profile.
4. Run `npm run build:tracks`; commit regenerated tracks.

Conventions: grade = Δh / horizontal segment length; closed loop everywhere; no rounding in the pure functions; `spacingM > 0`, `sigmaM > 0`, `maxGrade ≥ 0`, otherwise throw `Error`; empty array returns `[]`; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/085-elevation-profile-smoothing.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | constant profile 5, 1000 pts, spacing 2 | smoothProfile(σ 60) | all 5 ± 1e-9 |
| AT2 | closed-loop sine, wavelength 60 m, amplitude 1, spacing 2, length 6000 m | smoothProfile(σ 60) | max abs < 0.05 |
| AT3 | closed-loop sine, wavelength 2000 m, amplitude 10, same length | smoothProfile(σ 60) | amplitude > 9 |
| AT4 | profile with a 10 m step, spacing 2 | limitGrade(0.04) | every consecutive abs(Δh) ≤ 0.08 + 1e-9 (incl. last→first); input not mutated |
| AT5 | profile already within the limit | limitGrade | unchanged ± 1e-9 |
| AT6 | regenerated monza.json / silverstone.json | grade per centerline segment | max abs(grade) ≤ 0.04 (+1e-6); monza grade sign flips (threshold 0.002) ≤ 3 per km |
| AT7 | regenerated spa.json | same | max abs(grade) ≤ 0.20; elevation range 90–110 m (still) |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `elevationProfile` unchanged; test 025 and other track tests still pass with regenerated tracks.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Changing `elevationProfile`, the DEM canopy filter (079), terrain generation, runtime (`src/`) changes, new tracks, per-track tuning other than `maxGrade`.
