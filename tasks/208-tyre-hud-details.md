# 208 — Tyre HUD details and dirt tuning

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The tyre widget shows, per tyre, the temperature in °C, the wear and whether the tyre is dirty, plus the compound and pressure. The dirty-tyre penalty (166) becomes milder and shorter.

## Context

User: "falta poner la temperatura de llantas en el HUD, y el desgaste y todo". Also: after going off track the car spins for about 1 km even when slow. The cause is 166's dirt: 25 % grip loss that needs about 1 km of asphalt to clean, and it is invisible in the HUD.

Today `src/ui/hudTyres.ts` renders 4 `div.tyre` tiles. Each tile's own text is the wear % and its class `tyre-blue|green|red` comes from `tyreColour`. Below them is `.fuel`. `main.ts` (around line 546 and 758) fills `HudTyresData` from `telemetry.wheels[i].tempC/wear`. `WheelTelemetry.dirt` is optional (`w.dirt ?? 0`). The theme tokens (`--ui-*`) come from `src/ui/theme.css` (207).

## Files

- `src/ui/hudTyres.ts`, `src/ui/hudTyres.css`: modify.
- `src/main.ts`: modify (fill the new data fields).
- `src/physics/tyreDirt.ts`: modify constants only.
- `tests/unit/acceptance/208-tyre-hud.test.ts`, `tests/e2e/acceptance/208-tyre-hud.spec.ts`: create (acceptance worker).

## Steps

1. **Data.** `HudTyresData` gains `dirt: number[]` (length 4, FL FR RL RR), `compound: 'soft' | 'medium' | 'hard'` and `pressureKpa: number`. `main.ts` fills `dirt[i] = telemetry.wheels[i].dirt ?? 0` each frame. `compound` is `tune.compound`. `pressureKpa` is the `tyres.pressureKpa` of the spec the current `Game` was created with (`freshSpec()`); refresh it whenever the game is recreated.
2. **Tile structure.** Each `div.tyre` keeps the class `tyre tyre-<colour>` (same `tyreColour` rule) and gets 3 children, created once in the constructor:
   - `span.tyre-temp`: `tyreTempText(tempC)`. Rounded °C with a degree sign, e.g. `"86°"`; non-finite gives `"—"`.
   - `span.tyre-wear`: the wear text exactly as today (`"12%"`, `"—"`).
   - `span.tyre-bar`: a condition bar. `style.transform = "scaleY(r)"` with `r = 1 − wear` clamped to [0, 1], formatted with `toFixed(2)`; non-finite wear gives `scaleY(0.00)`. Use `transform-origin: bottom`.
   - When `dirt[i] ≥ 0.05` the tile also has the class `dirty`, which shows a brown inner border or overlay.
   - The tile itself no longer has its own text.
3. **Header.** A `div.tyres-head` above the tiles, spanning both columns:
   - `span.tyres-compound` with text `S`, `M` or `H` and the class `compound-soft|medium|hard`. Colours follow the F1 convention: red, yellow, white ring or letter.
   - `span.tyres-pressure` with text `` `${(kPa / 6.894757).toFixed(1)} psi` ``; non-finite gives `"— psi"`.
4. **Look.** Racing-game style (ACC and F1 tyre widget):
   - The 4 tiles stay in a 2 × 2 car layout.
   - The temperature is the big number.
   - Wear is small, under it.
   - The bar is a thin vertical strip on the tile's outer side.
   - Use the `--ui-*` tokens. The tile backgrounds tone down today's saturated blue, green and red (the user found them loud): alpha ≤ 0.55 and a 2 px coloured left border carries the colour.
   - Keep the `.tyres` panel glass style from 207 and keep it inside the viewport, without overlapping the other HUD boxes, at 1280×720 and 1920×1080.
5. **Per-frame rules.** No element creation in `update`. Text, class and style writes happen only when the value changes; cache them like `setText` and `setClass`.
6. **Dirt tuning** (`src/physics/tyreDirt.ts`), constants only:
   - `DIRT_PICKUP.grass = 0.01`, `DIRT_PICKUP.gravel = 0.02` (per metre).
   - `DIRT_CLEAN_LENGTH = 150`.
   - `DIRT_GRIP_LOSS = 0.10`.

## Planner-authorised test edits

- `tests/unit/ui/hudTyres.test.ts`:
  - Assertions that read a tile's own text (`t.text` on `.tyre`) now read the text of its `.tyre-wear` child, with the same expected values.
  - The "does not rewrite texts" and "creates no elements during update" tests keep their intent. Adapt their fake-DOM helpers only as needed for children and `style`.
  - Every `update` call passes the new fields: `dirt: [0, 0, 0, 0]`, `compound: 'medium'`, `pressureKpa: 140`.
- `tests/unit/acceptance/166-dirty-tyres.test.ts`, only these expected values:
  - Line ~97: gravel `0.4` → `0.2`.
  - Line ~98: grass `0.2` → `0.1`.
  - AT3: the decay is e^-1 over 150 m, so the calls become `updateDirt(1, surface, 15, 10)` and the test name says 150 m.
  - Line ~116: `0.2` → `0.1`.
  - AT6: `0.75` → `0.9` and `0.875` → `0.95`, both occurrences of `0.75`. The test name says 10%.
- Any other existing test that builds a `HudTyresData` literal: add the three new fields, nothing else.

## Acceptance tests (defined by the planner with Opus, before coding)

Unit rows use a fake DOM like `tests/unit/ui/hudTyres.test.ts`. They import `HudTyres`, `tyreTempText` and `type HudTyresData` from `src/ui/hudTyres` and `updateDirt` and `dirtGripFactor` from `src/physics/tyreDirt`. Base data: `tempC [60, 90, 120, 90]`, `wear [0.5, 1, 0, 0.25]`, `dirt [0, 0.04, 0.05, 1]`, `optTempC 90`, `tempWindowC 40`, `fuelL 10`, `meanLapL null`, `compound 'soft'`, `pressureKpa 140`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit `tyreTempText` | 86.4 / 86.5 / NaN / Infinity | `"86°"` / `"87°"` / `"—"` / `"—"` |
| AT2 | HudTyres, base data | update | 4 `.tyre`; `.tyre-temp` texts `["60°","90°","120°","90°"]`; `.tyre-wear` texts `["50%","100%","0%","25%"]`; colour classes blue, green, red, green |
| AT3 | base data | update | `.tyre-bar` `style.transform` = `["scaleY(0.50)","scaleY(0.00)","scaleY(1.00)","scaleY(0.75)"]` |
| AT4 | base data | update | class `dirty` on tiles 2 and 3 only; then update with `dirt [0, 0, 0, 0]` → no tile has `dirty` |
| AT5 | base data | update | `.tyres-compound` text `"S"`, has class `compound-soft`; `.tyres-pressure` text `"20.3 psi"`; with `compound 'hard'`, `pressureKpa NaN` → `"H"`, `compound-hard` (no `compound-soft`), `"— psi"` |
| AT6 | base data | update twice with identical data | zero text, class and style writes on the second call; no element created during either update |
| AT7 | unit tyreDirt | `updateDirt(0,'grass',10,1)`, `updateDirt(0,'gravel',10,1)`, `updateDirt(1,'asphalt',15,10)`, `dirtGripFactor(1,'asphalt')` | 0.1, 0.2, e^-1 (1e-12), 0.9 |
| AT8 | e2e `/?track=monza`, wait `window.__SIMGAME__?.ready === true` (60 s) | read DOM | `.tyres .tyre` count 4; each `.tyre-temp` matches `/^\d+°$/`, each `.tyre-wear` matches `/^\d+%$/`; `.tyres-compound` text in `S`, `M`, `H`; `.tyres-pressure` matches `/^\d+\.\d psi$/`; `.tyres` bounding box inside the 1280×720 viewport; no console errors |

Existing tests that must still pass: `tests/e2e/acceptance/207-ui-polish.spec.ts`, `070-dynamics-integration.spec.ts` AT6, `tests/unit/acceptance/069-hud-tyres-fuel.test.ts`.
