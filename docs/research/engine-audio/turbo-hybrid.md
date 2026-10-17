# Turbo and hybrid engine audio: F4, hypercar, OW-26

Researched 2026-10-16. Web search returned almost no published spectral data for these engines. Tags: **SRC** = sourced fact, **CALC** = derived from physics/arithmetic (formula shown), **DESIGN** = recommended game value (not measured). Treat DESIGN numbers as tuning starting points.

Current synth (`src/audio/engineSynth.ts`): even firing only, `firingHz = rpm/60 * cyl/2`, per-cylinder jitter, params `cylinders, exhaustLengthM, intakeMix, crackle`. Everything below marked "new" needs new optional fields in the `sound` block and synth layers (separate spec; this doc changes no code).

## 0. Shared rules

- Rev frequency `f_rev = rpm/60`. Four-stroke mean firing order = cyl/2.
- Open-closed pipe resonance (CALC): `f = c/(4L)`, c = 343 m/s; L = 1.0 m gives 86 Hz, L = 1.4 m gives 61 Hz.
- Keep every synthesized partial below 0.45 * sampleRate (about 20 kHz at 44.1 kHz) to avoid aliasing; for whines clamp to 8 kHz anyway (ear sensitivity, mix).
- Real compressor blade-pass is far above hearing (section 3.3). The "turbo whistle" in games is a designed band, not a literal BPF.

## 1. F4 (1.4 L inline-4 turbo, ~160 hp)

Facts
- SRC: series engine is a 1.4 L turbo four derived from a road-car unit, equalised by the organiser twice per season. https://fiaformula4.com/technical/ , https://en.wikipedia.org/wiki/Tatuus_F4-T421
- SRC: 160 hp at 5500 rpm, 240-250 N·m (road-derived tune, peak torque at 3500 rpm). https://www.kartxpress.com/ReadMore/from-formula-4-to-the-road-the-new-abarth-f595-165-hp-of-sheer-adrenaline
- Rev limit not found in sources. Our f4.json uses 6900 (plausible for a production-based turbo four).
- CALC: inline-4 fires every 180 degrees crank (even). Dominant order 2 (fundamental firing), then 4, 6 (strong at low rpm from pressure pulses). At 3000 rpm: f_rev 50 Hz, firing 100 Hz; at limiter 6900: 115 Hz and 230 Hz.
- Character (DESIGN, from general knowledge): production-style small turbo; coarse, buzzy, strong induction/mechanical noise, small turbo with a faint high hiss and blow-off/flutter on lift; exhaust through a short single silencer. Not muffled by a turbine as much as the hybrids because of low exhaust energy; turbo is quiet relative to the engine.

Synth parameters (map onto f4.json `sound`)
| Param | Value | Note |
|---|---|---|
| cylinders | 4 | even firing, jitter 0.05 |
| firing intervals | 180/180/180/180 deg | |
| exhaustLengthM | 1.0 (keep) | 86 Hz resonance, near 2nd order at 2600 rpm |
| intakeMix | 0.35 (keep) | induction growl dominant at WOT |
| turbo layer (new) | band-passed noise, centre `1500 + 3000*boost` Hz, Q 4, gain `0.04*boost*throttle` | boost = smoothed(throttle * min(1, rpm/4500)), 0.3 s attack, 0.6 s decay |
| turbo flutter (new) | on throttle drop above 60% boost: 2-3 noise bursts, 80 ms, 1.2 kHz band | gain 0.15 |
| muffling | low-pass 5 kHz, 12 dB/oct | thin shell, little attenuation |
| electric layer | none | |
| crackle | 0.10 (keep), pops only on lift above 4500 rpm | DESIGN |
| shift | no blip, short cut 0.15 s (matches json shiftTime) | |

## 2. Hypercar (LMH/LMDh): twin-turbo V6/V8 plus front electric motor

Facts
- SRC: a 3.5 L twin-turbo V6 drives the rear, about 500 kW; a front-axle motor of about 200 kW (268 hp) is added; total output capped at 500 kW so engine power is reduced as hybrid boost rises; hybrid only active above 120 km/h. https://goodwood.com/grr/race/modern/toyota-reveals-950ps-le-mans-hypercar , https://www.thedrive.com/accelerator/38740/heres-the-671-hp-hybrid-hypercar-toyotas-sending-to-le-mans , https://petrolicious.com/articles/toyota-will-try-to-continue-its-le-mans-winning-streak-this-year-with-the-gr010-hybrid
- SRC: other entries use a 3.0 L twin-turbo V6 or a 4.6 L twin-turbo V8 (rpm quoted as >8000, up to 10,000). Rev limits conflict between sources. https://www.auto-motor-und-sport.de/motorsport/100-jahre-le-mans-steckbrief-hersteller-topautos/ , https://motorsports.porsche.com/international/en/category/cars/lmdh-prototype-963 , https://sportscar365.com/?p=112617
- Our hyper-a: 8 cylinders, limiter 7500, torque peak 4500-5500. Acceptable as a generic "V8 twin turbo".
- CALC firing, V8 cross-plane (even 90 deg): mean order 4, strong order 2 (cross-plane imbalance, burble) and 4. At 7000 rpm: f_rev 117 Hz, order 4 = 467 Hz. V6 alternative: 90 deg V (uneven 90/150) or 120 deg (even 120): order 3.
- Character (DESIGN): deeper, bassier than the single-seater (heavy-duty silencing and long tailpipes), turbos reduce top-end crack, loud induction suck; electric deploy is audible mainly as a high whine under the engine note from the front axle.

Electric whine layer (new), front motor
- Motor connects to the front wheels through a fixed reduction. SRC (general EV NVH): whine orders are gear-mesh and electromagnetic orders of motor speed, plus an inverter switching tone that is high and nearly fixed in frequency. https://saemobilus.sae.org/content/2020-01-1269 , https://www.matec-conferences.org/10.1051/matecconf/202030903033
- CALC: `f_motor_rev = wheelHz * G`, `wheelHz = v / (2*pi*r)`. For hyper-a r = 0.3625: 120 km/h gives 14.6 Hz, 300 km/h gives 36.6 Hz.
- DESIGN: G = 10 (total ratio, so motor reaches ~370 Hz = 22k rpm at 300 km/h). Whine partials: gear mesh order 14 (`14*f_motor_rev`, 2.0 kHz at 120 km/h, 5.1 kHz at 300 km/h) plus order 28 at -12 dB; inverter tone fixed 7.5 kHz at gain 0.2x of main, slight random wobble +-3%.
- Level: `g = 0.06 * |P_elec|/P_max`, smoothed 50 ms; zero below 120 km/h (matches the rule). During regen under braking use the same partials at `0.05 * regenFrac`, which sounds like a falling whine as speed drops.

Synth parameters (hyper-a.json `sound`)
| Param | Value |
|---|---|
| cylinders / intervals | 8 / 90,90,... deg (even); optional second harmonic order 2 at 0.25 level |
| exhaustLengthM | 1.4 (keep), plus second pipe resonance at 2L |
| turbo layer | twin turbo: band 2.5-6 kHz noise, centre `2000 + 3500*boost`, gain `0.03*boost`; spool-down whoosh on lift, 0.8 s |
| muffling | low-pass 3.5 kHz 12 dB/oct, -2 dB overall at idle |
| electric layer | as above, front axle, wheel-speed based |
| crackle | reduce 0.5 to 0.2 (endurance prototypes burble little; keep pops only on lift) |
| shift | 0.03 s cut (json), 1 rev-matched blip on downshift (below) |

## 3. 1.6 L V6 turbo hybrid power units (2014-2025, then 2026)

### 3.1 Engine and firing
- SRC: 1.6 L V6 turbo, 90 deg V; rules force 90 deg V with 3 crank throws, so firing is uneven. https://www.f1technical.net/forum/viewtopic.php?p=540359 (forum, unverified)
- CALC: 90 deg V, 3 shared crank pins 120 deg apart gives alternating intervals 90/150 deg (sum 240 per pair, 3 pairs per 720). Mean firing order 3, but the repeating cycle is 240 deg crank = 1.5 per rev, so strong 1.5, 3, 4.5 orders. At 10,500 rpm: f_rev 175 Hz, 1.5 order 262 Hz, 3rd order 525 Hz.
- RPM: 2014-2025 limit 15,000 but in practice about 10.5-12k (no power gain above ~11.5k). SRC: https://forums.autosport.com/topic/205709-v4-turbo-hybrid-sound (forum). 2026 limit 15,000 SRC per docs/research/f1-2026-car.md; use 10.5k-13k as the usual working range, 15k only at the limiter. Our ow26 spec: idle 4000, upshift 14200.

### 3.2 Why it is muffled (and what 2026 changes)
- SRC: the MGU-H and turbine "acted as a bit of a muffler"; 2014 rules require a single tailpipe (instead of one per bank); lower revs, lower fuel flow. https://www.the-race.com/formula-1/first-f1-2026-engine-sound-reveal-honda.md , https://f1technical.net/news/18677
- SRC: engine chief expects 2026 to be "really, really similar": less back pressure (no MGU-H) makes it louder, less fuel makes it quieter, no step change. Same the-race.com URL.
- DESIGN muffling: turbine acts like a low-pass plus pulse averaging. 2014-25: low-pass 2.2 kHz, 12 dB/oct, pulse smoothing 4 ms moving average on the firing envelope. 2026 (ow26): cutoff 3.0 kHz, smoothing 2.5 ms, +1.5 dB. Firing note stays low and "droney" because 1.5 and 3rd orders (260-750 Hz) sit below the cutoff.
- Level vs rpm: raise envelope depth with throttle (0.25 + 0.75*thr as now), plus -3 dB above 12.5k (power and exhaust flow flatten).

### 3.3 Turbo whistle (compressor)
- CALC/SRC: blade-pass `f_bp = N_blades * rpm_turbo / 60`; example 20 blades at 9000 rpm gives 3 kHz. https://cyberleninka.ru/article/n/vibro-acoustic-diagnostics-of-turbocharger
- CALC: with ~11 blades (full+splitter) at 100-125k rpm (F1 turbo shaft rpm unsourced; fan sites say ~100k), BPF is 18-23 kHz, above hearing. So audible hiss/whistle is sub-synchronous: surge, broadband whoosh, shaft-order tones. Forum opinion: "turbo hiss" from high boost at low mass flow. https://www.f1technical.net/forum/viewtopic.php?p=675034
- DESIGN turbo layer for ow26: noise band centre `3000 + 2500*boost` Hz, Q 6, gain `0.02*boost`; the main character is a high faint hiss that lags throttle by 0.25 s on lift (turbine spools down slowly).
- 2026: MGU-H gone, so spool is not electrically held: lag returns. Boost smoothing 0.45 s attack (vs 0.2 s in 2014-25 style), whoosh on lift 0.5 s.

### 3.4 MGU-K whine and deployment
- Facts SRC (docs/research/f1-2026-car.md): MGU-K 350 kW, up to 27,000 rpm, fixed mechanical link to crank (no clutch), no deploy below 50 km/h. https://f1briefing.com/mgu-k-parameters-2026-rules/
- CALC: link ratio is unsourced; assume motor = 1.8 * crank rpm (27,000 at 15,000). Then the whine tracks engine rpm, not wheel speed (clutch-less). Motor rev at 12,000 crank rpm: 360 Hz.
- DESIGN: whine partials `order 18 * f_motor_rev` (6.5 kHz at 12k crank rpm; clamp 8 kHz) plus order 36 at -10 dB (aliasing: drop if above limit) and inverter tone fixed 9 kHz at 0.15x. Level `0.07 * |P_k|/350 kW`; deploy and harvest both audible, harvest slightly lower and thinner (-3 dB). Fade in over 50-80 km/h (50 km/h threshold, 0.5 s smoothing).
- Mixing note: whine must not mask firing; high-pass 3 kHz, low gain.

### 3.5 Harvesting, super-clipping, lift-and-coast
- SRC: super-clipping = MGU-K runs as generator at full throttle (cap raised 250 to 350 kW in April 2026), car slows (~30 km/h loss observed at Bahrain); lift-and-coast recovers up to 350 kW before braking. https://www.the-race.com/formula-1/super-clipping-how-it-works-why-controversial-key-f1-2026/ , https://www.thedrive.com/news/heres-what-the-new-2026-f1-regulation-tweaks-really-mean
- No source describes the acoustic effect. DESIGN (inference): ICE stays flat out, so exhaust level is full; rpm stops climbing and plateaus or falls slightly while throttle is 1.0 (the audible cue of clipping). Add whine in harvest mode at 0.6 of deploy level, and drop the firing envelope depth by 10% (load added).
- Lift-and-coast: throttle 0, rpm falls with speed, firing envelope floor 0.2, engine-brake thrum; whine at `0.04 * harvest fraction`. Overrun: no pops by default (MGU-K regen takes the torque; 2014-25 V6 had MGU-H keeping turbo spinning so no anti-lag bangs).

### 3.6 Downshift blips and anti-lag
- DESIGN: automatic rev-match on downshift: raise throttle to 0.35 for 60 ms, rpm target = new gear ratio rpm, then release; 2 ms spark-cut burst gaps optional. Provides audible "brap" at 0.6 of normal envelope.
- Anti-lag: SRC (forum) = extra fuel on overrun to keep the turbo spinning, can damage the turbo. https://www.seatcupra.net/forums/goto/post?id=2589444 . For ow26 (no MGU-H in 2026) allow `crackle` 0.05 and short 40 ms pops on lift above 11k rpm; keep hybrid-a at 0.2; f4 at 0.1.

## 4. Mapping to our cars (summary)
| Car | cyl | firing | mean/dominant orders | muffling LP | turbo layer | electric layer | crackle |
|---|---|---|---|---|---|---|---|
| f4 | 4 | even 180 | 2, 4 | 5 kHz | light hiss + flutter | none | 0.10 |
| hyper-a | 8 | even 90 (order 4, 2 minor) | 4, 2 | 3.5 kHz | twin, 2.5-6 kHz | front, wheel speed, gear order 14, > 120 km/h | 0.2 |
| ow26 | 6 | uneven 90/150 | 1.5, 3, 4.5 | 2.2 kHz (3.0 kHz 2026) | hiss, 0.45 s lag | crank-linked, order 18, regen and deploy | 0.05 |

Implementation gaps vs the current synth: (1) uneven firing intervals (per-cylinder angle table); (2) a boost-driven noise band layer; (3) an electric whine oscillator bank with deploy/regen level inputs; (4) a post low-pass and pulse smoothing; (5) rev-match blip and flutter triggers. Suggested new `sound` fields: `firingAnglesDeg[]`, `turbo {centerHz, spanHz, gain, attackS, decayS}`, `motor {order, gearRatio, source: "wheel"|"crank", maxHz}`, `lowpassHz`. No brand names appear in any of these fields.

## 5. Open questions
- Verify real rev limits and F4 rev limit from the technical regulations; sources conflict.
- No audio-dev blog or paper on F1 spectral content was found; if the project has audio clips, run an order-tracking FFT before locking section 3 numbers.
- MGU-K gear ratio and turbo shaft rpm unsourced.
