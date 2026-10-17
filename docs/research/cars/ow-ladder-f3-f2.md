# Feeder single-seaters (F3 2025+, F2 2024+): physics, rules, carSpec mapping

Status key: **REG** = official FIA/series page (fia.com, formula1.com); **PRESS** = Wikipedia/press/secondary; **FORUM** = forum or unverified; **EST** = our estimate (derived, not sourced). The FIA technical/sporting regulation PDFs were not read; verify REG items before hard-coding. Real manufacturer names appear here only because the sources use them; game data stays brand-neutral (proposed ids `ow3`, `ow2`; names "OW-3 Feeder", "OW-2 Feeder Turbo"). Researched 2026-10-17.

Ladder in game: F4 (`f4`, 650 kg) < OW-3 (F3) < OW-2 (F2) < OW-26 (`ow26`, 768 kg hybrid).

## 1. F3 (2025-2027 car)

### 1.1 Physics data

| Parameter | Value | Status | Source |
|---|---|---|---|
| Era | Unveiled 2024-08-31; raced 2025, 2026, 2027 | REG | https://fia.com/node/53556 ; https://www.gpfans.com/en/f1-news/1029077/fia-f3-new-car-italian-grand-prix-unveiled |
| Min mass incl. driver | 673 kg | PRESS | https://en.wikipedia.org/wiki/Dallara_F3_2025 |
| Length x width x height | 4965 x 1885 x 1043 mm | PRESS | https://en.wikipedia.org/wiki/Dallara_F3_2025 |
| Wheelbase, track | Not published in any source found | - | - |
| Weight distribution | Not found (EST 45 % front) | EST | - |
| Engine | 3.4 L V6, 95 deg bank, naturally aspirated, rear, 24 valves DOHC, dry sump | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Bore x stroke | 96 x 78.2 mm (3.396 L) | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Power | 380 hp (283 kW) @ 8000 rpm, fly-by-wire throttle | REG | https://fia.com/node/53556 |
| Torque | 420 N.m (peak rpm not stated; EST ~6000) | PRESS | https://en.wikipedia.org/wiki/Dallara_F3_2025 |
| Rev limit | Not found for F3 (rated power at 8000; EST limiter ~8500) | EST | - |
| Engine mass | 132 kg (F2 turbo variant incl. turbo; F3 lighter) | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Gearbox | 6-speed longitudinal sequential, electro-hydraulic, steering-wheel paddles | REG | https://fia.com/node/53556 |
| Ratios, shift time | Not found | - | - |
| Differential | Not found | - | - |
| Suspension | Double steel wishbones, pushrod, twin dampers, helicoidal springs | PRESS | https://en.wikipedia.org/wiki/Dallara_F3_2025 |
| Tyres | 16-in rims, low-profile; three dry compounds + one treaded wet; no tyre widths found | REG | https://fia.com/node/53556 ; https://www.formula1.com/en/latest/article/formula-3-reveal-2025-car-ahead-of-italian-grand-prix-at-monza.66kDoyOevaqOqS25Qe7RXM |
| Aero | Front/rear carbon wings, low ride-height sensitivity, "optimised DRS"; no downforce/drag figures | REG | https://fia.com/node/53556 |
| Brakes | Not found (EST steel discs, 6-piston-class calipers) | EST | - |
| Top speed | 300 km/h | REG | https://fia.com/node/53556 |
| 0-100 / 0-200 km/h | 3.0 s / 7.7 s | REG | https://fia.com/node/53556 |
| Peak lateral / braking | +/-2.6 G lateral, -1.9 G braking | REG | https://fia.com/node/53556 |
| Safety | Steel halo, wheel tethers, anti-intrusion panels | REG | https://fia.com/node/53556 |
| Fuel | 100 % sustainable fuel; cell size not found | REG | https://fia.com/node/53556 |

### 1.2 Lap-time context (same layout, 2025 pole laps)

| Circuit | F3 pole | F2 pole | F1 pole | F3/F1 | F2/F1 | F3/F2 | Source |
|---|---|---|---|---|---|---|---|
| Monza (Sep 2025) | 1:38.120 | 1:32.390 | 1:18.792 | 1.245 | 1.173 | 1.062 | https://en.wikipedia.org/wiki/2025_Monza_Formula_3_round ; https://en.wikipedia.org/wiki/2025_Monza_Formula_2_round ; https://en.wikipedia.org/wiki/2025_Italian_Grand_Prix |
| Barcelona (Jun 2025) | 1:28.761 | 1:24.810 | 1:11.546 | 1.241 | 1.185 | 1.047 | F3: https://www.pitdebrief.com/post/leon-quickest-as-2025-f3-pre-season-testing-kicks-off-in-barcelona ; F2: https://core-ecs-origin-home.core-dns.watchliveformula1.com/en/latest/article/f2-rafael-camara-takes-second-consecutive-pole-in-barcelona.UxusoC6P0E2LZaAr1Jnbw ; F1: https://en.wikipedia.org/wiki/2025_Spanish_Grand_Prix |
| Bahrain | F3 1:49.214 (2025); F2 1:41.696 (2024) | - | not verified | - | - | 1.074 (layouts may differ) | https://www.motorsport.com/fia-f3/results/2025/bahrain-656197/?st=Q ; https://www.formula1.com/en/latest/article/f2-maini-heads-invicta-racing-one-two-in-tense-bahrain-qualifying.1B36OLKvgJK9DBTvYqgbrc |

Race fastest laps Monza 2025: F3 feature 1:38.910, sprint 1:39.169 (https://en.wikipedia.org/wiki/2025_Monza_Formula_3_round); F2 feature 1:33.259, sprint 1:33.658 (https://en.wikipedia.org/wiki/2025_Monza_Formula_2_round); F1 race FL 1:20.901 (https://en.wikipedia.org/wiki/2025_Italian_Grand_Prix).
Barcelona 2024 F2: pole 1:24.766, feature FL 1:27.918, sprint FL 1:30.617, 37 / 26 laps of 4.657 km (https://en.wikipedia.org/wiki/2024_Barcelona_Formula_2_round).
Tuning target: F3 pole is F1 x 1.24; F2 pole is F1 x 1.17-1.19; F3 is F2 x 1.05-1.06. No sourced F4 lap times found; take the F4 baseline from the game sim and keep F4 > F3 by a similar 4-8 %. The F1 numbers are the 2025 car, not OW-26: re-anchor the ratios on a measured OW-26 lap in the sim.

### 1.3 Rules (gameplay)

| Item | Rule | Status | Source |
|---|---|---|---|
| Weekend | Fri: 45 min practice + 30 min qualifying; Sat: sprint 40 min + 1 lap; Sun: feature 45 min + 1 lap (before the F1 race) | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Sprint grid | Top 12 of qualifying reversed (older format); 2025 events use split qualifying (two groups by car number, 13-16 min each) and a reverse grid built from group results | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship ; https://www.pitdebrief.com/?p=74237 |
| Feature grid | Fastest overall = pole; fastest of the other group alongside; then alternating groups (split-qualifying events) | PRESS | https://www.pitdebrief.com/?p=74237 |
| Points, sprint | 10-9-8-7-6-5-4-3-2-1 (top 10) | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Points, feature | 25-18-15-12-10-8-6-4-2-1 (top 10) | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Bonus | Pole +2 (feature); fastest lap +1 per race if finisher in top 10; max 39 per round | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Pit stop | Optional (needed after weather change or damage); no refuelling | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship ; https://en.wikipedia.org/wiki/FIA_Formula_2_Championship |
| Tyre sets / compound rule | Not found | - | - |
| DRS | Present on the car ("optimised DRS"); activation rules (detection, zones, first laps) not found; assume F1 convention (within 1.0 s at detection point, not in first laps, off in wet) | EST | https://fia.com/node/53556 |
| Push-to-pass | None found | - | - |

### 1.4 carSpec mapping (`ow3`)

| Field | Proposed | Basis |
|---|---|---|
| category / drive | `open-wheel` / `rwd` | - |
| chassis.massKg | 673 (min with driver, no fuel; fuel adds via `fuel`) | PRESS |
| chassis.cgHeight | 0.28 | as F4/ow26 |
| chassis.halfExtents | x 0.9425, y 0.05, z 2.4825 | length/width PRESS |
| chassis.inertia | x 1300, y 1250, z 280 | EST (between f4 and ow26) |
| wheels.positions | front [-0.78,0,-1.65] [0.78,0,-1.65]; rear [-0.755,0,1.35] [0.755,0,1.35] (wheelbase 3.00, 45 % front) | EST |
| wheels.radius / width / inertia | 0.315 / 0.33 / 1.4 (16-in rim, low profile) | EST |
| suspension front / rear | springRate 56000 / 62000; bump 2600 / 2800; rebound 4300 / 4500; arb 20000 / 13500; rest 0.13, travel 0.1, bumpStop 400000 | EST (between f4 and ow26) |
| steering | maxAngleLow 0.38, High 0.09, fullSpeed 60, rate 1.5 | as f4 |
| tyres | optPressure 140, soft/medium/hard mu0 2.06 / 1.95 / 1.85 (Fz0 2000, loadSens 0.1, shapes as f4), same temps/wear as f4; `wet` real, `inter` default-derived | EST; 3 dry + 1 wet PRESS |
| aero | cda 0.80, claFront 1.05, claRear 1.55, rideHeightSens 1.2 (low sens PRESS), wingStep {0.07, 0.10, 0.016} | cda from 283 kW at 300 km/h => CdA <= 0.82 (EST); lateral 2.6 G target |
| engine.torqueCurve | [1500,170] [2500,260] [3500,330] [4500,390] [6000,420] [7000,385] [8000,338] [8500,305] N.m (<= 283 kW everywhere; 338 N.m x 8000 rpm = 283 kW) | shape EST; 420 N.m / 283 kW@8000 REG/PRESS |
| engine.idle / launch / limiter | 1800 / 5500 / 8500 | EST |
| engine.inertia / brakingTorque | 0.10 / 45 | EST |
| gearbox | ratios [2.60, 1.95, 1.58, 1.31, 1.09, 0.88]; final 3.6; reverse 2.6; upRpm 8200, downRpm 4800; shiftTime 0.08; efficiency 0.93. Check: top gear at 8000 rpm = 300 km/h (r 0.315), 1st reaches ~108 km/h at 8500 | EST; 6 gears, 300 km/h REG |
| diff | `lsd`, preload 40, lockPower 0.35, lockCoast 0.2 | EST |
| brakes | maxTorque 5000, bias 0.60 | EST |
| aids | abs/tc disabled (default) | - |
| fuel | capacityL 50, startL 35, bsfc 275, density 0.745 | EST (45 min race) |
| cockpit | default eye; halo-height eye y ~0.72 | EST |
| setup | finalDrive 3.2-4.0 default 3.6; others as f4 | EST |
| Acceptance targets | 0-100 km/h 3.0 s; 0-200 km/h 7.7 s; top speed 300 km/h; peak lateral ~2.6 G at high speed; braking ~1.9 G | REG |

New systems needed: **DRS** (see section 3).

### 1.5 Sound (F3)

| Item | Value | Status | Source |
|---|---|---|---|
| Engine | NA 3.4 L V6, 95 deg; 380 hp @ 8000 rpm | REG/PRESS | https://fia.com/node/53556 ; https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Firing order | Not published. Derived: 3-throw crank at 120 deg with a 95 deg bank gives uneven firing 0, 95, 240, 335, 480, 575 deg (same family as ow26 pattern 0/90/240/330/480/570). If a split-pin crank makes it even-fire, use `[0,120,240,360,480,600]` | EST | - |
| Layout notes | Dry sump, direct injection, fly-by-wire; no turbo or hybrid, so no whine except gear whine | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |

Proposed `sound` (cylinders 6, exhaustLengthM 0.9, intakeMix 0.45, crackle 0.08):
`synth`: firingDeg [0,95,240,335,480,575], bank [0,1,0,1,0,1], pipeM [0.5,0.5], tailM 0.7, pulseDeg 125, intakeHz 280, lowpassHz 4500, limiterHz 18, gainDb 0, turbo null, whine {order 11, gain 0.03, source wheel, minSpeedMs 12} (straight-cut gear whine, taste value). Higher intake mix than F4 (NA, airbox induction roar), open short exhaust, peak ~8000 rpm (about 800 Hz firing frequency at 8000 rpm).

## 2. F2 (2024+ car, ground effect floor)

Note: a new F2 car for 2027-2029 reuses the 2026 chassis; engine, tyres, dimensions and gearbox are unchanged, wings redesigned, on-board starter added (https://api.fia.com/news/fia-formula-2-unveils-its-new-car-2027-2029-seasons). Data below stays valid.

### 2.1 Physics data

| Parameter | Value | Status | Source |
|---|---|---|---|
| Min mass | 795 kg "including driver and fuel" per Wikipedia (FIA page gives no mass). Ambiguous: treat as driver, no fuel | PRESS | https://en.wikipedia.org/wiki/Dallara_F2_2024 |
| Length x width x height | 5284 x 1900 x 1097 mm (incl. camera roll hoop) | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Wheelbase | 3135 mm | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Track, weight distribution | Not found (EST 45.5 % front) | EST | - |
| Engine | 3.4 L V6 (95 deg), single turbo in the vee, longitudinal, fly-by-wire, rebuild 8000 km | REG/PRESS | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza ; https://www.raceenginetechnology.com/Suppliers/porsche-42-litre-flat-6-gt3-16 |
| Power | 620 hp (462 kW) @ 8750 rpm | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Torque | 570 N.m @ 6000 rpm (FIA); Wikipedia says 583 N.m | REG / PRESS | same; https://en.wikipedia.org/wiki/Dallara_F2_2024 |
| Rev limit | 8750 rpm | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Turbo | Single, boost up to 1.5 bar, spin cap 125,000 rpm | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Fuel flow | Restrictor ~105 kg/h | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Gearbox | 6-speed longitudinal sequential, electro-hydraulic paddles, carbon clutch, no on-board starter (2024) | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Ratios, shift time | Not found | - | - |
| Differential | Non-hydraulic ramp-type limited slip | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Suspension | Pushrod wishbones; front torsion bars, rear springs; adjustable ARBs, ride height, camber, toe | REG | same |
| Wheels | Magnesium 18 x 12 in front, 18 x 13.7 in rear | REG | same |
| Tyres | Pirelli slick (dry) + treaded wet; tyre diameter/compound count not found | REG | same |
| Brakes | Carbon-carbon discs and pads, 6-piston monobloc calipers | REG | same |
| Aero | Ground-effect floor (F1 2022 philosophy), 3-plane front wing, rear wing with DRS flap; no numeric data | PRESS | https://en.wikipedia.org/wiki/Dallara_F2_2024 ; https://formulascout.com/?p=110697 |
| DRS | Hydraulic, F1-like function | REG | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza |
| Fuel cell | 125 L; 55 % bio-sourced fuel (2024) | REG | same |
| Top speed | Not found (EST ~320 km/h Monza trim, higher with DRS) | EST | - |
| Safety | Titanium halo, F1-2024 safety standard | REG | same |

Lap-time deltas: see section 1.2 table (F2 = F1 x 1.17-1.19).

### 2.2 Rules (gameplay)

| Item | Rule | Status | Source |
|---|---|---|---|
| Weekend | Fri: 45 min practice + 30 min qualifying; Sat sprint ~120 km / 45 min max; Sun feature ~170 km / 1 h max (before the F1 race) | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_2_Championship |
| Sprint grid | Top 10 of qualifying reversed | PRESS | https://www.formula1.com/en/latest/article/new-points-system-revealed-for-formula-2-and-formula-3.258sclCMH8xWQDWRjIA9xY |
| Race length example | Barcelona 2024: sprint 26 laps, feature 37 laps of 4.657 km | PRESS | https://en.wikipedia.org/wiki/2024_Barcelona_Formula_2_round |
| Points, sprint | 10-8-6-5-4-3-2-1 (top 8) | PRESS | https://www.formula1.com/en/latest/article/new-points-system-revealed-for-formula-2-and-formula-3.258sclCMH8xWQDWRjIA9xY |
| Points, feature | 25-18-15-12-10-8-6-4-2-1 (top 10) | PRESS | same |
| Bonus | Pole +2; fastest lap +1 per race if finisher in top 10; max 39 per round | PRESS | same |
| Mandatory pit stop | A mandatory stop exists in F2 races (2024 stewards penalised a car for "failing to complete mandatory pit stop"; stop under VSC counts only if car is already in pit entry/lane). Which race(s) and the compound condition are not confirmed; EST: feature race, two different dry compounds, waived if declared wet | PRESS (existence) / EST (detail) | https://www.fia.com/sites/default/files/decision-document/2024%20Spielberg%20Event%20-%20INFRINGEMENT%20-%20Car%2021%20-%20failure%20to%20complete%20mandatory%20pit%20stop.pdf |
| Pit penalty | Missed stop: stop-and-go converted to time penalty after the race (30 s per a summary of the decision) | PRESS | same |
| Refuelling | Prohibited | PRESS | https://www.formula1.com/en/latest/article/new-points-system-revealed-for-formula-2-and-formula-3.258sclCMH8xWQDWRjIA9xY |
| Tyre sets | Not found | - | - |
| DRS | As F3: assume F1 convention (1.0 s detection, zones) | EST | - |
| Push-to-pass | None found | - | - |

### 2.3 carSpec mapping (`ow2`)

| Field | Proposed | Basis |
|---|---|---|
| category / drive | `open-wheel` / `rwd` | - |
| chassis.massKg | 795 (see ambiguity; if the 795 includes ~55 kg fuel use 740) | PRESS |
| chassis.halfExtents | x 0.95, y 0.05, z 2.642 | REG |
| chassis.inertia | x 1600, y 1600, z 290 | EST |
| wheels.positions | front [-0.80,0,-1.709] [0.80,0,-1.709]; rear [-0.775,0,1.426] [0.775,0,1.426] (wheelbase 3.135 REG, 45.5 % front EST) | REG/EST |
| wheels.radius / width / inertia | 0.33 / 0.35 (rear 13.7 in = 0.348 m REG; front 12 in = 0.305 m) / 1.6 | EST/REG |
| suspension front / rear | springRate 64000 / 72000; bump 2800 / 3000; rebound 4700 / 4900; arb 21000 / 14500 | EST |
| tyres | optPressure 140; soft/medium/hard mu0 2.18 / 2.06 / 1.96 (2 dry compounds per weekend in the weekend layer; third kept for the setup menu); wet real | EST |
| aero | cda 0.92, claFront 1.45, claRear 1.95, rideHeightSens 2 (ground effect floor), wingStep {0.085, 0.11, 0.018} | EST (between ow3 and ow26) |
| engine.torqueCurve | [3000,300] [4000,430] [5000,540] [6000,570] [7000,565] [8000,520] [8700,505] N.m (7000: 414 kW; 8700: 460 kW, matches 462 kW @ 8750) | 570 N.m@6000 and 620 hp@8750 REG; shape EST |
| engine.idle / launch / limiter | 2000 / 6500 / 8750 | limiter PRESS |
| engine.inertia / brakingTorque | 0.11 / 50 | EST |
| gearbox | ratios [2.80, 2.05, 1.62, 1.32, 1.07, 0.85]; final 4.0; reverse 2.8; upRpm 8450, downRpm 5200; shiftTime 0.06; efficiency 0.94. Top gear at 8750 rpm = ~320 km/h (r 0.33) | EST; 6 gears REG |
| diff | `lsd`, preload 50, lockPower 0.40, lockCoast 0.25 (ramp type REG) | REG/EST |
| brakes | maxTorque 8000 (carbon), bias 0.58 | EST |
| aids | disabled | - |
| fuel | capacityL 125 (REG), startL 75, bsfc 255, density 0.745 | EST |
| setup | finalDrive 3.5-4.5 default 4.0; wings 0-10 | EST |
| activeAero (DRS stand-in) | dragScale 0.85, downforceScale 0.88, transitionS 0.2 (rear flap only; magnitudes EST) | EST |

Turbo behaviour is not a carSpec field: model lag by shaping the low-rpm torque points (steep rise 3000-5000 rpm) and by `sound.synth.turbo.lagS`.

## 3. New systems the game would need

| System | Needed by | Notes |
|---|---|---|
| DRS (zones, 1.0 s detection, enable after first laps, closes on brake, disabled in wet) | OW-3, OW-2 | `activeAero` carries the drag/downforce scales but its activation is rule-less (OW-26 uses mode zones); needs zones in track data and a proximity timer. Rules for F2/F3 not confirmed: use F1 convention. |
| Reverse-grid sprint | OW-3 (top 12), OW-2 (top 10) | Session layer: qualifying result -> sprint grid; second race on the same weekend with its own points table. |
| Mandatory pit stop (two dry compounds) | OW-2 feature | Needs pit-lane/pit-stop model, compound-used tracking, time penalty on breach. Waived in a declared wet race (EST). |
| Split qualifying (two groups) | OW-3 at some rounds | Optional; the simple single session is acceptable. |
| Points tables | both | Data only: F3 sprint top 10 (10..1), F2 sprint top 8 (10-8-6-5-4-3-2-1), feature top 10 for both, pole +2, FL +1 (top 10). |
| Fuel-mass handling | OW-2 | Feature race uses ~75 L; already supported by `fuel`. |

No push-to-pass exists in either series (nothing found). No hybrid in either car.

## 4. Sound (F2)

| Item | Value | Status | Source |
|---|---|---|---|
| Engine | Turbo 3.4 L V6 (95 deg), single turbo in the vee, 620 hp @ 8750 rpm | REG/PRESS | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza ; https://www.raceenginetechnology.com/Suppliers/porsche-42-litre-flat-6-gt3-16 |
| Boost / turbo speed | up to 1.5 bar, cap 125,000 rpm (~2.1 kHz shaft frequency) | PRESS | https://en.wikipedia.org/wiki/Mecachrome_V634_engine |
| Firing order | Same crank as F3 (same engine family, uneven 0/95/240/335/480/575) | EST | - |
| Notes | Turbo in the vee muffles the exhaust (lower lowpass, steady boost whistle); wastegate flutter and pops on lift; DI | EST | - |

Proposed `sound` (cylinders 6, exhaustLengthM 1.0, intakeMix 0.3, crackle 0.12):
`synth`: firingDeg [0,95,240,335,480,575], bank [0,1,0,1,0,1], pipeM [0.5,0.5], tailM 0.8, pulseDeg 135, intakeHz 300, lowpassHz 3600, limiterHz 20, gainDb 1, turbo {centerHz 3200, spanHz 2400, gain 0.03, lagS 0.5}, whine {order 11, gain 0.04, source wheel, minSpeedMs 12}. Redline 8750 rpm => ~875 Hz firing frequency; lower and "heavier" than F3 at the same rpm because of the turbo muffling; keep OW-26 (15000 rpm) clearly higher pitched.

## 5. 3D model sourcing

| Option | Licence | Tris | Notes | Source |
|---|---|---|---|---|
| Generic Formula Car (CarlosCG31, id `46e0805e009a42f297405d943d6ce22e`) | CC-BY 4.0 (API-verified) | 16.6k | generic, no logos; F3 candidate | docs/research/car-models.md |
| Formula F211 (CarlosCG31, id `cada3b67c43744adadee21adcabc4fc4`) | CC-BY 4.0 (API-verified) | 36.9k | generic; F2/F3 candidate | docs/research/car-models.md |
| FIA F1 2026 Car (Abu Saif) | CC-BY 4.0 on page | 275.9k | too heavy, 2026 shape; not a feeder | docs/research/f1-2026-car.md |
| Dedicated F2 or F3 model | none found with a free licence | - | search found no CC F2/F3 model; one unverified listing named "f2" (author kinezu), licence unknown | https://stlfinder.com/model/f2/3951356 |
| Rejected | CC-BY-NC-SA Formula E model (Spark SRT05E G2); paid generic formula sets | - | non-commercial or paid | https://sketchfab.com/3d-models/spark-srt05e-g2-wwwvecarzcom-7191d89402344207b640ee35268dbe28 |

Recommendation: custom brand-neutral models derived from the project's own assets (no new licence): OW-3 = `f4.glb` scaled to length 4.965 m / wheelbase ~3.0 m with halo and F2-family wings; OW-2 = `ow26.glb` shrunk to 5.284 m / wheelbase 3.135 m, with a 1.9 m width, a cut rear-wing flap for DRS and no hybrid detail. Cross-check proportions with the generic CC-BY models above. Strip any real sponsor/series marks if a third-party mesh is used; CC-BY needs an in-game credit.

## 6. Open items

| Gap | Impact | How to close |
|---|---|---|
| F3 wheelbase, track, ratios, rev limit, brakes | EST values in `ow3` | FIA F3 Technical Regulations 2025 PDF (fia.com) |
| F2 track, tyre diameter, ratios | EST wheel radius and gearing | FIA F2 Technical Regulations 2024 PDF; Pirelli F2 data sheet |
| F2 mandatory stop rule text (which race, compound condition) | OW-2 weekend logic | FIA F2 Sporting Regulations 2025/2026, Article 38 (stewards decision cites a pit-stop article) |
| F2/F3 DRS activation rules | DRS system | Sporting Regulations; assume F1 convention until read |
| F2 pole times Barcelona 2025 and Bahrain F2/F1 | secondary cross-check only | motorsport.com result pages |
| F3 2025 sprint grid after split qualifying (top 12 vs group-based) | reverse-grid implementation | F3 Sporting Regulations 2025 |
