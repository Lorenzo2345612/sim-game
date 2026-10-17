# Career mode research (open-world, brand-neutral)

Date 2026-10-17. Planner input for roadmap M3.x (phase2-race.md lists M3.1 Weekend and M3.2 Career only as one-liners). No code changed. Figures from web sources are noted as such; points tables and series data below are generic/inspired, never real names.

## 0. Constraints from the repo

- PRD §14: free, non-profit, budget 0, offline career is Phase 3, online Phase 4. Car development is career-only; online cars fixed-spec. Roster is multi-category (open-wheel first, GT3, then GT4/TCR/prototypes). Real brands only in dev; de-brand before release, so the career layer must be brand-neutral from day one (fictional series/teams/drivers, circuit names city/region).
- Existing, from `tasks/tasks.json`: AI driver + traffic + difficulty (done), race classification (done), multi-car race game (done), replay recorder (done), damage model (pure done; effects pending), quick race menu/results (pending), weather in races (pending), replay player (pending). Not present: practice/qualifying sessions, championship points, any profile/save beyond per-feature localStorage keys (`livery:<car>`, setups, `school:<track>`).
- Determinism rule already in force: no `Math.random` in pure modules, seeded mulberry32 passed in (phase2-race.md). The career layer must follow it: all world simulation is a pure function of (world seed, season index, player choices).
- Pure modules import nothing from `three`; the career core lives in a new `src/career` (pure, depends on `core` only), wired by `src/game` and `src/ui`.

## 1. How existing games structure careers

| Game | Structure | Works | Pitfalls |
|---|---|---|---|
| EA F1 24 Driver Career | One top series (plus F2 lead-in); reputation and "driver recognition" shape which deals appear; contract targets can trigger renegotiation; secret talks with rivals with leak risk; team objectives and short-term accolades; reputation boosts R&D motivation ([racinggames.gg](https://racinggames.gg/f1/f1-24-revealed-with-revamped-career-mode-and-more-authentic-handling), [gpfans](https://www.gpfans.com/us/f1-news/1018977//), [insider-gaming](https://insider-gaming.com/details-on-f1-24-career-mode-revealed/), [the-race](https://www.the-race.com/formula-1/f1-24-game-overhauled-career-mode-explained/)) | Contracts with targets give the player a reason to race well each weekend; reputation as the single number explaining who calls | Previews only; missed targets lower reputation and make renewal unlikely, so goals must be realistic (cap objective difficulty by team expectation). Single series: no cross-series open world |
| GRID Legends | Rookie / Semi-Pro / Pro / Gauntlet tiers, ~250 events, unlock next tier by completing N events, free class choice; team management; scripted story "Driven to Glory" with live-action cutscenes ([racinggames.gg review](https://racinggames.gg/reviews/grid-legends-review-a-return-to-glory/), [traxion](https://traxion.gg/grid-legends-review-a-return-to-form-with-caveats/)) | Tiered unlock + free choice of discipline; rivals were the best-received part of the story | Silent, non-factor protagonist, thin writing, rushed final act. Scripted story is expensive and short (7-10 h); it does not scale. Lesson: rivals with persistent names and grudges beat authored cutscenes |
| iRacing | Rookie, D, C, B, A (+ Pro) licence per discipline; promotion needs minimum participation plus Safety Rating (starts 2.5, 3.0 to leave rookie, below 2.0 at season end risks demotion); iRating (Elo-style) places you in splits ([iracing.com](https://www.iracing.com/?p=275900), [coachdave](https://coachdaveacademy.com/tutorials/understanding-the-license-system-in-iracing/)) | Clear gating by clean racing + skill; two orthogonal numbers (skill vs conduct) | Pure ladder: no narrative, no contracts. Details of minimum participation differ across sources; do not copy numbers |
| Motorsport Manager | Management sim; driver market with iterative offers and feedback on how close the offer is; rival teams outbid you; drivers age and retire; contract length matters; sponsor targets drive cash ([cubed3](https://www.cubed3.com/games/reviews/pc/motorsport-manager), [pocketgamer](https://www.pocketgamer.com/motorsport-manager/review)) | World evolves between seasons (ageing, retirement, newcomers) so the market stays fresh | Lowball offers get rejected as insulting and the replacement can be cheaper: negotiation needs readable feedback. Missed sponsor bonuses cause cash-flow cliffs |
| Football Manager (contract model) | Live negotiation, agent personalities, clauses, accept/reject/counter, "suggest terms" shortcut; refusal complaints when team reputation is below the player's level ([afkgaming FM24](https://afkgaming.com/gaming/general/how-contract-negotiations-work-in-football-manager-2024), [fmscout thread](https://www.fmscout.com/q-2941-Players-dont-want-to-negotiate-HELP.html)) | Per-clause negotiation is deep and replayable | Opaque refusals frustrate; the player cannot tell why. Always expose a reason ("team budget too low", "you lack reputation") |
| Automobilista 2 | Strong custom championship editor (class, tracks, order, dates, weather, session types, rules); official career still unfinished; community add-on "Zero to Apex" layers reputation-driven opportunities over 100+ championships ([boxthislap](https://boxthislap.org/zero-to-apex-automobilista-2-career-mode/), [overtake.gg](https://overtake.gg/news/comments/68396)) | Data-driven championship definitions; modders extend them | Championship engine bugs (AI not pitting under rules in championships, per 2021 threads). Lesson: championship rules must reuse the exact race-session code path of quick race |
| Le Mans Ultimate | Not verified: as far as known it is race/championship-oriented (WEC-style endurance weekends, driver swaps, class racing) without an open career. Treat as reference for endurance format only; check before citing | Endurance multi-class traffic | n/a |

Cross-cutting conclusions:
1. One public number (reputation) plus visible reasons for every offer/refusal.
2. Separate conduct from skill (iRacing SR vs iRating): fits our classification + damage penalties.
3. World must evolve while you play (MM): AI drivers age, retire, rise and fall.
4. Prefer emergent rivalries from race data over authored cutscenes (GRID story criticism).
5. Championship rules should be data, run by the same code as quick race (AMS2 bugs).
6. Never gate fun behind a single series: tiered unlock plus free choice (GRID).

## 2. Real-world structure to model (generic)

### 2.1 Seasons and calendars
- A season is one year; 6-24 rounds depending on level. Junior: 6-8 weekends of 2-3 races (regional/national F4-like); mid: 10-14 weekends; top open-wheel: 20+; GT3 sprint: 7-10 weekends; endurance: 4-8 events from 6 h to 24 h; electric open-wheel: ~16 city rounds, 1 race per round.
- Model: season = ordered list of Events; Event = one track + layout + weekend format + weather profile + date (week-of-year). Date matters only to order events, drive the driver market window and weather climate.
- Region: continental calendars (e.g. "Europe", "Americas", "Asia-Pacific") use tracks near each other; flyaway events appear only at higher prestige.

### 2.2 Weekend formats (data, not code)
| Format | Sessions |
|---|---|
| Junior triple | Practice (30 min), Qualifying (20 min), Race 1 (grid by quali), Race 2 (grid by reversed top-N of race 1 or by 2nd best lap), Race 3 |
| Sprint + feature | Practice, Quali, Sprint (30-35 % distance, reversed top 10 or top 8), Feature (100 % distance, pit stop mandatory optional) |
| Single race | Practice, Quali (knock-out or single session), Race |
| Endurance | Free practice x2, Quali (class split), Warm-up, Race 6/8/12/24 h (time-scaled; driver stints; multi-class traffic) |
| Electric city | Short practice, group quali duels, Race (time + 1 lap), optional energy limit |
Design as `WeekendFormat = { sessions: SessionDef[] }`, `SessionDef = { kind: 'practice'|'quali'|'race', durationMin|laps, gridRule, pointsTable?, mandatoryStops?, tyreRule? }`. Gate by what the sim can do: pit/strategy (M2.2) is needed before endurance; light damage (M2.4) before contact penalties matter.

### 2.3 Points systems (typical, generic)
- Race, top-10 style (classic): 25-18-15-12-10-8-6-4-2-1; fastest-lap +1 if finished top 10 (optional); pole +1 (sprint-era).
- Sprint: 10-9-8-7-6-5-4-3 (top 8).
- Junior, deep (top 15): 25-18-15-12-10-8-6-4-2-1 then 1 for 11-15 optional, or the 15-12-10-8-6-5-4-3-2-1 variant.
- Endurance: 25-18-15-12-10-8-6-4-2-1 x multiplier for race length (e.g. 1x for 6-8 h, 1.5x for 24 h), class-split.
- Electric single race: same as classic plus pole +3.
- Tie-breaks: most wins, then most 2nd places, then best qualifying. Drop-rounds optional (best N of M).
- Standings: drivers, teams (sum of best two/three cars), per class.
All tables are data per series (`pointsTable: number[]`, `bonuses`). No branding.

### 2.4 Driver market timing
- Real market opens mid-season: first rumours around round 1/3 of the way, signings peak in the last third, contracts effective on 1 Jan; reserve/test seats and junior academies feed the top. Lower series have rolling, late (winter) signings because most seats need budget.
- Model windows: `W1` (after 50 % of the calendar: renewals and early offers), `W2` (after the final race: bulk), `W3` (pre-season: leftover seats at reduced quality). Offers expire at window end.

### 2.5 Pay drivers, sponsors, budgets
- Junior series: most seats are bought (budget ranges roughly from tens of thousands to a few hundred thousand in-game currency/year); talented drivers get "funded" seats by academies/championship prizes.
- Model: Driver has `sponsorMoney` (starts from nationality/region and home-market sponsors); Team seats have a `seatPrice` (negative = salary). Offer evaluation compares driver value vs price. Player can choose "pay for a better seat" at the cost of cash (lose it if no results).
- Top series: salaries, performance bonuses, clauses (win bonus, title bonus, release clause).

### 2.6 Licence gating (generic "super-points")
- Real ladders gate the top series by points earned over three seasons in feeder series (higher prestige series award more; points scaled from winner down to 10th; 12-10-7 for top 3 in national F4 vs 25-20-15 in a top regional series, per [formula1.com explainer](https://www.formula1.com/en/latest/article/f1-explained-how-does-the-super-licence-system-work-and-what-does-sargeant.IXyLbO00195LXtCo3YIOU); 2016 rules had 40-point threshold [formula1.com](https://www.formula1.com/en/latest/article/new-super-licence-points-system-from-2016.6dQ650pTG2zlNCtGopSVdv.html). Only used as a shape, numbers invented).
- Model: `LicencePoints` accumulated over a rolling 3-season window; each series has `licenceValue: [p1, p2, p3, ... p10]` and each series has `licenceRequired: points` (0 for entry series, high for the top). Cross-discipline (GT, endurance, electric) uses a separate, lighter gate (e.g. "GT licence": experience in any closed-wheel or 2 seasons anywhere) to avoid forcing one ladder. Conduct (clean racing, from penalties/damage) is a second value, like iRacing SR: low conduct blocks promotion and lowers offers.

### 2.7 Regional series
- Open-wheel entry is national/regional: F4-like per country or region (e.g. Europe-West, Latin America, North America, Asia-Pacific, Middle East-Africa), then continental F3-like, then global F2-like, then top. GT3: national/continental sprint and endurance series, global endurance top. Prototype endurance: continental then global. Electric open-wheel: global city championship plus a junior spec series. Later: stock car (oval/road), IndyCar-like, touring (TCR).
- Data: each Series has `region` (or `global`) and `tier` (0-6). Regions are generic names mapped from nationality groups, not trademarks.

## 3. Proposed data model (TypeScript sketch, plain JSON, serialisable)

```ts
type Id = string;
type Region = 'eur-w'|'eur-e'|'na'|'latam'|'asia'|'mea'|'oce'|'global';
interface Nationality { code: string; region: Region; homeSponsorWealth: number /*0-1*/; }

interface Series {
  id: Id; name: string;                 // fictional
  discipline: 'open-wheel'|'electric'|'gt'|'endurance'|'stock'|'indy'|'touring';
  tier: number; region: Region;         // tier 0 entry .. 6 top
  carClass: Id;                         // maps to existing car spec ids
  prestige: number;                     // 0-1
  weekendFormat: Id; pointsTable: Id;
  calendarTemplate: CalendarEntry[];    // see below, adjusted yearly
  teamCount: number; carsPerTeam: number;
  licenceRequired: number; licenceValue: number[];
  budgetCap?: number; rules: RuleSet;   // pit stops, tyre allocation, penalties
}
interface CalendarEntry { trackId: Id; layoutId?: Id; weekOfYear: number; formatOverride?: Id; weather: Id; }
interface Season { year: number; seriesId: Id; events: CalendarEntry[]; results: EventResult[]; standings: Standings; }
interface EventResult { eventIdx: number; sessions: SessionResult[]; /* grid, classification, penalties, fastest lap */ }

interface Team {
  id: Id; name: string; region: Region; seriesId: Id;
  budget: number; carPerf: number /*0-1 vs series spread*/; reliability: number;
  reputation: number; needs: { wantsPaying: boolean; wantsVeteran: boolean; wantsYoung: boolean; nationalityPref?: string };
  seats: Seat[]; academyDrivers: Id[];
}
interface Seat { driverId?: Id; contract?: Contract; role: 'lead'|'second'|'reserve'; }
interface Contract { teamId: Id; seriesId: Id; startYear: number; years: number; salary: number /*neg = pays*/; bonuses: Clause[]; targets: Target[]; }
interface Target { kind: 'wins'|'podiums'|'points'|'champPos'|'beatTeammate'; value: number; reputationDelta: number; }

interface Driver {
  id: Id; name: string; nationality: string; birthYear: number;
  ratings: { pace: number; racecraft: number; consistency: number; wetSkill: number; tyreMgmt: number; aggression: number; potential: number };
  reputation: number;                  // 0-100 global
  regionRep: Partial<Record<Region, number>>;
  conduct: number;                     // clean-racing score
  licencePoints: number[];             // rolling by season
  money: number; sponsorMoney: number;
  contract?: Contract; history: SeasonRecord[];
  isPlayer: boolean;
}
interface Rivalry { a: Id; b: Id; heat: number; events: RivalryEvent[]; }  // see 3.4
interface World { seed: number; year: number; series: Series[]; teams: Team[]; drivers: Driver[]; rivalries: Rivalry[]; storyQueue: StoryBeat[]; log: NewsItem[]; }
```
Player's on-track performance is the only non-simulated input. AI seasons not driven by the player are resolved by a fast statistical sim (3.3).

### 3.1 Offer generation (end of season / windows)
For each window and each team with an open seat (or a seat expiring), build a candidate list from drivers whose contracts allow; for the player, create an Offer if score >= threshold, shown with reasons.

```
fit(driver, team) = 
  w1 * perfScore      // recent results vs series field, normalised (last 2 seasons, weighted 0.6/0.4)
+ w2 * repScore       // driver.reputation + regionRep[team.region] vs team.reputation
+ w3 * regionScore    // 1 same region, 0.6 neighbouring, 0.25 other; home nationality bonus
+ w4 * prestigeStep   // prefers series tier = current tier +0/+1; tier+2 only with licence and top results
+ w5 * needScore      // team.needs match (age, money, nationality)
+ w6 * moneyScore     // driver.sponsorMoney vs seatPrice (pay-driver effect, larger at low tier)
- w7 * conductPenalty // low conduct
- w8 * contractLockPenalty
+ jitter(seed)        // small deterministic noise
```
- Suggested starting weights: perf 0.30, rep 0.20, region 0.15, prestigeStep 0.10, need 0.10, money 0.15 at tier<=2 (0.05 at tier>=4), conduct up to -0.2. Weights per tier in `tuning.json`.
- Eligibility hard gates: licenceRequired, minimum age for series, discipline licence, car class availability, region lock (entry series only offered in or near the driver's region; "away" series need money).
- Region probability: P(series offered) scaled by 1.0 same region, 0.5 neighbour, 0.15 other, so an unknown driver in region X starts mostly with local entry series.
- Team's offer terms: salary or seatPrice from team budget and driver value; contract length 1 year (low tier), 1-3 (mid), 2-3 (top); targets from team expectation vs driver ranking, with a fairness cap (avoid F1 24 pitfall: target should be reachable by ~60 % of the time for a car that is average).
- Output at most ~5 offers per window, sorted, always including a "stay" option and a "free agent/pay" fallback so the player never dead-ends. Show reasons ("Your results", "local market", "team needs a paying driver").
- Negotiation (later): player can counter on length, salary/price, target, clause; team responds accept/counter/reject with a readable reason (MM and FM pitfalls). Rival offers expire at window end.
- Pay-to-play: if no performance offers, the player can buy seats with money earned (prize money plus sponsor).

### 3.2 Reputation
- Updated after each event: expected finish (from car rank and driver rank) vs actual; delta = k * (expected - actual) + bonus for win/podium + conduct penalty; decays toward baseline 2 % per season if inactive; regionRep gains faster than global; moving series scales delta by prestige.
- Championship title: large step; transfer from series to series raises global rep only if results meet an expectation.
- Reputation drives: offer scores, sponsors, team trust (R&D motivation), media tone.

### 3.3 AI driver progression between seasons
- Age curve: potential-driven growth until ~24-26, plateau, slow decline from ~34; retirement probability rises after 35 or after 2 bad seasons. Each season: `rating += growth(age, potential) + noise(seed) + experience bonus`.
- Teams: car performance drifts with budget, previous results and a regulation reset every ~4 seasons for a series (generic "new rules" event shuffling the order).
- Career flow: top performers of a series with licence go up (replaced by promoted juniors); bottom drivers drop or retire; new rookies enter entry series each year (pool refilled from nationalities, weighted by regional population).
- Off-screen series are simulated by an event result generator: per race, performance = carPerf + driverPace + noise; DNFs from reliability; points awarded; cost O(drivers x events) per season, trivial. Only the player's series runs real physics races (or "sim race" option to auto-resolve).

### 3.4 Rivalry tracking
- Record per pair of drivers who race in the same series: head-to-head finishes, contacts (collision events from damage pipeline: who was at fault by closing speed/angle heuristics), position swaps in the last laps, shared championship fights, ex-teammate status, nationality pride.
- `heat` += weighted events; decays slowly. When heat > threshold, label RIVAL, show in news and the pre-race screen; AI aggression toward the rival slightly raised (small, deterministic).
- Teammate rivalry: auto-created with the teammate; qualifying and race head-to-head counters per season; contracts can carry `beatTeammate` targets.

### 3.5 Storyline triggers (emergent first, scripted later)
Emergent beats from rule templates evaluated at window/event boundaries (data, not code):
- `titleFight` (gap <= 1 race win in last 3 rounds), `comeback`, `rookieSensation`, `veteranRetires`, `teamCollapse` (budget < 0), `pushedOut` (pay driver replaced), `feud` (heat), `homeRace` (nationality), `promotionOffer` (tier jump), `rivalPoached`, `teammateBetter`.
- Each beat: id, trigger condition, cool-down, cast (names from the world), news text template (fictional names), optional effect (reputation, offer injected, rivalry heat).
- Scripted story arcs (small, optional, per region) later: 3-5 beats each, stat-gated; skip the cutscene approach criticised in GRID Legends.
- News feed: simple text log per week; the cheapest high-impact feature for the "living world" feel.

## 4. Phasing (smallest slice first)

| Phase | Adds | Depends on |
|---|---|---|
| C0 Weekend core (this is the planned M3.1) | `WeekendFormat`, practice + qualifying sessions (grid by best lap), classification with penalties, points tables, standings (drivers + teams) for a single event | AI opponents (done), classification (done), quick race menu/results (pending), race game |
| C1 Single series season | One fictional entry series (open-wheel F4-like), calendar of 6 events on existing tracks, AI grid of 12-20 fixed drivers/teams, season standings, results screen, save/load, resume mid-season | C0; save module; profile |
| C2 Season loop + contracts | Season rollover, player contract (1 team, car performance gap by team), end-of-season offers from teams in the same series (3-5), basic AI progression and retirement, reputation | C1 |
| C3 Ladder | 3 open-wheel tiers (entry, mid, top) in 1 region, licence points, promotion offers, regional rep, pay-driver money and sponsor | C2; car classes (F4/F3-like/F2-like) in roster |
| C4 Multi-region world | Series by region (F4-like per region), nationality start choice, offers weighted by region proximity, off-screen series sim, world news, rivalry tracking | C3 |
| C5 Disciplines | GT (sprint), electric open-wheel, endurance weekends (long races, driver swaps, multi-class), stock/indy/touring later | Pit stops + strategy (M2.2), weather (pending), damage effects (M2.4), car roster; endurance also needs time-scaled race and AI multi-class traffic |
| C6 Story layer | Storyline templates, feuds, press, scripted regional arcs, contract negotiation UI with clauses | C4; replays (for highlight clips, optional) |
| C7 Team/car development | R&D points as capped CarSpec multipliers (PRD §14), team budget interplay | C2; setup system; car development spec |
| C8 Polish/online hook | Career export/import file, seed share ("challenge seeds"), leaderboard tie-in | Phase 4 |

Minimum useful playable slice = C1: 6 races, points, standings, save. C2 gives the "contract offers" hook, which is the core promise; C3/C4 deliver the open-world promise.

Dependency risks:
- Practice/qualifying sessions do not exist yet: C0 must create them (or use a flying-lap time-trial against ghost).
- AI difficulty by team: need `carPerf` scalar mapping to AI target pace (existing "difficulty orders pace" work) and to physics car grip/power multipliers (capped like R&D multipliers).
- Weather and damage are optional for C1-C4: format data should already hold weather profile and penalty rules, with no-ops until the features land.
- Replays: not required; later "season highlights" can reuse the recorder.

## 5. Save system and determinism

### 5.1 Storage
- `localStorage` is about 5 MiB per origin, strings only, synchronous, no workers ([MDN via P. Brosset](https://patrickbrosset.com/articles/2023-01-17-web-storage/), [Mozilla support](https://support.mozilla.org/uk/questions/818987)); IndexedDB is limited by disk share per origin and varies by browser, Safari/iOS tighter ([rxdb note](https://rxdb.info/articles/indexeddb-max-storage-limit.html); sources conflict on exact quotas, verify against MDN before relying).
- Size estimate (JSON): driver ~600 B x 2000 drivers = 1.2 MB; teams/series negligible; per-event results for the player's series: 20 cars x 25 events x ~200 B = 100 kB/season; off-screen series store only standings and summary (not per-race detail) = ~10 kB/series/season; 10 seasons of history compact: ~3-6 MB. Over the 5 MiB localStorage limit in a long career.
- Decision proposal: use IndexedDB (single object store `career`, key = save slot) for the world and history; keep a tiny index/meta in localStorage (slot names, last played). Compress (CompressionStream gzip) when available. Trim policy: keep full detail for the last 2 seasons of the player's series; older seasons keep only standings, titles, rep and contract history.
- Quota safety: call `navigator.storage.persist()` and `estimate()` on first save; warn at 80 %; manual export/import of the save as a JSON file (also protects against browser eviction and enables the Phase 4 transfer).
- Schema versioning: `{ version, world, ... }`, migrations as pure functions `migrate(vN) -> vN+1`; never delete unknown fields; keep a backup of the previous autosave (2 slots rotating) to survive a crash during write. Write atomically (single IndexedDB transaction).
- Autosave at: end of session, between events, after offers decisions. Never mid-race (resume = restart the weekend session).

### 5.2 Determinism
- All world sim consumes seeded PRNG streams derived by hashing `(worldSeed, year, seriesId, eventIdx, purpose)`, so any single event is reproducible independent of simulation order (avoid one global stream: order changes would desync saves between versions).
- Real physics races are deterministic given inputs (fixed-step 1/120 s, seeded AI), but not across versions or floating-point platforms; so the stored race result is the source of truth: save the outcome, not the re-run.
- Off-screen series use pure integer/float arithmetic with the same code on all clients; avoid `Date.now()` and `Math.random()` (lint rule); iterate maps in stable id order; use sorted arrays for tie-breaks (id as final tie-breaker).
- Tuning data (weights, tables) are part of a versioned `rulesVersion` saved in the world so old saves keep their points tables; new versions apply from next season.
- Exploit mitigation: reload-scumming of results is possible offline; accept it (budget 0, single-player), but keep the seed stable per event so a reload gives the same off-screen results and the same weather forecast.
- Testing: golden tests for a 3-season sim from a seed (final standings hash), property tests (points sum, unique seats, no driver in two seats, contracts valid), and save/load round trips with migration fixtures.

## 6. Open questions for the planner

1. Currency and economy depth: only reputation + cash for seats (C3), or full team budgets (C7)?
2. Player can own a team (Motorsport Manager style) or driver-only? Proposal: driver-only first.
3. Auto-resolve ("sim race") for events the player skips: yes, uses the off-screen model.
4. Name generator: lists of fictional names by nationality (data file with licence), and no real driver names; check licence for any name dataset.
5. Which entry region first (user's own: Mexico, so a Latin-America F4-like series and Ermita circuit as flagship local event).
