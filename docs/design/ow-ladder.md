# M7.2 Open-wheel ladder (tasks 338-350) — design

Cars `ow3` ("OW-3 Feeder") and `ow2` ("OW-2 Feeder Turbo"), DRS, reverse-grid sprint, mandatory stop rules. Brand-neutral: no F1/F2/F3/FIA/Dallara/Mecachrome/Tatuus names, logos or liveries anywhere in `public/`, `src/`, tasks. Ladder in game: `f4` (650 kg) < `ow3` < `ow2` < `ow26` (768 kg hybrid). Prior research with full carSpec mapping: `docs/research/cars/ow-ladder-f3-f2.md` (values there are the car-data source; this doc closes the gaps and fixes integration). Status key: REG official, PRESS Wikipedia/press, EST estimate/tuning target.

## Data gaps closed (research 2026-10-21)

| Gap | Resolution | Status | Source |
|---|---|---|---|
| F2 mass | 795 kg "incl. driver and fuel" (Wikipedia) is ambiguous. Decision: `massKg` 795 (driver, no fuel, the f4/ow26 convention); fuel 75 L x 0.745 = 56 kg added by `fuel`. Slightly heavy; lap-time ratios (task 346) are the arbiter, fall back to 740 if ow2 cannot reach the ratio. | PRESS / EST | https://en.wikipedia.org/wiki/Dallara_F2_2024 |
| F3 mass | 673 kg min. incl. driver (no fuel); fuel 35 L start. | PRESS | https://en.wikipedia.org/wiki/Dallara_F3_2025 |
| F2 engine | 3.4 L V6 (95 deg) single turbo, 620 hp (462 kW) @ 8750 rpm, 570 (FIA) / 583 (Wikipedia) N.m, limiter 8750, 6-speed sequential paddles + reverse, ramp LSD, carbon brakes 6-piston | REG/PRESS | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza ; https://en.wikipedia.org/wiki/Dallara_F2_2024 |
| F3 engine | 3.4 L V6 (95 deg) NA, 380 hp (283 kW) @ 8000 rpm, 420 N.m, 6-speed sequential; limiter ~8500 | REG/EST | https://fia.com/node/53556 |
| Firing order | Not published. 3-throw crank, 95 deg bank: 0/95/240/335/480/575 deg (same for both). Even-fire fallback `[0,120,240,360,480,600]` if the voice sounds wrong | EST | - |
| Gearbox ratios | Not published: EST ratios in the research doc (top gear at limiter = 300 / 320 km/h) | EST | - |
| Tyres | F2: 18 in wheels, rim widths 12 in front / 13.7 in rear (REG, Pirelli slicks); F3: 16 in rims (REG). Tyre section widths not published. Decision: ow3 radius 0.315, width 0.30 front, `widthRear` 0.36; ow2 radius 0.33, width 0.31 front, `widthRear` 0.37 (EST). The 250/290 mm figures on the F3 Wikipedia page are the old 13 in car: not used | REG/EST | https://www.fia.com/news/fia-formula-2-next-generation-car-breaks-cover-monza ; https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Aero | No published downforce/drag. Targets: ow3 CdA 0.80, peak lateral 2.6 G, top speed 300 km/h; ow2 CdA 0.92, top ~320 km/h. DRS drag/downforce scales EST (rear flap): ow3 0.88 / 0.90, ow2 0.85 / 0.88, transition 0.2 s (ow26 uses 0.7 / 0.6 / 0.4 as the F1-style two-element flap) | EST | https://fia.com/node/53556 |
| DRS rules | F3/F2 regulation text not found. Source-backed: detection within about 1 s of the car ahead, driver-operated paddle, auto-disabled in rain (Wikipedia F3), disabled per zone while that zone shows yellow (FIA F2 event notes), not for the first two race laps nor the first two laps after SC/red restart (secondary). Rule adopted = F1 convention, below | PRESS/EST | https://en.wikipedia.org/wiki/FIA_Formula_3_Championship ; https://fia.com/sites/default/files/decision-document/2024%20Spielberg%20Event%20-%20F2%20Event%20Notes.pdf |
| Reverse grid | F2 sprint: top 10 of qualifying reversed (Wikipedia). F3 sprint: top 12 reversed (Wikipedia; 2025 results at Melbourne/Spielberg consistent). F3 2025 group-split qualifying not modelled (single session) | PRESS | https://en.wikipedia.org/wiki/FIA_Formula_2_Championship ; https://en.wikipedia.org/wiki/FIA_Formula_3_Championship |
| Race length | F3 sprint 40 min + 1 lap, feature 45 min + 1 lap; F2 sprint ~120 km / 45 min, feature ~170 km / 1 h. Game uses lap counts (time-based races are a later M7.1+ item) | PRESS | same |
| Points | F3 sprint 10..1 (top 10); F2 sprint 10-8-6-5-4-3-2-1 (top 8); feature both 25-18-15-12-10-8-6-4-2-1; pole +2 (qualifying); FL +1 if top 10 | PRESS | https://www.formula1.com/en/latest/article/new-points-system-revealed-for-formula-2-and-formula-3.258sclCMH8xWQDWRjIA9xY |
| F2 mandatory stop | Exists in the feature race only (no refuelling). Rule text from FIA bulletins (2022, via search snippets): not before 6 completed laps, not during a VSC unless the car is already in pit entry/lane (then it does not count), at least two wheels changed. Compound condition (two dry compounds) not confirmed: EST, adopted. Missed stop: 30 s time penalty (EST from stewards summary). F3: stop optional (weather, damage) | PRESS/EST | https://fia.com/sites/default/files/decision-document/2022%20Zandvoort%20Event%20-%20F2%20Bulletin%203%20-%20Sporting%20Regs%20-%20Mandatory%20pit%20stop%20Zandvoort%202022.pdf (page not fetchable; snippet only) |

## Planner decisions (2026-10-21)

- DRS is a player button (the `overtake` input edge); no auto-open assist for the player. AI opens it by rule (343).
- `ow2` `massKg` 795; the 740 fallback is allowed only inside task 346 (with the number-only update of 345 AT1).
- Sprint/feature lap defaults 8/12 laps; single qualifying session (no group split).
- Fictional series names "Feeder 3 Cup" and "Feeder 2 Series" are approved.
- 351 stays out of tasks.json and milestones until M2.2 pit stops exist.
- Sprint points tables also carry fastest lap +1 (top 10), same as the feature table.

Remaining unknowns accepted as tuning targets: gear ratios, tyre widths, aero coefficients, F3 limiter, DRS scales, firing order.

## Existing code facts (survey 2026-10-21)

- **Pit stops do not exist.** `PitLane {start,end,side}` is track geometry only (`src/core/types.ts`); render pit pieces exist; no pit-box service, tyre change, pit-lane speed limiter or strategy (M2.2 is planned, no tasks). Consequence: the mandatory stop is split into a pure rule tracker (349, feasible now) and the wiring (351, spec written, status blocked until M2.2 pit-box service lands; not registered in tasks.json).
- `ActiveAero` (`src/physics/activeAero.ts`): blend ramps to 1 when `inZone && throttle >= 0.9 && brake < 0.05`; `VehicleModel.setAeroZone(bool)`. Only single-player `Game` feeds it (`deriveAeroZones` straights >= 300 m, `src/track/aeroZones.ts`); `RaceGame` never calls `setAeroZone`, so ow26 AI/race cars have no active aero today.
- The `overtake` input edge (`DriverInput.overtake`, keyboard/gamepad bound, `raceGame.ts` ~L746 forwards it) is used by the ERS; OW-3/OW-2 have no ERS, so the same edge is the DRS button.
- Weekend (C0, done): `GridRule = 'qualifying' | 'reverse-top8' | 'sprint-result'`, reverse hard-coded to 8 (`src/career/weekend.ts`); `formats.json`, `points.json`; `parseWeekendFormat` in `src/career/points.ts`. Series parser `src/career/series.ts` is task 324 (C1, pending).
- Telemetry carries `aero: AeroTelemetry {blend, inZone}`; no DRS state.

## Design

### DRS rules (`src/race/drs.ts`, pure, 338)

```ts
export interface DrsZone { detection: number; start: number; end: number }   // lap distances, m
export interface DrsCarState { enabled: boolean; open: boolean; gapS: number | null }
export class Drs {
  constructor(zones: readonly DrsZone[], lapLength: number, carCount: number);
  update(time: number, cars: readonly DrsCarInput[], ctx: DrsContext): void;
  request(car: number): void;           // driver pressed the button
  state(car: number): Readonly<DrsCarState>;
}
export interface DrsCarInput { lapDist: number; lap: number; running: boolean; braking: boolean; throttle: number }
export interface DrsContext { vsc: boolean; wet: boolean; yellowZones: readonly boolean[] /* per zone */; restartLapsLeft: number }
```
Rules: (1) at each zone's detection point record the crossing time per car; when a car crosses it, its gap = its crossing time minus the crossing time of the car that crossed just before (the car ahead on track, same lap or one lap down is ignored); eligible if gap <= 1.0 s (inclusive). (2) Eligibility arms DRS for the next zone only: `enabled` true from `start` to `end`; the driver (or AI) calls `request` while enabled, then `open` true until brake > 0.05, end of zone, or any disable condition. (3) Disabled globally: car lap < 3 (first two race laps; `lap` is 1-based current lap), `vsc`, `wet`, `restartLapsLeft > 0`; disabled per zone while its yellow flag is on. (4) `open` closes on brake only; throttle lift does not close it. Pure and deterministic; no allocation in `update`.

### DRS zones (`src/track/drsZones.ts`, 339)

`deriveDrsZones(aeroZones, lapLength)` maps each derived aero zone (>= 300 m straight) to a `DrsZone`: `start` = aero zone start, `end` = aero zone end capped to 900 m, `detection` = start - 120 m (wrapped). Track JSON may override with an optional `drsZones` array (parsed as-is, validated) for later hand-placed zones. Max 3 zones per track: keep the 3 longest.

### Vehicle and spec (340)

`ActiveAeroSpec` gains optional `drs?: boolean` (default false). When true the car's active aero is opened by the DRS state, not by zone membership: the caller passes the DRS `open` flag through the existing `setAeroZone(open)`. `ActiveAero` throttle/brake gate is kept (closing on brake already matches the rule). Telemetry `aero.drs?: boolean` mirrors `drs`.

### RaceGame integration (341)

Per tick: build `DrsCarInput` from traffic distances/laps and the player/AI commands, call `drs.update`; for cars whose spec has `activeAero.drs`, `vehicle.setAeroZone(state.open)`. Player: `overtake` edge calls `request(0)`. `DrsContext.wet` from the current weather/track wetness (use the existing weather state; false if none). Cars without DRS spec are ignored. Only created when at least one car has `activeAero.drs`.

### HUD (342)

`src/ui/hudDrs.ts`: element `#hud-drs` with states OFF (hidden), AVAILABLE (amber "DRS"), OPEN (green "DRS OPEN"), plus zone-distance bar not included. Fed by `telemetry.drs?: { enabled, open }` (RaceGame exposes `drsState(0)`).

### AI (343)

AI cars call `request` as soon as `enabled` (a probability-free rule: the AI always uses DRS) and the car is in the zone with throttle >= 0.9. AI speed profile: `carLimitsFromSpec` unchanged; DRS effect comes from the physics (drag scale) so AI naturally gains speed; no re-planning. AI must keep the throttle at full on the straight (already true).

### Weekend formats (347, 348)

`GridRule` adds `'reverse-top10'`, `'reverse-top12'` (reverse the first min(N, timed) timed cars of the qualifying grid, rest unchanged); `reverse-top8` unchanged. Points tables added: `f3-sprint` (10..1), `f2-sprint` ([10,8,6,5,4,3,2,1]), `feeder-feature` ([25,18,15,12,10,8,6,4,2,1] + fastest lap 1 top 10). Formats: `ow3-weekend`: P 20 min, Q 15 min polePoints 2, sprint 8 laps `f3-sprint` grid reverse-top12, race 12 laps `feeder-feature` grid qualifying. `ow2-weekend`: P 20, Q 15 polePoints 2, sprint 8 laps `f2-sprint` reverse-top10, feature 12 laps `feeder-feature`. (Lap counts are minimum-complexity defaults; the track-length-based F2/F3 distance is a later tuning.)

### Mandatory stop (349 rules now, 351 wiring blocked)

```ts
export interface StopRule { minLap: number; minWheels: number; requireTwoCompounds: boolean; penaltyS: number }
export const FEEDER_STOP_RULE: StopRule = { minLap: 6, minWheels: 2, requireTwoCompounds: true, penaltyS: 30 };
export class MandatoryStop {
  constructor(rule: StopRule, carCount: number, wetDeclared?: boolean);
  startCompound(car: number, compound: string): void;
  recordStop(car: number, completedLaps: number, vscActive: boolean, inPitEntryAtVsc: boolean, wheelsChanged: number, newCompound: string): boolean; // true when it counts
  satisfied(car: number): boolean;
  penaltyAtFinish(car: number): number; // 0 or rule.penaltyS
}
```
351 (blocked until M2.2 pit-box service): call `recordStop` from the pit-box service, apply `penaltyAtFinish` through the `book(car,'penalty',...)` path, and show a HUD "STOP REQUIRED" flag. Not scheduled.

### Series data (350)

`public/career/series/ow3-cup.json` ("Feeder 3 Cup", carId `ow3`) and `ow2-cup.json` ("Feeder 2 Series", carId `ow2`), format `ow3-weekend`/`ow2-weekend`, 5 fictional teams x 2 (ow3, 10 cars) and 6 teams (ow2), calendar from existing tracks, `gridsSeries` mix entries in `public/career/grids.json`. No code beyond the C1 parser (324).

## Tasks

| # | Title | Files | Deps | Cx |
|---|---|---|---|---|
| 338 | DRS rules module | `src/race/drs.ts` | - | complex |
| 339 | DRS zones from the track | `src/track/drsZones.ts` | 338 | simple |
| 340 | CarSpec `activeAero.drs` flag + telemetry | `src/physics/carSpec.ts`, `src/physics/hybridTypes.ts`, `src/physics/vehicleModel.ts` | - | simple |
| 341 | RaceGame DRS integration | `src/game/raceGame.ts` | 338, 339, 340 | complex, heavy |
| 342 | DRS HUD | `src/ui/hudDrs.ts`, `src/main.ts` | 341, 345 | simple |
| 343 | AI uses DRS | `src/game/raceGame.ts` | 341 | simple |
| 344 | `ow3` car data, menu entry and voice | `public/cars/ow3.json`, `public/cars/index.json`, `src/ui/menu.ts` | 340 | complex |
| 345 | `ow2` car data, menu entry and voice | `public/cars/ow2.json`, `public/cars/index.json`, `src/ui/menu.ts` | 344 | complex |
| 346 | Ladder lap-time calibration | `tests/unit/calibration/ow-ladder.test.ts` (+ car JSON tuning, 345 AT1 mass only if 740 fallback) | 344, 345 | complex |
| 347 | Reverse-top10/top12 grid rules | `src/career/types.ts`, `src/career/weekend.ts`, `src/career/points.ts` | - | simple |
| 348 | Feeder points tables and weekend formats | `public/career/points.json`, `public/career/formats.json` | 347 | simple |
| 349 | Mandatory stop rules | `src/race/mandatoryStop.ts` | - | complex |
| 350 | OW ladder series data | `public/career/series/ow3-cup.json`, `ow2-cup.json`, `public/career/grids.json` | 324, 344, 345, 348 | simple |
| 351 | Mandatory stop wiring (blocked on M2.2, not registered) | `src/game/raceGame.ts` | 349, M2.2 | complex |

Waves: 1 = 338, 340, 347, 349; 2 = 339, 344, 348 (after 338 / 340 / 347); 3 = 341, 345; 4 = 342, 343, 346 (342 needs 345); 5 = 350 (needs 324). `index.json`/`menu.ts` edits serialise 344 -> 345; 341 -> 343 share `raceGame.ts`.

Planner-authorised protected-test edits (numbers only): car-count tests enumerated in 286 (073-car-selection e2e, ow26.test AT9, 221 edge, 231, 244 AT8, 226) get `ow3`, then `ow2` appended after `eow` (or after `ow26` if M7.1 is not merged); each 344/345 spec lists them. Weekend tests 274/275 are unaffected (new grid rules are additive).
