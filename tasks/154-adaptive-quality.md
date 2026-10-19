# 154 — Adaptive quality (dynamic resolution, auto preset)

Status: pending
Phase: 3
Depends on: 151
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The renderer adjusts its pixel ratio from measured frame times and lowers the quality preset when the machine is clearly too slow.

## Context

M5, design `docs/plans/late-features.md` ("154"). Read the current code first: this task runs after 151 (`FrameRing`/`perfStats` in `src/core/perfStats.ts`); adapt file names to what exists, keep the public contract. `src/core/settings.ts` has `Preset`, `presetSettings`, `loadPreset`, `SETTINGS_KEY` (other keys in the JSON must be preserved on save). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/render/dynamicResolution.ts` — create (pure, no `three`).
- `src/core/settings.ts` — modify: `loadAdaptive(storage): boolean` (key `adaptive` in the `SETTINGS_KEY` JSON, default true, corrupt/non-boolean → true).
- `src/main.ts` — modify: when adaptive, feed `frameMs` to `DynamicResolution.update` and call `renderer.setPixelRatio` when the ratio changes; run `autoPreset` once at 5 s of running and apply `presetSettings(result)` pixel ratio and shadow flag at runtime (not persisted).
- `tests/unit/acceptance/154-adaptive-quality.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Preset } from '../core/settings';
export interface DynamicResolutionOptions { initial: number; max: number; min?: number /* default 0.6 */ }
export class DynamicResolution {
  constructor(opts: DynamicResolutionOptions);
  update(frameMs: number): number; // returns the current pixel ratio
  readonly ratio: number;
}
export function autoPreset(samples: readonly number[], current?: Preset /* default 'high' */): Preset;
```

1. `update`: collects frames; every 60 frames evaluates the median (p50) of those 60: p50 > 18 → ratio −0.1 (not below `min`); p50 < 13 → ratio +0.05 (not above `max`); otherwise unchanged. Returns the ratio after each call; non-finite `frameMs` ignored. Target frame time 16.7 ms is informational only.
2. `max` in `main.ts` = device ratio, but ≤ 1.0 when the preset is `medium`; `initial = min(presetSettings pixelRatio, max)`.
3. `autoPreset(samples)`: median of `samples` (ms); > 25 → `'low'`; > 18 → `'medium'` only if `current` is `'high'` (never raises: result is the lower of target and `current`); else `current`. Fewer than 60 samples → `current`.
4. Default setting `adaptive: true`; when false neither mechanism runs.

Conventions: ratio rounded to 1e-9 not required; comparisons strict (`> 18`, `< 13`, `> 25`); inputs not mutated; no allocation per `update` (preallocated 60-slot buffer).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 25 ms frames from ratio 1.0, max 1.0 | update 120 / 240 / 1200 frames | ratio 0.9 / 0.8 / 0.75 (floor) ± 1e-9 |
| AT2 | 600 frames at 16 ms from 0.75, max 1.0 | update | ratio 1.0 (capped) |
| AT3 | 600 frames at 16.7 ms, then 600 at 19 ms, from 1.0 | update | ratio stays 1.0 (no 60 Hz ratchet) |
| AT4 | 300 samples at 30 / 20 / 12 ms; 300 at 30 ms with current `'medium'`; 300 at 150 ms | autoPreset | medium / high / high; low; high (all ignored) |

Amended 2026-10-19 (perf batch): hysteresis controller (period-relative thresholds, 2 s cooldown, floor 0.75) and one-level auto-preset.

## Acceptance criteria

- [ ] AT1–AT4 pass (AT3 with `current` omitted = `'high'`; "unchanged" = `'high'`).
- [ ] `adaptive` false in storage → pixel ratio never changes at runtime.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Settings menu UI; persisting the auto-selected preset; dynamic shadow or LOD changes (152).
- README, tasks.json, milestones.json.
