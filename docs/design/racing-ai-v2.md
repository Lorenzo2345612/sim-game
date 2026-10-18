# Racing AI v2 — racecraft (M2.1e) and learned AI (M2.3)

Status 2026-10-17, planner. Replaces `src/ai/traffic.ts` in `RaceGame` (the module stays for its frozen tests).

## Problem

`trafficDecision` sees one blocker within 25 m and shifts 3 m. No passing plan, no defence, no racing room, stopped cars ignored, no safe rejoin.

## Frenet view (258)

All racecraft works in track coordinates: `s` = distance along the lap (m, `TrackProgress.distance`), `d` = lateral from the centerline (m, + right, `TrackProgress.lateral`), `v` = forward speed (m/s).

```ts
export interface CarView { s: number; d: number; v: number; halfLen: number; halfWid: number; stopped: boolean; offTrack: boolean }
export interface Neighbour { car: CarView; gap: number }   // gap = wrapped s_other − s_self in (−L/2, L/2]
export interface TrackCorridor { lapLength: number; ds: number; halfLeft: Float64Array; halfRight: Float64Array; lineD: Float64Array; profileV: Float64Array; curv: Float64Array }
```

- Corridor sampled every `ds` = 2 m (n = ceil(L / ds)); `halfLeft/Right` from `halfWidthAt`, `lineD` = racing-line offset, `profileV` = AI speed profile, `curv` = signed racing-line curvature (1/m, + right), all linearly interpolated at `s` (wrapping).
- `stopped`: v < 3 m/s for ≥ 1.0 s after go. `offTrack`: d < −halfLeft(s) − 0.3 or d > halfRight(s) + 0.3.
- Braking point: first s' ahead (≤ 400 m) where `profileV(s') < profileV(s) − 5` and profile is decreasing; corner sign = sign of the racing-line curvature at the profile minimum after it (+1 right).

## Lane planner (259)

Sampling planner, re-planned every 0.1 s (12 ticks), no allocation in `plan`.
- 15 candidate terminal offsets `d_k` evenly from `−halfLeft + m` to `halfRight − m`, m = halfWid + 0.3, using the corridor at `s + v·H/2`.
- Each candidate: smooth lateral move from current d to d_k over `T_lat = 1.2 s` (cosine blend), then hold; horizon H = 3 s, check step 0.1 s.
- Prediction: self s(t) = s + v·t; others s_o + v_o·t at constant d_o (stopped cars: v_o = 0).
- Collision at t: |Δs| < halfLen + halfLen_o + 2.0 (Δs, Δd at the same t) and |Δd| < halfWid + halfWid_o + 0.6. A colliding candidate is infeasible; record first-collision time.
- Cost of a feasible candidate: `w_line·|d_k − lineD| + w_lat·|d_k − d| + w_edge·edge(d_k) + w_pref·|d_k − preferD| − w_hyst·[k = previous k]` with w_line 1, w_lat 0.4, w_edge 3 (edge = max(0, 1 − distance-to-edge/1.5)), w_pref from the bias, w_hyst 0.3.
- Ties: smaller |d_k − d|, then lower k.
- If no candidate is feasible: pick the one with the latest first collision; `speedCap` = v_o of the car hit first (0 for stopped); `blocked` true.
- Output `targetD` (absolute) → `AiDriver.setLateralOffset(targetD − lineD(s))`.

## Racecraft intents (260)

`follow | attack | defend | rejoin`, minimum 0.5 s per intent (rejoin exempt), writes a `PlanBias { preferD: number | null; preferWeight: number; speedCap: number | null }`.
- `rejoin` (self offTrack or stopped): preferD = d clamped into the track 1.5 m from the near edge; speedCap 12 m/s; while any neighbour behind has time gap (−gap / v_o) < 2.5 s and |d_o − preferD| < 3 m, speedCap 0 (wait).
- `attack`: car ahead, not stopped, time gap gap/v < 1.0 s, and own profile pace ≥ its speed + 0.5 m/s or gap < 15 m: preferD = inside line of the next corner (halfRight − 1.5 for a right corner, −halfLeft + 1.5 for left), preferWeight = 0.5 + 2·aggression, only while distance to braking point > 30 m; inside the braking zone keep the chosen side (no switch).
- `defend`: car behind, time gap −gap/v_o < 0.8 s, closing (v_o > v): one move per straight to the inside line, only when distance to braking point > 60 m; the move flag resets after the corner minimum. preferWeight 1.5.
- `follow`: no bias.
- Racing room is enforced by the planner (overlap infeasible); intents never override feasibility.

## Integration (261, 262)

- 261 `RaceGame`: optional `RaceConfig.scenario` (`starts: {s, d, v}[]` per car index, `speedScales?: number[]`, `frozen?: number[]` car indices held with brake 1) and `contactCount` (car–car contact events since go, counted once per pair per 0.5 s).
- 262 wiring: per AI `Racecraft` + `LanePlanner` replace `trafficDecision`; aggression easy 0.2, medium 0.4, hard 0.7, expert 0.9.

## Learned AI (M2.3, 263–267)

Pulled forward by the user (2026-10-17); the policy is retrained after vehicle-model changes.
- 263 `src/ai/rl/raceEnv.ts`: gym-style `reset(seed, scenario)` / `step(actions)` over `RaceGame`; action = [steer, throttle−brake] at 30 Hz (4 ticks); observation = 64 floats: [0..4] v/100, d/6, heading error (rad), yaw rate, rear slip; [5..16] curv·50, [17..28] (halfLeft + d)/10, [29..40] (halfRight − d)/10 at 0,10,20,40,60,80,100,130,160,200,250,300 m ahead; [41..58] 6 nearest cars by |gap| (Δs/100, Δd/6, Δv/20; zeros when absent); [59..60] previous action; [61] profileV(s)/100; [62] lap fraction; [63] 0; reward = progress Δs/100 − 5·contact − 1·offTrack-step − 0.01·|Δsteer| + 2·overtake.
- 264 `tools/rl/envServer.ts` (Node, binary stdin/stdout, N envs per process) + `tools/rl/client.py`.
- 265 `tools/rl/train.py` (PyTorch, local RTX 5060): behaviour cloning from the 262 AI, then PPO with 8–10 env processes; checkpoints to `tools/rl/runs/`.
- 266 `src/ai/policyNet.ts` (MLP 64-128-128-2, tanh, weights JSON in `public/ai/`) + `LearnedDriver` with the `AiDriver` input contract.
- 267 evaluation: learned vs racecraft on 3 tracks × 8 cars; enabled for hard/expert only if lap time ≤ and contacts ≤ the classic AI.

Measured 2026-10-17: headless `RaceGame` = 5–7 k car-steps/s per core (monza, f4, 2–16 cars), enough for PPO overnight on 10 cores.
