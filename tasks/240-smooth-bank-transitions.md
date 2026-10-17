# 240 — Smooth bank transitions on ovals

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer
Milestone: M1.11 (track fidelity; design `docs/design/track-fidelity.md`)

## Goal

Banked-to-flat transitions on ovals become smooth (smoothstep ramps inside each bank range) instead of a 60 m linear ramp centred on the boundary.

## Context

Design section "240 — Smooth bank transitions on ovals": implement its rules exactly. Current `bankProfile` (`tools/track-builder/banking.ts`) uses `rampMeters = 60` default and a centred linear `rampFactor`; Daytona goes 0 → 31° in 60 m.

## Files

- `tools/track-builder/banking.ts` — modify.
- `tools/track-builder/buildTrack.ts` — modify: the only caller (`bankProfile(cum, lapLength, config.banking ?? [])`, line ~109) must use auto mode (4th argument omitted).
- `public/tracks/daytona.json`, `public/tracks/fontana.json`, `public/tracks/fontana-roval.json` — regenerate.
- `tests/unit/acceptance/240-smooth-bank-transitions.test.ts` — create from the table.

## Steps

```ts
export function bankProfile(
  cumulativeMeters: number[],
  lengthMeters: number,
  ranges: BankRange[],
  rampMeters?: number, // no default value any more
): number[];
```

1. Signature, validation errors, wrap handling, sign (`left` negative), overlap rule (larger magnitude wins, sign included) and non-mutation stay as today.
2. `rampMeters` omitted (`undefined`) = auto mode: per range `R = max(60, 7.5·|degrees|)` m; if `2R > span` then `R = span/2`. Value = `full · f(u)`, smoothstep `f(u) = u²(3 − 2u)`, `u` = clamp01(distance inside the range from the nearer end / R). Zero at `from` and `to`, full from `from + R` to `to − R`. Ranges with `degrees === 0` or span 0 are skipped (as today).
3. `rampMeters` given (including 60) = today's behaviour exactly (linear, centred); the non-finite check applies only when it is given.
4. Rebuild: `npx tsx tools/track-builder/buildTrack.ts daytona fontana fontana-roval` (= `npm run build:tracks -- daytona fontana fontana-roval`). Commit only those three JSONs; no other track JSON may change.

Conventions: distances in metres along the ring, wrap-aware; boundary inclusive of zero (value 0 exactly at `from`/`to`); invalid input throws as today; inputs not mutated; ties on overlap keep the earlier range's value.

## Planner-authorised edits

In `tests/unit/acceptance/174-track-banking.test.ts` only: `wrapMargin(cum[i], from, to, total) < 60` becomes `< 240`, and the message `no index at least 60 m inside ...` becomes `no index at least 240 m inside ...`. No other edits to existing acceptance tests.

In `tests/unit/edge/174-track-banking-edge.test.ts`: EDGE2 (`omitting rampMeters equals passing 60`) is obsolete under auto mode; replace its assertion with `expect(bankProfile(cum, 1000, ranges, 60)).not.toEqual(bankProfile(cum, 1000, ranges))` and rename it `EDGE2: omitting rampMeters selects auto mode`. No other edge-test edits.

## Acceptance tests (defined by the planner with Opus, before coding)

Fixtures: `cum = [0, 1, …, 4999]`, length 5000; range A = `{from 1000, to 2000, degrees 31, right}`; range B = `{from 3000, to 3100, degrees 31, right}`; range C = `{from 4000, to 4500, degrees 2, left}`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | A, auto | bankProfile | bank[1500] = 31° ± 1e-9; bank[1000], bank[2000], bank[999], bank[2001], bank[500] = 0 ± 1e-12; bank[1000 + 232.5 rounded up = 1233] = 31° ± 1e-9 |
| AT2 | A, auto | consecutive differences over all i | max \|bank[i+1] − bank[i]\| ≤ 0.2° · 1.01 |
| AT3 | A, auto | second differences | at i = 1000 and i = 1233: \|bank[i+1] − 2·bank[i] + bank[i−1]\| ≤ 0.003° (no kink; a linear ramp gives 0.13°) |
| AT4 | A, auto | value at the ramp midpoint i = 1116 | 15.5° ± 0.3° |
| AT5 | B, auto (span 100 < 2R) | bankProfile | all finite; peak at i = 3050 equals 31° ± 1e-9 (R = 50); bank[3000] = bank[3100] = 0 |
| AT6 | C, auto | bankProfile | sign negative inside; R = 60: bank[4060] = −2° ± 1e-9; max step ≤ 1.5·2°/60 · 1.01 |
| AT7 | A with explicit `60` | bankProfile | identical to the pre-change linear centred result (bank[1000] = 15.5°, bank[970] = 0, bank[1030] = 31°) |
| AT8 | rebuilt daytona, fontana, fontana-roval JSON | per-metre bank change along the centerline (Δbank / Δs between consecutive points) | ≤ 0.2°/m · 1.05 everywhere; max \|bank\| = 31° / 11° / 14° ± 0.1° respectively |
| AT9 | — | 174 acceptance and edge tests | pass, with only the planner-authorised edits above |

## Acceptance criteria

- [ ] All AT rows pass; the edit to the 174 acceptance test is exactly the authorised one.
- [ ] Only the three listed track JSONs changed in `public/tracks/`.
- [ ] No new dependencies.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Physics, rendering, other tracks, `tracks.json` banking data, new banking ranges, changing how `bank` is consumed in `src/`.

## Planner-authorised test edits

- `tests/unit/edge/174-track-banking-edge.test.ts` EDGE10: invert to assert every surface vertex outside the banked ranges has bank exactly 0.
- `tests/unit/edge/174-bank-per-index.post.test.ts` (~262-265): full-bank margin 100 m → 240 m.
- `tests/unit/edge/211-fontana-roval-edge.test.ts` (~152): replace the hard-coded sha256 with that of the rebuilt `fontana.json` (report the new hash).
