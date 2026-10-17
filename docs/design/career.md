# Career and championships — design (phases)

Status: phase plan approved by the planner 2026-10-17 (user request 2026-10-16/17: open-world career, any series to any series, season contracts, region-weighted offers). Research: `docs/research/career-mode.md` (data model §3, offers §3.1, reputation §3.2, AI progression §3.3, rivalries §3.4, stories §3.5, save §5). PRD Phase 3 / modes M3, M5, M6.

## Decisions

| Topic | Decision |
|---|---|
| Player role | Driver only. Team ownership is a possible late phase, not planned. |
| Economy | Reputation + personal money (prize, sponsor) to buy seats from C3. Team budgets only drive AI team performance; R&D in C7. |
| Skipped events | Auto-resolve with the off-screen statistical model ("sim race"). |
| Names | Fictional names generated from per-nationality first/last lists authored in-repo (`public/career/names/*.json`); no external name datasets, no real drivers, teams, series or logos. |
| Start | Pick nationality (default Mexico). Entry series of the player's region; for Latin America an F4-like regional series with Ermita as the local flagship event. |
| Storage | IndexedDB (one record per save, world + seasons), small localStorage index; export/import file. Store outcomes, never re-simulate history. |
| Determinism | `World.seed`; per-event seed = hash(seed, year, series, round). Off-screen sims pure functions of seed and state. |
| Simulation boundary | Career code in `src/career/`, no `three`, no DOM; UI in `src/ui/career/`. Races reuse the quick-race/RaceGame session path (no parallel race code). |
| Tuning | Weights and curves in `public/career/tuning.json`; series, teams, calendars in `public/career/*.json` (data, not code). |

## Phases (each is one milestone; acceptance tables written by the planner when the milestone opens)

| Phase | Milestone | Adds | Needs first |
|---|---|---|---|
| C0 Weekend | M3.1 | Weekend format as data (practice, qualifying, race; sprint optional), grid from qualifying, points tables, event standings | M2.1 quick race + classification, M2.1c penalties |
| C1 Single season | M3.2 | One fictional F4-like series, 6 events on existing tracks, fixed AI grid (fictional drivers/teams), season standings, results screens, save/resume | C0 |
| C2 Contracts | M3.3 | Season rollover, player contract, end-of-season offers in the same series (with reasons, "stay" + fallback), reputation, AI ageing/retirement, rookies | C1 |
| C3 Ladder | M3.4 | 3 open-wheel tiers (F4-like, F3/F2-like, top OW-26), licence points, promotion offers, prize money, pay-for-seat | C2; F3/F2-like cars (roadmap item 3) |
| C4 Open world | M3.5 | Regions and nationality, regional entry series, region-weighted offers across series, off-screen sim of all series, news feed, rivalries | C3 |
| C5 Disciplines | M3.6+ | GT sprint, electric OW, endurance (long races, driver swaps, multi-class), later stock/indy/touring — each series is data + its cars/sounds/tracks | C4; pits/strategy (M2.2), weather (M2.2b), damage (M2.4) for endurance |
| C6 Story | M3.7 | Emergent story beats (title fight, feud, rookie sensation, poached, home race), short regional arcs, contract negotiation (counter-offers with reasons) | C4 |
| C7 Development | M3.8 | R&D points as capped CarSpec multipliers within class limits (PRD §14) | C2 |
| C8 Share | later | Career export, challenge seeds, leaderboard hook | Phase 4 |

Ordering against the roadmap: Bathurst (track fidelity gate M1.11 first) and C0–C1 can run in parallel; C3 waits for the F3/F2-like cars; C5 endurance waits for Le Mans systems.

## Rules carried into every phase

- Every offer, refusal and target shows a readable reason.
- Contract targets are reachable: an average driver in that car meets them ~60 % of the time (checked by the off-screen sim in tests).
- The player can never dead-end: at least a "stay" or a pay/free-agent option every window.
- Brand-neutral everything; no F1/FIA names, logos or liveries; never the "Tatuus" name.
