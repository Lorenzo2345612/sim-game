# 230 — Mixer: cockpit bus, master dynamics, smooth camera switch

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The master bus ends in a compressor plus limiter, the cockpit view gets a brighter low-pass (2500 Hz) with a short room reverb send, and camera switches ramp smoothly instead of stepping.

## Context

Design: `docs/design/engine-audio-v2.md` (task 230 row). The bus graph is built in `EngineAudio.mixerNodes()`; `Mixer.setCameraMode(mode)` is the existing cockpit/exterior switch (cockpit → cockpit values, any other mode → exterior values). Web Audio only; tests use fake contexts.

## Files

- `src/audio/mixer.ts` — modify.
- `src/audio/engineAudio.ts` — modify (`mixerNodes()` only).
- `tests/unit/acceptance/230-audio-mixer-dynamics.test.ts` — create (from the table).
- Frozen-test edits (planner-authorised, new values below): `tests/unit/audio/mixer.test.ts`, `tests/unit/acceptance/111-audio-mix.test.ts`.

## Steps

```ts
export const COCKPIT_LOWPASS_HZ = 2500;           // was 1200
export interface MixerNodes { /* existing fields */ cockpitWet?: GainNode }  // new optional field
export const COCKPIT_WET_GAIN = 0.25;
export const CAMERA_TAU_S = 0.05;
export function cockpitImpulse(sampleRate: number): Float32Array; // length Math.round(0.08 * sampleRate)
```
1. `mixerNodes()` builds `master → DynamicsCompressor A (threshold -18, ratio 4, attack 0.005, release 0.15) → DynamicsCompressor B (threshold -2, ratio 20, attack 0.001, release 0.05) → destination`. Replace the current `master → destination` link; set `.value` fields via `setValueAtTime(…, now)`; knee defaults. Both compressors are created inside `mixerNodes()` only.
2. Cockpit reverb: `engineFilter → ConvolverNode` (buffer from `cockpitImpulse`, `normalize = false`) `→ cockpitWet (GainNode, initial 0) → engine`. Dry path unchanged. Return `cockpitWet` in the nodes.
3. `cockpitImpulse`: deterministic (fixed-seed PRNG, no `Math.random`) noise times exponential decay; peak |x| ≤ 1; energy of the last 10 ms < 5 % of the first 10 ms.
4. `setCameraMode`: `engineFilter.frequency.setTargetAtTime(cockpit ? COCKPIT_LOWPASS_HZ : BYPASS_LOWPASS_HZ, now, CAMERA_TAU_S)`; `cockpitWet.gain.setTargetAtTime(cockpit ? COCKPIT_WET_GAIN : 0, now, CAMERA_TAU_S)` when present. No `setValueAtTime` in this method.

Conventions: sampleRate ≤ 0 or non-finite → throw `RangeError`; no mutation of inputs.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `src/audio/mixer.ts` | import | `COCKPIT_LOWPASS_HZ === 2500` |
| AT2 | Mixer on a fake ctx | build | graph ends `… → DynamicsCompressor(threshold −18, ratio 4, attack 0.005, release 0.15) → DynamicsCompressor(threshold −2, ratio 20, attack 0.001, release 0.05) → destination` |
| AT3 | Mixer | switch to cockpit / exterior (existing method) | lowpass frequency set via `setTargetAtTime(2500 / BYPASS_LOWPASS_HZ, t, 0.05)`; no `setValueAtTime` on that param during the switch |
| AT4 | Mixer at sampleRate 48000 | cockpit convolver buffer | length `round(0.08·48000)`; deterministic across two builds; peak |x| ≤ 1; energy of the last 10 ms < 5 % of the first 10 ms |
| AT5 | Mixer | cockpit / exterior | convolver wet gain target 0.25 / 0 via `setTargetAtTime` (τ 0.05) |

## Frozen-test edits (planner-authorised)

- `tests/unit/acceptance/111-audio-mix.test.ts` AT2: title and expectation `1200` → `2500`; `22050` unchanged.
- `tests/unit/audio/mixer.test.ts`: `WireContext` gains `createDynamicsCompressor()` (node with `threshold, knee, ratio, attack, release` FakeParams) and `createConvolver()` (node with `buffer`, `normalize`); `FakeParam.setTargetAtTime` already sets `.value`. Gain-count/index assertions shift because `cockpitWet` adds one gain after `effects`: 6 → 7 gains, and indices of wind/kerbAmp/gravel/crackleBus (6,7,9,10) → (7,8,10,11). Expectations using `COCKPIT_LOWPASS_HZ` need no change.

## Acceptance criteria

- [ ] All AT rows pass; edited frozen tests pass with the values above; no other frozen test changes.
- [ ] `setCameraMode` contains no `setValueAtTime`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Engine voice, worklet, per-car data, UI, settings, pause ramp behaviour, effects bus levels.
