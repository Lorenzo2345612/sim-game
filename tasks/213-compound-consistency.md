# 213 — Make soft/hard compounds consistent with medium for GT3, LMP2 and Hypercar

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In every GT3, LMP2 and Hypercar car JSON, soft grips more than medium and medium more than hard, following the F4 pattern.

## Context

`soft`/`hard` in these files were copied from an old base (mu0 1.749/1.5675, Fz0 2000, Bx 14, heatCoef 1.2e-4) and do not match the calibrated `medium` (GT3 medium grips less than hard; LMP2 medium more than soft). `public/cars/f4.json` is the reference: soft/hard equal medium except `mu0`, `optTempC`, `wearRate`. Data-only change; no `src/` change.

## Files

- `public/cars/gt3-a.json`, `gt3-b.json`, `gt3-c.json`, `gt3-d.json`, `lmp2-a.json`, `hyper-a.json` — modify — rewrite `tyres.compounds.soft` and `.hard`.
- `tests/unit/acceptance/213-compound-consistency.test.ts` — create (acceptance worker).

## Steps

1. In each of the 6 files, make `soft` and `hard` full copies of that file's own `medium` (all fields), then override only:
   - soft: `mu0` = medium.mu0 × 1.06, `optTempC` = 85, `wearRate` = medium.wearRate × 2.
   - hard: `mu0` = medium.mu0 × 0.95, `optTempC` = 95, `wearRate` = medium.wearRate × 0.46.
2. `medium` stays unchanged. Do not touch `f4.json` or any file under `ai/lab`.

Conventions: round `mu0` to 6 decimals; `wearRate` is the exact product (no rounding); invalid input N/A (data only); no tie-breaks; no mutation of other fields.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each of gt3-a, gt3-b, gt3-c, gt3-d, lmp2-a, hyper-a via `parseCarSpec` | read compounds | soft.mu0 = medium.mu0 × 1.06 and hard.mu0 = medium.mu0 × 0.95 (±1e-6); so soft > medium > hard |
| AT2 | same cars | compare soft and hard with medium field by field | every field except `mu0`, `optTempC`, `wearRate` equal to medium's (Fz0, loadSens, Bx, Cx, Ex, By, Cy, Ey, tempWindowC, heatCoef, coolCoef, wearGripLoss, cliffWear) |
| AT3 | same cars | optTempC, wearRate | soft 85 / hard 95; soft.wearRate = 2 × medium (±1e-15), hard = 0.46 × medium (±1e-15) |
| AT4 | values: gt3-* medium 1.55, lmp2-a 1.8, hyper-a 1.75 | soft/hard mu0 | gt3 1.643 / 1.4725; lmp2 1.908 / 1.71; hyper 1.855 / 1.6625 (±1e-6); medium unchanged |
| AT5 | `public/cars/f4.json` | parse | compounds unchanged: soft 1.81896, medium 1.716, hard 1.6302 |

## Acceptance criteria

- [ ] All 5 acceptance rows pass.
- [ ] Existing tests still pass: 058, 072, 113 acceptance and `tests/unit/calibration`.
- [ ] `git diff --stat` touches only the 6 JSONs (plus the acceptance test).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `f4.json`, `ai/lab` files, any `src/` change, medium compound values, new compounds or fields.
