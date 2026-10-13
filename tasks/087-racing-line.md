# 087 — Racing line (minimum curvature)

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure function that computes the minimum-curvature racing line of a closed centerline within the track limits.

## Context

New layer `src/ai` (may import only `core` and `track`; no Rapier, no three). Design: `docs/plans/phase2-race.md` section 087. Lateral offsets are metres along the RIGHT normal of the centerline (`[-dz, dx]/len` of `P[i+1]-P[i-1]`, as `rightNormalAt` in `src/physics/trackColliders.ts`; reimplement privately, do not import from physics), positive = right. Deterministic: no `Math.random`.

## Files

- `src/ai/racingLine.ts` — create.
- `tests/unit/ai/racingLine.test.ts` — create — edge cases.

## Steps

```ts
export interface RacingLine { offsets: Float64Array; points: Float64Array /* x,z interleaved */; dist: Float64Array /* cumulative, dist[0]=0 */; length: number }
export function computeRacingLine(centerline: [number, number][], halfWidth: number, margin?: number /* 1.0 */, iterations?: number /* 600 */): RacingLine;
export function mengerCurvature(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number; // signed, 1/m, + = turning right
```

- Minimise Σκᵢ² (κ = Menger curvature of consecutive points of the closed offset path) over the lateral offsets by projected gradient descent: gradient per offset by central finite difference (h = 0.01 m, recomputing only the 3 affected terms); a step is accepted only if the objective decreases (halve the step otherwise, double it after a success); initial step 0.5 m; `iterations` full sweeps; offsets clamped to ±(halfWidth − margin); start from offsets 0.
- Closed loop: indices wrap. `dist[i]` is the cumulative polyline length from point 0 to point i; `length` is the closed total including the closing segment; `dist` has n entries.
- `mengerCurvature` is `2·cross/(|AB||BC||CA|)`, sign + for a right turn in the x,z plane with the convention above; collinear or coincident points give 0 (no NaN).
- Positive offset moves the point along the right normal of the centerline.

Conventions: no rounding; clamp is inclusive; `centerline.length < 3` throws `Error`; `halfWidth − margin < 0` is treated as 0; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | circle R 100, N 120 (clockwise as in 031's fixture), halfWidth 6, margin 1 | computeRacingLine | every point at radius 105 ± 0.05 (outer bound) |
| AT2 | rounded square: 4 straights 200 m + 4 arcs R 30 (90°), spacing 2 m, halfWidth 6, margin 1 | same | at each arc midpoint the line is ≥ 4.5 m towards the corner inside; at 40 m before each arc start it is ≥ 3.5 m towards the outside; max |κ| along the line ≤ 0.022 1/m (centerline 0.0333) |
| AT3 | monza.json | same | every |offset| ≤ 5 + 1e-9; max |κ| of the line ≤ 0.9 · max |κ| of the centerline |
| AT4 | monza.json twice | same | outputs byte-identical |
| AT5 | monza.json | timed | < 3 s in Node |
| AT6 | mengerCurvature of (0,0),(1,0),(2,0) / of three points on a circle R 50 turning right | call | 0 / +0.02 ± 1e-9 |

Note for AT3: the test passes the halfWidth that gives the 5 m bound (halfWidth 6, margin 1).

## Acceptance criteria

- [ ] All AT rows pass (AT5 timing < 3 s in Node).
- [ ] No `Math.random`, no import from `three`, `@dimforge`, or `src/physics`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Speed profile and driver (088, 089).
- Using the line in rendering or in the game.
- Spline smoothing or resampling of the centerline; per-point variable margins.
