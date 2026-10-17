# Drivetrain and mix improvements (beyond the raw engine)

Scope: src/audio/{effects,mixer,engineAudio}.ts. Date 2026-10-16.

## Where we are
- Perspective: one static lowpass (1200 Hz cockpit / bypass) via `Mixer.setCameraMode`; no exterior colouring, no distance.
- Load: `engineParams` only scales gain 0.15..0.60 with throttle; no on/off layers, no timbre change.
- Tyres: slip-ratio only (`tyreSquealGain`), fixed filter; no slip-angle, no load, no pitch.
- Wind (`windGain`), kerb (speed/1.5 m LFO), gravel, crackle, `shiftEnvelope` (dip to 0.3 over 80 ms) exist. No gear whine, limiter, reverb, compressor, other-car handling.

## Evidence base (honest note)
Studios publish little numeric detail. Solid public sources: Forza 6 mix talk (tyre feedback vs dense soundscape), F1 2018 audio lead (separate on-board and trackside recordings, distance tones blended not only filtered, world-positioned reverb, reflection system conveying barrier proximity), ACC/Unreal interview (context-dependent sound, reflections), AC FMOD pipeline docs and per-car gain sections, tyre-squeal patents (pitch/volume from slip angle and load), W3C Doppler removal, platform loudness guides. Numbers below marked (T) are tuning starting points of ours, not quotes from any studio.
- https://gdcvault.com/play/1023324/Simulating-the-Race-Day-Experience (Forza 6 mix)
- https://gamingaudionews.com/2018/08/20/lead-audio-designer-on-f1-2018-details-what-goes-into-making-the-game-sound-authentic/
- https://www.unrealengine.com/developer-interviews/assetto-corsa-competizione-leans-into-realism-to-create-the-ultimate-racing-sim
- https://isrtv.com/fmod-sound-update/ (AC FMOD update; separate int/ext engine, gear, transmission layers)
- https://www.racedepartment.com/threads/sound-design-in-assetto-corsa.53195/ and AC SDK "AC Audio Pipeline" PDF (layer/RPM-parameter structure in FMOD)
- https://patents.justia.com/patent/8078300 (squeal tone from slip angle and vertical load)
- https://www.cbmconnect.com/gmf-calculation-and-gearbox-problems-detection/ (gear mesh frequency)
- https://codereview.chromium.org/783273002/ and https://bugzil.la/1148354 (PannerNode Doppler removed)
- https://audiokinetic.com/en/mastering-a-game-with-wwise-part1 and https://designingsound.org/2013/02/20/different-loudness-ranges-for-console-and-mobile-games (loudness)
- Not retrievable: iRacing, rFactor 2, AMS2 internals (closed); Game Developer "Vroom Vroom" racing sound study (only referenced).

## Prioritised improvements

### P1. On/off-throttle (load) layers
Industry practice (FMOD/Wwise RTPCs): two or three loops or timbres crossfaded on RPM x load. Ours is synthesised, so emulate with spectrum.
- load = smoothed throttle (tau 60 ms) but allow negative engine torque: off = lift with rpm above idle+500.
- On: engine gain 0.5..0.6, lowpass of the engine bus 3.5 kHz + 3 kHz*load (T), intake band (800 Hz, `INTAKE_HZ`) +4 dB.
- Off (overrun): gain 0.25, lowpass 1.8 kHz, add deeper exhaust drone (firing hz x 0.5 sub, +3 dB), crackle already exists (`crackleSchedule`); extend to any lift above 70 % limiter.
- Crossfade time constants: on to off 80 ms, off to on 40 ms (attack faster than release, feels responsive).
- Needs: throttle, rpm, engine torque sign (or wheel torque), clutch state.

### P2. Perspective filtering that follows the camera (not a single switch)
Replace the 1200 Hz lowpass switch with a two-bus blend (interior bus, exterior bus), crossfaded over 150 ms on camera change.
- Cockpit/helmet: highpass 60 Hz, lowpass 2.5 kHz (Q 0.7) on engine, low shelf +3 dB at 120 Hz, a notch/dip -3 dB at 2.5-3.5 kHz; 1200 Hz is too dull, it kills gear whine and tyre cues (T: 2.5 kHz, with whine and tyre fed after the filter at their own levels).
- Chase/TV/bonnet: full band, high shelf +2 dB at 6 kHz, exhaust-forward (add the comb exhaust component, lower intake), light reverb send (P9).
- Chase camera distance (m) d: lowpass fc = 12 kHz / (1 + d/20) floor 3 kHz; gain 1/(1+d/8).
- Cockpit extras: body/chassis resonance 80-140 Hz band tracking firing hz, vibration gain with rpm; interior also gets suspension thump (P7).
- Needs: camera mode and distance (cameraRig), already partly available.

### P3. Straight-cut gearbox whine
GMF = teeth x shaft rev/s. Shaft speed after the gearbox input = engine rpm/60 x (1/ratio stage). For a sim: whine_hz = k x (wheel_rpm/60) x final_ratio x gear_ratio_stage, simplified to `whine_hz = rpm/60 x N` with N per gear (teeth of the loaded pair; use gear ratio as proxy: N = 18..24 for output pinion, hz = N x rpm/60 x 1/gear_ratio_ratio).
- Practical recipe (T): sine at f = (rpm/60) x 6 x (ratio_gear / ratio_top) with 2nd harmonic at -9 dB; typical range 500-3500 Hz. Check the range stays under 3.5 kHz to avoid harshness.
- Gain: on-load 0.06 x speed fraction, off-load (coast) 0.03 with slightly different pitch (coast flank): add 2 percent detune on overrun.
- Add 1 percent random pitch wander and slow AM at wheel hz (tooth eccentricity), makes it less synth-like.
- Cockpit +6 dB vs exterior (whine is a cockpit cue; exterior -6 dB with the gearbox casing lowpass 3 kHz).
- Needs: gear ratio per gear, final drive, rpm, load sign, vehicle speed.

### P4. Sequential gear change: cut and blip
Current `shiftEnvelope` dips engine gain only. Improve:
- Upshift: ignition cut 40-60 ms (fuel/spark cut): engine gain 0.3, add a short pop/burble at the end (existing crackle, 1-2 bursts), drivetrain clunk: 20-30 ms noise burst bandpassed 400 Hz Q 2 at -12 dB (T).
- Downshift: auto-blip, rpm target = new-gear rpm over 60 ms, throttle spike, overrun crackle 2-4 bursts at the end; gain bump +3 dB.
- Whine pitch glides to new ratio over the cut (not stepped), otherwise it clicks.
- Needs: gear change event (from, to), time since shift, target rpm. Sim already has shift state; expose `shiftPhase` and direction.

### P5. Rev limiter
- Hard cut: fuel-cut pattern, engine gain toggles 1 / 0.25 at 18-25 Hz (T; real engines ~15-20 Hz alternate-cylinder cut), random jitter 15 percent; plus crackle bursts. Do not use a perfect square wave (aliasing, robotic): smooth edges 3 ms.
- Needs: limiter active flag (rpm >= limiter-50, throttle > 0.9).

### P6. Tyre scrub and squeal from slip
Use slip angle and load, not only slip ratio (patent source above).
- Combined slip s = sqrt(lat^2 + long^2) normalised to peak; squeal begins at 0.85 of peak grip (not 0.1 ratio) so the player hears the limit approach; full at 1.2.
- Bandpassed noise plus two detuned resonators: f = 700 + 500 x s Hz (T) fronts, rears +150 Hz so the axle identity is heard; Q 6; gain 0.5 x smoothstep(s); per axle, not summed max.
- Scrub (rolling, below squeal): pink noise lowpass 1.5 kHz, gain follows lateral force/load; surface multiplier (asphalt 1, kerb 1.4, grass 0.6 low-passed 700 Hz).
- Locking brakes: lower pitch -15 percent, rougher (AM 25 Hz depth 0.4), gain +3 dB; wheelspin: AM at wheel hz.
- Cockpit: tyre cues -3 dB and lowpass 3 kHz; keep them clear of engine masking (Forza talk: tyre feedback is gameplay info, protect it in the mix, duck engine 2 dB when squeal > 0.5).
- Needs: per-wheel slip angle, slip ratio, vertical load, surface id, brake lock flag.

### P7. Kerb rumble and bumps
Existing `kerbRumbleHz = speed/1.5`. Add: lowpass 160 Hz plus thump impulses per stripe (not only LFO); stripes with frequency above ~60 Hz become a buzz, clamp depth; per-wheel left/right pan in cockpit (+-0.3); suspension velocity thump (bump events) 60-90 Hz, 80 ms decay. Needs: surface id per wheel, suspension travel velocity.

### P8. Wind
Existing `windGain` is fine in range. Improve spectrum: pink noise bandpassed 400-3000 Hz, centre = 500 + 12 x speed (T); gain ~ v^2 (not linear), cockpit -6 dB with whistle at mirror/halo band 1.2 kHz at very low level. Exterior chase: no wind (listener is not moving); instead whoosh of the car passing (P10). Needs: speed, camera mode, yaw (gusts).

### P9. Reverb and early reflections (walls, bridges)
- One ConvolverNode with a procedural IR (exponential decay noise, RT60 0.35 s open, 1.2 s tunnel/bridge) or a feedback delay network; send level 0.12 exterior, 0.03 cockpit.
- Early reflections: 2-3 delay taps (8, 17, 29 ms) with lowpass 4 kHz; modulate gain by distance to the nearest wall: tap gain = 0.5 x clamp(1 - d/15). Pitfall: static short delays produce comb filtering, so keep taps non-harmonic and send only a fraction (wet 15-25 percent), highpass the wet at 150 Hz.
- Under bridges/tunnels: switch IR via 300 ms crossfade, raise wet to 0.3.
- Needs: raycast distances left/right (sim already has track edge distance), tunnel/bridge flags from track data.

### P10. Other cars: distance, Doppler, panning
Web Audio dropped Doppler in PannerNode, so do it ourselves.
- Doppler: playback/frequency scale = c / (c - v_radial), c = 343, v_radial = relative velocity projected on the line of sight; smooth with tau 50 ms; cap +-12 percent. For the worklet engine, scale `frequencyHz` (pitch) directly.
- Distance: gain = 1/(1 + d/10), air absorption lowpass fc = 16 kHz / (1 + d/30), floor 2 kHz; use PannerNode (HRTF or equalpower, `inverse` model, refDistance 8) for pan.
- Cap simultaneous engines (e.g. 6 nearest at full synth, others simplified/crossfaded), cull beyond 150 m.
- Needs: other-car positions and velocities, listener position/orientation.

### P11. Loudness, dynamics, master chain
- Master: DynamicsCompressor threshold -14 dB, knee 12, ratio 3, attack 5 ms, release 200 ms (T), then limiter at -1 dBFS (ratio 20, attack 1 ms). Not a hard clip.
- Target loudness for web/desktop headphones/laptops: about -16 LUFS integrated in-race (mobile/PC), console reference -24; offer a quiet mode. Peak -1 dBTP.
- Duck engine bus 2-3 dB under tyre squeal or impacts (sidechain via fast gain control on engine bus).
- Gain staging: master 1.0, engine 0.6, effects 0.8, sum peak < 0.9 pre-limiter.

### P12. What to avoid
- Aliasing: naive saw/pulse oscillators at high rpm; use band-limited (polyBLEP) or additive with harmonics < 0.45 x sampleRate; cap partials at 8 kHz.
- Static loops: add slow random modulation on pitch (+-0.3 percent), gain (+-1 dB), and avoid exact repetitions in crackle and gravel.
- Phasey combs: stacked detuned copies with delays 1-10 ms colour; use delays that are decorrelated, or offsets > 25 ms with low gain, or keep it mono for the exhaust comb (`COMB_FEEDBACK` 0.5 is the upper limit).
- Harsh 2-4 kHz: kerb/crackle/squeal/whine all overlap here; apply -3 dB peaking at 3 kHz Q 1 on the master bus and keep crackle (`CRACKLE_BAND_HZ` 2000) at -6 dB cockpit.
- Zipper noise: use `setTargetAtTime` with tau 20-60 ms for parameters, never `setValueAtTime` jumps (the current Mixer camera switch pops).
- Allocation in per-frame code (project rule): reuse nodes, update AudioParams only.

## Suggested order of work
1. P2 camera blend and P11 master chain (cheap, biggest audible gain).
2. P1 load layers and P5 limiter.
3. P3 whine and P4 shift cut/blip.
4. P6 tyre rework, P7 kerb, P8 wind.
5. P9 reverb, P10 other cars.

## Sim-state wishlist (single struct per frame)
rpm, throttle, engineTorqueSign/load, clutch, gear, gearRatio, finalDrive, shiftPhase+direction, limiterActive, speed, per-wheel slipAngle/slipRatio/vertLoad/surface/brakeLock, suspension velocity, camera mode+distance, wall distances, tunnel flag, other-car pos/vel.
