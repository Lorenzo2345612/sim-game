# Electric open-wheel (GEN4 era, season 2026/27+): research

Status key: **REG** = official fact sheet/regulation as quoted by a source; **PRESS** = press/secondary; **FORUM** = forum/unverified; **ASSUMED** = planner/engineering estimate for the sim, no source (must be tuned). Researched 2026-10-17. FIA technical-regulation PDF not read directly; verify REG items before hard-coding. Game data must be brand-neutral (fictional series/car names, no logos); real names appear only in this doc.

## 1. Physics

| Parameter | Value | Status | Source |
|---|---|---|---|
| Mass, minimum | 954 kg "including driver" (FIA table); FAQ says 950 kg | REG | https://www.fiaformulae.com/en/news/762855/fact-sheet-all-you-need-to-know-about-the-gen4-car ; https://www.fiaformulae.com/en/news/1021458 |
| Mass, conflicting | 1012 kg (862 for Gen3 Evo); Porsche says 954 kg "without driver"; Wikipedia 1016/1012 kg | PRESS | https://e-formula.news/news/formula-e-news/formula-e-news-detail/freedom-for-manufacturers-pit-boost-remains-technical-regulations-for-formula-e-gen4-car-published-71621 ; https://newsroom.porsche.com/en/2026/motorsports/porsche-975-rse-formula-e-gen4-presentation-42182.html ; https://en.wikipedia.org/wiki/Formula_E_Gen4 |
| Length / width / height | 5540 / 1790-1800 / 1025-1113 mm (sources differ on width and height) | REG/PRESS | fact sheet (above); https://en.wikipedia.org/wiki/Formula_E_Gen4 |
| Wheelbase | 3080 mm (Gen3: 2970.5) | REG | fact sheet; e-formula.news article above |
| Track width | Not published. Derived cap: width 1.80 m minus tyre width -> front <= 1.505 m, rear <= 1.455 m | ASSUMED | derived |
| Race power | 450 kW (+50% vs Gen3 Evo) | REG | https://www.fiaformulae.com/en/news/1021458 |
| Attack mode / qualifying power | 600 kW (Gen3 Evo 350 kW) | REG | same |
| Drive split | Rear axle capped at 350 kW; front powertrain 250 kW (Gen3: 50 kW); sum 600 kW | PRESS | e-formula.news article above |
| AWD | Permanent active AWD in every race phase (Gen3 Evo: front motor only at start, attack mode, duels) | REG | https://www.fiaformulae.com/en/news/1021458 |
| Regen | 700 kW total, 350 kW per axle (front was 250 kW) | PRESS/REG | https://newsroom.porsche.com/en/2026/motorsports/porsche-975-rse-formula-e-gen4-presentation-42182.html ; https://www.fiaformulae.com/en/news/762858/formula-e-and-fia-unveil-the-all-new-gen4 (via search) |
| Regen share of race energy | "over 40 %" (Gen1 ~15, Gen2 ~25) | REG | https://www.fiaformulae.com/en/news/1021458 |
| Battery energy | Race energy capacity 55 kWh (+43 % vs 38.5); usable 51.25 kWh (Podium pack) | REG/PRESS | fact sheet; https://en.wikipedia.org/wiki/Formula_E_Gen4 ; Porsche page above |
| Battery charge power | CCS up to 600 kW | PRESS | Porsche page above |
| Energy per race | Budget = usable energy (~51 kWh); with >40 % regen, gross traction energy ~85 kWh (51.25 / 0.6) | derived | derived |
| Top speed | 335 km/h (Gen3 320) "given enough room" | REG | https://www.fiaformulae.com/en/news/1021458 |
| 0-100 / 0-200 km/h | ~1.8 s / 4.4 s | REG | https://www.fiaformulae.com/en/news/1021458 |
| Lap time | At least ~5 s quicker than Gen3 Evo on street circuits; close to F2 pace | PRESS | https://www.carscoops.com/2026/04/formula-e-gen4-race-car/ ; https://the-race.com/formula-e/f2-pace-very-different-look-formula-e-next-car/ |
| Tyres | One all-weather treaded dry tyre + one wet ("monsoon"), Bridgestone, 18 in; "~5 % more grip" than previous (FIA roadmap report) | REG/PRESS | https://www.fiaformulae.com/en/news/1021458 ; Bridgestone result via search |
| Tyre widths / rims | Front 295 mm on 11.5 in rim; rear 345 mm on 13 in rim (Wikipedia says rear 330) | PRESS | e-formula.news article above ; https://en.wikipedia.org/wiki/Formula_E_Gen4 |
| Camber limits | Front 0 to -4 deg, rear 0 to -3 deg | PRESS | e-formula.news article above |
| Aero | Two kits: high downforce (qualifying, Unleashed format), low downforce (races); no coefficients published; very low drag required for energy targets | REG/PRESS | https://www.fiaformulae.com/en/what-is-formula-e ; the-race.com article above |
| Brakes | Hydraulic friction brakes return on rear axle; brake-by-wire (front, manufacturer-developed); emergency system if rear regen fails; 275 mm discs front and rear | PRESS | e-formula.news article above ; Porsche page above |
| Gearbox | Single speed per axle, manufacturer-developed (Porsche: in-house gearbox); ratio not published | PRESS | Porsche page above |
| Differentials | Active front and rear diffs allowed (electric/hydraulic lock), or mechanical LSD / viscous coupling | PRESS | e-formula.news article above |
| Aids | TC and ABS "unlimited" (fact sheet) | REG | fact sheet |
| Steering | Power steering (first for the series) | PRESS | https://en.wikipedia.org/wiki/Formula_E_Gen4 |
| Suppliers | Front powertrain Marelli (common), battery Podium, tyres Bridgestone, chassis Spark | PRESS | the-race.com article above |

Not found: front/rear split of the 450 kW race level, motor torque/rpm, gear ratios, aero coefficients, tyre outer diameter, rolling/curve tyre data.

## 2. Rules that change how the race plays

| Rule | Detail | Status | Source |
|---|---|---|---|
| Race distance | Time-based: 45 min + the following lap (performance E-Prix); lap-count cap applies; 75 min for efficiency races; after interruption up to 75 min + 1 lap | REG | https://e-formula.news/news/formula-e-news/formula-e-news-detail/detailed-analysis-an-overview-of-all-changes-to-the-formula-e-sporting-regulations-ahead-of-the-gen4-debut-73171 |
| Two formats at double-headers | "E-Prix Unleashed": 30 min, high downforce, 6 min attack mode, no pit boost. Standard E-Prix: 45 min, low downforce, 8 min attack mode, mandatory pit boost | REG | https://www.fiaformulae.com/en/what-is-formula-e |
| Energy management | Usable energy is a hard budget; when it runs out power drops to 0 kW; regen >40 % of energy so lift-and-coast/regen braking matter | REG | e-formula.news sporting article above |
| Attack mode (power) | +150 kW above the 450 kW race cap (600 kW) | REG | https://www.fiaformulae.com/en/news/1021458 |
| Attack mode (activation) | Gen3 rule, S13 unverified: arm on wheel, drive through off-line zone, hit 3 coils in sequence; not allowed in first laps (older source says first 2), under safety car or FCY; last activation must expire before the end | PRESS (Gen3) | https://e-formula.news/wiki/attack-mode |
| Attack mode (duration/count) | Gen3: 2 activations, split 2+6 / 4+4 / 6+2 min of the 8 min (since 2023). S13 total is 8 min (6 in Unleashed); activation count not found, assume 2 | PRESS/ASSUMED | same; fiaformulae.com page above |
| Pit boost (fast charge) | Mandatory stop in standard E-Prix; driver chooses energy level on the wheel before entering the pit lane (FIA table of levels vs minimum stop time); 4.05 kWh (was 3.85); at 600 kW this is ~24 s plus lane time (derived; Gen3 reports ~30 s stop). Gen3 report: stop unlocks 2nd attack mode period; one article says limit to one attack period, unconfirmed | PRESS/derived | e-formula.news article (71621) above ; sporting article above ; https://e-formula.news/wiki/attack-mode |
| Refuelling | None; only pit boost | REG | same |
| Qualifying | Group stage (up to 600 kW, full power), then knockout Duels, final duel decides pole; aero kit announced >= 3 weeks before; from 2026/27 duel points: 1 per qualifier, 1 per duel winner, +1 bonus for final winner | REG | sporting article above ; https://www.fiaformulae.com/en/what-is-formula-e |
| Practice | 45 min, first 30 min capped at 450 kW; shakedown 350 kW | REG | sporting article above |
| Safety car energy | No 600 kW mode behind the safety car on a rolling start; proceeding to grid capped at 450 kW; attack mode cannot be armed under SC/FCY (Gen3 rule). No explicit energy-adjustment rule found | REG/PRESS | sporting article above ; attack-mode wiki above |
| FanBoost | Dropped (removed in the Gen3 era); absent from every S13 source | PRESS | https://www.motor.es/noticias/tecnologia-carga-rapida-attack-charge-adios-al-fanboost-nueva-formula-e-202291342.html |
| Tyre allocation | Single-header: 2 all-weather sets + 1 wet set; double-header: 3 + 1; joker tyres on puncture (steward approval) | REG | sporting article above |
| Points | Top 10 score, winner 25 | REG | fiaformulae.com page above |
| Season | 6-16 events, 6-22 races | REG | sporting article above |

## 3. Mapping to carSpec (proposed values)

`NEW` = needs a new spec field or system; otherwise the existing field is used. All values ASSUMED unless a source is quoted in section 1.

| Field | Proposed | Note |
|---|---|---|
| id / name / category | `ow-e` / generic neutral name / `open-wheel` | no real names |
| drive | `awd` | NEW: type is `'rwd'` only; need torque split front/rear |
| chassis.massKg | 954 | REG; alt 1012 if the real figure excludes driver; make it a tunable |
| chassis.cgHeight | 0.27 | ASSUMED (floor battery) |
| chassis.inertia | x 1830, y 1860, z 330 | scaled from ow26 by mass x wheelbase^2 |
| chassis.halfExtents | x 0.90, y 0.05, z 2.77 | width 1.80, length 5.54 |
| wheels.positions | front (+-0.74, 0, -1.54), rear (+-0.72, 0, 1.54) | wheelbase 3.08, track capped by width |
| wheels.radius / width | 0.335 / 0.295 front, 0.345 rear | NEW: ow26 has one width for all wheels; split front/rear needed. Radius ASSUMED |
| wheels.inertia | 1.6 | ASSUMED |
| tyres.optPressureKpa | 170 | ASSUMED |
| tyres.compounds | soft=medium=hard (single all-weather): mu0 ~1.45, Bx 12, Cx 1.5, loadSens 0.12, optTempC 80, tempWindowC 50 (wide), low wearRate, `wet` mu0 ~1.05, `inter` omitted | mu0 below F4 slicks (1.72). Check 0-100 1.8 s needs ~1.6 g at launch with AWD and full traction (954 kg, 600 kW); launch may need mu0 up to 1.6 or a launch-assist, tune against 1.8 s |
| aero.cda | 1.15 low-DF / 1.35 high-DF | low-DF derived: 335 km/h at 600 kW needs CdA ~1.2 with 0.97 efficiency |
| aero.claFront / claRear | low-DF 0.70 / 1.00; high-DF 0.85 / 1.25 | between F4 (2.0 total) and ow26 (4.2 total); F2-pace target. Two kits need NEW discrete `aeroKit` (or reuse `setup.frontWing/rearWing` steps; kit chosen per session) |
| engine.torqueCurve | Motor-side combined curve (Nm vs motor rpm): [[0,709],[8000,709],[10000,573],[12000,478],[14000,409],[16000,358],[18000,318],[20000,287]] | NEW: constant torque to ~8000 rpm then constant 600 kW (T = P/w). Valid for ratio 7.8, 20,000 rpm max (ASSUMED). Needs per-mode power cap (450/600/350/250 kW) as NEW multiplier |
| engine.idleRpm / launchRpm / limiterRpm | 0 (or 1) / 0 / 20000 | motors have no idle; check code for division by idle |
| engine.brakingTorque | NEW `regen` block: coast regen ~0.1 g, brake regen max 700 kW (front 350 / rear 350), blend with friction | existing field is engine braking only |
| gearbox | ratios [1.0], final 7.8, reverse 7.8, shiftTime 0, up/downRpm out of range, efficiency 0.97 | ASSUMED; confirm single-ratio arrays and no shift logic are safe |
| diff | `lsd`, preload 30, lockPower 0.45, lockCoast 0.25 on both axles | NEW: active lock (electronic) and second diff for AWD |
| brakes | maxTorque 5000, bias 0.55 (front share), rear friction only above regen capacity | NEW: brake-by-wire blend |
| aids | abs enabled slip 0.12, tc enabled slip 0.15 | REG: unlimited TC/ABS |
| fuel | capacityL 0, startL 0 | field is required; verify nothing divides by capacity |
| hybrid | Do not reuse for the electric car as-is (needs ICE, taper by speed, super-clip) | existing `HybridSpec` is F1-shaped |
| cockpit / steering | like ow26; add power steering as steering.rate default | |
| setup | frontWing/rearWing, brake bias 0.50-0.60, tyre pressure; add energy deployment map | |

New systems the sim lacks:

| System | Needed behaviour |
|---|---|
| Electric powertrain | Motor torque curve vs motor rpm per axle, front/rear torque split, AWD drive in the vehicle model (currently RWD only) |
| Battery / SoC | usable 51.25 kWh, drain by power, charge by regen, 0 kW at empty; efficiency losses |
| Power cap profile | 450 kW race, 600 kW attack/qualifying, 350 kW rolling start, 450 kW pit-to-grid, 0 kW empty |
| Regen blending | 700 kW regen, per-axle 350 kW, lift regen, friction brake blend (rear friction returns) |
| Attack mode | Arm + off-line activation zone (3 coils), 8 min total per race in 2 activations, disabled under SC/FCY and early laps, HUD timer |
| Pit boost | Mandatory pit stop, selectable energy level (default 4.05 kWh) vs stop time, no refuel |
| Time-based race | 45 min + 1 lap, lap cap, 30 min Unleashed variant, SC energy rules |
| Qualifying duels | Group stage then bracket; points for qualifying |
| Two aero kits | High-downforce (quali/Unleashed) vs low-downforce (race) |
| Electric sound voice | See section 4; engineVoice has no electric (non-firing) mode |
| Spec: split wheel widths, active diff, per-axle drive | See table above |

## 4. Sound

No measured Gen4 data found. The real series cars are quiet at low speed with a high-pitched drivetrain whine dominating at race speed, mostly gearbox, plus tyre noise as the only other significant sound; broadcast sound design aims to emphasise whine, tyre noise and rush of air; whine character changes with development (deeper or less prominent).

| Source | Claim | Status | URL |
|---|---|---|---|
| Whine = mainly gearbox, other noise = tyres (Gen1 visit report) | PRESS | https://www.ednasia.com/?p=4578 |
| Broadcast audio aims at whine, tyre noise, high-speed rush | PRESS | https://www.stereonet.com/news/sennheiser-wants-to-reinvent-the-sound-of-formula-e |
| Whine has become deeper/less prominent as development progressed | PRESS | https://static.goodwood.com/grr/race/modern/video-how-the-sound-of-formula-e-is-changing |

Proposed synth parameters (all ASSUMED; wheel radius 0.33 m is the voice constant `WHEEL_RADIUS_M`; wheel-order = multiples of wheel revolutions; at 93 m/s one wheel rev = 44.9 Hz, at 28 m/s = 13.5 Hz):

| Layer | Source | Order / value | Frequency range | Gain |
|---|---|---|---|---|
| Motor electrical fundamental | wheel | 7.8 wheel-orders x 4 pole pairs = ~31 | ~420 Hz (28 m/s) to 1.4 kHz (93 m/s) | 0.05 |
| Motor 2nd/3rd harmonics (inverter ripple) | wheel | 62, 93 | 840 Hz-2.8 kHz | 0.03, 0.015 |
| Gear mesh stage 1 (the dominant "whine") | wheel | ~156 (pinion ~20 teeth x ratio) | 2.1 kHz - 7 kHz | 0.07 |
| Gear mesh stage 2 | wheel | ~60 | 0.8 - 2.7 kHz | 0.04 |
| Inverter switching carrier | fixed | 8-12 kHz with +-motor-frequency sidebands, slight pitch drift with load | 8-12 kHz | 0.015, rises with load |
| Tyre roll noise | speed | band noise 400-1500 Hz, gain ~ v^1.5, plus slip squeal (existing layer) | broadband | dominates above ~150 km/h |
| Wind | speed | existing `windGain`, add open-wheel turbulence 100-600 Hz | broadband | rises with v^2 |
| Load dependence | throttle/regen | whine +4 dB under load, -3 dB and slightly lower mesh gain on lift; regen has stronger low motor tone | | |
| Attack mode | state | +2 dB whine, +0.5 kHz brightness | | |
| Pit boost | state | none (silent stop), brief charger relay clack | | |

Needs: an electric voice path (no `firingDeg`; `cylinders` parser requires 1..12), more than one `whine` layer (spec has a single `WhineLayer`), whine orders above 100 (parser cap is (0,100]; use a lower order with the wheel radius scaling or lift the cap), a fixed-frequency carrier layer, speed-driven tyre noise layer.

## 5. 3D model sourcing

No free generic Gen4-shape model found. Gen4 is long (5.54 m) with a 3.08 m wheelbase, closed wheel arches are not used, so a generic formula model needs rescaling and rear bodywork changes. Licences below are from search listings only; verify each page before use (Sketchfab 429s page fetches in this repo's earlier research).

| Candidate | Author | Licence | Notes | URL |
|---|---|---|---|---|
| Formula E Project (boxy WIP) | lorinxgames | CC-BY (listing) | ~220k tris, work in progress, verify download | https://sketchfab.com/3d-models/formula-e-project-9e269f0eefb246519d9e246732d920da |
| Generic Formula Car | CarlosCG31 | CC-BY per docs/research/car-models.md | 16.6k tris, no logos, shape not electric | docs/research/car-models.md |
| Formula E Gen2 Spark SRT05E | n/a | CC-BY-NC-SA | rejected (non-commercial) | https://sketchfab.com/3d-models/spark-srt05e-g2-wwwvecarzcom-7191d89402344207b640ee35268dbe28 |
| Formula E Gen1 (RenderHub) | naudaff3d | free, editorial-use restriction | rejected | https://www.renderhub.com/naudaff3d/formula-e-gen1-car |
| Formula E Nissan Gen2 | CLeN | CC (docs/research/car-models.md) | 13.3k tris, logos baked | docs/research/car-models.md |

Recommendation: custom model in Blender, using the F4/ow26 pipeline as the base proportions, textured neutral; fall back to retexturing the generic formula car scaled to 5.54 x 1.80 m with a longer rear and no logos.

## 6. Calendar 2026/27 (season 13) and local tracks

21 rounds at 13 events; dates provisional (Monaco: 1-2 May vs 15 May in other sources; Tokyo finale 20-21 vs 24-25 Jul). Source: https://racingnews365.com/2027-formula-e-calendar-season-13 (PRESS); venue names beyond city not confirmed except Austin = Circuit of the Americas.

| Rounds | Event | In `public/tracks/`? |
|---|---|---|
| 1-2 | Jeddah (18-19 Dec 2026) | no |
| 3 | Mexico City (16 Jan) | `mexico` exists (F1 layout); the series uses a shortened layout, derive a variant |
| 4 | Austin (6 Feb) | no (not in index) |
| 5 | Miami (20 Feb) | no |
| 6 | Sao Paulo (13 Mar) | no |
| 7 | Sanya (17 Apr) | no |
| 8-9 | Monaco (1-2 May) | no |
| 10-11 | Berlin (8-9 May) | no |
| 12-13 | Brands Hatch (29-30 May) | no |
| 14-15 | Zandvoort (18-19 Jun) | no |
| 16-17 | Madrid (26-27 Jun) | no |
| 18-19 | Shanghai (10-11 Jul) | no |
| 20-21 | Tokyo (24-25 Jul) | no |

Local tracks in `public/tracks/index.json`: monza, spa, silverstone, mexico, daytona, lusail, bahrain, braselton, elkhart, sepang, baku, budapest, singapore, lasvegas, spielberg, fontana, fontana-roval, cleveland, detroit. Only `mexico` overlaps the calendar, so a first electric release needs new street tracks (priority by data availability: Berlin, Monaco, Jeddah, Miami, Tokyo) or ships on existing street circuits (baku, singapore, detroit, lasvegas) as brand-neutral races.

## Open questions to verify before specs

| Item | Why |
|---|---|
| Real mass definition (954 vs 1012) | 6 % mass difference changes launch and brake model |
| Front/rear split of 450 kW race level | torque split in AWD model |
| Motor rpm and gear ratio | torque curve and sound orders |
| Tyre outer diameter and rear width (330 vs 345) | wheel radius, contact patch |
| Attack mode count and activation-zone rule for S13 | gameplay rules |
| Aero downforce/drag per kit | tuning to F2-like pace |
