# Overrun pops, turbine muffling, V6 firing, open-source synths

Researched 2026-10-17. Tags: **SRC** = sourced (URL), **CALC** = derived, **DESIGN** = inference / tuning start. Complements `turbo-transients.md` and `turbo-hybrid.md` (not repeated: BOV/flutter/wastegate, anti-lag basics, spool whistle, 90/150 CALC). Finding: no public source gives measured spectra, durations or rates for exhaust pops, nor an engine-level dB figure for turbine muffling. Mechanism sources are forum/Wikipedia level; numbers below are tuning defaults unless tagged SRC.

## 1. Overrun pops / crackle / backfire

### 1.1 Mechanism
- SRC: closed throttle gives low cylinder pressure and slow burn; exhaust valve opens before the charge is fully burned, unburnt fuel enters the exhaust. https://nistune.com/forum/viewtopic.php?p=4231 (forum)
- SRC: retarded idle/closed-throttle timing lights the mixture late, leaving fuel to ignite in the exhaust; ECU levers are the decel fuel-cut/recovery tables and idle timing. Same URL.
- SRC: aftermarket "pops and bangs" = ignition retard plus extra fuel injected on overrun; a longer fuel-cut delay gives louder pops but can surge in low gears. https://www.hondata.com/help/flashpro/pops_and_bangs_fl5de5.htm
- SRC: backfire = combustion in the exhaust system; causes: ignition with exhaust valve open, unburnt fuel reaching hot exhaust, late timing; audible result "a sharp pop". https://en.wikipedia.org/wiki/Back-fire
- SRC (forum, anecdotal): lean misfire = sharp "rifle crack"; rich misfire = softer pop; very loud shotgun bang = exhaust full of mixture igniting. https://www.hpacademy.com/forum/general-tuning-discussion/show/exhaust-pop-nature/
- CALC: ignition needs hot exhaust (turbine inlet ~800-1100 C, turbo-transients.md) so pops are strongest right after sustained load; cold pipe, few pops. Pop count scales with unburnt-fuel mass: rpm x closed-throttle time x decel fuel enrichment.
- DESIGN: a "cut map" is stochastic: every Nth cycle (N random) a cylinder gets late spark + fuel; each pop is therefore tied to one exhaust valve opening, so pops are phase-locked to the firing grid (per-cylinder slot), not free-running in time.

### 1.2 Single pop (all DESIGN; no measurements found)
| Property | Value | Reason |
|---|---|---|
| Rise time | 0.3-1 ms (deflagration front, not detonation, in a pipe) | steep but finite; a 0 ms click is the "static" artefact |
| Pulse | positive overpressure 2-6 ms, then rarefaction (N-wave) from the open-end reflection | open end reflects with inverted sign (CALC: pipe `L`, round trip `2L/c`: 1.2 m gives 7 ms) |
| Ring | pipe resonance `f = c/(4L)` plus odd harmonics, decays 30-80 ms (muffler lengthens it) | CALC from turbo-hybrid.md section 0 |
| Spectrum | energy 100-2500 Hz, strongest 200-800 Hz (boomy "pop") up to 4 kHz (sharp "crack" = lean) | tailpipe + muffler low-pass; crack/pop split from SRC forum above |
| Level | +3 to +9 dB re steady note peak; rare ones +12 dB | |
| Duration | pop 15-40 ms total; crackle = 3-10 of them | |

### 1.3 Clustering
- DESIGN: events live in the decel window after lift: start delay 50-150 ms, active while throttle < 0.05 and rpm > ~0.45 * limit, tail off over 0.5-2.5 s as pipe cools and fuel burns off (use decay of an "exhaust fuel" state: charged by prior load, drained by pops).
- DESIGN: Poisson-like with refractory: mean rate `r = 6-20 /s` at high rpm (crackle), 1-4 /s at mid rpm (burble); rate ~ `fuelState * rpm/limit`; min gap 25 ms; amplitude lognormal (sigma 0.5), occasional doublet (second pop 30-70 ms after, -3 dB). Quantise start to the next exhaust valve opening (`720/cyl` deg slot) for a tempo-locked "brap" feel.
- DESIGN: gearshift upshift lift gives 1-3 loud pops; downshift blip gives one at throttle snap-closed.
- SRC: BeamNG exposes only count / volume / muffling multipliers (`afterFireAudioCoef`, `afterFireVolumeCoef`, `afterFireMufflingCoef`, default 1, multiplicative along the exhaust tree) i.e. a tuned effect, not physics. https://documentation.beamng.com/modding/vehicle/sections/nodes/exhaust
- SRC: Sound Design Toolkit motor model has one backfire parameter: "chance of backfiring [0,1]" when the engine revs down; models rich mixture igniting later in hotter exhaust parts. https://sdt.lim.di.unimi.it/docs/API/v2.2-078/group__motor.html (page does not give the synthesis method)

### 1.4 Why naive noise bursts sound like static/clicks
- CALC/DESIGN: (a) white-noise burst has no pipe resonance: real pops are a pressure pulse that passes through the same exhaust path as the engine note, so they carry its pipe/muffler colour; (b) 0-ms attack and random-sign samples = click (broadband above 5 kHz that no muffler passes); (c) no N-wave, no ring, so it lacks the low-frequency "thump" body; (d) fixed amplitude and regular rate = machine-gun; (e) not tied to the firing grid or rpm, so it feels detached; (f) panned/mixed after the cockpit low-pass instead of through it.

### 1.5 Implementation (DESIGN)
Preferred: inject, don't mix. Add a pressure impulse into the exhaust waveguide input on the chosen cylinder slot (see 4.1 for the technique, SRC). Shape: `p(t) = A * (exp(-t/0.0015) - exp(-t/0.0004))`, 4 ms total, plus a small random sign-flipped tail; feed at the same node as the firing pulse so delay line, end reflection (alpha ~ -0.9 to -0.97 at the open end), muffler LP and turbine smoothing apply. Optional 20-30 % extra: lightly filtered noise (LP 3 kHz, 5 ms decay) added at the same node to roughen the front. If no waveguide exists in the voice, approximate: impulse into a damped resonator at `c/(4L)` (Q 8-15) + second at `3c/(4L)`, then the existing cockpit LP; gain pop vs firing peak per table 1.2.

## 2. Turbo vs NA timbre

- SRC: turbine is a large passive acoustic two-port: transmission-loss peaks reach ~50 dB with broadband level above 10 dB for a twin-scroll automotive turbine (a component property, not an engine-level figure). https://kth.diva-portal.org/smash/get/diva2:1096314/FULLTEXT01.pdf (Kabral, KTH)
- SRC: turbocharger acts passively on engine pressure pulses up to roughly 1600 Hz; its own noise is believed to originate mostly on the intake side, mufflers damp the exhaust side well (search summary, Rämmal/Åbom). https://saemobilus.sae.org/content/2007-01-2205 ; https://www.diva-portal.org/smash/get/diva2:514184/FULLTEXT02.pdf
- SRC: F1 turbine/MGU-H "acted as a bit of a muffler" (turbo-hybrid.md 3.2). No dB figure found anywhere.
- CALC (physics): turbine = expansion chamber plus throttling nozzle plus rotor inertia. Exhaust pulse energy is partly turned into shaft work and partly averaged by the plenum, so (a) pulse peaks drop, pulse width grows (smoothing), (b) high orders lose more (LP-like), (c) mean flow noise (hiss) rises relative to pulses.
- DESIGN timbre change vs the NA voice of the same car: pulse envelope depth x0.5-0.7 (i.e. harmonic ratio of orders 1-3 reduced); firing-pulse width x1.5-2 (moving average 3-5 ms); post LP 2.2-3.5 kHz 12 dB/oct instead of 5-8 kHz; overall exhaust level -3 to -6 dB; raise mean-flow noise floor +3 dB so the note is less "pure" and more "whooshy"; keep low orders (< 300 Hz) intact. NA reference for comparison: na-engines.md.
- DESIGN levels: spool whistle/hiss -26 to -20 dB re exhaust (turbo-transients.md) is consistent with "intake-side noise is the main turbo noise". Gain `~ boost`, tilt to higher centre with boost, band 2-6 kHz; at idle/off-boost it vanishes. Twin-turbo: two detuned bands.
- DESIGN: parameter `turbo.muffle` 0..1 scaling the three items (depth, smoothing, LP) so one voice can morph NA to turbo; hybrid-a 0.6, ow26 1.0 (2014-25) or 0.75 (2026, no MGU-H, less back pressure), f4 0.35.

## 3. Firing order of the 1.6 L 90-degree V6 (2014+)
- SRC (forum quoting Wikipedia, unverified vs FIA text): early 90 deg V6s with three shared crankpins 120 deg apart fire unevenly, intervals 90 / 150 deg alternating. https://www.f1technical.net/forum/viewtopic.php?p=540359
- SRC (forum): F1 uses 3 shared crankpins, intervals 90, 150; "2014 rules specifically require shared pins"; split pins (30 deg offset gives even 120) is the road-car fix, not used in F1. https://www.f1technical.net/forum/viewtopic.php?p=493450 , https://www.f1technical.net/forum/viewtopic.php?p=539614 (page returned 403 to the fetch tool; read via search summaries only)
- SRC: Wikipedia "Formula One engines" confirms 1.6 L 90 deg V6 for 2014-2021 and current, says nothing on crank layout. https://en.wikipedia.org/wiki/Formula_One_engines
- Not found: the FIA regulation clause text. Confidence: medium-high that ow26 is uneven 90/150 (two independent forum statements plus the 2014 shared-pin claim); engine sound commentary calling it "droney/hollow" fits. Keep `firingAnglesDeg` as data so a split-pin variant (120) is a one-line change. The ordering of which bank fires when does not matter for audio; only the interval sequence 90,150,90,150,90,150 (sum 720) matters.

## 4. Open-source synths and what to copy
### 4.1 enginesound (Rust, per-sample waveguides)
SRC: https://github.com/standardgalactic/enginesound (`src/gen.rs`, read). Per cylinder: `cyl_sound = piston_motion(crank)*k1 + fuel_ignition(crank, ignition_time)*k2`; this sum is the source pushed into an exhaust waveguide (cylinder to exhaust, then extractor waveguide to a collector, then muffler delay lines). Valve state changes the end reflection alpha (`exhaust_open_refl` / `exhaust_closed_refl`), so the pulse only "gets out" when the valve is open. `fuel_ignition` is a half sine over `ignition_time/2` of a cycle starting at crank 0.5 (a smooth bump, not noise). A low-passed noise `crankshaft_fluctuation` jitters crank phase; intake noise is separate low-passed noise. Technique to copy for pops: add an extra `fuel_ignition`-style bump (shorter, 2-4 ms, random sign/amp) to the exhaust-side source of a random cylinder in the overrun window, delayed by `ignition_time` > normal, so it enters the same waveguide (see 1.5). It has no pop or turbo layer itself.
### 4.2 ghurni (Rust/Cyrius crate, forced induction)
SRC: https://github.com/MacCracken/ghurni (`src/forced_induction.cyr`, read). Spool = smoothed target `rpm * drive_ratio * load` with `spool_inertia` 0.1-5 s (supercharger 0.01). Whine = saw oscillator at `spool/60 * blades` (turbo 10 blades, supercharger 3 lobes), clamped 20 Hz..0.49 fs, amp `min(0.4, spool/20000)`; hiss = white noise x same amp x 0.15 x load tilt. BOV: triggered when load drops from > 0.5 to < 0.2 and spool > 5000; 150 ms linear-decay noise, band-pass 2 kHz Q 2, gain 0.6. Weak points (do not copy): audible blade-pass is ultrasonic for real F1/road turbos (turbo-hybrid.md 3.3), linear decay and fixed 2 kHz centre. Worth copying: smoother-based spool with separate inertia, load-drop trigger with spool threshold.
### 4.3 Others
- SRC: Sound Design Toolkit motor: waveguides for collector, pipe, muffler, outlet with lengths/gains driven by the engine cycle; backfire = probability parameter on rev-down (code not read; docs only). https://sdt.lim.di.unimi.it/docs/API/v2.2-078/group__motor.html
- SRC: Yamaha patent US5835605: exhaust waveform generated from throttle and rpm then passed through a waveguide-style delay/junction pipe circuit; same "source into waveguide" topology. https://patents.google.com/patent/US5835605
- SRC: JarkaEngine (Java, 4-cyl turbo, listed features: backfire, flutter; repo contains only a .rar, not inspected). https://github.com/pxlohd/JarkaEngine
- engine-sim (Ange Yaghi, MIT): physics-based pistons + exhaust propagation; backfire and turbo not found in docs; source not read. Not verified.

## 5. Open questions
- Confirm 90/150 against the FIA 2014 PU regulations text (crankshaft clause).
- Measure real pop duration/spectrum from onboard clips (none in repo); until then 1.2 stays DESIGN.
- Read engine-sim and SDT source for how backfire impulses are injected (only docs read).
