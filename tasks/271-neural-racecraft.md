# 271 — Neural racecraft training: overtakes, defence, contact faults, mixed fields

Status: pending
Phase: 2
Depends on: 272
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Evolved neural drivers learn to overtake, defend and avoid causing contact, because the trainer rewards position changes and penalises at-fault contact, in packed mixed fields (candidates plus frozen hall-of-fame opponents). Trainer only: no game-side changes (the in-game neural AI already senses the 4 nearest cars, including the player).

## Context

Fitness is only own distance/time and fields spread out, so there is no incentive for racecraft. Read `scripts/evolve/{worker,evolve}.mts` (as modified by 270: limits, setup genes, `invalidLaps`), `src/ai/neuralFeatures.ts`, `src/ai/neuralPolicy.ts`. Cars already collide in the worker world. Rapier API: `world.narrowPhase.contactPair(colliderA, colliderB, callback)`.

## Files

`scripts/evolve/racecraft.mts` (new, pure, no Rapier imports), `scripts/evolve/evolve.mts`, `scripts/evolve/worker.mts`, test `tests/unit/acceptance/271-neural-racecraft.test.ts`. Existing tests unchanged.

## Steps

```ts
// scripts/evolve/racecraft.mts
export const POS_W = 60, PASS_W = 40, CONTACT_W = 80, CRASH_W = 200;
export interface RcCar { dist: number; speed: number; running: boolean } // dist = total race distance (m)
export interface ContactInfo { fwdGap: number; latGap: number; closing: number }
export class RacecraftTracker {
  constructor(n: number);
  readonly passes: Int32Array; readonly lost: Int32Array; readonly faults: Int32Array; readonly crashFaults: Int32Array;
  step(dt: number, cars: ReadonlyArray<RcCar>): void;
  contact(k: number, j: number, info: ContactInfo): void;
  noteElimination(k: number): void;
}
export function racecraftFitness(base: number, finishPos: number, n: number, passes: number, lost: number, faults: number, crashFaults: number): number;
export function pickOpponents(hof: { file: string; avgLap: number }[], bestAvg: number, count: number, rand: () => number): { file: string; avgLap: number }[];
```

1. Position change between cars k and j: the race order flips while both are running, both speeds >= 2 m/s and |dist gap| <= 20 m at the flip. It is committed only if the new order holds 1.0 s continuously; if it flips back earlier nothing is counted. Committed: `passes[k]++` for the car now ahead, `lost[j]++` for the other.
2. `contact(k, j, info)`: `info` = j's position in k's frame (forward/right, m); `closing` = k's forward speed minus j's speed along k's forward (m/s). k is at fault when `fwdGap > 1.0`, `|latGap| < 1.2` and `closing > 3.0` (light touches at ≤ 3 m/s closing are allowed, no fault). Callers report both ordered pairs each step while the bodies touch. One episode (consecutive steps touching) gives at most one fault per car; a new episode needs >= 0.5 s without touching (time is tracked from `step` dt).
3. `noteElimination(k)`: if k is eliminated within 3.0 s after an episode where j was at fault, `crashFaults[j]++`.
4. `racecraftFitness` = `base + POS_W*(n-1-finishPos) + PASS_W*(passes-lost) - CONTACT_W*faults - CRASH_W*crashFaults`. `finishPos` is 0-based by finish time, then by distance for non-finishers.
5. `pickOpponents`: uniform with repetition from entries with `avgLap <= bestAvg + 3`; `[]` if none or `count` <= 0.
6. `evolve.mts`: flag `--racecraft` implies speed-phase race settings (`--speed-laps` respected). Every episode uses the staggered pack start (two-abreast pack behind a random point), never grid slots. Mixed fields: about half of each episode's slots are candidate genomes, the rest hall-of-fame opponents from `pickOpponents` (models loaded from the run's model dir; `bestAvg` = best `avgLap` in `index.json`; if none, candidates only). Opponents are frozen, their fitness is discarded. Gen log line appends `passes <sum> faults <sum>` (candidates only). In racecraft mode a hall-of-fame model is saved only with 0 faults, 0 crashFaults and 0 invalid laps (270 rule) for that model in that race.
7. `worker.mts`: the eval message also carries opponent genomes/setups, run in the same world. Each step, for car pairs within 6 m, detect touching with `world.narrowPhase.contactPair` on the chassis colliders; feed the tracker (`step` with dist/speed/running, `contact` both orders with frame-projected gaps, `noteElimination` on elimination). When racecraft is on, fitness = `racecraftFitness(...)`; without `--racecraft` behaviour and fitness are unchanged. Worker returns passes/faults/crashFaults per candidate. No per-step allocations (reuse typed arrays/objects).

Conventions: double precision; thresholds inclusive as written (`>=` / `<=`) except `>` where stated; invalid input throws; `step` does not mutate `cars`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `RacecraftTracker(2)`, dt 1/30; car A dist 95→ +40 m/s, B dist 100 → +35 m/s, both running | step 3 s | A passes 1, B lost 1; B passes 0, A lost 0 |
| AT2 | as AT1 but B speed 1 m/s (dist +1 m/s) | step until A is 10 m ahead + 2 s | no passes or lost for either |
| AT3 | A and B swap order, then swap back 0.5 s later, then hold | step 3 s | all passes and lost are 0 |
| AT4 | A behind B: `contact(A,B,{fwdGap:4,latGap:0.5,closing:5})` and `contact(B,A,{fwdGap:-4,latGap:-0.5,closing:-5})` on 10 consecutive steps; separately a light touch with closing 2 / −2 | step | hard: faults A 1, B 0; light: faults 0 for both |
| AT5 | side by side: `contact` with fwdGap 0.5, latGap 1.8, closing 0 (both orders) | step | faults 0 for both |
| AT6 | AT4 episode, then `noteElimination(B)` 2.0 s later; separately a second tracker with elimination 4.0 s later | — | first: crashFaults A 1; second: crashFaults A 0 |
| AT7 | `racecraftFitness(1000, 0, 10, 2, 1, 1, 0)` | compute | = 1000 + 60·9 + 40·1 − 80 = 1500 |
| AT8 | `pickOpponents` with avgLaps [95, 97, 99, 105], bestAvg 95, count 50, seeded rand; and empty hof | pick | 50 entries, all with avgLap ≤ 98; empty hof → [] |
| AT9 | evolve cleveland f4 `--racecraft --pop 6 --gens 1 --speed-laps 1` with a temp model dir seeded with one exported model | run (timeout 600000) | exits 0; gen line contains `passes ` and `faults `; non-racecraft run's fitness formula unchanged (existing tests pass) |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Without `--racecraft`, trainer behaviour and fitness are identical to before.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Game-side or `src/` changes, new inputs/network size, retraining runs, exporting models, new tracks/cars, rewards other than listed, viewer changes.
