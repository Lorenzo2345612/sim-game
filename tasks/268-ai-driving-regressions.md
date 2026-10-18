# 268 — AI driving regressions: barrier climbing, off-track excursions, stuck recovery

Status: pending
Phase: 2
Depends on: —
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

AI cars stay on track, never climb barriers and recover when stuck or flipped.

## Context (planner measurements 2026-10-17, headless RaceGame, monza, f4, expert, seed 3)

- Solo AI never completes lap 1 in 240 s. At s ≈ 4925–5008 m (Parabolica) it runs wide to lateral −11.4 m (runoff → grass), wheel rays hit the left armco trimesh (index 2491–2516, offset 12 m; reported surface 'asphalt'), the suspension lifts the car 2.8 m up the wall, it flips (up.y −0.76) and is thrown ~100 m off track; `forwardSpeed` then oscillates ±80 m/s so the 1 m/s stuck timer never fires.
- 7 AI, 240 s: 27–79 s per car with wheels on grass/gravel, 0–5 resets each, two cars still on lap 1; grass entries spread over most corners (solo: one per corner).
- Causes to fix: (1) barrier walls are inside `WHEEL_RAY_FILTER_GROUPS` (`src/physics/vehicleModel.ts`); (2) racing line and `trafficDecision` use constant `widthMeters/2`, line margin 1.0 m ≈ car half width; (3) speed profile/steering let the car exceed track limits on corner exit; (4) stuck detection uses speed only.

## Planner answers (round 1)

AT2 spawn fix (planner-authorised acceptance-test edit, the only one allowed): in `tests/unit/acceptance/268-ai-driving-regressions.test.ts` AT2, replace the spawn `y: groundHeightAt(track, sx, sz) + 0.5` with `y: (track.elevation[IDX] ?? 0) + 0.6` (same lift as `SPAWN_HEIGHT_M` in `raceGame.ts`). Reason: `groundHeightAt` samples the terrain below the floating verge strip, so the car spawned inside the bump stop. Change nothing else in that file. AT2 row now reads "spawned at centerline elevation + 0.6 m". Step 1 is accepted as implemented; continue with steps 2–5.

## Planner answers (round 2)

1. BLOCKER 2 (AT2 spawn) is already authorised in round 1 above: apply it, no further question.
2. BLOCKER 1 (frozen 032 AT5): keep the step-1 physics as prescribed. 032 AT5 forces `setLinvel(x = 10)` every step, which overrides the contact solver and is not a real driving case. Planner-authorised edit of `tests/unit/acceptance/032-physics-track-colliders.test.ts` AT5 only: set the sideways velocity `{x: 10}` once after settling (keep y/z), then let the car run freely for 2 s; keep every assertion unchanged (centre < 11 every step, y in (−0.5, 2), maxX > 8.5). Nothing else in 032 may change.
3. Wall-tunnelling guard (added to AT2): in the 268 AT2 test also assert every step that the car centre stays on the track side of the left armco (signed lateral offset from the centreline at the nearest index > −(halfWidthAt(track, 'left', IDX) + barrier offset used by `trackColliders`)). Planner-authorised addition to that test, nothing else.
4. Then continue with steps 2–5. Do not stop again for these items.

## Planner answers (round 3)

The AT2 spawn edit IS authorised (see "Planner-authorised test edits" under Files). Apply it first, then do step 5 and AT3–AT5, 225 EDGE3, lint and full tests. Do not report BLOCKED for AT2 again. `computeRacingLine` default margin: 1.4 only when per-index arrays are given, 1.0 when absent (keeps `racingLine.test.ts`) — accepted.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza world with track colliders | cast the wheel ray (same filter as `VehicleModel`) straight down from 0.3 m above the top of the left armco wall at index 2504 and horizontally into it at wheel height | the down ray does not hit the barrier collider (hits ground or nothing); the chassis collider still collides with the wall (contact pair exists when the chassis is pushed into it) |
| AT2 | f4 on monza at index 2504, lateral −9 m, spawned at centerline elevation + 0.6 m, heading 25° towards the left armco, 30 m/s, no input | simulate 3 s | max chassis y − centerline elevation at that index ≤ 0.6 m; up.y > 0.5 throughout; the car centre never crosses the left armco line |
| AT3 | RaceGame monza, f4, aiCount 1, expert, seed 3, player brake 1 | 3 laps (≤ 400 s) | AI finishes 3 laps; 0 resets; total time with ≥ 2 wheels on grass/gravel ≤ 1.0 s; best lap ≤ 1.04 × the profile lap time (`Σ ds / v_profile` × speedScale) |
| AT4 | same as AT3 on spa and on silverstone | 2 laps each | finishes; 0 resets; ≥ 2 wheels on grass/gravel ≤ 1.5 s per track |
| AT5 | RaceGame monza, f4, aiCount 7, expert, seed 3, player brake 1 (static car on the grid) | 300 s | every AI completes ≥ 2 laps; Σ over AIs of time with ≥ 2 wheels on grass/gravel ≤ 15 s; total resets ≤ 1 |
| AT6 | AI car flipped (up.y < 0.3) on track | hold 1.5 s | reset to the nearest track pose within 0.1 s after 1.5 s; also reset when progress along the lap is < 5 m over 5 s regardless of speed |
| AT7 | racing line for every `public/tracks/*.json` | sample every index | line lateral within [−halfWidthAt(left) + 1.4, halfWidthAt(right) − 1.4] m (per-index widths) |
| AT8 | `trafficDecision` with per-index half widths | blocker ahead at an index with halfWidthAt 4.0 m each side | chosen offset keeps |line + offset| ≤ 4.0 − 1.4 m |

Frozen 225 tests (expert never spins, difficulty orders pace) must pass, including `tests/unit/edge/225-ai-grip-margin.test.ts` EDGE3 (medium < hard < expert on monza), which fails on master because of this regression (moved here from 256).

AT3–AT5 are slow headless `RaceGame` runs (`RaceGame.create(track, spec, {trackId, carId, laps, aiCount, difficulty, seed})`, `g.step(input)`, `g.vehicles[i].getWheelSurfaces()`, `g.traffic[i].distance`): put them in `tests/unit/acceptance/268-*.test.ts` with per-test timeout up to 600 000 ms.

## Files

**Planner-authorised test edits (apply exactly these; the coder rule's "Planner-authorised" exception covers them):**
- `tests/unit/acceptance/268-ai-driving-regressions.test.ts` AT2 (line ~306): `y: groundHeightAt(track, sx, sz) + 0.5` → `y: (track.elevation[IDX] ?? 0) + 0.6`; plus the AT2 wall-crossing assertion from round 2.
- `tests/unit/acceptance/032-physics-track-colliders.test.ts` AT5: set `{x: 10}` sideways velocity once after settling instead of every step (round 2).
- `tests/unit/edge/` and every other test: no edits.


- `src/physics/trackColliders.ts` — modify: `export const BARRIER_GROUP = 0x0004;` barrier trimesh gets `setCollisionGroups((BARRIER_GROUP << 16) | 0xffff)`.
- `src/physics/vehicleModel.ts` — modify: `WHEEL_RAY_FILTER_GROUPS` also clears `BARRIER_GROUP` in its low 16 bits (both raycast sites, ~lines 455 and 749). `CHASSIS_COLLISION_GROUPS` unchanged (chassis still hits barriers). Import `BARRIER_GROUP` from `trackColliders`.
- `src/ai/racingLine.ts` — modify. `src/ai/traffic.ts` — modify. `src/game/raceGame.ts` — modify ; put the step 5 edge-keeping correction in `raceGame.ts` (touch `src/ai/aiDriver.ts` instead of `traffic.ts`-unrelated files only if impossible there).
- `tests/unit/acceptance/268-ai-driving-regressions.test.ts` — by the acceptance worker; edge tests by tester-pre/tester.

## Steps

```ts
export function computeRacingLine(centerline: [number, number][], halfWidth: number, margin?: number /* default 1.4 */, iterations?: number,
  halfWidthLeft?: readonly number[], halfWidthRight?: readonly number[]): RacingLine;
export function trafficDecision(self, others, lapLength, halfWidth: number, lineOffsetAhead: number, curvatureAhead: number,
  halfWidthLeft?: number, halfWidthRight?: number): TrafficDecision; // per-index values at the lookahead index
```

1. Barrier group and ray filter as in Files. The wheel ray must never report a barrier hit; chassis-barrier contacts remain.
2. `computeRacingLine`: when the per-index arrays are given (same length as `centerline`), lateral bound at index i is in `[-(left[i] - margin), right[i] - margin]` (clamped so the interval is never inverted: lower ≤ upper, collapse to 0). Absent arrays: old behaviour with `halfWidth` (frozen 087/089 pass explicit margins, so they are unaffected). Lateral sign convention unchanged. `RaceGame` builds the arrays with `halfWidthAt(track, 'left'|'right', i)` and passes them; the call no longer relies on `widthMeters / 2`.
3. `trafficDecision`: when `halfWidthLeft`/`halfWidthRight` are given, the lateral limit is `min(side half width) - 1.4` for the chosen side (offset keeps `|line + offset|` ≤ that side's half width − 1.4); when absent, existing behaviour (frozen 090). `RaceGame` passes the half widths at the AI's lookahead index.
4. Stuck/flip reset in `RaceGame` replaces the `STUCK_SPEED_MS` speed-only check: reset to the nearest track pose (existing reset path) when `up.y < 0.3` continuously for 1.5 s (reset within 0.1 s after), or when lap progress (wrapped, signed) advanced < 5 m over a 5 s window regardless of speed. Remove `STUCK_SPEED_MS`; a timer restart on reset. Counts as a reset (existing counter).
5. Corner-exit excursions: the coder may tune `AI_GRIP_MARGIN` (allowed range 0.70–0.82), lookahead constants, and add an edge-keeping correction in `AiDriver`/`RaceGame` (steer towards the track when `|lateral| > halfWidth − 1.0`). Frozen 225 and 089 tests must stay green. Tune until AT3–AT5 pass; report final constants in the commit/notes.

Conventions: margins in metres; per-index arrays are read-only and never mutated; lookups out of range wrap with the closed centerline; thresholds `<` as written (`up.y < 0.3`, progress `< 5`).

## Planner-authorised test edits

Grep of `tests/unit` found no test whose numbers depend on the new default margin (087/089 pass margin explicitly; 090 calls without half widths). None authorised. If a frozen test (032, 087, 089, 090, 093, 145, 225) breaks anyway, BLOCK and report; only racing-line lateral expected values in `089-ai-driver.test.ts` may be updated, nothing else.

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/268-ai-driving-regressions.test.ts`.
- [ ] Wheel rays ignore `BARRIER_GROUP`; chassis still collides with barriers (AT1).
- [ ] Frozen 087, 089, 090, 093, 225 and 032 tests pass (032 AT5 with the round-2 authorised edit only).
- [ ] Final `AI_GRIP_MARGIN` and other tuned constants are in [0.70, 0.82] / reported.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Racecraft/lane planner (258–262), RL work, new tracks or barrier geometry changes, tyre/suspension model changes, player-car reset behaviour, changes to `ai/guides/architecture.md`.
