# 008 — Track progress and lap timer

Status: done
Phase: 0
Depends on: 002, 004, 005
Complexity: complex
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`TrackProgress` computes distance along and lateral offset from the centerline; `LapTimer` emits lap and sector events from distance.

## Context

`LapEvent` is in `src/core/types.ts` (task 002; import, do not redefine). `Point2` from `./geo` (004); `cumulativeLengths` from `./centerline` (005). No `three`, no real time: time is a parameter. Don't allocate in `update` (reuse one internal `ProgressSample` object and return it). Relative imports without extension. Minimal code comments.

## Files

- `src/track/trackProgress.ts` — create
- `src/track/lapTimer.ts` — create
- `tests/unit/track/trackProgress.test.ts` — create
- `tests/unit/track/lapTimer.test.ts` — create

## Steps

### trackProgress.ts

```ts
import type { Point2 } from './geo';
export interface ProgressSample { index: number; distance: number; lateral: number }
export class TrackProgress {
  constructor(centerline: Point2[]);
  readonly length: number;   // closed total length = cumulative[n]
  update(x: number, z: number): ProgressSample;
  reset(): void;             // next update does a global search
}
```

Constructor: store the line (`n ≥ 3`, else throw `Error`), `cumulative = cumulativeLengths(centerline, true)`, `length = cumulative[n]`, `lastIndex = -1`.

`update(x, z)`:
1. Candidates: if `lastIndex < 0` (first call or after `reset`) all `i` in `0..n-1`; otherwise `i = (lastIndex + o + n) % n` for `o` in `-60..60`.
2. For each candidate segment `A=P[i] → B=P[(i+1)%n]`: `d = B-A`; `t = clamp(dot(p-A, d)/|d|², 0, 1)` (`t=0` if `|d|²===0`); `Q = A + t*d`; squared distance from `p` to `Q`. Pick the `i` with the smallest value (first wins ties).
3. For the winner: `segLen = cumulative[i+1] - cumulative[i]` (last segment `i=n-1` is the closing one); `distance = cumulative[i] + t * segLen`; `lateral = dot(p - Q, right)` with `right = (-dz, dx)/segLen`, `(dx,dz) = d` (positive to the right of travel direction; if `segLen===0`, unsigned distance). `lastIndex = i`. Return `{ index: i, distance, lateral }`.

`reset()`: `lastIndex = -1`.

### lapTimer.ts

```ts
import type { LapEvent } from '../core/types';
export class LapTimer {
  constructor(lengthMeters: number, sectorStartDistances: [number, number, number]);
  update(distance: number, time: number): LapEvent[];
  reset(): void;
  readonly lap: number;                   // getter, 0 until first crossing
  currentLapTime(time: number): number | null;
  readonly lastLapTime: number | null;    // getter
  readonly bestLapTime: number | null;    // getter
}
```

Constant `WRAP = 50` (m). State: `prevDistance: number | null = null`, `lap = 0`, `lapStart`, `sectorStart` (time the current sector began), `nextSector` (1, 2 or 3), `invalid = false`, `lastLapTime = null`, `bestLapTime = null`.

`update(distance, time)`: `events = []`; `prev = prevDistance`; `prevDistance = distance`; if `prev === null` return `[]`. `L = lengthMeters`.
- `forward = prev > L - WRAP && distance < WRAP`; `backward = prev < WRAP && distance > L - WRAP`.
- If `backward`: if `lap >= 1` set `invalid = true`. Return `events`.
- If `forward`:
  - `lap === 0`: `lap = 1; lapStart = sectorStart = time; nextSector = 1; invalid = false`; emit `{type:'lapStarted', lap:1, time}`.
  - `lap >= 1`: `valid = !invalid && nextSector === 3`. If `valid`: emit `{type:'sectorCompleted', lap, sector:3, sectorTime: time - sectorStart}`; `lapTime = time - lapStart`; `isBest = bestLapTime === null || lapTime < bestLapTime`; set `lastLapTime = lapTime` (and `bestLapTime` if `isBest`); emit `{type:'lapCompleted', lap, lapTime, isBest}`. Then (valid or not): `lap += 1; lapStart = sectorStart = time; nextSector = 1; invalid = false`; emit `{type:'lapStarted', lap, time}`.
  - Return `events`.
- Otherwise, if `lap >= 1`: `while (nextSector <= 2)` with `s = sectorStartDistances[nextSector]` recomputed each iteration: if `prev < s && s <= distance` emit `{type:'sectorCompleted', lap, sector: nextSector, sectorTime: time - sectorStart}`, set `sectorStart = time`, `nextSector += 1`; else break. (A jump over two sectors in one update emits both, in order.)
- Return `events`.

`currentLapTime(time)`: `lap >= 1 ? time - lapStart : null`. `reset()`: back to initial state (`lastLapTime`, `bestLapTime`, `prevDistance` all `null`, `lap = 0`).

Planner decisions (edge cases):
- If N ≤ 121 the ±60 window covers the whole track: always use the global search. Ties: the lowest segment index wins.
- Segments shorter than 1e-9 m are skipped by the search (no NaN from zero-length segments).
- `TrackProgress.update` with non-finite x or z returns the previous sample unchanged (zeros if none yet).
- `LapTimer.update` expects `distance` in [0, L) as returned by `TrackProgress` (the caller does not wrap; the timer does not wrap). Non-finite `distance`/`time` or `distance` outside [0, L): return [] and change no state.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/008-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `TrackProgress` on circle r = 100 resampled at 2 m (index 0 at (100, 0)) | `update(100, 0)` | index 0; distance 0 ±0.5; lateral 0 ±0.1 |
| AT2 | same | points along the circle every 10 m of arc in order | distance increases monotonically, matches arc length ±1 m |
| AT3 | same | `update` at radius 105 vs 95 at the same angle | lateral has opposite signs, magnitude 5 ±0.2 |
| AT4 | `LapTimer(1000, [0, 333, 666])`, distance from 990 rising 1 m per update, time += 0.01 per update, wrapping at 1000 | first wrap | emits `lapStarted` lap 1; `lap` = 1 |
| AT5 | continue one full lap to the next wrap | second wrap | emits `sectorCompleted` 1, 2, 3 (in that order over the lap) then `lapCompleted` lapTime 10.00 ±0.02, isBest true, then `lapStarted` lap 2 |
| AT6 | lap 2 started | distance jumps 300 → 700 in one update | sectors 1 and 2 both emitted in that update |
| AT7 | lap 2 started, prev distance 20 | update with distance 990 (backward wrap), then forward across the line again | no `lapCompleted` for lap 2; `lapStarted` lap 3 |
| AT8 | two completed laps, second slower | after second | lastLapTime = second, bestLapTime = first |
| AT9 | any state | `reset()` | lap 0; currentLapTime(t) null; next forward crossing emits `lapStarted` lap 1 |

## Acceptance criteria

`trackProgress.test.ts` (circle r=100: 64 points `[100cos a, 100 sin a]`, `a = 2πk/64`, then `resampleClosed(..., 2)`; travel direction at `(100,0)` is `(0,+1)`, so `right = (-1,0)`, towards the centre):
- [ ] `start point gives distance ~0 and lateral ~0`: `update(100,0)` → `index 0`, `distance` ±0.01, `lateral` ±0.05.
- [ ] `outside the circle gives negative lateral`: `update(110,0)` → lateral ≈ -10 (±0.1); after `reset()`, `update(90,0)` → ≈ +10 (±0.1).
- [ ] `arc length and lateral sign`: `update` at 10 m arc steps gives `distance` matching arc length ±1 m; radius 105 vs 95 at the same angle give opposite lateral signs, magnitude 5 ±0.2.
- [ ] `quarter turn gives a quarter of the length`: `update(0,100)` → `distance` ≈ `length/4` (±1).
- [ ] `continuous travel increases distance monotonically`: one `TrackProgress`, no reset, 1000 circle points for angle 0 → `2π*0.99`; each `distance` ≥ previous − 1e-6; the last > `0.97 * length`.
- [ ] `wraps across the start line`: after that sequence, `update(100·cos(0.01), 100·sin(0.01))` returns `distance` < 10.
- [ ] `reset forces a global search`: after travelling to `(0,100)`, `reset()` then `update(-100,0)` → `distance` ≈ `length/2` (±1).

`lapTimer.test.ts` (L = 1000, sectors `[0, 333, 666]`; test helper advances distance 1 m per update with `time += 0.01`, distance `% 1000`, starting at 990 with `time = 0`; collect all events):
- [ ] `no events before first crossing`: first 9 updates (990..998) return `[]`; `lap === 0`; `currentLapTime(t) === null`.
- [ ] `first crossing starts lap 1`: the update going 999 → 0 emits exactly `[lapStarted lap 1]`.
- [ ] `first full lap takes 10.00 s`: after 1000 more updates, events in order: `sectorCompleted` 1, 2, 3, then `lapCompleted` (`lapTime` 10.00 ±0.02, `isBest === true`) and `lapStarted lap 2`; `lastLapTime` and `bestLapTime` ≈ 10.00.
- [ ] `sector times add up to lap time`: sum of the 3 `sectorTime` ≈ `lapTime` (±0.02).
- [ ] `best only updates with a faster lap`: laps at 0.01, 0.02, 0.005 s/m → `isBest` true, false, true; `bestLapTime` ≈ 10, 10, 5.
- [ ] `crossing the line backwards invalidates the lap`: just after lap 2 starts: `update(10)`, `update(995)` (backward), `update(5)` (forward) → events only `[lapStarted lap 3]`; `lastLapTime` unchanged.
- [ ] `lastLapTime and bestLapTime`: two completed laps, the second slower (0.01 then 0.02 s/m) → `lastLapTime` ≈ 20, `bestLapTime` ≈ 10.
- [ ] `a jump over several sectors counts them`: in lap 1, one update from 300 to 700 emits `sectorCompleted` 1 then 2.
- [ ] `reset returns to lap 0`: after `reset()`: `lap === 0`, `lastLapTime` and `bestLapTime` null; next update returns `[]`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Penalties, minimum sector times, persistent times, HUD, total lap count.
- Smoothing of `distance`, using car speed, multiple cars per `TrackProgress`.
- Importing `three` or touching `window`/`document`.
