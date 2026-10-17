# Engine audio v2 (tasks 226-232)

Research: `docs/research/engine-audio/{techniques,na-engines,turbo-hybrid,drivetrain-mix}.md`. Old `src/audio/engineSynth.ts` stays untouched (108 tests); the worklet switches to the new `EngineVoice`.

Causes of the bad sound (techniques.md §1): DC-biased pulse into permanent `tanh` clipping, positive-feedback undamped comb, identical pulses ignoring firing order, pedal-only load, per-block stepped control, same `sound` block for most cars.

## Flow

```
226 soundSpec (types, parser, CarSound.synth) ──> 227 EngineVoice core ──> 228 layers ──> 229 worklet/engineAudio/main wiring
                                         └──> 231 per-car synth data          └──> 232 offline render tool
230 mixer (cockpit bus, master compressor/limiter, smooth camera switch) — independent
```

Milestone M1.9 "Engine audio v2".

## Contracts

```ts
// src/audio/soundSpec.ts (226)
export interface BlockMode { hz: number; q: number; gainDb: number }
export interface TurboLayer { centerHz: number; spanHz: number; gain: number; lagS: number }
export interface WhineLayer { order: number; gain: number; source: 'rpm' | 'wheel'; minSpeedMs: number }
export interface EngineSynthSpec {
  firingDeg: number[]; bank: number[]; pipeM: [number, number]; tailM: number; gasSpeedMs: number;
  pulseDeg: number; jitterDeg: number; jitterAmp: number; intakeHz: number; intakeMix: number;
  block: BlockMode[]; lowpassHz: number; drive: number; turbo: TurboLayer | null; whine: WhineLayer | null;
  crackle: number; limiterHz: number; gainDb: number;
}
export const SYNTH_DEFAULTS: Omit<EngineSynthSpec, 'firingDeg' | 'bank' | 'pipeM' | 'tailM' | 'intakeMix' | 'crackle'>;
export function evenFiring(cylinders: number): number[];
export function legacySynthSpec(s: { cylinders: number; exhaustLengthM: number; intakeMix: number; crackle: number }): EngineSynthSpec;
export function parseEngineSynth(raw: unknown, legacy: { cylinders: number; exhaustLengthM: number; intakeMix: number; crackle: number }): { spec: EngineSynthSpec; errors: string[] };

// src/audio/engineVoice.ts (227, layers 228)
export interface VoiceControl { rpm: number; load: number; throttle: number; wheelSpeedMs: number; limiter: boolean }
export const RPM_SLEW_S = 0.02; export const LOAD_SLEW_S = 0.03; export const WHEEL_RADIUS_M = 0.33;
export class EngineVoice {
  constructor(spec: EngineSynthSpec, sampleRate: number, seed: number);
  setControl(c: VoiceControl): void; // targets, slewed per sample (one-pole, time constants above)
  render(out: Float32Array): void;   // mono, fills out.length, no allocation
  reset(): void;
}
```

Ranges (parser errors name the path `synth.<field>`): firingDeg each in [0,720), length 1..12, same length as bank; bank values 0|1; pipeM each (0,5]; tailM (0,5]; gasSpeedMs [300,700] (default 480); pulseDeg [20,240] (110); jitterDeg [0,2] (0.2); jitterAmp [0,0.3] (0.05); intakeHz [80,1200] (300); intakeMix [0,1]; block ≤ 6 entries, hz [40,8000], q [0.5,30], gainDb [-24,24] (default []); lowpassHz [800,20000] (6000); drive [0.5,4] (1.2); turbo centerHz [500,12000], spanHz [100,8000], gain [0,0.3], lagS [0,3] (default null); whine order (0,100], gain [0,0.3], source rpm|wheel, minSpeedMs [0,100] (default null); crackle [0,1]; limiterHz [5,40] (15); gainDb [-12,12] (0).
Legacy mapping: firingDeg = evenFiring(cylinders), bank alternates 0,1,…, pipeM = [L/2, L/2], tailM = L/2, intakeMix and crackle copied, rest defaults. Absent `sound.synth` → legacy; present → missing fields from defaults, missing firingDeg → evenFiring(cylinders), missing bank → alternating, missing pipeM/tailM → legacy values.

Voice rules (227): crank angle in a 720° cycle advanced per sample by rpm·6/fs degrees; cylinder i fires when the angle crosses firingDeg[i] + gaussian jitter (jitterDeg); pulse amplitude (0.25 + 0.75·load)·(1 + jitterAmp·n); pulse = band-limited kernel (precomputed table, ≥ 8× oversampled, low-passed ≤ 0.45·fs) written at the fractional crossing position, width pulseDeg converted to time at current rpm and clamped to [0.3, 8] ms; per bank a fractional-delay tube (delay 2·pipeM/gasSpeedMs) with open-end reflection −0.85 and a one-pole low-pass in the loop; banks summed into a tail tube (tailM); radiated = first difference; DC blocker (corner ≤ 20 Hz); asymmetric soft clip (drive) 2× oversampled; output scaled by gainDb with peak ≤ 0.9.
Layers (228): intake = noise gated per cylinder by an intake window (crank 360-540° after its firing) through a resonator at intakeHz, gain intakeMix·throttle; block = parallel band-pass modes excited by the pulse train; lowpassHz = 2-pole muffling filter on the exhaust; turbo = band noise centred `centerHz + spanHz·boost`, gain `turbo.gain·boost`, boost = load slewed with time constant lagS; whine = sine at `order·rpm/60` (rpm) or `order·wheelSpeedMs/(2π·WHEEL_RADIUS_M)` (wheel, silent below minSpeedMs), gain `whine.gain`; limiter = ignition cut gate at limiterHz (50 % duty) on pulses; crackle = overrun pops (throttle < 0.05, rpm > 4000) as extra pulses injected into the exhaust, Poisson rate `crackle·20` /s for 1 s after lift.

## Acceptance tables (Opus; copy verbatim into specs)

### 226 — Engine sound spec and parser

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | — | `evenFiring(8)`, `evenFiring(6)` | `[0,90,180,270,360,450,540,630]`; `[0,120,240,360,480,600]` |
| AT2 | `{cylinders:4, exhaustLengthM:1.0, intakeMix:0.35, crackle:0.1}` | `legacySynthSpec` | firingDeg `[0,180,360,540]`, bank `[0,1,0,1]`, pipeM `[0.5,0.5]`, tailM 0.5, intakeMix 0.35, crackle 0.1, turbo null, whine null, every other field = `SYNTH_DEFAULTS` |
| AT3 | a full valid raw object with every field set to a non-default in-range value | `parseEngineSynth(raw, legacy)` | errors `[]`; spec deep-equals the input |
| AT4 | raw `{}` with legacy `{cylinders:6, exhaustLengthM:1.2, intakeMix:0.3, crackle:0.2}` | parse | errors `[]`; spec deep-equals `legacySynthSpec(legacy)`; `SYNTH_DEFAULTS` has gasSpeedMs 480, pulseDeg 110, jitterDeg 0.2, jitterAmp 0.05, intakeHz 300, block `[]`, lowpassHz 6000, drive 1.2, turbo null, whine null, limiterHz 15, gainDb 0 |
| AT5 | raws: firingDeg `[0,720]`; bank length ≠ firingDeg length; pipeM `[0,1]`; 7 block modes; whine source `'x'`; turbo gain 0.5 | parse each | each has ≥ 1 error containing respectively `synth.firingDeg`, `synth.bank`, `synth.pipeM`, `synth.block`, `synth.whine`, `synth.turbo`; never throws |
| AT6 | every `public/cars/*.json` except `index.json` | `parseCarSpec` (existing loader) | no throw; `sound.synth.firingDeg.length === sound.cylinders` |
| AT7 | a valid car json with `sound.synth.firingDeg: [0, 800]` | `parseCarSpec` | throws; message contains `sound.synth.firingDeg` |

### 227 — EngineVoice core (pulse train, exhaust, DC, clip, slew)

Test spec base: `legacySynthSpec(...)` overridden with `intakeMix 0, block [], turbo null, whine null, crackle 0, lowpassHz 20000, jitterDeg 0, jitterAmp 0` unless stated; fs 48000; seed 1; warm-up 0.5 s before measuring; spectra = 1 s FFT with Hann window.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 8 cyl even, rpm 6000, load 1 | render 1 s | no NaN/Inf; |mean| < 1e-3; max |x| ≤ 0.9; RMS > 0.01 |
| AT2 | same | normalised autocorrelation over lags 0.5-20 ms | smallest lag with value ≥ 0.9 × the max over that range is 2.5 ms ± 2 samples |
| AT3 | 4 cyl, rpm 6000, load 1; A firingDeg `[0,180,360,540]`, B `[0,90,360,450]` (bank `[0,1,0,1]`) | energy in bins 100/300/500/700 Hz ± 3 Hz vs 200/400/600/800 Hz ± 3 Hz | ratio < 0.05 for A; > 0.2 for B |
| AT4 | 8 cyl even, rpm 6000, load 1; pipeM `[0.5,0.5]` vs `[0.5,0.9]` | 1/3-octave band levels 100-4000 Hz | max |difference| ≥ 3 dB |
| AT5 | 8 cyl even, rpm 6000; load 1 vs load 0.1 | RMS | RMS(load 1) ≥ 1.8 × RMS(load 0.1) |
| AT6 | 8 cyl even, load 1; rpm 3000 for 0.5 s, then setControl rpm 9000 | render 0.5 s more in 128-sample blocks | max |x[n]−x[n−1]| during the 0.2 s after the step ≤ 2 × the same max over a steady 9000 rpm second; autocorrelation (AT2 method) of the last 0.25 s gives 1/600 s ± 1 % |
| AT7 | 6 cyl even, rpm 15000, load 1 | spectrum | energy above 20 kHz < −40 dB relative to total |
| AT8 | rpm 6000 load 1 for 0.5 s, then rpm 0 load 0 | render 0.5 s | RMS of the last 0.2 s < 1e-4 |
| AT9 | jitterDeg 0.2, jitterAmp 0.05 | two voices same seed vs seeds 1 and 2, 0.5 s | same seed identical arrays; different seeds differ |
| AT10 | — | 108 acceptance and edge tests | pass; `src/audio/engineSynth.ts` unchanged |

### 228 — EngineVoice layers (intake, block, muffling, turbo, whine, limiter, crackle)

Same test base and method as 227; each row changes only the named field.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rpm 6000, load 1, throttle 1, intakeHz 300; intakeMix 0 vs 1 | band 212-424 Hz energy | +≥ 6 dB with intakeMix 1 |
| AT2 | block `[]` vs `[{hz:900,q:8,gainDb:12}]` | 1/3-octave band at 900 Hz | +≥ 4 dB |
| AT3 | lowpassHz 12000 vs 1500 | energy above 4 kHz | ≥ 12 dB lower with 1500 |
| AT4 | turbo `{centerHz:3000, spanHz:3000, gain:0.05, lagS:0.4}` vs null; rpm 7000, load 1 for 2 s | band 3-6 kHz over the last second | +≥ 6 dB with turbo |
| AT5 | same turbo; load 0 for 1 s, then load 1 | band 3-6 kHz energy in the first 0.1 s after the step vs 1.4-1.5 s after | first < 50 % of later |
| AT6 | whine `{order:18, gain:0.05, source:'rpm', minSpeedMs:0}`, rpm 10000 | spectrum | peak at 3000 Hz ± 5 Hz ≥ 20 dB above the median level of 2.5-3.5 kHz |
| AT7 | whine `{order:14, gain:0.05, source:'wheel', minSpeedMs:33}`; wheelSpeedMs 20 vs 60 | level at `14·v/(2π·0.33)` Hz ± 5 Hz vs median of ±500 Hz | < 6 dB above median at 20; ≥ 20 dB at 60 |
| AT8 | limiter true, limiterHz 15, rpm 8000, load 1 | RMS envelope in 5 ms windows over 1 s | envelope autocorrelation peak at 1/15 s ± 10 %; dips ≥ 6 dB below peaks |
| AT9 | crackle 1 vs 0; rpm 8000, throttle 1 → 0 and load 1 → 0 | 1 s after lift: count clusters (≥ 2 ms apart) with |x| > 3 × RMS of the preceding 50 ms | ≥ 3 with crackle 1; 0 with crackle 0; 0 with crackle 1 while throttle stays 1 |
| AT10 | — | all 227 acceptance tests | pass |

### 229 — Worklet, EngineAudio and main wiring

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | worklet processor (globals mocked as in 109 tests) with processorOptions `{synth: legacySynthSpec(gt3-a sound), seed: 3}` | message `{rpm:5000, load:1, throttle:1, wheelSpeedMs:0, limiter:false}`, 400 × `process` (128 frames) | last 100 blocks RMS > 0.01, no NaN |
| AT2 | EngineAudio with ready worklet (fake ctx) | `update(6000, 0.8, [], {load:0.6, wheelSpeedMs:40})` | last posted message deep-equals `{rpm:6000, load:0.6, throttle:0.8, wheelSpeedMs:40, limiter:false}` |
| AT3 | same | `update(6000, 0.8, [])` | message has load 0.8, wheelSpeedMs 0 |
| AT4 | limiterRpm 9000 | `update(8960, 1, [])` / `update(8940, 1, [])` | limiter true / false |
| AT5 | worklet ready, rpm 8500 throttle 1 → update with throttle 0 | — | no crackle buffer source is scheduled (pops come from the voice); with worklet failed, existing 110 crackle behaviour unchanged |
| AT6 | worklet ready | `setSound(sound)` with a different synth | a new AudioWorkletNode is created with `processorOptions.synth` deep-equal `sound.synth`; the old node is disconnected |
| AT7 | `src/main.ts` source | read | `engineAudio?.update(` call passes a 4th argument with `load` computed from `engineTorque` and `wheelSpeedMs` |

### 230 — Mixer: cockpit bus, master dynamics, smooth camera switch

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `src/audio/mixer.ts` | import | `COCKPIT_LOWPASS_HZ === 2500` |
| AT2 | Mixer on a fake ctx | build | graph ends `… → DynamicsCompressor(threshold −18, ratio 4, attack 0.005, release 0.15) → DynamicsCompressor(threshold −2, ratio 20, attack 0.001, release 0.05) → destination` |
| AT3 | Mixer | switch to cockpit / exterior (existing method) | lowpass frequency set via `setTargetAtTime(2500 / BYPASS_LOWPASS_HZ, t, 0.05)`; no `setValueAtTime` on that param during the switch |
| AT4 | Mixer at sampleRate 48000 | cockpit convolver buffer | length `round(0.08·48000)`; deterministic across two builds; peak |x| ≤ 1; energy of the last 10 ms < 5 % of the first 10 ms |
| AT5 | Mixer | cockpit / exterior | convolver wet gain target 0.25 / 0 via `setTargetAtTime` (τ 0.05) |

### 231 — Per-car synth data

Proposed types (na-engines.md §8, turbo-hybrid.md table): f4 inline-4 turbo; gt3-a cross-plane V8; gt3-b flat-six; gt3-c flat-plane V8; gt3-d V10 (`sound.cylinders` → 10, sound only); lmp2-a flat-plane V8 NA; hyper-a twin-turbo V8 hybrid; ow26 90° V6 turbo hybrid.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each `public/cars/*.json` except index | `parseEngineSynth(sound.synth, sound)` | errors `[]`; `sound.synth` present in the file |
| AT2 | f4 / gt3-b / gt3-c / lmp2-a / hyper-a | firingDeg | `evenFiring(4)` / `evenFiring(6)` / `evenFiring(8)` / `evenFiring(8)` / `evenFiring(8)` |
| AT3 | gt3-a | firingDeg, bank | firingDeg `evenFiring(8)`; bank `[0,1,0,0,1,1,1,0]` (cross-plane, order 1-8-4-3-6-5-7-2) |
| AT4 | gt3-d | firingDeg | 10 values, consecutive intervals alternate 90 and 54 (± 0.5), first 0 |
| AT5 | ow26 | firingDeg | `[0,90,240,330,480,570]` |
| AT6 | all cars | turbo / whine | turbo non-null exactly for f4, hyper-a, ow26; whine source `'rpm'` for ow26, `'wheel'` for hyper-a, null for others |
| AT7 | all cars | pairwise | no two `sound.synth` objects deep-equal |
| AT8 | — | 221 acceptance tests, 226 tests | pass |

### 232 — Offline engine render tool

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run -s audio:render -- --car f4 --out <tmp>` | run | exit 0; files `f4-idle.wav`, `f4-mid.wav`, `f4-redline.wav`, `f4-sweep.wav`, `f4-lift.wav`, `f4.json` in `<tmp>` |
| AT2 | the wavs | parse RIFF header | PCM 16-bit, mono, 48000 Hz; durations idle 2 s, mid 2 s, redline 2 s, sweep 5 s, lift 2 s (± 1 %) |
| AT3 | `f4.json` | read | per scenario `peak ≤ 0.9`, `|dcMean| < 1e-3`; `mid.f0Hz` within 1 % of `0.6·limiterRpm/60·cyl/2` |
| AT4 | two runs, same car | compare | byte-identical outputs |
| AT5 | `--car nope` | run | exit ≠ 0; stderr contains `nope` |

Scenarios: idle (idleRpm, load 0.1, throttle 0.1), mid (0.6·limiterRpm, load 1), redline (limiterRpm − 200, load 1), sweep (idle → limiterRpm linearly in 4 s at load 1, then 1 s at limiterRpm with limiter true), lift (limiterRpm − 500 at load 1 for 0.5 s, then throttle 0, load 0). f0 from the 227 AT2 autocorrelation method. Default `--out .ai/audio`.

### 239 — Turbo transients: blow-off/bypass valve, surge flutter, wastegate, spool-down

Research: `docs/research/engine-audio/turbo-transients.md` (§2 table, §4 recipe). Deps 228 (and 231 data).

Schema (226 types, all optional, absent = old behaviour): `TurboLayer` gains `valve?: 'none'|'bpv'|'bov'`, `flutter?: number` [0,1], `wastegate?: number` [0,1], `wastegateKind?: 'internal'|'external'`, `downLagS?: number` [0,5]. Effective defaults in the voice: valve 'none', flutter 0, wastegate 0, wastegateKind 'internal', downLagS = lagS. The parser keeps absent fields absent (existing deep-equal tests unchanged) and reports bad values under `synth.turbo`.

Voice: boost = load slewed up with lagS, down with downLagS. Trigger per control update: throttle fell at > 3 /s (i.e. Δthrottle/Δt over the last update) while boost > 0.25; 0.3 s refractory; strength s = boost at the trigger. Transients use their own noise generator seeded `seed + 7`, so with every transient off the output is sample-identical to 228. They are summed before the final soft clip and bypass the exhaust low-pass. Recipes per research §4: bov = band noise 3500 + 2000·s Hz, duration 0.25 + 0.5·s s, gain ∝ s^1.5; bpv = 1.8 kHz Q 6 hiss τ 60 ms plus 600 Hz damped sine, ≈ 15 dB below bov; flutter = n = round((4 + 4·s)·flutter) pulses, rate 14 → 7 Hz, each pulse 2 kHz band noise + 250 Hz damped thump, amplitude ×0.8 per pulse; wastegate (external only; internal = nothing) = 3 kHz Q 1 noise, held at −10 dB re engine while load > 0.7 and boost > 0.7, AM by the exhaust pulse envelope, plus a lift chuff (attack 3 ms, τ 80 ms). Gains scaled by `wastegate`.

Car data (231 files): f4 `valve 'bpv', flutter 0.4`; hyper-a `valve 'bpv', flutter 0, wastegate 0.3, wastegateKind 'internal'`; ow26 `valve 'bpv', flutter 0, wastegate 0.5, wastegateKind 'external'`; each `downLagS = 1.5 × lagS`.

Test base: 228 base with `turbo {centerHz 3000, spanHz 3000, gain 0.05, lagS 0.4}` plus the named fields; 8 cyl; rpm 7000; "lift from L" = setControl rpm 7000, load L, throttle L for 2 s, then one setControl rpm 7000, load 0, throttle 0, rendering on in 128-sample blocks; t = 0 at the lift sample. `d` = output minus the output of the same seed with valve 'none', flutter 0, wastegate 0 (same other fields). Baseline RMS `B` = RMS of the baseline output over the 0.5 s before the lift. Envelope = RMS in 5 ms windows. Centroid = power-weighted mean frequency of a Hann-windowed FFT.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | valve 'bov', lift from 1 | d over t 0.02-0.35 s | RMS between B·10^(−12/20) and B·10^(−1/20); centroid in [3000, 7000] Hz |
| AT2 | valve 'bov', lift from 1 | d over t 1.2-1.5 s | RMS < 0.01·B |
| AT3 | valve 'bov'; lift from 1 vs lift from 0.4 vs lift from 0.2 | d energy over t 0-0.5 s | from 1 ≥ 6 dB above from 0.4; from 0.2: max \|d\| < 1e-6 |
| AT4 | valve 'bpv' vs 'bov', lift from 1 | d over t 0.02-0.35 s | bpv centroid in [800, 3000] Hz; bpv energy ≥ 10 dB below bov |
| AT5 | flutter 1, valve 'none', lift from 1 | envelope of d over t 0-1 s; peaks = local maxima ≥ 6 dB above the minima on both sides | 6 to 8 peaks; mean interval between consecutive peaks in [1/14, 1/7] s |
| AT6 | flutter 0.4, lift from 1 | same | 2 to 4 peaks |
| AT7 | wastegate 1, wastegateKind 'internal' vs 'external', lift from 1 | d | internal: max \|d\| < 1e-6 everywhere; external: RMS over the last 1 s before the lift between B·10^(−20/20) and B·10^(−6/20), and RMS over t 0-0.15 s ≥ 2 × that |
| AT8 | downLagS 1.2 vs 0.3 (valve 'none'), lift from 1 | 3-6 kHz band energy of the output over t 0.6-0.8 s | ≥ 3 dB higher with 1.2 |
| AT9 | turbo without the new fields vs explicit `valve 'none', flutter 0, wastegate 0, wastegateKind 'internal', downLagS 0.4`; lift from 1 | 3 s output | arrays identical |
| AT10 | valve 'bov', flutter 0.4, wastegate 0.5 external, lift from 1, but throttle and load ramp 1 → 0 in steps of 0.05 every 50 ms | d over the whole run after the ramp start | max \|d\| < 1e-6 except the held external wastegate before boost drops below 0.7 (check only t ≥ 0.3 s after the ramp start: max \|d\| < 1e-6) |
| AT11 | 6 cyl, rpm 15000, valve 'bov', flutter 1, wastegate 1 external, lift from 1 | 3 s | no NaN/Inf; max \|x\| ≤ 0.9 |
| AT12 | parse raws: valve 'x'; flutter 2; wastegate −1; wastegateKind 'y'; downLagS 9; and a valid turbo with all five fields | parse | each invalid has ≥ 1 error containing `synth.turbo`; valid round-trips the five values; a turbo without them keeps them absent |
| AT13 | car JSONs | parse `sound.synth.turbo` | f4 valve 'bpv', flutter 0.4; hyper-a valve 'bpv', flutter 0, wastegate 0.3, 'internal'; ow26 valve 'bpv', flutter 0, wastegate 0.5, 'external'; each downLagS = 1.5 × its lagS (± 1e-9) |
| AT14 | — | all 226, 227, 228 and 231 acceptance tests | pass |

## 244 — Voice timbre v2.1 (user-approved preview "H5")

Why: the 227 core sounded like a round wave with flanging. Three cascaded high-feedback tubes make fixed comb peaks that the engine harmonics sweep through (flanger), the smooth wide kernel keeps only lows, and identical cylinders give no sub-orders (no character). The user A/B'd previews and approved "H5" for every car. Reference prototype (not production code, read for exact maths): `docs/design/engine-audio-ref/voice-h5.ts` (core) and `render-h5.ts` (layers as prototyped, run with `NAME=H5 PIPE_K=1.5 CYLVAR=0.28 BASS_DB=8 BASS_HZ=160 POPW=1.8`). Research: `docs/research/engine-audio/pops-turbo-muffling.md`.

Core changes (`src/audio/engineVoice.ts`):
1. Kernel: Hann rise over the first 4 % of the width, then `exp(-5d)·(1-d)` decay, d ∈ [0,1] over the rest. Export the table as `PULSE_KERNEL` (Float64Array, length KERNEL_N + 2).
2. Tubes: `REFLECTION` −0.25, `LOOP_LP_HZ` 1800 (exported constants).
3. Per-cylinder traits, drawn once in the constructor and on `reset()` from `mulberry32(seed·7919 + 13)`, for i = 0..cyl−1 in order, three draws each: `amp_i = 1 + cylVar·(2r−1)`, `off_i = 7·cylVar·(2r−1)` degrees, `runner_i = 2·(0.35 + 0.25r)/480` s. Firing angle = firingDeg[i] + off_i (+ jitter). Pulse amplitude × amp_i. Each pulse is also written a second time delayed by runner_i (fractional, linear split) with gain −0.35 into the same bank buffer (one bounce, no feedback). Injection buffers sized for max pulse + max runner.
4. Exhaust path = everything derived from the pulse train (core tubes, 228 block modes, pops). After the 228 muffling low-pass: if `turbo` ≠ null a second identical 2-pole low-pass stage; then an RBJ low-shelf (S = 1) at 160 Hz, gain `bassDb`; then × `exhaustGain`; then the soft clip. Intake, turbo and whine layers bypass shelf and exhaustGain.
5. Pops replace the 228 crackle model: the overrun window opens when throttle falls below 0.05 having been ≥ 0.5 (each new lift restarts it); pops possible from 0.08 s to 2.2 s after the lift, only while throttle < 0.05 and rpm > 3500. At each firing event inside the window, fire a pop with probability `rate / firingEventsPerSecond`, `rate = 20·crackle·min(1, rpm/8000)·exp(−t/0.8)` (t = time since lift), minimum 25 ms between pops. A pop is a kernel pulse injected into both bank buffers, amplitude 2.2·U(0.6, 1.4) of a full-load pulse, width U(3.6, 9) ms (not clamped by MAX_PULSE_S). Public read-only `popCount` (total pops since construction/reset). All draws from the voice PRNG.
6. `reset()` restores every layer state (boost, phases, filters, overrun window, pop counter, traits) so a reset voice renders identically to a fresh one.

Spec fields (`soundSpec.ts`): `cylVar` [0, 0.5] default 0.28; `bassDb` [0, 12] default 8; `exhaustGain` (0, 2] default 1. Parser errors as for other fields.

Data (`public/cars/*.json` `sound.synth`): every car `pipeM` and `tailM` × 1.5 (cap 5); gt3-d `firingDeg` [0,72,144,216,288,360,432,504,576,648] (even-fire V10); ow26 firing unchanged (90/150 uneven, research confirmed); turbo cars (f4, hyper-a, ow26) `drive` 1.4 and `exhaustGain` f4 0.8, hyper-a 0.6, ow26 0.6; NA cars `drive` 2.0; `crackle`: f4, gt3-*, lmp2-a 0.8; hyper-a 0.25; ow26 0.2.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `PULSE_KERNEL` | read | argmax index / KERNEL_N in [0.035, 0.045]; value at index KERNEL_N ≤ 1e-9; non-increasing after the argmax |
| AT2 | f4 and gt3-c synth from `public/cars` with `jitterDeg` 0, `jitterAmp` 0; voice seed 1, 48 kHz | for rpm 3000..7000 step 250, load 1, throttle 1: render 0.8 s, RMS of the last 0.5 s | max RMS / min RMS ≤ 1.6 per car (no comb sweep) |
| AT3 | same specs, `cylVar` 0.28 | steady 3000 rpm, load 1, 1.3 s, Hann-windowed DFT of the last 1.0 s | energy at orders 0.5, 1, 1.5 summed ≥ −20 dB relative to the firing order (cyl/2) |
| AT4 | f4 synth with `turbo` null, `drive` 0.5, `exhaustGain` 0.6 vs 1.0, same seed | steady 6000 rpm, load 1, 1 s | RMS ratio (0.6 / 1.0) in [0.5, 0.72] |
| AT5 | gt3-a synth, `bassDb` 8 vs 0, same seed | steady 4000 rpm, load 1, 1 s, DFT | energy below 250 Hz rises ≥ 5 dB; energy above 1 kHz changes ≤ 1.5 dB |
| AT6 | f4 synth (crackle 0.8), seed 1 | 2 s at 6500 rpm throttle 1, then throttle 0 / load 0 with rpm 6000 for 3 s, blocks of 128, record `popCount` per block | ≥ 3 pops between 0.08 and 2.2 s after the lift; none before 0.08 s or after 2.2 s; consecutive pops ≥ 25 ms apart (block resolution); `crackle` 0 → 0 pops; throttle kept at 1 → 0 pops; rpm 3000 during overrun → 0 pops |
| AT7 | any car synth | render 1 s mixed controls, `reset()`, render again | both renders bit-identical; two voices with the same seed bit-identical |
| AT8 | `public/cars/*.json` | compare with `git show master:` at test-writing time | `pipeM`/`tailM` = 1.5 × master (±1e-9, cap 5); gt3-d firingDeg as above; ow26 firingDeg unchanged; drive/exhaustGain/crackle as in the data list |
| AT9 | `parseEngineSynth` | `cylVar` 0.6, `bassDb` −1, `exhaustGain` 0 | one error each naming `synth.cylVar`, `synth.bassDb`, `synth.exhaustGain`; absent → defaults 0.28, 8, 1 |

Frozen-test edits authorised: assertions in 227/228/231 acceptance and edge tests that encode the old kernel shape, reflection, loop low-pass, crackle timing/arming, car `pipeM`/`tailM`/gt3-d firing or the "bit-identical to 227" layer-off rule may be updated to the v2.1 behaviour; the coder lists every changed assertion in the report.
