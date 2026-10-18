# 259 — Sampling lane planner

Status: pending
Phase: 2
Depends on: 258
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

A deterministic sampling lane planner that picks a target lateral offset avoiding predicted collisions (design: "Lane planner").

## Context

Types `PlanBias`, `CarView`, `Neighbour`, `TrackCorridor`, `CorridorSample`, `corridorAt` come from `src/ai/raceView.ts` (task 258): import, do not redefine. Constants and cost are in the design doc; this spec fixes the exact contract. No `three`, no allocation in `plan` (preallocate in the constructor).

## Files

- `src/ai/lanePlanner.ts` — create.
- `tests/unit/acceptance/259-lane-planner.test.ts` — by the acceptance worker.
- `tests/unit/edge/259-lane-planner.test.ts` and `.post.test.ts` — by tester-pre / tester.

## Steps

```ts
export type { PlanBias } from './raceView'; // defined in 258, re-exported
export interface PlanOutput { targetD: number; speedCap: number | null; blocked: boolean }
export interface PlannerParams {
  candidates: number; margin: number; horizon: number; checkStep: number; lateralTime: number;
  longMargin: number; latMargin: number; wLine: number; wLat: number; wEdge: number; edgeRange: number; wHyst: number;
}
export const DEFAULT_PLANNER_PARAMS: PlannerParams; // 15, 0.3, 3, 0.1, 1.2, 2.0, 0.6, 1, 0.4, 3, 1.5, 0.3
export class LanePlanner {
  constructor(corridor: TrackCorridor, params?: Partial<PlannerParams>);
  plan(self: CarView, neighbours: readonly Neighbour[], bias: PlanBias, out: PlanOutput, count?: number): PlanOutput;
}
```

- `count` defaults to `neighbours.length`; only the first `count` neighbours are used.
- Candidates: `d_k = −halfLeft + m + k·(range / (candidates − 1))`, m = `self.halfWid + margin`, range = `halfLeft + halfRight − 2m`; corridor sampled at `s + max(v,0)·horizon/2`. Cost terms `lineD`, `edge` use that same sample; edge = max(0, 1 − min(d_k + halfLeft, halfRight − d_k)/edgeRange).
- Lateral path: cosine blend from `self.d` to `d_k` over `lateralTime`, then hold. Check times t = j·checkStep, j = 1..horizon/checkStep (30). Self s(t) = s + max(v,0)·t; other s_o + v_o·t at constant d_o; `stopped` others use v_o = 0. Gaps use wrapped Δs (lapLength). Collision: |Δs| < halfLen + halfLen_o + longMargin and |Δd| < halfWid + halfWid_o + latMargin (strict).
- Feasible candidates: minimise the design cost; hysteresis −wHyst for the previous chosen k (none on the first plan; stored in the planner). Cost ties (|Δ| < 1e-9): smaller |d_k − self.d|, then lower k. Bias term `preferWeight·|d_k − preferD|` only when `preferD !== null`.
- None feasible: choose the candidate with the latest first-collision time (ties as above), `blocked` true, `speedCap` = `v_o` of the first car hit by it (0 if stopped).
- Output `speedCap`: planner cap (blocked case) else null; then if `bias.speedCap !== null` → `min(bias.speedCap, planner cap ?? Infinity)`.
- The caller throttles planning to 0.1 s; `plan` always computes. Deterministic: same input and same previous k → same output. Previous k always updated.

Conventions: collision test strict `<`; cost tie epsilon 1e-9; negative `v` treated as 0; inputs not mutated (only `out`).

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture S: straight looped corridor, lapLength 2000, ds 2, halfLeft = halfRight = 6, lineD 0 (unless stated), profileV 60, curv 0. Self: s 100, d 0, halfLen 2.0, halfWid 0.9, stopped/offTrack false; others same size. Candidates are then −4.8 + k·(9.6/14), k = 0..14. Bias none unless stated. Each row uses a fresh planner.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | S, self v 50, no neighbours | `plan` | targetD 0 (±1e-9), blocked false, speedCap null |
| AT2 | S, self v 50; car at gap +30, d 0, v 40 | plan | targetD −2.742857 (±1e-5) (tie → smaller \|d_k − d\|, then lower k); blocked false; speedCap null |
| AT3 | S, self v 50; car at gap +30, d −3, v 40 | plan | targetD 0 (±1e-9) |
| AT4 | S, self v 50; cars at gap +30 with d −4, 0, 4, all v 40 | plan | blocked true; speedCap 40; targetD finite and inside [−4.8, 4.8] |
| AT5 | S, self v 30; stopped car (v 0, stopped true) at gap +80, d 0 | plan | \|targetD\| ≥ 2.4; blocked false |
| AT6 | S with lineD 3; self v 50; car at gap 0, d 3, v 50 | plan | targetD ≤ 0.6 + 1e-9 (racing room); without that car: targetD 2.742857 (±1e-5) |
| AT7 | S, self v 50, no neighbours, bias {preferD 4, preferWeight 2, speedCap null} | plan | targetD 3.428571 (±1e-5) (cost: \|d_k\| + 0.4\|d_k\| + 3·edge + 2\|d_k − 4\|) |
| AT8 | S, self v 50; car at gap +30, v 40, d alternating +0.1 / −0.1 on 10 successive plans | plan ×10 | every targetD has the same sign (hysteresis) |
| AT9 | S, 8 neighbours spread over gaps −50..+100 | 10 000 plans | identical output for identical input; total ≤ 2 s |
| AT10 | bias.speedCap 12 | plan | output speedCap = min(12, planner cap) |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/259-lane-planner.test.ts`.
- [ ] No `three` import; no allocation in `plan`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Intents and bias selection (260), `RaceGame` wiring (262), replan throttling, edits to existing files.
