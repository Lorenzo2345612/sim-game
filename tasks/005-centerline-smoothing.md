# 005 — Smooth and resample the centerline

Status: pending
Phase: 0
Depends on: 004
Roles: coder, tester, reviewer

## Goal

`src/track/centerline.ts` provides closed centripetal Catmull-Rom smoothing, uniform resampling and cumulative lengths.

## Context

Typical input: ~124 projected points (task 004), smoothed with 20 samples/segment and resampled at 2 m. Import `Point2` from `./geo`. Relative imports without extension. Minimal code comments.

## Files

- `src/track/centerline.ts` — create
- `tests/unit/track/centerline.test.ts` — create

## Steps

```ts
import type { Point2 } from './geo';
export function catmullRomClosed(points: Point2[], samplesPerSegment: number, alpha?: number): Point2[];
export function resampleClosed(points: Point2[], spacing: number): Point2[];
export function cumulativeLengths(points: Point2[], closed: boolean): Float64Array;
```

**catmullRomClosed** (`alpha` default 0.5). `n = points.length`; if `n < 3` throw `Error('catmullRomClosed: need at least 3 points')`. For each `i` in `0..n-1`: `p0=P[(i-1+n)%n]`, `p1=P[i]`, `p2=P[(i+1)%n]`, `p3=P[(i+2)%n]`; for `k` in `0..samplesPerSegment-1`:

```
d(a,b) = max(hypot(a.x-b.x, a.z-b.z), 1e-6) ^ alpha
t0 = 0; t1 = t0 + d(p0,p1); t2 = t1 + d(p1,p2); t3 = t2 + d(p2,p3)
t  = t1 + (t2 - t1) * k / samplesPerSegment
A1 = (t1-t)/(t1-t0)*p0 + (t-t0)/(t1-t0)*p1
A2 = (t2-t)/(t2-t1)*p1 + (t-t1)/(t2-t1)*p2
A3 = (t3-t)/(t3-t2)*p2 + (t-t2)/(t3-t2)*p3
B1 = (t2-t)/(t2-t0)*A1 + (t-t0)/(t2-t0)*A2
B2 = (t3-t)/(t3-t1)*A2 + (t-t1)/(t3-t1)*A3
C  = (t2-t)/(t2-t1)*B1 + (t-t1)/(t2-t1)*B2     // output point (apply to x and z separately)
```

Output: `n * samplesPerSegment` points, first point NOT repeated at the end; `k=0` gives `C = p1`, so `out[0]` equals `P[0]`.

**resampleClosed(points, spacing)**: `L` = closed total length (including last→first). `N = Math.max(3, Math.round(L / spacing))`, `step = L / N`. Return `N` points at distances `k * step` (`k=0..N-1`) along the closed polyline, linearly interpolated within the segment (closing segment included). First point is exactly a copy of `points[0]`. Skip zero-length segments. Walk the segments once with a running cursor (O(n)).

**cumulativeLengths(points, closed)**: `Float64Array`; `[0]=0`, `[i]` = length up to point `i`. If `closed`: length `n+1`, last value = total length including closure; else length `n`. Empty input: length 0 (open) or `[0]` (closed).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/005-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | circle r = 100 m, 64 points | `catmullRomClosed(c, 20)` | output length 64·20; first point equals c[0] (±1e-9); closed polyline length 628.32 ±0.5 % |
| AT2 | square 100×100 m, 4 points | `catmullRomClosed(sq, 10)` | no NaN; every output point within 20 m of the square's perimeter |
| AT3 | circle r = 100, 64 points | `resampleClosed(c, 2)` | N = round(L/2); every consecutive distance incl. closing one within ±2 % of L/N; first point = c[0] |
| AT4 | circle r = 3 (L ≈ 18.8) | `resampleClosed(c, 10)` | at least 3 points |
| AT5 | square 10×10 | `cumulativeLengths(sq, true)` / `(sq, false)` | [0,10,20,30,40] / [0,10,20,30] |
| AT6 | any input with duplicate consecutive points | `catmullRomClosed` | no NaN in output |

## Acceptance criteria

Tests in `tests/unit/track/centerline.test.ts`:

- [ ] `catmullRomClosed keeps first point and count`: circle r=100, 64 points (`[100cos a, 100 sin a]`, `a = 2πk/64`), `samplesPerSegment=10` → 640 points, `out[0]` equals `P[0]` (`toBeCloseTo`, 9 digits).
- [ ] `catmullRomClosed length of circle is close to 2*pi*r`: closed length (last value of `cumulativeLengths`) = 628.3 ±0.5%.
- [ ] `resampleClosed produces uniform spacing`: smoothed circle resampled at 2 m; `step = L/N`, `L` from closed `cumulativeLengths` of the input; all consecutive distances including closure within ±2% of `step`; `N` = `round(L/2)`.
- [ ] `resampleClosed preserves the first point`.
- [ ] `catmullRomClosed square stays near its perimeter`: 100x100 square, 4 points, `samplesPerSegment=10` → no NaN, every point within 20 m of the perimeter.
- [ ] `catmullRomClosed tolerates duplicate consecutive points`: no NaN in output.
- [ ] `resampleClosed tiny circle`: circle r=3, spacing 10 → at least 3 points.
- [ ] `cumulativeLengths of a square`: `[[0,0],[10,0],[10,10],[0,10]]` closed → `[0,10,20,30,40]`; open → `[0,10,20,30]`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Curvature, width, sectors, coordinate rounding (task 006).
- Other spline types, adaptive smoothing.
- Any other export.
