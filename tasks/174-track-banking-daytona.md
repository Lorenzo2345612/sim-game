# 174 — Track banking (cross-slope) + Daytona

Status: pending
Phase: 1
Depends on: 106, 155
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Track surfaces gain a lateral cross-slope (banking) driven by per-index `bank` data; Daytona's oval sections are banked as in reality. Today every cross-section is flat (106 and 168 declared banking out of scope; this task lifts that).

## Context

Builder: `tools/track-builder/` (`buildTrackData.ts`, `terrain.ts` incl. `clampTerrainBelowStrips`, registry `tracks.json`). Runtime: `src/track/surfaces.ts` (`buildTrackSurfaces`, `halfWidthAt`), `markings.ts`, `barrierPath.ts`; physics `src/physics/trackColliders.ts` consumes the strips, so it needs no new code (only verify the car sits on banked trimesh). Types: `TrackDataV2` in architecture.md section on track data; do not redefine. Real Daytona: NASCAR turns 31 deg, tri-oval 18 deg, back straight about 2 deg, Bus Stop chicane flat.

## Files

- `tools/track-builder/banking.ts` — create — `bankProfile` and `BankRange`.
- `tools/track-builder/buildTrackData.ts`, `tools/track-builder/tracks.json` — modify — registry field, write `bank`, Daytona data, terrain clamp uses banked strips.
- `src/track/surfaces.ts` (+ `parseTrackData.ts`, `markings.ts`, `barrierPath.ts` only if they place geometry by lateral offset) — modify — `bank?: number[]` on `TrackDataV2`, parser default, banked heights.
- Tests: `tests/unit/acceptance/174-track-banking.test.ts`, `tests/e2e/acceptance/174-track-banking.spec.ts`.
- Rebuild `public/tracks/daytona.json` with the builder.
- `src/core/types.ts`, `src/physics/vehicleModel.ts`, `src/game/game.ts` — modify — bank-aware spawn (planner decision after AT7 blocked; see "Bank-aware spawn").

## Steps

```ts
export interface BankRange { fromMeters: number; toMeters: number; degrees: number; raisedSide: 'left' | 'right' }
export function bankProfile(cumulativeMeters: number[], lengthMeters: number, ranges: BankRange[], rampMeters?: number): number[]; // default 60
```

1. `bankProfile`: per-index signed radians, positive = right edge higher (`raisedSide` is relative to driving direction; 'left' gives negative). Linear ramp of `rampMeters` centred on each range boundary (full value inside, 0 outside, half value exactly at a boundary). `toMeters < fromMeters` means the range wraps past `lengthMeters`. Overlapping ranges: larger magnitude wins. Inputs are not mutated.
2. Registry: optional `banking: BankRange[]` per track. Builder writes `bank: number[]` (same length as `centerline`) to the track JSON only through `bankProfile(cumulative, lengthMeters, banking)`; zeros when absent. JSON version stays 2. `parseTrackData` defaults a missing `bank` to all zeros (same length as centerline).
3. Cross-section: height at lateral offset d (d > 0 right of driving direction) = `elevation[i] + d * Math.tan(bank[i])`. Apply it to every vertex placed by lateral offset: track strip, kerbs, run-offs, escape roads, markings, barrier bases, pit and start objects. With all-zero `bank` the output must be bit-identical to today.
   - Lateral offset d and index: for every vertex, d = signed distance from the centerline (right of driving direction positive) and i = the nearest centerline index (the one the vertex's row is built from, when it has one). Escape-road vertices use the same rule (nearest centerline index, offset from the centerline, not from their own polyline).
   - Point objects placed beside the track (braking boards, sausages, pit building, start gantry/lights): base y uses the same formula at their placement offset and index; they are not tilted (stay vertical).
4. Terrain: after banking, the heightfield must be at least 0.05 m below every surface vertex of a banked section (including run-off width), blending back to the natural height over 30 m. Reuse `clampTerrainBelowStrips` with the banked strips and a 30 m blend; do not replace it.
5. Daytona data (meters along centerline from index 0, `lengthMeters` 5763.3, left-hand circuit, so the outside of every turn is the right side). All `raisedSide: 'right'`:
   - turns 1-2: 2290 to 3180, 31 deg
   - back straight: 3180 to 3680, 2 deg
   - turns 3-4: 4090 to 5150, 31 deg
   - tri-oval: 5150 to 160 (wraps), 18 deg
   Flat (must stay 0): Bus Stop 3720 to 4055 and infield 210 to 2250.
6. Physics: no code change; the e2e row proves the car stays on the banked trimesh.

Conventions: radians internally, degrees only in registry; boundary `fromMeters <= m <= toMeters` is inside; indices use `cumulativeMeters[i]` as position; empty `ranges` returns zeros; `degrees` 0 or `toMeters == fromMeters` contributes nothing; no throw on invalid input except non-finite numbers (throw `Error`).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/174-track-banking.test.ts` (e2e row into `tests/e2e/acceptance/174-track-banking.spec.ts`) before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit: `bankProfile` cumulative 0..999 step 1, length 1000, range `{fromMeters:200,toMeters:500,degrees:31,raisedSide:'right'}`, ramp 60 | compute | index 350 = +31° (±1e-6 rad); index 100 and 600 = 0; index 200 = +15.5° (±0.01°); monotonic on 170..230 |
| AT2 | unit: same with `raisedSide:'left'` and a range `{fromMeters:950,toMeters:50,…}` wrapping the start | compute | index 350 = −31°; index 0 = ±full value with sign of its range; indices 970 and 30 non-zero |
| AT3 | unit: synthetic straight track, constant bank +10° (`bank` array), halfwidth 6 m | `buildTrackSurfaces` | every track-strip vertex y = elev + d·tan(10°) ±1e-4, where d is its signed lateral offset (right positive) |
| AT4 | unit: monza.json (no `bank`) | parse + `buildTrackSurfaces` | all vertex heights identical (±1e-9) to the bank-less computation; parsed `bank` is all zeros |
| AT5 | unit: built daytona.json | max \|bank\| inside each oval-turn range | in [30°, 32°]; tri-oval in [17°, 19°]; every index inside the infield ranges = 0 |
| AT6 | unit: built daytona.json | for every track-surface vertex within the banked ranges, terrain height at its x,z | ≤ vertex y − 0.05 m |
| AT7 | e2e `/?track=daytona`, teleport to the middle of the NASCAR turns 3–4 range | hold throttle 5 s sim time | `surfaceUnderCar` 'asphalt' throughout, speed > 30 km/h at the end, car y − `trackHeightUnderCar` stays in [0, 1] m |

AT5 ranges: turns 3-4 = 4090..5150 (and turns 1-2 = 2290..3180) measured on indices at least 60 m inside the range; tri-oval = 5150..160 wrapping, indices at least 60 m inside; infield = 210..2250 and Bus Stop = 3720..4055. AT7 teleport target: index nearest 4620 m (use `teleportToIndex`).

## Acceptance criteria

- [ ] `bankProfile` matches AT1/AT2; non-banked tracks produce unchanged geometry (AT4).
- [ ] Surface, kerbs, run-offs, markings and barriers follow the cross-slope (AT3).
- [ ] `public/tracks/daytona.json` rebuilt with `bank`, other tracks unchanged except no `bank` or all-zero `bank`.
- [ ] Terrain stays below banked surfaces (AT6); car drives the banked turn (AT7).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 174-
```

## Out of scope

- Fontana banking data (task 175), other tracks' banking.
- Physics changes, banking-aware AI/racing line, camera or HUD changes.
- Changing track JSON version, centerline, elevation or width logic.

## Planner-authorised test edits

- `tests/e2e/acceptance/174-track-banking.spec.ts`: replace `join(__dirname, '../../../public/tracks/daytona.json')` with `join(process.cwd(), 'public/tracks/daytona.json')` (the project is ESM; Playwright runs from the repo root). No other change to that file.

## Bank-aware spawn (planner decision)

Spawning level on a 31° bank engages the bump stops and launches the car. This exception to "Physics: no code change" covers the spawn only:
- `SpawnPose` gains `roll?: number` (rad, default 0, positive = right side up).
- `VehicleModel.reset` builds the body rotation as yaw, then roll about the car's local forward axis (-Z). Linear and angular velocity stay zeroed as today.
- `teleportToIndex(i)` (and every reset path that uses it, e.g. R) passes `roll = ±bank[i]`, with the sign such that the car's up vector equals the banked surface normal at the centerline. Height stays `elevation[i] + 0.6`.
- With `bank` absent or 0, behaviour is byte-identical to today: no change for other tracks.

The coder adds a unit test in `tests/unit/physics/` that checks two things: a reset with roll 0.5 gives a body up vector at 0.5 ± 0.01 rad from world Y, and roll 0 matches the old quaternion.

## Merge note (planner, 2026-10-16)

Master moved on (157 added `environment`/`biomeFor` in `tools/track-builder/buildTrack.ts` and `src/track/parseTrackData.ts`). In the worktree run `git merge master`, then resolve:
- `buildTrack.ts`: keep master's `biome = biomeFor(...)`, `placeTrees(..., biome)` and `environment`, plus this task's `bank` argument to `buildTerrain` and the `bank` field.
- `parseTrackData.ts`: doc comment lists `environment`, `escapeRoads`, `boards`, `sausages` and `bank`.
- `public/tracks/daytona.json`: take master's copy, then rebuild with `npx tsx tools/track-builder/buildTrack.ts daytona`.
Then rerun typecheck, lint, `npm test` and the 174 e2e. No other changes.
