# Later series: stock car, IndyCar, TCR, Supercars, GT4, LMP3

Status key: **REG** = regulation/official spec sheet; **PRESS** = press/manufacturer/secondary; **FORUM** = forum, own estimate or not verified. Researched 2026-10-17 via web search; regulation PDFs were not read (the TCR PDF is compressed, not parsed). Every FORUM value must be checked before hard-coding. In game all names are fictional (no series, team, manufacturer or logo in data); real names appear here only to cite sources.

Existing assets used below: cars `f4, gt3-a..d, lmp2-a, hyper-a, ow26` (`public/cars/index.json`); categories in `carSpec.ts`: `open-wheel, gt3, gt4, touring, prototype, lmp2, hypercar` (`gt4` and `touring` exist already). `drive` is typed `'rwd'` only. Gearbox: `auto|manual` mode in `src/physics/gearbox.ts`, one ratios array, no H-pattern/sequential distinction. Sound types per car: `docs/design/engine-audio-v2.md` (cross-plane V8, flat-plane V8, flat-six, V10, V6 turbo hybrid, I4 turbo).

## 0. Summary table

| Series | Mass (kg, with driver unless noted) | Engine | Power | Rev limit | Box | Drive | Top speed |
|---|---|---|---|---|---|---|---|
| Stock car | ~1,540 (3,400 lb w/ driver+fuel) | 5.86 L pushrod V8 NA | 670 hp (road/intermediate), 510 hp (superspeedway) | ~9,000 (FORUM) | 5-speed sequential | RWD | ~320 (FORUM) |
| IndyCar | ~770-810 dry, no driver (1,700-1,785 lb) | 2.2 L V6 twin-turbo + hybrid | 650-700 + 60-150 hybrid + ~50 P2P | 12,000 | 6-speed paddle | RWD | ~380 (speedway, FORUM) |
| TCR | 1,265 (with driver) | 2.0 L I4 turbo | 350 hp (BoP-capped) | ~7,000 | 6-speed sequential paddle (DSG variants exist) | FWD | ~250 (FORUM) |
| Supercars Gen3 | 1,350 | 5.0-5.7 L V8 NA (sources conflict) | 600 hp | 7,500 | 6-speed sequential | RWD | 300 |
| GT4 | 1,300-1,450 | production-derived (I6, flat-6, V8, I4 turbo) | 350-500 hp, BoP | 7,000-8,500 (FORUM) | 6-7 speed sequential or dual-clutch | RWD mostly | ~270 (FORUM) |
| LMP3 Gen3 | ~950-960 (Gen2 figure; Gen3 not found) | 3.5 L V6 twin-turbo (60 deg) | 470 hp | ~7,000 (FORUM) | 6-speed sequential paddle | RWD | ~270 (FORUM) |

## 1. US stock car "Next Gen"

### 1.1 Physics
| Parameter | Value | Status | Source |
|---|---|---|---|
| Min weight | 3,200 lb without driver/fuel; 3,400 lb with both (~1,542 kg) | PRESS (another spec sheet: ~3,300 lb) | https://en.wikipedia.org/wiki/Next_Gen_(NASCAR) ; https://www.speedsport.com/nascar/nascar-cup-series/the-nuts-bolts-of-nascar-next-gen/ |
| Wheelbase | 110 in (2,794 mm) | PRESS | https://en.wikipedia.org/wiki/Next_Gen_(NASCAR) |
| Width / length | ~1.96 m / ~4.9 m | FORUM | own estimate, verify |
| Engine | 5.86 L (358 ci) pushrod V8, NA, front-engine RWD | PRESS | https://flowracers.com/blog/nascar-horsepower |
| Power | ~670 hp intermediate/road/short track; 510 hp superspeedway (tapered spacer) | PRESS | https://flowracers.com/blog/nascar-horsepower ; https://www.motorsport.com/nascar-cup/news/daytona-500-next-gen-testing-speeds/7226148/ |
| Rev limit | ~9,000 rpm | FORUM | own estimate, verify |
| Firing order / crank | cross-plane V8 (1-8-4-3-6-5-7-2) | FORUM | standard pushrod V8 |
| Gearbox | 5-speed sequential (replaced 4-speed H-pattern), rear transaxle | PRESS (single source) | https://flowracers.com/blog/nascar-horsepower |
| Wheels / tyres | 18 in forged aluminium, single centre-lock nut; slick tyres, rain tyres on road courses only (FORUM) | PRESS (wheels) | https://www.nascar.com/news-media/2021/05/05/stock-reborn-nascar-manufacturers-unveil-next-gen-models-for-2022-cup-series/amp/ |
| Suspension | independent rear (new vs solid axle) | FORUM | own knowledge |
| Aero | symmetric composite body, flat carbon undertray with splitter and rear diffuser | PRESS | https://www.speedsport.com/nascar/nascar-cup-series/the-nuts-bolts-of-nascar-next-gen/ |
| Spoiler | 7 in at superspeedways; 4 in (road/short) | PRESS 7 in; 4 in FORUM | https://www.motorsport.com/nascar-cup/news/daytona-500-next-gen-testing-speeds/7226148/ |
| Brakes | large steel discs, 6-piston front calipers | FORUM | verify |
| Speed refs | Daytona 500 pole 2022 ~181 mph (291 km/h) average; practice up to 193 mph | PRESS | https://flowracers.com/blog/nascar-car-speed/ |

### 1.2 Rules shaping gameplay
| Item | Value | Status | Source |
|---|---|---|---|
| Stages | race split in 3 stages, caution at stage end; top 10 score 10..1 stage points | PRESS (2017 source, stage lengths now vary) | https://racer.com/racerpedia/series-guides/nascar/how-does-stage-racing-work |
| Points | winner 40, 2nd 35, 3rd 34 ... 1 pt per place; stage winners 1 playoff pt; race winner 5 playoff pts | PRESS | https://motorsport.com/nascar-cup/news/nascar-releases-stage-lengths-and-other-race-format-details-874348/ |
| Playoffs | 16-driver 10-race playoff, 36-race season | FORUM | verify |
| Yellow flag | field bunches behind pace car, pit road opens, free pass/wave-around (lap-down cars) | FORUM | own knowledge |
| Overtime | green-white-checker, up to 3 attempts after scheduled distance (FORUM) | FORUM | verify |
| Drafting | superspeedway: 2-wide/3-wide packs, bump drafting; drag drops 20-30 % in the wake (FORUM) | FORUM | own estimate |
| Spotter | radio call "clear/car left/car right/three wide" for ovals | FORUM | game feature, no source needed |

### 1.3 carSpec mapping (proposed)
| Field | Proposal |
|---|---|
| category | new `stock` (or reuse `touring`) |
| chassis.massKg | 1,540; cgHeight 0.52; halfExtents x 0.98, z 2.45 |
| wheels.radius | 0.34 (18 in rim, ~28 in OD slick-like) |
| engine | limiterRpm 9,000, idle 1,000; torque ~560 N.m peak at 5,000-6,500 (670 hp @ 7,500); superspeedway: 510 hp variant (derate curve 0.76x) |
| gearbox.ratios | 5 gears, shiftTime 0.08, mode manual-sequential |
| aero | cda 0.95, claFront 0.35, claRear 0.45 (low downforce vs GT3); superspeedway variant lower cda |
| brakes / aids | no abs, no tc |
| Missing systems | (1) oval drafting aero (wake drag/lift model for packs); (2) banking-aware physics (`bank` exists on track json, Daytona 18 deg, verify tyre/suspension load); (3) 5-speed sequential with clutchless upshift; (4) stage/caution/wave-around race logic; (5) fuel + 2-4 tyre stops under caution; (6) rain tyres on road courses only; (7) two power packages per track |

### 1.4 Sound
Pushrod cross-plane V8, 90 degrees, 1-8-4-3-6-5-7-2 firing; exhaust loud with 2 short pipes per bank, side-pipe character; limiterHz ~16, lowpass ~5,500 Hz; heavy low-frequency burble at idle (cross-plane lopes, jitterAmp 0.12 like gt3-a). Reuse the gt3-a synth block, shorter pipes (`pipeM` 0.5), higher gain.

### 1.5 Circuits
Needed: superspeedway (Daytona-type tri-oval), intermediate 1.5 mi ovals, short ovals/road courses. In repo: `daytona` (5.763 km combined road+oval, bank 0.314 rad) and `fontana` (2.43 km inner flat), `fontana-roval` (4.54 km). No pure oval exists; `cleveland`, `detroit`, `braselton`, `elkhart` can host road-course stock races. A pure oval layout needs a `bank` profile (0.3 rad), pit road, tri-oval start line.

## 2. IndyCar (Dallara IR-18 aero kit on IR-12 chassis, 2.2 L hybrid 2024+)

### 2.1 Physics
| Parameter | Value | Status | Source |
|---|---|---|---|
| Weight | ~1,700 lb road/street, 1,690 short oval, 1,655 speedway (older page); newer: 1,785 / 1,775 / 1,635 lb; excl. fuel and driver | PRESS (versions differ) | https://indycar.com/Fan-Info/INDYCAR-101/Introduction-To-INDYCAR/Anatomy-Of-An-INDYCAR |
| Hybrid mass | +~100 lb vs non-hybrid, system ~120 lb, 48 V ultracapacitor | PRESS | https://racer.com/2024/02/01/indycar-makes-huge-strides-with-first-hybrid-test-of-2024/ ; https://jalopnik.com/everything-you-need-to-know-about-indycars-woke-hybrids-1851479063 |
| Dimensions | length ~201.7 in (5.12 m); width 75.5-76.5 in (1.92-1.94 m); height ~40 in; wheelbase 117.5-121.5 in (~3.0-3.09 m) | PRESS | same indycar.com page |
| Engine | 2.2 L V6 twin-turbo (two BorgWarner EFR 7163), 90 deg, min 248 lb; 12,000 rpm limit | PRESS | https://racer.com/2024/02/01/indycar-makes-huge-strides-with-first-hybrid-test-of-2024/ |
| Power | 650-700 hp ICE; hybrid up to +150 hp max, ~60 hp initial; ~50 hp push-to-pass overboost; total ~850-900 hp | PRESS | https://jalopnik.com/indycar-will-finally-go-hybrid-10-years-after-f1-1848621075 ; https://autos.yahoo.com/850hp-potential-indycar-once-hybrids-193130130.html |
| Gearbox | Xtrac #1011 6-speed + reverse, paddle-shift (Mega-Line assisted) | PRESS | https://indycar.com/Fan-Info/INDYCAR-101/Introduction-To-INDYCAR/Anatomy-Of-An-INDYCAR |
| Tyres | Firestone Firehawk; front 25-26 in dia, rear 26.5-27.5 in; 35 psi | PRESS | same |
| Brakes | monobloc aluminium calipers, carbon-carbon discs/pads (ovals: steel/carbon variants, FORUM) | PRESS | same |
| Aero | two kits: road/street (large wings, underwing) and speedway/oval (low drag, trimmed wings); no DRS | PRESS | same |
| Speed ref | Indy 500 pole 2024 four-lap avg 234.220 mph; 2025 pole ~233.0 mph | PRESS | https://www.floracing.com/articles/14217462-indy-500-qualifying-2025-see-who-qualified-where-saturday |
| Road lap ref | not found (add from a specific circuit before tuning) | open | - |

### 2.2 Rules shaping gameplay
| Item | Value | Status |
|---|---|---|
| Push-to-pass | driver button, limited total seconds per race (unrestricted on Indy 500 oval; road ~200 s total, FORUM); ~+50 hp | FORUM seconds |
| Hybrid | energy store charged by braking, deployed automatically/under driver control; used for restarts and overtake | PRESS |
| Race format | road/street: time- or lap-based, no mandatory tyre change beyond compound rule (two compounds required), fuel stops, full-course yellows | FORUM |
| Ovals | single-file and pack, drafting/tow, 200 laps Indy 500; caution laps with pit-lane closed first lap | FORUM |
| Points | 50 for winner decreasing, +1 lead lap, +1 most laps led, +1 pole; Indy 500 double points | FORUM |

### 2.3 carSpec mapping
| Field | Proposal |
|---|---|
| category | `open-wheel` (reuses f4/ow26 pipeline) |
| massKg | 830 including driver+fuel (road); cgHeight 0.30 |
| engine | torque from ~700 hp ICE, limiterRpm 12,000, idle 1,500; `hybrid` block (reuse `ow26` HybridSpec) with 120-150 hp deploy, small battery ~1 MJ (FORUM) |
| gearbox | 6 gears, shiftTime 0.03 |
| aero | road: cda 0.85, claFront 1.2, claRear 1.8 (FORUM); speedway: cda 0.55, cla ~1.4 total |
| tyres | slick + wet, 2 slick compounds (primary/alternate) |
| Missing systems | (1) push-to-pass timer HUD with finite seconds per race; (2) oval draft; (3) banked oval collision/contact (barriers wall-riding); (4) oval setup (stagger, cross weight, wicker); (5) full-course-yellow procedure; (6) dual aero kit selection per circuit; (7) hybrid can reuse ow26 `hybrid` |

### 2.4 Sound
90 deg V6 turbo with hybrid whine: reuse ow26 synth (V6 turbo hybrid), `limiterHz` 20, lowpass ~7,500 Hz, turbo whistle gain lower than F1 (blow-off on lift), P2P adds +1 dB and a higher intake tone. Hybrid whine very subtle.

### 2.5 Circuits
Ovals: Indianapolis (2.5 mi), Texas, Iowa, Gateway, Milwaukee, Nashville; road courses: Barber-type, Mid-Ohio-type, Road America-type (`elkhart` exists), Long Beach/St Pete street (`detroit`, `cleveland` exist). In repo: `elkhart`, `detroit`, `cleveland`, `braselton`, `spielberg`, `daytona`. No oval.

## 3. TCR touring car

### 3.1 Physics
| Parameter | Value | Status | Source |
|---|---|---|---|
| Example car | Elantra N TCR (2024): 1,998 cc turbo I4, 350 hp @ 7,000, 450 N.m @ 3,500, FWD | PRESS (manufacturer) | https://motorsport.hyundai.com/racing/tcr-world-tour/tech-specs-elantra-n-tcr |
| Weight | 1,265 kg including driver (min racing weight, BoP adjustable) | PRESS | same |
| Dimensions | width 1,950 mm, wheelbase 2,750 mm | PRESS | same |
| Gearbox | 6-speed sequential paddle-shift, cerametallic twin-disc clutch, multi-plate LSD | PRESS | same |
| Reg frame | engine 1.75-2.0 L turbo, power cap ~350 hp via BoP, FWD only; sequential or DSG allowed | FORUM (regs not parsed) | https://europe.tcr-series.com/pdf/2026_TCR_Tech_Regulations.pdf |
| Wheels / tyres | 18 in, ~270 mm wide slicks, 18x8.5 (FORUM) | FORUM | verify |
| Aero | production body + fixed wing, mild undertray, ~0.3 CLA total | FORUM | verify |
| Brakes | steel discs ~355 mm front, ABS permitted | FORUM | verify |
| Top speed | ~250 km/h | FORUM | verify |

### 3.2 Rules shaping gameplay
| Item | Value | Status | Source |
|---|---|---|---|
| BoP | weight, boost (power) and sometimes ride height adjusted per car per event | PRESS | https://FIA.com/sites/default/files/2022_fia_msg_-_touring_car_cup_-_technical_regulations_v10.05.2022.pdf |
| Success ballast | min racing weight can vary with BoP, compensation and Success Ballast allocation | REG | https://www.fia.com/sites/default/files/fia_motorsport_games_touring_car_cup_-_technical_regulations_2019_eng_v1_-_wmsc_-_04102019_0.pdf |
| Format | two sprint races per weekend, qualifying + reverse-grid for race 2 (FORUM); no mandatory pit stop | FORUM |
| Points | 25-18-15-12-10-8-6-4-2-1 (FORUM) | FORUM |

### 3.3 carSpec mapping
| Field | Proposal |
|---|---|
| category | `touring` (already in `carSpec.ts`) |
| massKg | 1,265; cgHeight 0.50; halfExtents x 0.95, z 2.2 |
| drive | add `'fwd'` |
| engine | torque 450 N.m flat 2,500-5,500, limiterRpm 7,000, idle 1,000 (turbo wastegate shape: fast rise, plateau) |
| gearbox | 6 gears, shiftTime 0.04 (sequential/DSG) |
| aero | cda 0.65, claFront 0.25, claRear 0.35 |
| tyres | 18 in slicks, 1 compound |
| Missing systems | (1) **FWD drivetrain in `vehicleModel.ts`** (torque to front wheels, engine braking, torque steer, understeer with TC off/on); (2) success ballast/BoP as per-weekend `massKg` and `engine` scalar; (3) reverse grid; (4) FWD-specific diff (helical LSD) ; (5) rear-axle lift-off oversteer behavior |

### 3.4 Sound
2.0 L turbo I4: inline-4 firing 0-180-360-540, flat-plane exhaust, sharp rasp, turbo blow-off (reuse f4 synth), `limiterHz` 14, crackle on overrun, lowpass 5,000 Hz; anti-lag pops under decel.

### 3.5 Circuits
Short sprint circuits: `braselton`, `elkhart`, `budapest`, `sepang`, `spielberg`, `silverstone`, `monza`, `spa`, street (`detroit`, `cleveland`, `baku`, `singapore`). All road courses exist. Need no new circuits.

## 4. Supercars Gen3

### 4.1 Physics
| Parameter | Value | Status | Source |
|---|---|---|---|
| Weight | 1,350 kg (Supercars site; earlier source 1,335 kg; another 1,355 kg) | PRESS | https://supercars.com/the-gen3-supercars ; https://lapmeta.com/en/model/2063 |
| Engine | NA V8; displacement conflict: Ford 5.4 L / GM 5.7 L (site) vs 5.0 L racing engine (EngineLabs) | PRESS conflict | https://supercars.com/the-gen3-supercars ; https://www.enginelabs.com/?p=49014 |
| Power / revs | 600 hp (site), 620-650 hp (EngineLabs); max 7,500 rpm | PRESS | same |
| Top speed | 300 km/h; 0-100 km/h 3.4 s | PRESS | https://supercars.com/the-gen3-supercars |
| Gearbox | 6-speed sequential, transaxle, RWD | PRESS | https://lapmeta.com/en/model/2063 |
| Fuel tank | 135 L | PRESS | https://supercars.com/the-gen3-supercars |
| Suspension | double wishbone front, multi-link rear, control chassis | PRESS | https://lapmeta.com/en/model/2063 |
| Aero | reduced downforce vs Gen2, symmetrical body | PRESS | https://www.supercars.com/news/300km-h-barrier-hit-during-in-bathurst-qualifying |
| Lap ref | Bathurst qualifying record 2:03.9376 (reported, year unconfirmed); 2025 pole 2:04.0307; pre-Gen3 best 2:03.3736 | PRESS | https://www.supercars.com/news/repco-bathurst-1000-qualifying-report-brodie-kostecki-provisonal-pole-2025-dick-johnson-racing ; https://thenightly.com.au/sport/brodie-kostecki-sets-record-to-nab-bathurst-1000-provisional-pole-c-20307256 |
| Tyres | 18 in, Dunlop hard/soft, wet (FORUM) | FORUM | verify |

### 4.2 Rules shaping gameplay
Endurance races (Bathurst 1000, 161 laps, 2 drivers, mandatory fuel/tyre stops, FORUM); sprint races with reverse-grid for some rounds; no push-to-pass in Gen3 (FORUM); points 150 per 1000 km race (FORUM); safety car and mandatory stop windows (FORUM). Verify all with Supercars sporting regs before use.

### 4.3 carSpec mapping
| Field | Proposal |
|---|---|
| category | `touring` (reuses RWD pipeline) or `gt3` |
| massKg | 1,350; cgHeight 0.50; halfExtents x 0.96, z 2.4 |
| engine | peak ~630 N.m at 5,200, limiterRpm 7,500 (7,500 per source), idle 1,000 |
| gearbox | 6 sequential, shiftTime 0.05 |
| aero | cda 0.9, claFront 0.4, claRear 0.6 |
| Missing systems | co-driver swap, mandatory stops/stints, safety-car procedure; otherwise reuses gt3 pipeline |

### 4.4 Sound
Pushrod V8 cross-plane but with GT3-style crackle: reuse gt3-a cross-plane V8 synth, `pipeM` 0.8, gain +2 dB, aggressive crackle 0.6 on lift, rev limit 7,500 gives tonal edge; slightly lower pitch than gt3-c flat-plane.

### 4.5 Circuits
Need Bathurst (Mount Panorama) first, Sandown, Phillip Island, Adelaide, Albert Park-type. In repo: none (Bathurst is the next planned track in the roadmap). Fillers: `braselton`, `silverstone`.

## 5. GT4

### 5.1 Physics
| Car | Mass | Engine / power | Gearbox | Status | Source |
|---|---|---|---|---|---|
| Porsche 718 Cayman GT4 Clubsport (previous) | 1,320 kg | 4.0 L flat-6, 425 hp (313 kW) | 6-speed PDK | PRESS | https://motorsports.porsche.com/usa/en/article/2020/03/24/718caymangt4clubsport |
| Porsche GT4 RS Clubsport (2022+) | 1,330 kg | 4.0 L flat-6 NA, 500 PS | 7-speed PDK | PRESS | https://lapmeta.com/en/vehicle/298/967 |
| BMW M4 GT4 (2018-21) | 1,430 kg | 3.0 L I6 twin-turbo, 437 hp | 7-speed DCT | PRESS | https://lapmeta.com/en/vehicle/298/967 |
| Alpine A110 GT4 Evo | ~1,100 kg (FORUM) | 1.8 L I4 turbo, 350-400 hp (BoP) | 6-speed sequential, Bosch ABS | PRESS | https://www.alpine-cars.co.uk/competition/a110-gt4.html |

Category generics: production-based, ABS and (no or limited) traction control (FORUM), cheaper than GT3, aero modest, slicks 10-11 in wide, steel brakes (FORUM). BoP levers: weight, ride height, rim, tyre size, engine management, power; SRO may change at any moment (PRESS: https://japancup.co/documents/notice/138/SRO+Balance+of+Performance+Japan+Cup+SUGO+08052026.pdf).

### 5.2 Rules shaping gameplay
Sprint races of 60 min with one mandatory pit stop (window) and driver change (pro-am), FORUM; BoP per car; points 25-18-15... FORUM.

### 5.3 carSpec mapping
| Field | Proposal |
|---|---|
| category | `gt4` (already present) |
| massKg | 1,350 (generic), cgHeight 0.45 |
| engine | 3.0 L I6 turbo-like torque: 520 N.m flat 2,500-5,500, limiterRpm 7,200, ~430 hp; second variant NA flat-6 |
| gearbox | 6-speed sequential, shiftTime 0.06 |
| aero | cda 0.75, claFront 0.35, claRear 0.45 |
| aids | abs enabled, tc off |
| Missing systems | none critical; BoP scalar per car (shared with TCR) |
Cheapest series to implement: retune an existing gt3 spec (gt3-b flat-six, gt3-c V8) at 75 % power and 85 % downforce.

### 5.4 Sound
Reuse gt3 variants: flat-six (gt3-b) for the NA variant, turbo I6 would need a new "inline-6 turbo" synth (firing 0-120-240-360-480-600, turbo blow-off). Lower gain than GT3.

### 5.5 Circuits
All road: `spa`, `monza`, `silverstone`, `spielberg`, `braselton`, `elkhart`, `budapest`, `sepang`, `bahrain`, `lusail`. Exists.

## 6. LMP3 (2025+ third generation)

### 6.1 Physics
| Parameter | Value | Status | Source |
|---|---|---|---|
| Example | Ligier JS P325 (2025): Toyota 3.5 L twin-turbo V6 (60 deg), 470 hp | PRESS (manufacturer) | https://ligierautomotive.com/en/vehicles/sports-prototypes/ligier-js-p325/ |
| Why V6 | end of Nissan VK56 V8 production; all Gen3 constructors use the same V6 | PRESS | https://en.endurance-info.com/auto/article/112253-ligier-js-p325-ready-take-over-reins |
| Dimensions | length 4,605 mm, width 1,900 mm, wheelbase 2,860 mm | PRESS | https://ligierautomotive.com/en/vehicles/sports-prototypes/ligier-js-p325/ |
| Gearbox | 6-speed sequential Xtrac 1152, paddle shift | PRESS | same |
| Wheels | 18 in OZ magnesium; 12.5 in front, 13 in rear wide | PRESS | same |
| Weight | Gen2 (Nissan V8 car): ~950-960 kg; Gen3 minimum not found (assume ~950-980) | PRESS Gen2, FORUM Gen3 | https://en.wikipedia.org/wiki/Duqueine_D08 ; https://en.wikipedia.org/wiki/Ligier_JS_P320 |
| Aero | closed cockpit, fixed rear wing, flat underfloor and diffuser, HPC carbon bodywork | PRESS | Ligier page |
| Aids | TC and ABS: not found; assume none | FORUM | verify |

### 6.2 Rules shaping gameplay
Same as the ELMS/IMSA structure: multi-class endurance, 4-6 h races, pro-am driver ratings (Bronze driver mandatory minimum drive time), BoP via ballast/power, FORUM. LMP3 sits below LMP2 in the multi-class traffic hierarchy.

### 6.3 carSpec mapping
| Field | Proposal |
|---|---|
| category | `prototype` (already present) |
| massKg | 970; cgHeight 0.35; halfExtents x 0.95, z 2.3 |
| engine | peak ~600 N.m flat 3,000-6,000; 470 hp @ 6,500; limiterRpm 7,000 (FORUM); turbo block |
| gearbox | 6 sequential, shiftTime 0.04 |
| aero | cda 0.7, claFront 0.9, claRear 1.4 |
| Missing systems | multi-class traffic, driver swaps, night/lights; otherwise derives from `lmp2-a` at 55-60 % power |

### 6.4 Sound
Twin-turbo V6 60 deg: even-fire 120 deg (0-120-240-...), wail with moderate turbo; reuse ow26 V6 turbo hybrid block minus hybrid whine, rev limit 7,000 gives lower pitch than F1; crackle low. Slight mechanical gear whine (straight-cut) is the dominant character.

### 6.5 Circuits
All road: `spa`, `monza`, `bahrain`, `lusail`, `silverstone`, `sepang`. Le Mans (La Sarthe) is on the roadmap (next-content-plan). Exists mostly.

## 7. Circuit inventory vs needs

| Needed | In `public/tracks/index.json` |
|---|---|
| Superspeedway oval | `daytona` (combined layout only, banked 0.314 rad); no pure oval |
| Short / intermediate ovals | none |
| Road courses (touring, GT4, LMP3, stock road) | monza, spa, silverstone, mexico, lusail, bahrain, braselton, elkhart, sepang, baku, budapest, singapore, lasvegas, spielberg |
| Street (Indy, stock, TCR) | detroit, cleveland, baku, singapore, lasvegas |
| Fontana (banking data) | fontana, fontana-roval |
| Bathurst / Sandown / Phillip Island | none (Bathurst on roadmap) |

## 8. Recommended order

| # | Series | Reason | New work |
|---|---|---|---|
| 1 | GT4 | Retune gt3 specs, `gt4` category exists, all circuits exist | per-car BoP scalar |
| 2 | LMP3 | Derive from lmp2-a, V6 sound from ow26, circuits exist | multi-class traffic (if not yet) |
| 3 | Supercars | RWD V8 reuse gt3-a; needs Bathurst (already planned) | stints/mandatory stops |
| 4 | IndyCar (road/street only) | ow26 hybrid + f4 pipeline; exists tracks | push-to-pass timer, 2 compounds |
| 5 | TCR | Needs new FWD drivetrain and success ballast | FWD model (largest physics change) |
| 6 | Stock car road courses | Cross-plane V8, 5-speed; stages/caution | stage/caution logic |
| 7 | Ovals (IndyCar oval + stock car superspeedway) | Needs draft aero, oval tracks, banking validation, pack AI | drafting, spotter, oval tracks |

Cross-series shared systems to build once: BoP/ballast scalar (GT4, TCR, LMP3), mandatory stop windows (Supercars, GT4, LMP3), push-to-pass (Indy; also stock car "overtime" restarts), draft aero (ovals).
