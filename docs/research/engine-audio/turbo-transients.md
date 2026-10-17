# Turbo transients: blow-off, flutter, wastegate, spool, anti-lag

Researched 2026-10-17. Tags: **SRC** = sourced (URL), **CALC** = derived, **DESIGN** = inference / tuning start. Finding: no public source gives measured spectrograms, pulse rates or levels for BOV, flutter or wastegate. Searches returned only qualitative descriptions plus a few SAE abstracts. Every number below not tagged SRC is a tuning default; verify by ear with `audio:render` (task 232).

## 1. Facts found
- SRC: closed-throttle surge = air separates at the compressor, flows back, pressure in the intercooler pipes drops, cycle repeats; heard as repeated flutter, pressure pulses in the piping; occurs at high boost with low flow; "no BOV makes the compressor surge flutter". https://gfb.com.au/tech/tech-articles/11-the-truth-about-compressor-surge/
- SRC: when the throttle snaps shut the excess charge has only one way out, back into the compressor; sounds "STUSTUSTU"; BOV/hybrid valve gives "PHSST"/hiss; valve opens because manifold goes to vacuum behind the piston; preload spring is only a few psi. https://www.mishimoto.com/engineering/2020/04/blow-off-valve-tech
- SRC: mild-surge fundamental is set by duct and compressor geometry, in-duct pressure frequencies well below 100 Hz, near the system Helmholtz resonance; falls as surge deepens; small plenum volume limits growth. https://saemobilus.sae.org/articles/instabilities-low-flow-range-a-turbocharger-compressor-2013-01-1886
- SRC: heavy-duty diesel, surge showed a dominant 5-7 Hz peak (knock sensor); plus a component near 25 kHz tied to turbo speed. https://saemobilus.sae.org/content/2017-24-0050 (via search summary; abstract only)
- SRC: surge "whoosh" is broadband flow noise, mostly on throttle tip-in at near-surge. https://saemobilus.sae.org/content/2009-01-2053 ; another paper: surge noise components above 1 kHz, wide band. https://saemobilus.sae.org/content/2014-01-2053
- SRC: recirculating anti-surge valve flow noise is narrow-band, a few hundred Hz to a few kHz depending on cavity geometry. https://saemobilus.sae.org/content/2011-01-1532
- SRC: screamer pipe = external wastegate vented through its own unmuffled pipe, loud. https://en.wikipedia.org/wiki/Screamer_pipe
- SRC (forum, unverified): 2014+ F1 gives the wastegate its own outlet (louder when open), MGU-H sets compressor speed so wastegate rarely opens, MGU-H can spool the turbo so little need for a BOV; wastegate flutter audible on onboards. https://www.f1technical.net/forum/viewtopic.php?p=647062 , https://www.f1technical.net/forum/viewtopic.php?p=466966
- SRC: anti-lag = ignition retard (40 deg or more) plus fuel/air on overrun, igniting in the hot exhaust; turbine temp ~800 to 1100 C+; destroys road exhausts. https://en.wikipedia.org/wiki/Antilag_system , https://rallycars.com/technical-stuff/bang-bang-or-anti-lag-system/
- SRC: hypercar 499P reported as muted, hybrid whirr dominant, combustion mainly audible coasting/braking; no source on BOV/flutter on any hypercar. https://www.thedrive.com/news/ferrari-499p-hypercar-sounds-like-a-spaceship-on-sebring-pole-lap
- SRC: F4 rules allow NA or turbo, 140 kW cap; Italian/British F4 use the 1.4 L 4-cyl turbo (Abarth 414TF, Garrett turbo, ~160 hp); Japanese F4 uses a Toyota 2.0 L (aspiration not confirmed). https://en.wikipedia.org/wiki/Formula_4 (see also turbo-hybrid.md section 1)

## 2. Parameter table (all DESIGN unless tagged)
| Sound | Trigger | Delay / duration | Envelope | Spectrum | Level vs engine | Boost scaling |
|---|---|---|---|---|---|---|
| Atmospheric BOV "pssht" | throttle drops > 3 /s (falls by > 0.5 in < 0.15 s) while boost > 0.25 | 20-40 ms delay; duration 0.25 + 0.5*boost s (0.3-0.75 s) | attack 5 ms, exp decay tau = duration/3 | broadband jet noise, band-pass 2-9 kHz, centre 3500 Hz at low boost to 5500 at full (CALC: jet peak f ~ 0.2*U/d, U ~ 340 m/s, d 20-30 mm gives 2.3-3.4 kHz; upper part is shear broadband) | -6 to -3 dB re engine RMS at full boost; ~-14 dB at 0.25 | gain ~ boost^1.5, duration and centre rise with boost |
| Recirculating BPV / diverter | same trigger | 20-40 ms; 0.15-0.3 s | attack 8 ms, tau 60 ms | quiet; band-pass 1-3 kHz plus faint 400-900 Hz cavity tone (SRC range above), Q 6 | -20 dB to -14 dB; mostly a short hiss/"thup" | gain ~ boost |
| Surge flutter (no valve, or valve too slow) | same trigger, boost > 0.4 and BOV absent/closed | starts 30-80 ms after lift; 4-8 pulses (boost 0.4-1.0); total 0.25-0.6 s | each pulse: attack 4 ms, decay 25-40 ms; successive pulse amplitude *0.8; pulse rate falls 14 to 7 Hz during the event | pulse = band noise 1.2-3.5 kHz (Q 2) plus a damped sine 150-400 Hz (cavity thump); whole train AM at pulse rate | -8 dB re engine at full boost (loud, since wideband) | pulse count and gain rise with boost; rate: 8-12 Hz DESIGN (SRC places the physical mild-surge fundamental < 100 Hz and a diesel case at 5-7 Hz; audible "stu-tu-tu" is slower than that, so use the low-Hz end) |
| Wastegate, external + screamer | boost target reached under load (load > 0.7, boost > 0.7) and each rapid lift; on lift the gate pops open | on lift: 0 delay, 0.2-0.5 s chuff; on load: continuous | on lift: attack 3 ms, decay 80 ms; on load: slow 30-60 ms smoothing | harsh broadband rasp 1.5-6 kHz; modulated at engine firing frequency (exhaust pulses leak through) | -10 dB held on load, -4 dB chuff on lift | gain ~ (boost - 0.7)/0.3 on load |
| Wastegate, internal (all other cars) | same | same, muted | | same band, low-pass 2 kHz, buried in the tailpipe | -20 dB: skip, or fold into the existing turbo layer | |
| Spool-up whistle/whoosh | boost rising | follows boost with lagS (0.2-0.5 s up, 0.5-0.9 s down) | continuous | band noise centre `centerHz + spanHz*boost`, Q 4-8 (existing layer); optional tonal partial that glides 0.6-1.0x of centre with boost; blade-pass is ultrasonic (turbo-hybrid.md 3.3) | -26 to -20 dB | gain ~ boost; centre rises with boost |
| Spool-down | boost falling after lift | 0.5-0.9 s | exp | same layer, centre falls and gain decays (a pitch-down "whoosh") | | |
| Anti-lag bangs | rally-style only; none of our cars | rate 10-25 /s random, 1 s after lift | each 3-8 ms click + 80 ms exp tail | broadband 300-4000 Hz | | not used |

## 3. Per car
| Car | Turbo transients that apply | Parameters |
|---|---|---|
| f4 (1.4 L turbo four, road-derived) | Yes. Production-style turbo, atmospheric-style or recirculating valve is a content choice. Use a recirculating valve with a weak one (flutter 2-3 pulses, lower than full surge) DESIGN. | BPV hiss gain 0.4 re table, flutter 3 pulses at 10 Hz when boost > 0.5, spool whistle as turbo-hybrid.md section 1. Internal wastegate: none. If a variant is NA (some series), omit. |
| hyper-a (twin turbo V8, hybrid) | Mostly masked. Modern prototypes recirculate and are described as muted with hybrid whirr dominant (SRC). Short low-level BPV hiss; faint wastegate chuff on lift; no flutter. | BPV 0.3 re table at high boost, 0.15 s, centre 3000 Hz; wastegate chuff -18 dB; no flutter, no anti-lag; two turbos: detune the second centre by +6 % for beating. |
| ow26 (1.6 V6 turbo, 2026 rules, no MGU-H) | 2014-25: almost none (MGU-H holds turbo speed; wastegate rarely open; SRC forum). 2026: no MGU-H, turbo lag returns (turbo-hybrid.md 3.3), so the turbo is not held at lift-off. No source confirms audible BOV/flutter/wastegate on either generation. Treat as DESIGN: wastegate chuff on lift with a screamer-style outlet, slightly audible; BPV hiss very faint; no flutter (an F1 team will not tolerate surge) | external wastegate chuff: gain 0.25 re table (-10 dB), 0.3 s, band 2-5 kHz, only when throttle drops > 0.6 above 8000 rpm; BPV hiss 0.15; spool-down whoosh 0.5 s (existing lag); flutter off; anti-lag off. |

In-game names never use brands; turbo "kind" is data (see 5).

## 4. Synth recipe (per sample, AudioWorklet)
Shared: white noise from the voice's seeded LCG; SVF band-pass (2 poles, per-sample coefficients, retuned every 16 samples); no allocations.

State per event: `t` (s since trigger), `dur`, `env`. Trigger detector (per control block): `dthr = (thrPrev - throttle)/dt`; fire when `dthr > 3/s` and `boost > 0.25`, with 0.3 s refractory; event strength `s = boost` captured at the trigger.

1. BOV/BPV hiss: `x = BP(noise, fc = 3500 + 2000*s, Q 1.5)`; `env = A(5 ms) * exp(-t/tau)`, `tau = (0.25 + 0.5*s)/3`; out = `g * s^1.5 * env * x`. Add a 2nd BP at 7 kHz at -9 dB for "sizzle". For BPV: fc 1800, Q 6, tau 0.06, plus damped sine 600 Hz (decay 40 ms) at -6 dB.
2. Flutter: pulse train phase `p += rate/fs`, `rate = 14 -> 7` Hz linear in t over dur, pulse envelope `e = exp(-(p mod 1)/0.3)` (about 25-40 ms decay), amplitude multiplier `0.8^k` per pulse k, stop after `n = round(4 + 4*s)` pulses. Source `BP(noise, 2000, Q 2) + 0.5*sin(2*pi*250*t_pulse)*exp(-t_pulse/0.02)`. Cavity sine pitch drops 5 % per pulse (deeper surge, SRC trend).
3. Wastegate: `BP(noise, 3000, Q 1)` multiplied by `(0.6 + 0.4*pulseEnv)` where `pulseEnv` is the exhaust pulse train (already computed in the voice) for the held-on-load rasp; chuff on lift = env A(3 ms), tau 0.08 s.
4. Spool layer (existing): centre `centerHz + spanHz*boost`, boost slewed by `lagS`; add separate down slew 1.5x lagS so spool-down whoosh outlasts the lift. Optional glide sine `0.8*centre`, 1 % depth FM at 6 Hz for "whistle" shimmer.
5. Mix: transients bypass the exhaust low-pass (they exit at the intake/bay); route through the cockpit bus high-pass at 300 Hz; duck engine by 1.5 dB for 100 ms at BOV peak. Limit total transient level so peak <= 0.9 with the voice.

## 5. Suggested data fields (for a later spec; this doc changes no code)
`turbo.valve: "none"|"bpv"|"bov"`, `turbo.flutter: 0..1` (pulse count scale), `turbo.wastegate: 0..1`, `turbo.wastegateKind: "internal"|"external"`, `turbo.downLagS`. Defaults: f4 `bpv`, flutter 0.4, wg 0; hyper-a `bpv`, flutter 0, wg 0.3 internal; ow26 `bpv` faint, flutter 0, wg 0.5 external.

## 6. Open questions
- Replace all DESIGN levels with a measured order/band analysis of real onboard clips (none in repo); until then keep flutter and BOV gains conservative.
- Confirm Japanese F4 and other series aspiration; add an NA variant without turbo layer if wanted.
- Physical flutter rate from first principles needs plenum volume and duct length per car (CALC possible: Helmholtz `f = c/(2*pi)*sqrt(A/(V*L))`), not done.
