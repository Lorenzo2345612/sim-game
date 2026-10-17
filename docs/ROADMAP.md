# Roadmap to the complete game

Status 2026-10-17. View-only overview: milestones here are not dispatched until the planner opens them (acceptance tables + specs). Open milestones live in `tasks/milestones.json`. Sizes are estimated task counts. Sources: `PRD.md` §8.1 and §11, `docs/design/career.md`, `docs/design/new-series.md`, `docs/plans/*`.

Legend: **done** = approved · **open** = tasks dispatched · **planned** = design exists · **proposed** = planner proposal, design pending.

## Done (13 milestones)

M0 prototype · M1.1 real tracks · M1.2 scenery and menu · M1.2b track look · M1.2c realism and new tracks · M1.2d environments · M1.2e per-circuit fidelity · M1.3 gameplay · M1.4 F4 model · M1.5 vehicle dynamics · M1.6 car roster · M1.7 audio v1 · M1.8 cockpit.

## Wave A — open now

| Milestone | Content | Status |
|---|---|---|
| M1.10 | Engine audio v2 (crank-angle synth, per-car voices, H5 timbre, turbo) | open, 6/9 |
| M1.11 | Track fidelity (grounding, pit pieces, kerbs/barriers/sausages that never fold, QA report) | open, 7/12 |
| M1.12 | Ermita de Guadalupe street circuit (5 layouts, village, arroyo) | open, 0/3 |
| M1.9 | Liveries (data, paint shader, numbers, editor) | open |
| M2.1 | Race: AI, quick race, grid, start lights, classification | open |
| M2.1b | Driving school (line, braking boards, assists, lessons) | open |
| M2.1c | Race rules (track limits, flags, VSC, penalties) | open |
| M2.1d | Replays and telemetry | open |
| M2.2b | Weather and time of day | open |
| M2.4 | Damage (model, impacts, effects, debris, repair) | open |
| M2.5 | Sausage kerbs | open |
| M5 | Performance (harness, render/sim cost, adaptive quality) | open |

## Wave B — race weekend and Bathurst

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M1.13 | Bathurst (Mount Panorama): OSM layout, DEM, real colours, visual QA gate | ~6 | M1.11 | planned |
| M2.2 | Pits and strategy: pit lane, box service, 3 compounds, fuel modes, strategy planner + live panel, AI uses it | ~10 | M2.1 | planned (PRD) |
| M3.1 | Career C0: weekend format as data, grid from qualifying, points, event standings | ~6 | M2.1, M2.1c | planned |
| M3.2 | Career C1: one F4-like season, 6 events, fictional grid, save/resume | ~8 | M3.1 | planned |

## Wave C — electric series

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M7.1 | Electric OW: powertrain + battery + regen, AWD, attack mode, timed race, qualifying duels, electric voice | ~12 | M1.10, M3.1 | planned |
| M1.14 | Electric calendar tracks, batch 1 (3–4 street tracks: Mexico layout, Berlin Tempelhof, Jeddah, Miami) | ~8 | M1.11 | planned |
| M3.3 | Career C2: season rollover, contracts, offers with reasons, reputation, AI ageing, rookies | ~8 | M3.2 | planned |

## Wave D — open-wheel ladder and open world

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M7.2 | F3-like and F2-like cars: DRS, reverse-grid sprint, mandatory stop | ~10 | M2.2 | planned |
| M3.4 | Career C3: 3 OW tiers, licence points, promotion, prize money, pay-for-seat | ~8 | M3.3, M7.2 | planned |
| M3.5 | Career C4 open world: regions, nationality, cross-series offers, off-screen sims, news, rivalries | ~10 | M3.4 | planned |
| M3.7 | Career C6 story: emergent beats, regional arcs, negotiation | ~6 | M3.5 | planned |
| M3.8 | Career C7 R&D: capped upgrades within class limits | ~5 | M3.3 | planned |
| M1.15 | Electric calendar tracks, batch 2 (rest of the 13) | ~12 | M1.14 | planned |

## Wave E — endurance

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M7.3 | Endurance: multi-class, BoP, driver swaps, race clock compression, FCY/safety car, night, Circuit de la Sarthe | ~14 | M2.2, M2.2b, M2.4 | planned |
| M7.4 | GT4 and LMP3 cars | ~5 | M7.3 | planned |
| M3.6 | Career C5 disciplines: GT, electric, endurance series as data in the open world | ~6 | M3.5, M7.3 | planned |

## Wave F — remaining series

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M7.5 | V8 Supercars + 1–2 Australian tracks | ~6 | M1.13 | planned |
| M7.6 | IndyCar road/street: push-to-pass, hybrid | ~6 | M7.1 | planned |
| M7.7 | TCR touring: FWD, success ballast | ~5 | M7.3 | planned |
| M7.8 | Stock car road: gearbox, stages, cautions | ~6 | — | planned |
| M7.9 | Ovals: drafting, pack AI, oval cautions, spotter, new oval tracks | ~10 | M7.6, M7.8 | planned |

## Wave G — learned AI (experiment)

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M2.3 | Imitation + RL AI on the headless sim (RTX 5060 / RunPod); used for hard/expert only if it beats the classic AI | ~8 | vehicle model frozen (after M7.2) | planned (PRD) |

## Wave H — online (PRD Phase 4)

| Milestone | Content | Size | Needs | Status |
|---|---|---|---|---|
| M4.1 | Leaderboards with ghost validation (server replays the inputs) | ~6 | M2.1d | proposed |
| M4.2 | Real-time multiplayer (WebRTC + signalling, or server-authoritative) | ~12 | M4.1 | proposed |
| M4.3 | Driver rating (skill + safety), matchmaking into splits | ~5 | M4.2 | proposed |
| M4.4 | Admin events: scheduled sessions, results, standings | ~6 | M4.3 | proposed |
| M3.9 | Career C8 share: export, challenge seeds, leaderboard hook | ~3 | M4.1 | planned |

Budget 0: online needs free hosting (Railway free tier or P2P-first); a hosting check opens Wave H.

## Wave I — 1.0 release

| Milestone | Content | Size | Status |
|---|---|---|---|
| M8.1 | Settings and accessibility: control remapping, colour-blind HUD, subtitles for radio/spotter, difficulty presets | ~6 | proposed |
| M8.2 | Wheel support and force feedback (PXN first) | ~6 | proposed (deferred by user) |
| M8.3 | Spanish/English UI | ~4 | proposed |
| M8.4 | Menus and onboarding polish: main menu flow, first-run tutorial, loading screens | ~5 | proposed |
| M8.5 | Release 1.0: full performance pass, licence/credits audit, save migration, public build | ~4 | proposed |

## Totals

About 35 milestones and ~250 tasks remain. At the current pace (~40 tasks/day when not blocked) that is roughly 1–2 months of pipeline time, plus planner gates and blocked days.
