# New cars and series — milestone plan

Status: planned 2026-10-17; order = user roadmap (electric, then the OW ladder, then endurance, then the rest). Starts after M1.10 (engine audio v2, incl. 244) and M1.11 (track fidelity, incl. 245–249) close. Research per series in `docs/research/cars/`: `ow-ladder-f3-f2.md`, `electric-ow.md`, `endurance.md`, `later-series.md`. Each milestone opens with: (1) data-gap check (values marked FORUM/EST/ASSUMED verified or accepted as tuning targets), (2) planner acceptance tables, (3) specs. All game data brand-neutral; never "Tatuus"; no real series/team/manufacturer names, logos or liveries.

Every new car gets: carSpec JSON, physics tuning against the research lap-time ratios, its own engine voice (audio v2), a model (custom from existing `.glb` when no free CC model exists, licence line in `ASSETS_LICENSES.md`), livery support, AI tuning, and a series data file for the career (`docs/design/career.md`).

## Order and milestones

| # | Milestone | Cars | New systems | Tracks | Needs |
|---|---|---|---|---|---|
| 1 | M7.1 Electric OW | `eow` (450/600 kW, AWD, 51 kWh, 700 kW regen) | Electric powertrain (motor torque/power map, battery SoC, regen blending front/rear), AWD drive type, attack mode, pit boost, time-based race (45 min + 1 lap), qualifying duels, electric sound voice (motor/gear-mesh/inverter layers — synth extension), split front/rear wheel widths | Mexico short layout + new street tracks (12 missing; pick 3–4 first) | M1.10 synth extension; career C0 race formats |
| 2 | M7.2 OW ladder | `ow3` (F3-like: 673 kg, 3.4 NA V6 95°, 283 kW), `ow2` (F2-like: ~795 kg, 3.4 turbo V6, 462 kW, DRS) | DRS (zones, 1 s detection), reverse-grid sprint, mandatory pit stop (F2 feature race) | existing | M1.10, M1.11; pit stops (M2.2) for the mandatory stop |
| 3 | M7.3 Endurance | existing `hyper-a`, `lmp2-a`, `gt3-*` (+ hybrid block for hyper-a) | Multi-class grid + class standings, BoP table, driver crew + swaps + drive-time ledger, race clock with time compression (6 h in 60 min, wear/fuel ×K), FCY/slow zones/safety cars, multi-class AI traffic, night (headlights, track lights) | Circuit de la Sarthe (OSM check first) | M2.2 pits/strategy, M2.2b weather/time of day, M2.4 damage |
| 4 | M7.4 GT4 + LMP3 | `gt4-a`, `lmp3-a` | — (BoP from M7.3) | existing | M7.3; cheap reuse of GT3/LMP2 |
| 5 | M7.5 V8 Supercars | `v8sc` | — (sequential gearbox flag) | Bathurst (roadmap item 1) + 1–2 Australian tracks | Bathurst |
| 6 | M7.6 IndyCar road/street | `indy` | Push-to-pass (time budget), hybrid deploy | existing road/street | M7.1 energy pieces reused |
| 7 | M7.7 TCR | `tcr` | FWD drivetrain, success ballast | existing | — |
| 8 | M7.8 Stock car road | `stock` | H-pattern/sequential gearbox, stages + cautions | existing road courses | — |
| 9 | M7.9 Ovals | `stock`, `indy` oval kits | Drafting aero (wake model), pack-racing AI, oval cautions/pit cycles, spotter | Pure ovals (new) | M7.6, M7.8 |

Shared systems are built once and reused: DRS (M7.2) → push-to-pass/attack mode share an "overtake aid" module; energy/battery (M7.1) → Indy hybrid (M7.6) and hypercar hybrid (M7.3); BoP (M7.3) → GT4/LMP3 (M7.4) and TCR (M7.7).

## Open data gaps (resolve at milestone open)

- M7.2: F2 mass incl./excl. fuel; F2 mandatory-stop exact rule; DRS rules in F2/F3; firing order (EST 0/95/240/335/480/575).
- M7.1: mass 954 vs 1012 kg; rear tyre 345 vs 330 mm; aero coefficients; front/rear race power split; attack-mode activations; model is custom.
- M7.3: tank/stint energy, pit rules, Hyperpole format, LMP2/LMGT3 power (official PDFs unread); Sarthe OSM availability.
- M7.5–M7.9: Supercars displacement (5.0 vs 5.4/5.7 L), stock-car weight and rev limit, push-to-pass seconds, LMP3 Gen3 mass, points systems.
