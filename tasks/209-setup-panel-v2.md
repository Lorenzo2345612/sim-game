# 209 — Setup panel v2, tyre compound choice and in-game setup overlay

Status: pending
Phase: 1
Depends on: 208
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The setup screen looks like a racing game's garage, shows values in real units and lets the player pick the tyre compound. In-game, one key toggles a compact read-only overlay with the current setup.

## Context

User: "mejorar el panel de setup, que en pantalla se muestre el setup o tener un HUD que se esconde con un botón para ver la configuración del auto, poder seleccionar los neumáticos".

Today:
- `src/ui/setupPanel.ts` (`#setup-panel`, opened from pause → Setup) shows 8 bare sliders (`input[type=range][data-setup=<key>]`), the presets Stable, Balanced and Aggressive, and Apply. `onApply` restarts the game.
- Setup keys, ranges and presets are in `public/cars/<id>.json` → `spec.setup` and `spec.presets`. `src/physics/setup.ts` has `loadSetup`, `saveSetup`, `clampSetup`, `presetSetup` and `applySetup`.
- The compound can only be set with `?compound=` or `GameOptions.compound` (`src/core/settings.ts`, localStorage key `settings`). There is no UI for it. `savePreset` overwrites the whole `settings` object with `{preset}`, which would erase a stored compound.
- `main.ts` builds `tune = {compound, wear, fuel}` once (around line 342). `Game.create(track, freshSpec(), tune)`. The tyre HUD reads the compound since 208.
- Keys in use: W A S D, arrows, R, C, Q, E, M, Esc, F3. Gamepad (`src/input/gamepad.ts`, standard mapping): buttons 4–7 are used.

## Files

- `src/ui/setupPanel.ts`: modify (layout, units, compound selector, ±/reset).
- `src/ui/setupHud.ts`, `src/ui/setupHud.css`: create (overlay).
- `src/core/settings.ts`: modify (`saveGameOptions`, merge-safe `savePreset`).
- `src/input/gamepad.ts`: modify (button 8 edge → toggle event).
- `src/main.ts`: modify (wiring, mutable compound, `KeyI`).
- `tests/unit/acceptance/209-setup-panel-v2.test.ts`, `tests/e2e/acceptance/209-setup-panel-v2.spec.ts`: create (acceptance worker).

## Steps

1. **Units and formatting.** Export `formatSetupValue(key, value): string` from `src/ui/setupPanel.ts`:

   | key | format | example |
   |---|---|---|
   | `frontWing`, `rearWing` | integer | `"5"` |
   | `brakeBias` | percent front, 1 decimal | `0.6` → `"60.0% F"` |
   | `finalDrive` | 2 decimals | `"3.50"` |
   | `arbFront`, `arbRear` | kN/m, integer | `18000` → `"18 kN/m"` |
   | `rideHeight` | mm, signed, integer | `-0.006` → `"-6 mm"`, `0` → `"0 mm"`, `0.004` → `"+4 mm"` |
   | `tyrePressureKpa` | psi, 1 decimal, then kPa | `140` → `"20.3 psi (140 kPa)"` |

   A non-finite value gives `"—"`.
2. **Panel layout**, garage style (F1 24 setup and ACC setup screens). The panel is wider (`min(880px, 94vw)`) with two columns, and one column below 900 px. Groups:
   - Aero: front wing, rear wing.
   - Brakes: bias.
   - Gearing: final drive.
   - Suspension: anti-roll bars, ride height.
   - Tyres: compound and pressure.

   Each row has:
   - the label;
   - the formatted value;
   - `−` and `+` buttons that change the value by one `step` (clamped; `aria-label` `"Decrease <label>"` / `"Increase <label>"`);
   - the slider;
   - a dim delta vs the car default (`"+1"`, `"−2 kN/m"`; empty when equal).

   Footer: presets (Stable, Balanced, Aggressive), `Reset` (defaults), `Apply`, `Close`. Use the 207 theme tokens and button variants. Keep exactly 8 `input[type=range][data-setup]`, the button names `Apply`, `Stable`, `Balanced` and `Aggressive`, and Esc closing back to the pause menu (068 tests).
3. **Compound selector** in the Tyres group: 3 buttons `button.compound-btn[data-compound=soft|medium|hard]`, labelled `Soft`, `Medium` and `Hard`.
   - The selected one has `aria-pressed="true"` and class `selected`.
   - Each shows its letter in F1 colours and one dim line from the spec compound: `opt <optTempC>°C`.
   - On Apply, the chosen compound is saved with `saveGameOptions(storage, {...loadGameOptions(storage), compound})`. `main.ts` then restarts the game with that compound: `tune.compound` becomes mutable, and the 208 tyre HUD data and the temp window follow the new compound.
   - `?compound=` in the URL still wins over the stored value at page load.
4. **Settings storage.**
   - `saveGameOptions(storage, opts)` writes `wear`, `fuel` and `compound` into the `settings` object and keeps the other keys.
   - `savePreset` also merges, keeping the other keys, instead of overwriting.
5. **In-game setup overlay** `src/ui/setupHud.ts`: class `SetupHud(container, doc?)` with `show(setup, compound, spec)`, `hide()`, `toggle()`, `visible` and `dispose()`.
   - Root `div#setup-hud.setup-hud`: a glass panel (207 style) at the right edge, vertically centred, at least 16 px below the minimap's bottom. It does not overlap any other HUD box at 1280×720 or 1920×1080.
   - It lists the 8 setup values with `formatSetupValue` (`div.setup-hud-row[data-setup=<key>]`) plus a compound row `div.setup-hud-row[data-setup=compound]` whose text contains `Soft`, `Medium` or `Hard`.
   - Built once. Its content is refreshed only on `show`, never per frame.
   - Toggle: keyboard `KeyI` (ignored while paused or while the setup panel is open), and gamepad button 8 (Back/Select/Share; edge-triggered, like the shift buttons).
   - Hidden by default. The visibility is remembered in localStorage key `setupHudVisible` (`"1"`/`"0"`).
   - The pause menu's controls text, if any, mentions `I`.
6. Escape, pause and everything else behave as today.

## Acceptance tests (defined by the planner with Opus, before coding)

Unit rows use a fake DOM and storage like `tests/unit/ui/hudTyres.test.ts`. They import `formatSetupValue` from `src/ui/setupPanel`, `SetupHud` from `src/ui/setupHud`, and `loadGameOptions`, `saveGameOptions`, `savePreset` and `SETTINGS_KEY` from `src/core/settings`. They load the F4 spec with `parseCarSpec` from `public/cars/f4.json`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit `formatSetupValue` | (`brakeBias`,0.6), (`arbFront`,18000), (`rideHeight`,-0.006), (`rideHeight`,0), (`rideHeight`,0.004), (`tyrePressureKpa`,140), (`finalDrive`,3.5), (`frontWing`,5), (`rearWing`,NaN) | `"60.0% F"`, `"18 kN/m"`, `"-6 mm"`, `"0 mm"`, `"+4 mm"`, `"20.3 psi (140 kPa)"`, `"3.50"`, `"5"`, `"—"` |
| AT2 | unit storage with `settings = {"preset":"high","wear":2}` | `saveGameOptions(s, {wear: 2, fuel: 1, compound: 'soft'})` then `loadGameOptions(s)` | `{wear: 2, fuel: 1, compound: 'soft'}`; stored JSON still has `preset: "high"` |
| AT3 | unit storage with `settings = {"compound":"hard"}` | `savePreset(s, <any valid preset>)` then `loadGameOptions(s)` | compound still `'hard'` |
| AT4 | unit `SetupHud`, F4 default setup, compound `'soft'` | `show(...)` | root id `setup-hud`, visible; 9 `.setup-hud-row`; row `rearWing` text contains `"5"`; row `tyrePressureKpa` contains `"20.3 psi"`; row `compound` contains `"Soft"`; then `hide()` → not visible; `toggle()` → visible |
| AT5 | e2e `/?track=monza`, ready (60 s) | pause → Setup | 8 `#setup-panel input[type=range][data-setup]`; 3 `button.compound-btn`; exactly one has `aria-pressed="true"` and it is `medium` (fresh storage) |
| AT6 | e2e, setup open | click `Increase Rear wing` once | slider `rearWing` value = default + 1 (6); the row shows `"+1"` delta text |
| AT7 | e2e, setup open | click `Soft`, then `Apply`, wait ready, reload page, wait ready | `.tyres-compound` text `"S"`; reopen Setup → `soft` has `aria-pressed="true"` |
| AT8 | e2e `/?track=monza`, ready | press `KeyI` | `#setup-hud` visible, contains `"Medium"`; its box is inside 1280×720 and does not intersect `.tyres`, `.hud2-panel`, `.hud-panel` or the minimap canvas; press `KeyI` again → hidden; no console errors |

Existing tests that must still pass: `tests/e2e/acceptance/068-setup-screen.spec.ts`, `207-ui-polish.spec.ts`, `208-tyre-hud.spec.ts`, and the unit tests of `src/core/settings.ts`.
