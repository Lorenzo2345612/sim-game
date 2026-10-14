# 139 — Weather in races: config, forecast HUD, grip wiring, AI pace

Status: pending
Phase: 2
Depends on: 078, 093, 130, 135, 137, 138
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A race can be `dry`, `wet` or `changing` (seeded shower); wetness changes tyre grip in the vehicle model, AI cars slow down accordingly, and a forecast HUD shows now and +10 min.

## Context

Design: `docs/plans/game-features.md` section 139. M2.2 compound/pit-service tasks will build on this; AI pitting for inters/slicks is NOT implemented here, only the pure decision helper. Uses `TrackWeather`, `gripFactor`, `compoundClass`, `wearMultiplier` (137, `src/physics/weather.ts`), `RainField`/`wetnessUniform` (138, `src/render/rain.ts`), `RaceGame` and `RaceConfig` (093, `src/game/raceGame.ts`), `Vehicle` (065/070, `src/physics/vehicle.ts`, `setCompound`; grip `factor` passed to the tyre forces), `AiDriver` (089, `src/ai/aiDriver.ts`; its speed table scaled uniformly keeps braking distances consistent). `Vehicle` imports 137's `gripFactor` under the alias `wetGripFactor` (`tyreState.ts` already exports another `gripFactor`). Seeded rng = local `mulberry32(seed)` copy (convention of `src/render/grandstand.ts`), no `Math.random`. Acceptance: Vitest `tests/unit/acceptance/139-weather-in-races.test.ts` (AT1–AT3, Node), Playwright `tests/e2e/acceptance/139-weather-in-races.spec.ts` (AT4).

## Files

- `src/race/raceWeather.ts` — create (pure)
- `src/physics/vehicle.ts` — modify: `setWetness`
- `src/ai/aiDriver.ts` — modify: `setGripScale`
- `src/game/raceGame.ts` — modify: `RaceConfig.weather`, weather tick, `weather` accessor
- `src/main.ts` — modify: `?weather=dry|wet|changing`, `#forecast`, feed 138 visuals from `game.weather`

## Steps

```ts
export type WeatherMode = 'dry' | 'wet' | 'changing';
export interface RainShower { start: number; duration: number; intensity: number } // seconds since go, intensity in [0.5, 1]
export function rainShower(seed: number, raceSeconds: number): RainShower;        // one shower, deterministic
export function rainAt(mode: WeatherMode, shower: RainShower | null, t: number): number; // dry 0; wet 1; changing: intensity inside [start, start+duration), else 0
export function forecastLabel(rain: number): 'Dry' | 'Light rain' | 'Heavy rain';  // < 0.05 / < 0.7 / else
export function desiredCompoundClass(wetness: number, current: CompoundClass): CompoundClass; // slick→inter if wetness > 0.35; inter|wet→slick if < 0.15; else unchanged
// Vehicle: setWetness(w: number): void;  AiDriver: setGripScale(k: number): void;  RaceConfig: weather?: WeatherMode (default 'dry')
```

1. `rainShower`: `u1,u2,u3` from `mulberry32(seed)`; `start = (0.2 + 0.4·u1)·raceSeconds`; `duration = (5 + 10·u2)·60`; `intensity = 0.5 + 0.5·u3`. `raceSeconds` = `laps` × reference lap time (`lapLength / mean speed profile`) for the config.
2. `RaceGame` per tick: `weather.setRain(rainAt(...))` (mode `wet` starts with `setWetness(1)`); `weather.update(dt, lineUsage)` with `lineUsage = carCount · 60 · meanCarSpeed / lapLength`; every car `Vehicle.setWetness(weather.wetness)`; every AI `setGripScale(sqrt(gripFactor(compoundClass(compound), weather.wetness)))`. Exposes `readonly weather: TrackWeather`.
3. `Vehicle.setWetness(w)`: the tyre grip factor is multiplied by `gripFactor(compoundClass(current compound), w)` and tyre wear by `wearMultiplier(...)`; default 0 (no change).
4. `AiDriver.setGripScale(k)`: final target speed × `k` (default 1, clamped to (0, 1]).
5. `main.ts`: `?weather=` (invalid → `dry`); `#forecast` (visible only in races, hidden otherwise) text `Now: <label> | +10 min: <label>` from `forecastLabel(rainAt(mode, shower, t))` and `t + 600`; `wetnessUniform.value` and `RainField.setRain` follow `game.weather`.

Conventions: deterministic (same seed → same shower); clamps as stated; no per-tick allocation in the weather loop; `setWetness` clamps to [0, 1], non-finite ignored.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: schedule for seed 1, race 30 min | call | one shower, start in [6, 18] min, duration [5, 15] min; same seed same schedule |
| AT2 | Node: f4 on slicks, constant-radius skidpad (066 setup) wetness 0 vs 1 | max lateral g | ratio 0.55 ± 0.05 |
| AT3 | Node monza race wet, 5 AI | 60 s | AI average speed < 0.85 × dry run; no AI off-track > 2 times |
| AT4 | e2e `?race=1&weather=wet` | HUD | `#forecast` visible; no console errors |

## Acceptance criteria

- [ ] All AT rows pass; dry races (093–095, 130) unchanged and still pass.
- [ ] `grep -rn "Math.random" src/race/raceWeather.ts src/game/raceGame.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- AI pit decisions and tyre changes (M2.2); weather menu UI; time-of-day link; wet-weather AI mistakes; replay/telemetry of weather.
