# Procedural engine audio: diagnosis and recommended synth

Date 2026-10-16. Scope: research only, no code changed. Items marked (unverified) come from general knowledge, not a page I could open.

## 1. What is wrong with the current synth

Code read: `src/audio/engineSynth.ts`, `engineWorklet.ts`, `engineAudio.ts`, `effects.ts`, `mixer.ts`, `public/cars/*.json` (`sound` block).

### Most likely causes of "horrible" (ranked)

1. Hard saturation of a DC-biased signal, in `EngineSynth.render`. The pulse `envelope` is always >= 0 (0.2..1.1) and decays by e^-4 per firing period, so the source is a one-sided sawtooth with DC. The comb adds positive feedback 0.5, so the gain is 2 at DC and at every comb peak. Peak input to `tanh` is about 2.2, so it clips permanently into a fuzzy square-like buzz. Nothing removes DC before or after `tanh`.
2. Comb with positive feedback and no damping in the loop (`COMB_FEEDBACK = 0.5`, `exhaust = burst + 0.5*delayed`). It gives a metallic comb with equal peaks to Nyquist: a "flanger on a saw". A real pipe that is closed at the cylinder and open at the tail reflects with inverted sign at the open end and loses highs at each reflection. That gives a quarter-wave resonator (odd harmonics) with decaying highs. Also `combDelay = round(2L/343*fs)` is an integer delay, so the tuning is coarse, and 343 m/s is air at 20 C. Exhaust gas is hot, about 450-600 m/s (unverified).
3. One identical pulse for every cylinder at every rpm and load. Only amplitude jitter of +-10% exists. Pulse width is tied to the firing period (`tau = 0.25/fh`), so the spectrum is a fixed 1/n shape relative to the fundamental. Real engines have fixed-Hz resonances (pipe, block, intake, cabin) over a crank-angle-based pulse. The result is a buzzy synth tone, not an engine.
4. Firing order and layout are ignored. `cylinders` only sets the firing rate. Even-fire and uneven-fire engines (cross-plane V8 burble, flat-6, inline-4 2nd order) all sound alike. There is no timing jitter, which is what gives engines their "lumpy" idle.
5. Load model is just `0.2 + 0.8*throttle` on amplitude. There is no spectral change between on-throttle and overrun, and no real engine load: it is pedal position, not torque/full-load torque at that rpm. The intake is white noise through a 800 Hz one-pole lowpass times throttle. It is not tied to valve events, has no resonance, and sounds like hiss.
6. Control path, in `engineAudio.update` and `render`: `{rpm, throttle}` goes by `postMessage` once per frame. In the worklet, `render` interpolates previous to new value within one 128-sample block, then holds. That gives about 5 flat blocks per message and one ramp: a staircase in pitch and gain (roughness and zipper at fast rev changes and shifts). Messages are not timestamped and arrive asynchronously to the audio thread.
7. Almost every car sounds the same. `gt3-a`, `gt3-d`, `hyper-a`, `lmp2-a` all use `{8, 1.4, 0.25, 0.5}`. The only per-car differences are `cylinders`, `exhaustLengthM`, `intakeMix` and `crackle`, and these are 4 scalars. The F1-like `ow26` (idle 4000, limit 15000) is `{6, 1.0, ...}` through the same model.
8. No body, cabin or radiation model. The only filter is one biquad lowpass at 1200 Hz (`mixer.ts`, cockpit) or bypass. The output is mono, dry and unreverberated. Real exhaust radiation is a differentiating (high-passing) end-of-pipe effect, and the low end is rich in the first few orders. Nothing models that.
9. Fallback path (`engineParams`): two sawtooth oscillators at `rpm/60*2` Hz regardless of cylinders, plus a lowpass. It is used while `addModule` loads or if it fails. It is a plain buzzer and the likely first thing heard at start.
10. Redline and limiter: no ignition-cut pattern in the synth. `effects.crackleSchedule` fires only after lift-off above 70% of the limiter and plays through a separate bandpassed click bus. It is not in the pipe, so it does not resonate.
11. No transmission whine, valvetrain tick, wheel-speed layers or turbo/BOV. High rpm (ow26 at 15000 rpm and 6 cyl = 750 Hz firing) is unaliased in the synth only by luck: the exponential pulse is not bandlimited. `phase >= 1` triggers on whole samples, so there is no sub-sample timing, causing pitch-dependent aliasing and jitter.

## 2. Techniques surveyed (what the literature and open code do)

- Farnell, *Designing Sound* (MIT Press 2010): procedural engine = timed pulse source through resonant filtering, plus noise and mechanical layers, built in Pure Data. Companion patch "Practical 22: Car Engines": https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/8375/designing_sound.zip/practical22.html (HTTP 200). I could only open the patch page, not the book text; the pulse-train plus waveguide description follows his approach as I remember it (unverified).
- Baldan, Lachambre, Delle Monache, Boussard, "Physically informed car engine sound synthesis for virtual and augmented environments" (SIVE 2015). Repository record, open-access post-print listed: https://air.iuav.it/handle/11578/264484 (returned 403 to my fetcher; seen in search results). Model: cylinder pulse source per firing order, exhaust and intake as waveguides with valve-dependent reflection, plus muffler. Implemented in Max/MSP, used in the GeneCars driving simulator.
- antonio-r1/engine-sound-generator (MIT, https://github.com/antonio-r1/engine-sound-generator): a WebAudio AudioWorklet (plain JS and WASM) implementing the Baldan model. I read `engine_sound_generator_worklet.js`. Per cylinder: a `cylinderWaveguide` of length 10 samples (reflection 0.75 each end), `intakeWaveguide`, `exhaustWaveguide`, `extractorWaveguide`; the sum goes through a `Muffler` of several parallel waveguide elements (each with an `action` reflection) and a one-pole lowpass. Valve opening is `sin(4*pi*x)` windows over crank phase `x` (intake 0..0.25, exhaust 0.75..1). Piston motion `cos(4*pi*x)*1.5`, ignition `sin(2*pi*x/ignitionTime)*5`. Intake noise gated by intake valve. Reflection factors interpolate with valve state (open vs closed). Doppler via a DelayNode. Separate volumes for intake, vibrations, outlet. Lesson: the realism comes from valve-modulated reflection and per-cylinder paths, not from the pulse shape.
- AngeTheGreat "Engine Simulator" (MIT, https://github.com/ange-yaghi/engine-sim): full physics (piston, cylinder pressure, intake and exhaust flow) at a high internal rate, then an audio stage. I read `src/synthesizer.cpp` (`Synthesizer::renderAudio`). Per cylinder/exhaust channel: input samples resampled to the audio rate, antialiasing lowpass at 1900 Hz, jitter lowpass, DC removal (10 Hz highpass), derivative of the signal, air-noise-modulated copy `f * (airNoise*lowpassedNoise + (1-airNoise))`, mix `f' * dF_F_mix + f*noise*(1-dF_F_mix)`, then convolution with a per-channel impulse response (`convolution_filter.cpp`, `impulse_response.cpp`) with a dry/wet amount, summed, a final lowpass at 0.45*fs, and a leveler (automatic gain). Lessons: (a) the source is a pressure/flow derivative, not a raw pulse; (b) DC is removed; (c) noise multiplies the signal rather than adding hiss; (d) a short impulse response supplies the body and pipe character; (e) a leveler avoids clipping. Secondary description: https://starlog.is/articles/developer-tools/ange-yaghi-engine-sim (exhaust as a transmission line with reflections and standing waves, IRs for exhaust, intake and microphone).
- Waveguide theory: J. O. Smith, *Physical Audio Signal Processing*, https://ccrma.stanford.edu/~jos/pasp/ (200 OK). Karplus-Strong-style delay loop with a loss filter models a tube; open end = inverted reflection with lowpass; closed end = positive reflection; area changes give scattering coefficient `k = (S1-S2)/(S1+S2)`.
- Antialiasing: Stilson and Smith, BLIT, https://ccrma.stanford.edu/~stilti/papers/blit.pdf (200 OK). Brandt, minBLEP, https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf (200 OK). For engines a precomputed bandlimited pulse kernel written at fractional offsets (an oversampled table) is equivalent and simpler.
- Granular and sample-based (unverified, general knowledge): recordings at several steady rpms, crossfaded by rpm and load and pitch-shifted, with grains looped or pitch-synchronous. Strong realism for one specific engine, but needs rights-clear recordings at several rpm for on and off throttle, loops sound phasey, pitch-shifting moves formants, and memory grows per car. We have no clear-license racing-engine rpm set (see section 4), so it is not the base. It can serve as a residual or reference.
- Order-based additive (unverified): sum of sines at engine orders (k * rpm/60 * 0.5 per half order) with a 2D amplitude table over rpm and load, random phase walk. Cheap and controllable; sounds synthetic alone but is good to shape low-frequency body and to match a reference by spectrum.
- Saturation and distortion: real captured engine sound is compressed and saturated at the mic or the cabin. Use an asymmetric soft clipper (tanh with bias) on a non-DC signal, 2x oversampled, plus a DC blocker after.
- Convolution for body and cabin: a short (50-200 ms) impulse response per car type or listening position; engine-sim uses it per channel. In WebAudio a `ConvolverNode` is available but costly per car; use one on the player's cockpit bus only.

## 3. Recommended architecture (stays procedural, own code, no recordings)

One `AudioWorkletProcessor` with N voices (all cars), no per-car AudioNode. Per-frame state arrives in one `Float32Array` message; the worklet smooths it at audio rate.

```
control  : rpm, load(0..1, torque/fullTorque), throttle, gear, wheelSpeed, limiter, pops
   |  (one message/frame, all cars; worklet slews rpm 15-25 ms, load 30 ms, per sample)
   v
crank phase theta (0..720 deg, double) += rpm*6*dt*2/... ; events at per-car firing offsets
   |
   +--> per-cylinder pulse generator
   |       amp = A(load, rpm) * (1 + sigmaA*n_i);  timing jitter sigmaT (+ slow drift)
   |       kernel = bandlimited blowdown pulse (table, 8-16x oversampled, fractional offset)
   |       shape: sharper + brighter with load; softer on overrun; cylinder cut by limiter
   |       ignition-cut / pops: extra pulses and noise bursts injected here, not on a side bus
   v
exhaust network (per bank)
   primary_i (frac. delay Li, loss LP) --> collector junction (scattering) --> tail pipe (frac. delay)
   --> muffler: 2-3 chambers (waveguide sections, k=(S1-S2)/(S1+S2)) + 1 Helmholtz biquad
   --> open end: R = -0.9 with LP (end correction), radiated = differentiated (HP ~60-100 Hz)
   c = 340 + 0.2*T_C approx 450-550 m/s, rises with load
   |
intake: noise gated by intake-valve window per cylinder (cam angle), bandpass/resonator 150-500 Hz
        (Helmholtz + short delay), gain ~ throttle_opening * rpm_norm
block/mechanical: parallel bandpass bank (4-6 modes, fixed Hz 120-1800) excited by
        d/dt(cylinder pressure pulses); valvetrain tick (BP noise 2-4 kHz per cam event);
        gear whine sines at mesh orders of wheelSpeed (straight-cut for race cars)
order layer (optional): 6-12 orders from 2D table [rpm][load], fills fundamental/low end
   |
sum -> asymmetric soft clipper (2x oversampled, bias, load-linked drive) -> DC blocker -> leveler
   |
listener model:
  player cockpit : ConvolverNode (synthetic 60-120 ms IR, exp-decaying noise with modes), engine/intake
                   emphasised, exhaust attenuated, LPF 1.2-3 kHz
  chase / external: exhaust-heavy, light high shelf, optional short room IR
  AI cars        : distance gain, 1-pole LPF vs distance, Doppler by modulated delay in worklet,
                   equal-power pan (no HRTF)
```

### Key design rules

- Everything pulses in crank-angle domain; resonances are fixed in Hz. This alone separates "synth tone" from "engine".
- Unequal firing and per-cylinder variation: `fireDeg[i]` in 0..720 per car (V8 cross-plane 0/90/180/270/... per-bank uneven; flat-plane even 90; flat-6 even 120; inline-4 even 180; V6 uneven) and `lengthMul[i]`, `gain[i]` from a seed. Timing jitter 0.1-0.3 deg crank gaussian, amplitude jitter 3-8%.
- Load-dependence: on-throttle = high-pressure sharp pulses, loud intake roar; overrun = weak dull pulses, strong low orders, throttle-closed intake low, plus pops. Use physics load, not pedal.
- Antialiasing: pulse kernel precomputed lowpassed at about 0.4*fs and written at fractional sample positions into the exhaust line (linear or cubic interpolation of a 16x table). Do not generate impulses on integer samples. Worst case ow26 at 15000 rpm: firing 750 Hz, harmonics under 24 kHz about 32.
- Denormals: add 1e-18 offsets or flush in feedback loops; no allocations in `process`; Float32Array state; interpolate delay lines.
- Control smoothing: do not interpolate per message as now. Keep rpm and load as targets and slew per sample, or use `AudioParam` automation (`rpm` as a-rate param). Avoid `SharedArrayBuffer` (needs COOP/COEP headers).
- Fallback: the oscillator fallback should be a 4-order additive voice with the same control mapping, not saw plus sub, and `addModule` should load before the first start.

### Parameters per car (replace the 4-field `sound` block)

| Field | Meaning | Example |
|---|---|---|
| `fireDeg[]` | crank angles of each cylinder in the 720 deg cycle | cross-plane V8: 0,90,180,270,360,450,540,630 mapped by firing order |
| `bankOf[]` | primary assignment to bank/primary pipe | [0,1,0,1,...] |
| `primaryM[]`, `collectorM`, `tailM` | pipe lengths | 0.45, 0.3, 0.9 |
| `muffler[]` | chamber lengths and area ratios | [{len:0.3,ratio:3}] |
| `intakeM`, `intakeQ` | intake resonator | 0.35, 3 |
| `pulse` | blowdown width (crank deg), brightness slope vs load | 120, 0.6 |
| `jitter` | `{timingDeg, amp}` | {0.15, 0.05} |
| `block[]` | modes `{hz, q, gain}` | 4-6 modes |
| `orders` | 2D table `[rpm][load] -> amps` | 8 orders |
| `mech` | valve tick level, gear whine ratio | |
| `drive`, `cabinIR` | saturation drive, cabin IR id | |
| `limiter` | cut pattern (rate Hz, cylinders cut fraction) | 16 Hz, 50% |
| `pops` | probability and level on overrun | |

Idle and limiter rpm already exist in the car JSON (`idleRpm`, `limiterRpm`); reuse them.

### CPU budget (<= 8 cars, 48 kHz, 128-sample quanta = 2.67 ms per quantum)

Estimated flops per output sample (my estimate, not measured):

| Tier | Contents | ~flop/sample |
|---|---|---|
| Full (player) | 8 cyl pulses, 2 banks x primaries, collector, tail, muffler, intake, block bank, mech, clipper 2x, cabin convolution | ~350 plus ConvolverNode |
| Mid (nearest 3 AI) | 1 merged pipe waveguide, intake, 2 block modes, order layer, clipper | ~90 |
| Low (rest) | order table plus one resonator | ~25 |

1 full + 3 mid + 4 low = 350 + 270 + 100 = 720 flop/sample = ~35 MFLOP/s, a few percent of one core in V8 JIT. Plus the cabin convolver (about 120 ms IR = 5800 taps, FFT partitioned, a few percent). Target total under 8% of one core and under 40% of the 2.67 ms quantum deadline on the worst quantum. Rules: cull cars beyond about 250 m to silent, drop tier by distance, one processor instance, no `postMessage` per car, no allocations. Measure with `performance.now()` around `process` in a debug build and a Playwright audio-render test.

### Validation plan (for the planner)

- Offline harness: render each car at idle, 3000, redline, on-throttle sweep, lift-off, with `OfflineAudioContext` or the synth class directly, and write wav plus spectrogram (`render-preview` skill style).
- Objective checks: no DC (mean < 1e-3), peak < 0.9 before master, no aliasing above fs/2-margin (energy in 18-24 kHz is below -60 dB at 15000 rpm), firing fundamental matches `rpm/60*cyl/2` within 0.5%, different `fireDeg` give different spectra, no block-rate steps (rpm slew smoothness).
- Subjective: compare against reference recordings (section 4) in a spectrogram viewer, not by copying them.

## 4. Reference and grain candidates (licence pages checked via HTTP on 2026-10-16)

None is a rpm-layered rights-clear racing set. Use them as listening and spectrum references. CC BY-SA files must not be bundled in `assets/` as playable grains without accepting share-alike on the derived audio.

| Source | Licence | Notes | Page |
|---|---|---|---|
| Wikimedia Commons, uploader Edvvc, historic and Le Mans cars: Porsche 956B (1984), Lola-Cosworth T290, Peugeot 908 HDI FAP (2009), Bentley Speed 8 (2003), Lotus-Ford 38, BRM P578, Jaguar XJ13, AC Cobra | CC BY-SA 3.0 (API `LicenseShortName`) | real race-car recordings (ogg), good references for spectrum and gearshift | https://commons.wikimedia.org/wiki/File:Porsche_956B_(1984).ogg, https://commons.wikimedia.org/wiki/File:Peugeot_908_HDI_FAP_(2009).ogg, https://commons.wikimedia.org/wiki/File:Bentley-Speed-8-2003.ogg, https://commons.wikimedia.org/wiki/File:Lola-Cosworth_T290_(1972).ogg |
| OpenGameArt, domasx2, "racing car engine sound loops" | CC0 (page text; https://creativecommons.org/publicdomain/zero/1.0/) | 6 short pitch-variant loops cut from a public-domain road-car start-up clip (pdsounds); low quality, a derived loop, not a race engine. Author notes it was remade from a public-domain sample | https://opengameart.org/content/racing-car-engine-sound-loops |
| OpenGameArt "Some sounds" (node 166538) | CC0 (page text) | synthesized cartoon car sounds; not realistic | https://opengameart.org/node/166538 |
| OpenGameArt "car engine loop 96khz 4s" | CC-BY 3.0 / GPL 3 / GPL 2 | attribution required; usable only as a reference | https://opengameart.org/content/car-engine-loop-96khz-4s |

Not found: a CC0 or CC-BY multi-rpm engine set with on/off-throttle layers. Freesound could not be queried without its API (not tried); a CC0-filtered manual search with per-file licence check is the next step if grains are wanted. Per project rule, any file added to `assets/` needs its line in `ASSETS_LICENSES.md`.

## 5. Recommendation

Build the procedural worklet from section 3 (pulse in crank-angle domain, fractional-delay exhaust network with correct reflections, valve-gated intake, block modes, saturation, cabin IR). Fix the quick wins first, since they probably account for most of the "horrible": remove DC and the double-gain saturation, make the comb a negative-feedback damped tube, slew rpm/load per sample, and give each car its own firing offsets. Use the Commons recordings only as spectral references.
