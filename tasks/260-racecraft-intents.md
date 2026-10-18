# 260 — Racecraft intents (attack, defend, rejoin)

Status: pending
Phase: 2
Depends on: 258
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

A per-car intent state machine (follow, attack, defend, rejoin) that produces a `PlanBias` for the lane planner (design: "Racecraft intents").

## Context

Imports from `src/ai/raceView.ts` (258): `CarView`, `Neighbour`, `TrackCorridor`, `CorridorSample`, `BrakingPoint`, `PlanBias`, `corridorAt`, `brakingPoint`. Do not redefine them. No `three`, no allocation per update.

## Files

- `src/ai/racecraft.ts` — create.
- `tests/unit/acceptance/260-racecraft-intents.test.ts` — by the acceptance worker; edge tests by tester-pre/tester.

## Steps

```ts
export type Intent = 'follow' | 'attack' | 'defend' | 'rejoin';
export class Racecraft {
  constructor(corridor: TrackCorridor, aggression: number);
  update(self: CarView, neighbours: readonly Neighbour[], dt: number, out: PlanBias, count?: number): Intent;
  get intent(): Intent;
}
```

- `count` defaults to `neighbours.length`; neighbours are not assumed sorted. "Car ahead" = smallest positive gap; "car behind" = largest negative gap. Time gap ahead = gap / max(v, 1); behind = −gap / max(v_o, 1). `follow` writes `{preferD null, preferWeight 0, speedCap null}`.
- Priority: `rejoin` > `attack` > `defend` > `follow`. Rules as in the design doc, fixed here:
  - `rejoin`: self offTrack or stopped. preferD = `clamp(d, −halfLeft + 1.5, halfRight − 1.5)`, preferWeight 2, speedCap 12; speedCap 0 while any neighbour with gap < 0 has time gap < 2.5 s, v_o > 0.1 and |d_o − preferD| < 3. Entered and left immediately (no minimum time).
  - `attack` start: car ahead not `stopped`, time gap < 1.0, and (`profileV(self.s)` ≥ v_ahead + 0.5 or gap < 15), a braking point exists with distance > 30. preferD = `halfRight − 1.5` for cornerSign +1, `−halfLeft + 1.5` for −1 (corridor at `self.s`); preferWeight = 0.5 + 2·aggression. Inside distance ≤ 30 a running attack keeps its stored preferD while the car-ahead conditions (except the 30 m rule) hold.
  - `defend` start: car behind with time gap < 0.8, v_o > v, move not yet used on this straight, braking-point distance > 60 (no braking point within 400 m: no defence move, intent stays `follow`). Otherwise as attack (inside line, preferWeight 1.5). Using it sets "moveUsed" and stores the braking point's absolute s; moveUsed clears when self is past that s (wrapped travel in (0, 400]) and `profileV` is not decreasing (corner minimum passed). A running defend keeps its stored preferD inside ≤ 60 m while conditions hold. Rejoin `preferWeight` 2 is final.
- Minimum 0.5 s per intent: each `update` adds `dt` to the intent age (age 0 on the call that changes intent); a non-rejoin intent may only be left when age ≥ 0.5 − 1e-9 (while held, the stored bias is output). Leaving goes to the highest-priority intent whose conditions hold, else `follow`.

Conventions: thresholds strict as written (`<`, `>`); v clamped as above; inputs not mutated except `out`.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixture C of 258 (right corner, minimum at s 600, braking point from s 300 at 514). Self halfLen 2, halfWid 0.9, aggression 0.7 unless stated; `update(..., dt 0.1)`; fresh `Racecraft` per row.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | self s 300 v 55 d 0; car ahead gap 20, v 50, d 0 | update | intent 'attack'; bias preferD 4.5, preferWeight 1.9 (±1e-9), speedCap null |
| AT2 | same, car ahead gap 60 (1.09 s) | update | 'follow'; preferD null |
| AT3 | car ahead gap 30, v 59.8 (own profile 60 < 59.8 + 0.5) | update | 'follow'; with gap 14: 'attack' |
| AT4 | self s 495 (braking point 19 m ahead), car ahead gap 20 v 50, fresh | update | 'follow' (no new attack < 30 m); a Racecraft already attacking since s 300 keeps preferD 4.5 at s 495 |
| AT5 | self s 300 v 55; car behind gap −20, v 58 | update | 'defend'; preferD 4.5; preferWeight 1.5 |
| AT6 | after AT5, behind car gone 1 s (follow), then back at gap −20 v 58 at s 420 | update | no defend bias (one move per straight); at s 610 onward (past minimum) a new defend is allowed at the next straight with distance to braking > 60 |
| AT7 | self d 7 (offTrack), s 100, v 20 | update | 'rejoin'; preferD 4.5; speedCap 12 |
| AT8 | AT7 + neighbour gap −40, v 50, d 4 | update | speedCap 0; same neighbour at d −4: speedCap 12 |
| AT9 | self stopped true on track d 0 | update | 'rejoin' |
| AT10 | attack started, conditions vanish after 0.2 s | update every 0.1 s | still 'attack' at 0.4 s; 'follow' by 0.6 s |
| AT11 | car ahead stopped true, gap 20 | update | not 'attack' |
| AT12 | aggression 0.2 | AT1 | preferWeight 0.9 |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/260-racecraft-intents.test.ts`.
- [ ] No `three` import; `update` allocates nothing.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Lane planning (259), `RaceGame` wiring (262), pit/flag/penalty behaviour, learning-based AI.
