# 212 — Ghost delta goes wild from the second lap

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The live delta against the ghost stays correct on every lap.

## Context

User: "después de la segunda vuelta el delta se vuelve loco, dice que voy ganando más de 100 segundos".

`ghostDelta` in `src/main.ts` (around line 638) maps the car's track distance `d` (from `carProgress`, the rendered/interpolated position) to the ghost's time at the same distance, with a cursor `ghostCursor` that only moves forward and is reset to 0 on `lapStarted`. The lap line is at distance 0 and distances wrap at the lap length `L`. On `lapStarted` the interpolated position still lags the sim by up to one step, so it is just before the line and `d ≈ L`; the cursor then runs to the end of the ghost and never comes back, so the ghost time is the whole ghost lap and the delta is about minus one lap time for the rest of the lap. The same happens after any backward jump (reset with R).

## Files

- `src/game/ghostDelta.ts`: create (pure function, no `three`).
- `src/main.ts`: modify (use it; remove the inline cursor logic).
- `tests/unit/acceptance/212-ghost-delta-wrap.test.ts`: create (acceptance worker).

## Steps

1. Export from `src/game/ghostDelta.ts`:
   `ghostTimeAt(ghostTimes: ArrayLike<number>, ghostDist: ArrayLike<number>, d: number, lapTime: number, lapLength: number): number | null`
   - `ghostTimes[i]` is sample i's time (`ghost.samples[i][0]`), `ghostDist[i]` its track distance; both same length ≥ 2, else `null`.
   - Wrap: if `d > lapLength / 2` and `lapTime < 10` (car just behind the line at lap start), use `d = 0`. Non-finite `d` or `lapTime` → `null`.
   - Find the ghost time at distance `d` by linear interpolation between the two samples around `d`, scanning samples whose distance is not wrapped (ignore leading samples with `ghostDist[i] > lapLength / 2` and trailing samples after the distance drops back near 0). No state is kept between calls, so a backward jump of `d` gives the right value at once. `d` before the first usable sample → that sample's time; after the last → the last's time.
   - Cost: binary search or a linear scan, ≤ O(n) per call, no allocation.
2. `main.ts`: `ghostDelta` returns `lapTime - ghostTimeAt(...)` (or `null`), with `lapLength = carProgress.length`. Remove `ghostCursor`. Precompute `ghostTimes` once per ghost (a `Float64Array`) where `ghostDist` is computed.

## Acceptance tests (defined by the planner with Opus, before coding)

Base ghost: lap length 1000 m, 11 samples, `ghostTimes[i] = 6·i` (60 s lap), `ghostDist[i] = 100·i` except `ghostDist[10] = 0` (the last sample crosses the line and wraps).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | base ghost | `ghostTimeAt(t, dist, 450, 25, 1000)` | 27 (±1e-9) |
| AT2 | base ghost | `d = 999.5`, `lapTime = 0.01` (lap start, interpolation lag) | 0 (±1e-9) |
| AT3 | base ghost | call with `d = 900`, `lapTime = 54`, then `d = 200`, `lapTime = 55` | 54, then 12 (no state between calls) |
| AT4 | base ghost | `d = 999.5`, `lapTime = 59.9` | between 54 and 60 inclusive |
| AT5 | ghost `ghostDist = [999, 1, 100, 200, 300, 400, 500, 600, 700, 800, 900]`, `ghostTimes = [0, 0.05, 6, 12, 18, 24, 30, 36, 42, 48, 54]` (first sample recorded just behind the line) | `d = 150`, `lapTime = 9` | 9 (±1e-9) |
| AT6 | arrays of length 1, or `d = NaN` | call | `null` |
| AT7 | source check | read `src/main.ts` | no `ghostCursor` identifier; imports `ghostTimeAt` from `./game/ghostDelta` |

Existing tests that must still pass: every ghost test under `tests/unit` and `tests/e2e`, and the HUD delta tests.
