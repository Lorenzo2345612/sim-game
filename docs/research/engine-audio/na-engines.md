# NA race engine acoustics: synth parameters (research, 2026-10)

Scope: brand-neutral game data; real engines used only to learn. Confidence tags: [S] sourced, [K] engineering knowledge / derivation (not verified by a fetched source), [?] uncertain.

## 0. Current state (what the synth does)

- `src/audio/engineSynth.ts`: one pulse per firing at `rpm/60 * cyl/2` Hz, evenly spaced, exponential burst, +-10 % per-cylinder amplitude jitter, one feedback comb (`2*L/343` delay, g=0.5) as the exhaust, lowpassed noise (800 Hz) as intake, `tanh` clip.
- Sound block: `cylinders, exhaustLengthM, intakeMix, crackle` (crackle is not used by the synth yet).
- Consequence: every engine is an even-fire train. Cross-plane burble, V10 90/54 and flat-six 1.5 order cannot be produced; only pitch (cylinder count) differs.
- Data: gt3-a/c/d = 8 cyl, 1.4/1.5/1.4 m; gt3-b = 6 cyl, 1.1 m; lmp2-a = 8 cyl, 1.4 m. GT3 curves identical: idle 1000, limiter 7200, peak torque 4000 rpm. LMP2: idle 1500, limiter 8500, flat 5500-6500.

## 1. Physics shared by all types

- Order = multiple of crank rev frequency (rpm/60). A four-stroke fires each cylinder once per 2 revs, so a cylinder alone makes order 0.5. Firing order (N cyl) = N/2 [S: patent/Altair order-analysis pages, https://help.altair.com/hwdesktop/nvh/topics/hypergraph/nvh_ordercut_analysis_r.htm].
- Exhaust sound is dominated by the firing order and its harmonics; uneven spacing adds sub-harmonic orders (half orders, per-bank orders). SAE 2003-01-1657: an equal-length Y-pipe keeps the firing order and harmonics (3rd and 6th for a six) and suppresses the half order; half-order SPL grows with branch length difference [S: https://saemobilus.sae.org/content/2003-01-1657].
- Rule for synth: build the pulse train from the real firing-angle list (crank degrees over 720), not from `cyl/2`. Spectrum of the train is automatic (line spectrum at multiples of 1/period).
- Pipe resonances are fixed in Hz, not in order: open-closed/open-open quarter/half-wave `f = c/(4L)` or `c/(2L)` (c ~ 343 m/s cold, 450-550 m/s in hot exhaust gas [K]). Header primary 0.6-0.9 m: f ~ 150-250 Hz (4L); collector+tailpipe 1.2-2 m: 60-100 Hz. Fixed-Hz peaks make the engine "ring" at specific rpms as orders sweep through them. The current comb uses 343 m/s: use ~500 m/s hot for plausible delays [K].
- Throttle: at closed throttle the combustion pressure drops, exhaust pulses are weak (~10-15 dB lower in the 1st-4th harmonics [K]), the sound is mostly mechanical (gear whine, valvetrain) plus intake pumping. At full throttle the pulse edges are sharp, harmonics up to 1-2 kHz are strong; intake roar peaks at WOT mid rpm.
- Intake roar: broadband band-limited noise, centre 150-500 Hz modulated at firing order, Helmholtz-like tone from the airbox/plenum 100-200 Hz [K]. GT3 uses restrictors (airbox, 2 intakes): intake 4-8 dB under exhaust at WOT; LMP2 open airbox above the driver: intake clearly audible in cockpit (~equal to exhaust at 6-8k rpm) [K].
- Mufflers: GT3 (homologated dB limit ~110 dB(A) at track, 1 muffler per bank) damp > 1 kHz by 10-20 dB and keep the low orders; open LMP2 (short tailpipe, no silencer, cat-less) keeps harmonics to 4-5 kHz: brighter, crackly [K].
- Overrun crackle: unburnt fuel and hot exhaust ignite after throttle lift (after-fire); more likely rich, hot, with air leaks; caused by deliberate overrun fuelling/retard in race maps [S: f1technical/ukgser threads, anecdotal: https://f1technical.net/forum/viewtopic.php?p=58751]. Acoustically: random 5-30 ms sharp pops, 2-20 Hz rate, only rpm > ~40 % of range, throttle < 5 %, decaying within 0.5-1.5 s after lift; spectrum broadband 300 Hz-3 kHz, peak 6-12 dB above the idle-level exhaust [K].
- Rev limiter: fuel/ignition cut: pulses present on 2 of 3-4 cycles at 12-25 Hz cut rate (hard cut: gaps; soft cut: ignition retard = bangs). Sound = amplitude-gated chop of the pulse train plus bangs from unburnt charge (louder pops on the "cut" cycle) [K].
- Game-audio practice: harmonic + noise with an RPM-driven order model or granular loops is the norm; physical/additive modelling is common in research [S: https://www.mcvuk.com/development/how-to-make-racing-car-engines-roar-using-audiomotors-fmod, https://www.audiokinetic.com/engine-sound-modeling-from-sampling-to-granular-synthesis-in-wwise, https://arxiv.org/html/2603.07584v1 (harmonic+noise engine dataset, 2026)]. Kunos used FMOD with real recordings crossfaded over rpm and reflections as a key feature [S: https://www.racedepartment.com/threads/sound-design-in-assetto-corsa.53195/, https://www.unrealengine.com/en-US/developer-interviews/assetto-corsa-competizione-leans-into-realism-to-create-the-ultimate-racing-sim]. No public order-level data from iRacing/Reiza found.

## 2. Cross-plane V8 (front-engine GT3)

- Crank: 4 throws at 90, two cylinders per throw on opposite banks. Typical firing order 1-8-4-3-6-5-7-2 [S: https://en.wikipedia.org/wiki/V8_engine; https://www.curbsideclassic.com/blog/tech/curbside-tech-v8-engine-crankshafts-and-firing-orders-good-vibrations].
- Overall interval: even 90 deg (8 x 90 = 720) [S]. Bank sequence L-R-R-L-R-L-L-R [S: Wikipedia gives L-R-L-L-R-L-R-R, cyclic rotation/mirror variant].
- Per-bank intervals: (270, 180, 90, 180) crank deg, repeating: uneven. Each bank has pairs of cylinders firing 90 deg apart then a 270 gap. With a 2-into-1 collector per bank the pulses merge as uneven trains: this is the burble [S for mechanism; numbers derived].
- Spectrum: strong order 4 (firing, 8 pulses/2 rev) only if both banks are merged symmetrically; per-bank trains add strong order 2 (4 pulses/720 per bank), order 1, order 1.5 and 3 content. Typical idle: lumpy order 2 + order 4 at 16-20 Hz at 1000 rpm (4 x 16.7 = 67 Hz firing; order 2 = 33 Hz; order 1 = 17 Hz). At full load upper harmonics (8, 12, 16) fill in: warm, thick, low "brap".
- Rpm: idle 800-1100, redline 7000-7500 for GT3 [K; the game uses 1000/7200].
- Exhaust: 4-1 (or 4-2-1) header per bank, 2 collectors, one or two mufflers per side, side-exit or rear-exit; primary length 0.5-0.7 m [K].
- Cross-plane vs flat-plane: both are even 90 deg overall, but cross-plane pairs of adjacent firings on one bank crowd pulses in that bank's manifold (low-frequency, rough) whereas flat-plane alternates banks and pulses clear [S: https://jalopnik.com/1878133/why-flat-plane-crank-v8-engines-sound-different/; https://www.edtengineers.com/articles/gearhead-quandary-be-flat-or-be-crossed].
- Synth params:
  - `firingAnglesDeg` = [0,90,180,270,360,450,540,630] with `bank` = [0,1,1,0,1,0,0,1]; per-bank pipe, mix at collector with 0.7/0.3 low-passed cross-talk.
  - Harmonic emphasis (relative to firing order 4): orders 2: -3 dB, 4: 0, 8: -3, 12: -8, 16: -14; 1.5 and 1: -8 dB at WOT, -4 dB at idle/low rpm (burble higher at low rpm).
  - Per-pulse amplitude jitter 10-15 %; low-pass tilt -9 dB/oct above 800 Hz.
  - Noise: intake mix 0.20-0.30, centre 250 Hz; crackle 0.5-0.7 (longer pops, 40-60 % of lifts).
  - Limiter: 14 Hz hard cut, soft bangs.

## 3. Flat-plane V8

- Crank: 2 planes at 180, banks fire alternately: 1-5-4-8-6-3-7-2 (typical flat-plane; two even 4-cyl engines) [K: check numbering, intervals matter].
- Intervals: overall 90 deg even; per bank 180 deg even [S: sources above]. Two independent 4-cylinder banks merged: order 4 is dominant, banks 180 deg apart add order 2 (4-cyl 2nd order) only if banks are mismatched.
- Spectrum: clean line spectrum at orders 4, 8, 12 [K]; no strong sub-orders; higher fundamental per rev (same as the cross-plane 4 order, but cleaner), so "scream": 4 x 150 Hz = 600 Hz at 9000 rpm.
- Rpm: idle 1000-1200, redline 8500-9500 (shorter stroke, lighter crank) [K; cross-plane heavier cranks limit revs per Jalopnik].
- Exhaust: 4-2-1 per bank (even spacing helps scavenging): primary 0.6-0.8 m; sometimes 4-into-1 tuned collector with 180 deg scavenging pairs.
- Synth params: `firingAnglesDeg` = [0,90,...,630], bank alternating 0,1,0,1; sub-orders -20 dB; harmonic order 4: 0, 8: -2, 12: -5, 16: -8, 20: -12; jitter 5 %; noise 0.20-0.25; crackle 0.2-0.4 (low in dry GT/prototype maps). Slight nasal peak 2-3 kHz.

## 4. Flat-six (boxer, rear)

- Firing: even 120 deg overall, firing order 1-6-2-4-3-5 (Porsche numbering) [S: https://renndriver.com/guides/flat-six-engine/; Wikipedia gives R1-L2-R3-L1-R2-L3, https://en.wikipedia.org/wiki/Firing_order]. Per bank: 240 deg intervals (three pulses per 720 per bank).
- Spectrum: firing order 3 (3 x rev) and 6, 9; each bank alone makes order 1.5. Equal banks cancel order 1.5; unequal header/pipe lengths bring it back (SAE paper: half-order grows with branch difference) [S]. Result: metallic, rasping, a higher "ring" with a sawtooth and some "rotor" like ripples.
- Rpm: idle 900-1100; GT3-class naturally aspirated 4.0-4.2 L revs 8400-9400 (GT3 R 4.2: 9,250-9,400 reported) [S: https://www.supercars.net/blog/this-is-how-the-porsche-911-gt3-r-rennsport-sounds-at-9400-rpm; https://www.9carthai.com/porsche-911-gt3-r/].
- Exhaust: two 3-1 headers (rear, behind axle), tailpipe 1.0-1.4 m; thermal reactor; GT3: single central muffler; very prominent airbox/intake howl from the rear intake lungs (behind driver) at 3-6 k rpm [K].
- Synth params: `firingAnglesDeg` = [0,120,...,600], banks [0,1,0,1,0,1]; order 3: 0, 6: -2, 9: -5, 12: -10; order 1.5: -12 dB (unequal headers: -8); intake noise 0.30-0.40 (rear intake), centre 400 Hz, cabin-forward. Crackle 0.3-0.4. Limiter 16-18 Hz soft retard.

## 5. V10 (mid-engine GT3)

- 90-degree V10 with a shared-pin crank: uneven firing 90/54 repeating five times over 720 [S: https://en.wikipedia.org/wiki/Lamborghini_V10 (5.2 non-split); 72 even only with split pins]. Adopted numbers: pairs 90, 54, 90, 54...
- Spectrum: mean firing order 5 (5 pulses per rev); the 144 deg pattern repeats 5 times per 720: order 2.5 fundamental with strong order 5, 7.5, 10; 90/54 asymmetry adds a rhythmic "double-tap" at idle, merges to a smooth high howl at 6000+ rpm. Orders higher than the V8: at 8000 rpm order 5 = 667 Hz; order 10 = 1.3 kHz [K derived].
- Rpm: idle 1000-1200; GT3 redline 8000-8700 [K].
- Exhaust: two 5-1 headers (one per bank), collectors 1.0-1.2 m: collectors shorter than a V8 as mid-engine, tailpipe up and rear; single muffler per bank or one. Rear intake roar loud in cockpit.
- Synth params: `firingAnglesDeg` = [0,90,144,234,288,378,432,522,576,666]; banks alternating 0,1 but uneven; harmonics: order 5: 0, 2.5: -6, 10: -3, 15: -9; jitter 5-8 %; noise 0.25; crackle 0.4.

## 6. LMP2 4.2 L V8 (single spec)

- Spec engine 4.2 L NA V8, ~600 hp originally, ~560 hp WEC; 2023 IMSA: rev limit 8000 rpm (gears 1-5), 8500 (gear 6); before 8700 [S: https://sportscar365.com/?p=111891; https://www.fiawec.com/en/news/new-lmp2-engine-for-2017-revealed/4151]. Crank type: flat-plane reported by enthusiast sources [?]; sound note: high, tearing, with strong order 4 and a fast "bark" typical of flat-plane [K]. Idle ~ 1500 (data) but 1200-1500 plausible.
- Spectrum: firing order 4 (8 cyl): 8000 rpm -> 533 Hz; harmonics up to 4-5 kHz not damped by silencers; intake airbox noise 300-1000 Hz above the shoulders; gearbox whine (sequential straight-cut) 2-4 kHz, amplitude under load.
- Exhaust: short 4-into-1 pipes, two open tailpipes, little or no silencer, thin walls: bright (ring at 100-200 Hz plus harmonics up to 5 kHz); crackle: sharp pops on lift [S: general overrun mechanism].
- Synth params: flat-plane pattern of section 3 with 1.1-1.3 m effective exhaust, comb feedback 0.35; harmonics order 4: 0, 8: -1, 12: -3, 16: -5, 20: -7, 24: -10; intake 0.30-0.35, noise centre 600 Hz; crackle 0.4-0.6 with short pops (5-15 ms); limiter 20-25 Hz hard cut. Total gain +4 dB vs GT3 in the cockpit.

## 7. Mapping proposal

| Car | Data signals | Proposed type | Reason |
|---|---|---|---|
| gt3-a | 8 cyl, 1.4 m, crackle 0.5, limiter 7200, front-engine GT3 | cross-plane V8 | classic GT3 muscle; baseline |
| gt3-b | 6 cyl, 1.1 m, intake 0.3, crackle 0.4 | flat-six (rear) | only 6-cyl; shortest pipe fits compact rear headers; 7200 limiter in data is below real (8400+): raise to 8400 for realism |
| gt3-c | 8 cyl, 1.5 m, crackle 0.6, intake 0.2 | flat-plane V8 or longer-pipe cross-plane | longest pipe, most crackle, lowest intake; differentiate: flat-plane gives distinctive higher voice; keep limiter 7200 or raise to 7800 |
| gt3-d | 8 cyl, 1.4 m, same as gt3-a, no cockpit block | V10 (mid-engine) | the only remaining GT3 slot; change `cylinders` to 10 (synth max 12, so allowed), pipe 1.1, intake 0.30, limiter 8000 [needs design decision] |
| lmp2-a | 8 cyl, 1.4 m, idle 1500, limiter 8500 | LMP2 NA V8 (flat-plane) | matches 4.2 L spec limit 8500; open exhaust: pipe 1.1-1.2, intake 0.3, crackle 0.5 |

Notes: GT3 torque/limiter curves are identical among a-d (only the sound block differs), so sound is the single differentiator: the proposed per-type values above should be new sound-block fields.

## 8. Suggested schema (for a later spec; not applied)

```
"sound": {
  "type": "crossV8|flatV8|flat6|v10|lmpV8",
  "firingDeg": [0,90,...],      // crank deg in 720, per cylinder
  "bank": [0,1,...],            // pipe assignment
  "pipeM": [0.7, 0.7],          // per-bank primary+collector, m
  "tailM": 1.2,
  "harm": {"2":-3,"4":0,"8":-3}, // dB re firing order, optional sub-orders
  "intakeMix": 0.25, "intakeHz": 250,
  "crackle": 0.5, "limiterHz": 15, "gainDb": 0
}
```
Implementation hints: one pulse per entry with its own phase offset; per-bank comb delays summed after the bank mix; crackle = Poisson pop events on `throttle<0.05 && rpm>0.4*limit`; limiter = square gate at `limiterHz`; reuse existing seed for jitter. Keep `cylinders/exhaustLengthM/intakeMix/crackle` as fallback for cars without `type`.

## 9. Sources

- https://en.wikipedia.org/wiki/V8_engine ; https://en.wikipedia.org/wiki/Firing_order ; https://en.wikipedia.org/wiki/Lamborghini_V10
- https://jalopnik.com/1878133/why-flat-plane-crank-v8-engines-sound-different/ ; https://jalopnik.com/2063399/cross-vs-flat-plane-cranks-differences/
- https://www.curbsideclassic.com/blog/tech/curbside-tech-v8-engine-crankshafts-and-firing-orders-good-vibrations ; https://www.edtengineers.com/articles/gearhead-quandary-be-flat-or-be-crossed
- https://saemobilus.sae.org/content/2003-01-1657 (Y-pipe, half orders)
- https://sportscar365.com/?p=111891 ; https://www.fiawec.com/en/news/new-lmp2-engine-for-2017-revealed/4151
- https://renndriver.com/guides/flat-six-engine/ ; https://www.supercars.net/blog/this-is-how-the-porsche-911-gt3-r-rennsport-sounds-at-9400-rpm
- https://www.racedepartment.com/threads/sound-design-in-assetto-corsa.53195/ ; https://www.mcvuk.com/development/how-to-make-racing-car-engines-roar-using-audiomotors-fmod ; https://www.audiokinetic.com/engine-sound-modeling-from-sampling-to-granular-synthesis-in-wwise ; https://arxiv.org/html/2603.07584v1
- https://f1technical.net/forum/viewtopic.php?p=58751 (overrun pops, anecdotal)
