# 110 — Audio effects

Status: pending
Phase: 1
Depends on: 109
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Add shift cut, exhaust crackle on lift-off, wind, kerb rumble, gravel and an improved tyre squeal, driven by car state, via pure helpers plus wiring.

## Context

M1.7 plan (`docs/plans/m1.7-audio.md`). Engine synthesis exists (108/109). Effects use noise buffers and gains in the existing `EngineAudio` context; the pure helpers are the tested contract. `Math.random` is allowed only in wiring, never in the helpers (rng is injected).

## Files

- `src/audio/effects.ts` — create — pure helpers.
- `src/audio/engineAudio.ts` — modify — effect nodes and an `updateEffects` method.
- `src/main.ts` — modify — call `updateEffects` per frame.
- `tests/unit/audio/effects.test.ts` — create — edge tests.

## Steps

```ts
export function crackleSchedule(prevThrottle: number, throttle: number, rpm: number, limiterRpm: number, crackle: number, rng: () => number): number[]; // burst offsets, seconds, sorted ascending
export function windGain(speed: number): number;        // m/s
export function kerbRumbleHz(speed: number, stripeMeters: number): number; // Hz
export function shiftEnvelope(t: number): number;       // engine gain multiplier, t seconds since shift start
// EngineAudio:
updateEffects(s: { speed: number; surface: Surface; shifting: boolean; slipRatios: readonly number[] }): void
```

- `Surface` is imported from the existing surface type (as used in `src/main.ts`).
- Crackle: trigger when `prevThrottle > 0.5`, `throttle < 0.15`, `rpm ≥ 0.7·limiterRpm`; count = `round(3 + 5·crackle·rng())` clamped 3..8 only when `crackle > 0`; otherwise `[]`. Offsets uniform in [0, 0.6] via `rng`, sorted.
- `windGain`: piecewise linear through (0 m/s, 0), (40, 0.1), (80, 0.4); constant 0.4 above 80.
- `kerbRumbleHz = speed / stripeMeters`; wiring uses stripe 1.5 m, active when surface is kerb, gain 0.3, band-passed noise modulated at that rate.
- `shiftEnvelope`: 1 at t ≤ 0; linear to 0.3 over 0–0.02; hold 0.3 over 0.02–0.06; linear back to 1 over 0.06–0.08; 1 beyond. Wiring applies it to the engine gain for 0.08 s when `shifting` rises.
- Gravel: low-passed noise gain 0.35 · min(1, speed/20) when surface is gravel; squeal as 051.

Conventions: `crackleSchedule` non-finite inputs → `[]`; `windGain` negative speed → 0; `kerbRumbleHz` stripeMeters ≤ 0 → 0; `shiftEnvelope` t < 0 → 1; boundaries inclusive on the left of each segment; no mutation.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/110-audio-effects.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | throttle 0.9 → 0.05, rpm 6000, limiter 7000, crackle 1, rng fixed | crackleSchedule | 3–8 offsets, sorted, all in [0, 0.6] s |
| AT2 | same with rpm 4000 (< 0.7·limiter) / crackle 0 / throttle 0.5 → 0.3 | crackleSchedule | [] |
| AT3 | windGain(0 / 40 / 80 / 120 m/s) | call | 0 / 0.1 / 0.4 / 0.4 (± 1e-9) |
| AT4 | kerbRumbleHz(30, 1.5) | call | 20 |
| AT5 | shiftEnvelope(0 / 0.04 / 0.08 / 0.2 s) | call | 1 → dips to 0.3 at 0.04 → back to 1 by 0.08 → 1 (± 1e-6; linear segments 0–0.02 down, 0.02–0.06 hold, 0.06–0.08 up) |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Wiring does not create objects per frame; effect nodes are disposed in `dispose()`.
- [ ] Engine sound still works if effect wiring is absent (`updateEffects` optional to call).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Volume settings, cockpit filter, pause (111); AI car sounds and spatial audio; collision sounds; music.
