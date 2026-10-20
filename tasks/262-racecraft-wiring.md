# 262 — Racecraft AI drives the race

Status: pending
Phase: 2
Depends on: 259, 260, 261, 268, 323
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

AI cars in `RaceGame` drive with `Racecraft` + `LanePlanner` (passing, defence, safe rejoin, stopped-car avoidance) instead of `trafficDecision`, with the old path kept behind a flag.

## Context

Planner diagnosis 2026-10-19 (two heavy coder timeouts): the full `npm test` plus the 262 suite (AT4 alone ~400 s) left no time to iterate. The worktree racecraft path makes 125 contacts in 400 s of the AT4 grid (45 in the first 190 s, then a pile-up 300–330 s); `classicTraffic` makes 3. Iterate with `npx tsx /tmp/plan262/at4.mts $PWD rc 60` and `... classic 60` (60 s of the AT4 grid, ~12 s wall; prints contactCount every 10 s) and AT1–AT3; run the full 262 suite only once at the end. Contacts come from the racecraft intent steering into a car alongside: keep a side-by-side car's lateral gap ≥ 2.2 m (car width + margin) before any attack/defend offset is applied, and fall back to the classic follow cap when no gap exists.

Design: `docs/design/racing-ai-v2.md`, "Integration". Imports: `buildCorridor, collectNeighbours, corridorAt, isOffTrack, StopTracker` + types `CarView, Neighbour, TrackCorridor, CorridorSample, PlanBias` from `src/ai/raceView.ts` (258); `LanePlanner, PlanOutput` from `src/ai/lanePlanner.ts` (259); `Racecraft` from `src/ai/racecraft.ts` (260); `RaceScenario`/`contactCount` from 261. `src/ai/traffic.ts` stays untouched (frozen tests).

## Files

- `src/game/raceGame.ts` — modify (only file in `src/`).
- `tests/unit/acceptance/262-racecraft-wiring.test.ts` — by the acceptance worker.
- Protected tests that exercise `RaceGame` AI traffic and may need planner-authorised edits: BLOCK and report, do not edit: `tests/unit/acceptance/093-race-game.test.ts`, `tests/unit/acceptance/225-ai-grip-margin.test.ts`, `tests/unit/edge/093-race-game-edge.test.ts`, `093-race-game.post.test.ts`, `093-race-game-gaps{,2,3,4,5,6}.post.test.ts`, `tests/unit/edge/145-contact-impacts.post.test.ts`, `tests/unit/edge/225-ai-grip-margin.test.ts`, `225-ai-grip-margin.post.test.ts`. No e2e test references `RaceGame`.

## Steps

```ts
// RaceConfig gains: classicTraffic?: boolean;  (true = old trafficDecision path, unchanged)
export const RACECRAFT_AGGRESSION: Record<Difficulty, number>; // easy 0.2, medium 0.4, hard 0.7, expert 0.9
```

- In `create`: when not `classicTraffic`, build one `TrackCorridor` via `buildCorridor(track, line, speeds)`, one `CarView` per car (`halfLen` = `spec.chassis.halfExtents` z, `halfWid` = its x; check the vector shape in `src/physics/carSpec.ts`), one `StopTracker` per car, one `Racecraft` (aggression from `RACECRAFT_AGGRESSION[config.difficulty]`) and one `LanePlanner` per AI, and preallocated neighbour arrays, `PlanBias`, `PlanOutput`, `CorridorSample`. Nothing is allocated per tick.
- Each tick after `refreshProgress` (post-go only): update every `CarView` (`s` = distance, `d` = lateral, `v` = forwardSpeed, `stopped` from `StopTracker.update(v, FIXED_DT, true)`, `offTrack` from `isOffTrack`). The player is a neighbour like any AI.
- Each AI replans every 12 ticks, staggered by AI index (`(tick + k) % 12 === 0`): `collectNeighbours` (default ranges) → `Racecraft.update(..., 0.1, bias)` → `LanePlanner.plan`. Racecraft's dt is 0.1 (12 ticks). Between replans keep the last `targetD` and `speedCap`. Every tick: `driver.setLateralOffset(targetD − lineD(s))` (lineD via `corridorAt` at the car's `s`), `driver.setSpeedCap(speedCap)`.
- Before go and for frozen cars (261) nothing changes; stuck respawn (`respawnOnLine`) is unchanged and does not touch planner or intent state.
- `classicTraffic: true` keeps the exact current `trafficDecision` code path and results.
- Performance: 16 cars must cost ≤ 1.5× the classic path (AT6).

Conventions: tick index = integer step counter since go; no randomness added; the `rng()` call order in `create` stays identical.

## Acceptance tests (defined by the planner with Opus, before coding)

Monza, f4, headless `RaceGame` with `scenario` (261). Player (index 0) frozen at d = −(halfLeft + 8) unless stated. "Ahead" = race distance (laps × L + s).

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | AI A (scale 1.0) at s 200, AI B (scale 0.85) at s 230, both d = lineD, v 40 | 120 s | A ahead of B by ≥ 10 m at the end; contactCount 0 |
| AT2 | AI 3 frozen at s 600, d = lineD(600); AIs 1, 2, 4 at s 200, 230, 260, v 40 | 40 s | contactCount 0; AIs 1, 2, 4 all past s 650 |
| AT3 | two AIs scale 1.0 at s 300, d −2.5 / +2.5, v 50 | 40 s | contactCount 0; each AI offTrack ≤ 1 s total |
| AT4 | 7 AIs expert, two columns s 100 − 8·row, d ±2, scales 0.90..1.00 with the fastest at the back | 3 laps | contactCount ≤ 6; ≥ 4 position changes among AIs; every AI finishes within 1.3 × the winner's time |
| AT5 | `RaceConfig.classicTraffic: true` | AT1 setup | uses `trafficDecision` (old path) and still runs |
| AT6 | 16 cars, 30 s | wall time | racecraft run ≤ 1.5 × the classicTraffic run |
| AT7 | `RACECRAFT_AGGRESSION` | read | easy 0.2, medium 0.4, hard 0.7, expert 0.9 |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/262-racecraft-wiring.test.ts`.
- [ ] `classicTraffic: true` output equals the pre-262 behaviour.
- [ ] Protected tests listed in Files either pass or are reported as BLOCKED with the failing test names.
- [ ] Verification passes (full `npm test` is not run by the coder).

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/262- tests/unit/acceptance/261- tests/unit/acceptance/260- tests/unit/acceptance/093- tests/unit/acceptance/225- tests/unit/acceptance/268- tests/unit/acceptance/273-
```

## Out of scope

- Editing `src/ai/traffic.ts`, `aiDriver.ts`, 258-261 files, or any protected test; UI or menu options; pit stops; learned AI (263+).
