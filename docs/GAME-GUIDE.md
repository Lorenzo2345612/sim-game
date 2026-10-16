# Sim-game player guide (state of master)

Single-seater / GT / prototype driving sim on real circuits. Single car, time-attack only (no AI or race yet).

## 1. How to run

```
npm install
npm run dev        # http://127.0.0.1:5173
```

Without `?track=` the track select menu opens. URL parameters (all optional):

| Param | Values | Effect |
|---|---|---|
| `track` | track id (see section 3) | Skips the menu; unknown id falls back to `monza` |
| `car` | car id (see section 4) | Overrides the saved car; default `f4` |
| `compound` | `soft` / `medium` / `hard` | Tyre compound (default: saved choice, `medium`) |
| `wear` | number > 0 | Tyre wear multiplier (default 1) |
| `fuel` | number > 0 | Fuel consumption multiplier (default 1) |
| `quality` | `low` / `medium` / `high` | Graphics preset (wins over `preset`) |
| `preset` | `low` / `medium` / `high` | Graphics preset fallback; saved in localStorage, default `high` |

Example: `http://127.0.0.1:5173/?track=spa&car=gt3-a&compound=soft`

## 2. Controls

### Keyboard

| Key | Action |
|---|---|
| W / Up | Throttle |
| S / Down | Brake (hold ~0.4 s at standstill in auto mode: reverse) |
| A / Left, D / Right | Steer |
| Q / E | Shift down / up (manual mode) |
| M | Toggle auto / manual gearbox |
| C | Cycle camera: chase, T-cam, cockpit |
| R | Reset car to the track |
| I | Toggle the setup read-out overlay (not while paused) |
| Esc | Pause menu (closes the setup panel if open) |
| F3 | FPS overlay |

### Gamepad (standard mapping)

| Input | Action |
|---|---|
| Left stick X | Steer (deadzone applied) |
| RT (button 7) / LT (button 6) | Throttle / brake |
| RB (5) / LB (4) | Shift up / down |
| Button 8 (Back/Select) | Toggle setup overlay |
| Rumble | Surface and kerb feedback on the pad |

Gears: auto by default. In auto, holding the brake at standstill engages reverse; throttle returns to forward. In manual (M), shift with Q/E.

Pause menu: Resume, Restart, Setup, Change track, Credits.

## 3. Tracks (`public/tracks/index.json`)

| Id | Name | Country | Length |
|---|---|---|---|
| monza | Monza | Italy | 5.793 km |
| spa | Spa | Belgium | 7.004 km |
| silverstone | Silverstone | United Kingdom | 5.891 km |
| mexico | Mexico City | Mexico | 4.304 km |
| daytona | Daytona | United States | 5.729 km |
| lusail | Lusail | Qatar | 5.419 km |
| bahrain | Sakhir | Bahrain | 5.412 km |
| braselton | Braselton | United States | 4.088 km |
| elkhart | Elkhart Lake | United States | 6.515 km |
| sepang | Sepang | Malaysia | 5.543 km |
| baku | Baku | Azerbaijan | 6.003 km |
| budapest | Budapest | Hungary | 4.381 km |
| singapore | Singapore | Singapore | 4.940 km |
| lasvegas | Las Vegas | United States | 6.201 km |
| spielberg | Spielberg | Austria | 4.318 km |
| fontana | Fontana | United States | 2.426 km |
| cleveland | Cleveland | United States | 3.426 km |
| detroit | Detroit | United States | 2.562 km |

Scenery and trackside detail vary a lot per circuit (see "Coming next").

## 4. Cars (`public/cars/index.json`)

| Id | Name | Category |
|---|---|---|
| f4 | F4 | open-wheel (default) |
| gt3-a | GT3 A | gt3 |
| gt3-b | GT3 B | gt3 |
| gt3-c | GT3 C | gt3 |
| lmp2-a | LMP2 A | lmp2 |
| hyper-a | Hypercar A | hypercar |

`gt3-d` has a spec file in `public/cars/` but is not in the car list, so `?car=gt3-d` falls back to `f4`.

## 5. Features wired in `src/main.ts`

**Menus**
- Track select with a car selector; choices are remembered (localStorage).
- Setup panel (pause menu, Setup): front/rear wing, brake bias, final drive, front/rear anti-roll bar, ride height, tyre pressure; presets Stable / Balanced / Aggressive; tyre compound Soft / Medium / Hard. Setup is saved per car and track.
- Graphics presets low / medium / high (via URL, saved).
- Credits screen.

**HUD**
- Speed (km/h), gear, RPM bar with 15 shift LEDs.
- Tyres: temperature colour (blue / green / red against the compound window), wear, dirt flag per corner.
- Fuel level and mean fuel per lap.
- Lap, current / last / best lap time, three sector times with purple / green colouring, live delta vs ghost, lap validity.
- Minimap.
- Setup read-out overlay (I), FPS overlay (F3).

**Physics**
- Fixed 120 Hz Rapier vehicle: per-wheel tyre model, aero (wings), suspension, brakes, powertrain with gearbox.
- Surfaces: asphalt, kerb, grass, gravel, run-off with different grip/drag.
- Tyre temperature, wear and dirt (picked up off-track); compound-dependent.
- Fuel burn and weight loss; damage model code exists (not yet wired to impacts).
- Track elevation from DEM data.

**Other**
- Audio: synthesised engine sound (AudioWorklet), starts on first key/click. No effects yet.
- Gamepad rumble from surface/kerb feedback.
- Ghost: your best lap per track is saved and replayed as a translucent car.
- Cameras: chase, T-cam, cockpit (no steering wheel yet).
- Scenery: terrain, trees, barriers, grandstands, pits, city buildings on some tracks, sky and shadows, surface particles.
- Livery system with number decals on the car.

## 6. Known limits and coming next

Open milestones (`tasks/milestones.json`) and pending tasks (`tasks/tasks.json`):

| Milestone | Coming next |
|---|---|
| M1.2d / M1.2e | City, desert and tropical environments; per-circuit style data (kerb colours, barriers, floodlights, props, palette) for all 18 tracks |
| M1.x banking | Track banking (cross-slope) and Daytona / Fontana banking data (in progress, not on master yet); Fontana roval layout |
| M1.7 | Audio per-car engines, effects, mix |
| M1.8 | Cockpit steering wheel, rear-view mirror, head motion and FOV setting |
| M1.9 | Livery editor screen |
| M2.1 | AI opponents, quick race, grid and start lights, results, race HUD |
| M2.1b | Driving school: driving line, braking assist, lessons |
| M2.1c | Race rules: track limits strikes, flags, VSC, penalties |
| M2.1d | Replays, TV cameras, telemetry recorder and screens |
| M2.2b | Weather and time of day: rain, wet tyres, night lighting |
| M2.4 | Damage from contacts, debris, damage HUD, pit repair |
| M2.5 | Sausage kerbs |
| M5 | Performance harness and adaptive quality |
| Cars | Prototype B variants (LMP2 B, Hypercar B) blocked pending design |

Not available today: opponents, race or session modes, pit stops, weather, wheel / force feedback, replays, telemetry screens, banked tracks.
