# 295 — Per-nationality name lists and seeded grid generator
Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal
Fictional driver grids generated from per-nationality name lists and a per-series nationality mix (data), so names depend on the championship. Reused by the race UI (296) and the future career mode (`docs/design/career.md`: names generated from `public/career/names/*.json`, series are data).

## Context
No real drivers, teams or series names; brand-neutral. Track ids come from `public/tracks/index.json`.

## Files
- `public/career/names/<NAT>.json` — create 16 files: MEX ARG BRA COL USA GBR FRA ITA ESP DEU NLD BEL JPN CHN AUS CAN. Shape `{ "nat": "MEX", "first": string[], "last": string[] }`, >= 25 unique `first` and >= 25 unique `last`, common everyday names of that country (accents allowed; Latin script only, so JPN/CHN use romanised names).
- `public/career/names/blocklist.json` — create — `string[]` of surnames: Senna, Prost, Pérez, Verstappen, Hamilton, Schumacher, Alonso, Sainz, Leclerc, Norris, Piastri, Russell, Gasly, Ocon, Hülkenberg, Stroll, Albon, Tsunoda, Zhou, Bottas, Räikkönen, Vettel, Button, Massa, Barrichello, Fittipaldi, Piquet, Rodríguez, Gutiérrez, Esteban, O'Ward, Andretti, Unser, Montoya, Castroneves, Palou, Dixon, Newgarden, Power, Webber, Ricciardo, Brabham, Clark, Stewart, Lauda, Hill, Mansell, Rosberg, Villeneuve, Häkkinen, Coulthard, Kubica, Hunter-Reay, Herta, Rossi, Grosjean, Magnussen, Bearman, Antonelli, Colapinto, Lawson, Hadjar, Bortoleto, Doohan. No list may contain these as a `last`.
- `public/career/grids.json` — create — shape below.
- `src/race/drivers.ts` — create — no DOM/three.
- `tests/unit/acceptance/295-career-names-grid-generator.test.ts` — create (acceptance worker; loads the real JSON files).

## Steps
```ts
export interface Driver { first: string; last: string; code: string; nat: string; number: number } // nat = ISO 3166 alpha-3
export interface NameList { nat: string; first: string[]; last: string[] }
export type SeriesMix = Readonly<Record<string, number>>;
export interface GridsFile { series: Record<string, { name: string; mix: SeriesMix }>; trackSeries: Record<string, string>; default: string }
export function generateGrid(count: number, seed: number, mix: SeriesMix, names: Readonly<Record<string, NameList>>): Driver[];
export function shortName(d: Driver): string; // `${first[0]}. ${last}`
export function seriesForTrack(grids: GridsFile, trackId: string): string; // series id; unknown id -> grids.default
```
1. `grids.json` series (mix weights sum to 1): `f4-latam` "Latin F4 Cup": MEX .45, ARG .12, BRA .12, COL .12, ESP .07, USA .07, FRA .01, ITA .01, GBR .01, DEU .01, CAN .01. `f4-na` "North American F4": USA .5, CAN .2, MEX .15, GBR .05, AUS .05, BRA .05. `f4-europe` "European F4 Trophy": GBR, FRA, ITA, ESP, DEU, NLD, BEL .12 each; BRA .04; AUS, JPN, CHN, USA .03 each. `f4-asia` "Asia-Pacific F4": JPN .3, CHN .3, AUS .2, GBR .05, USA .05, CAN .05, FRA .05. `f4-international` "International F4": the 16 nats at 0.0625. `default`: `f4-international`.
2. `trackSeries`: f4-latam: mexico, ermita-centro, ermita-federal, ermita-norte, ermita-mixto, ermita-poniente, ermita-veloz; f4-na: daytona, braselton, elkhart, lasvegas, fontana, fontana-roval, cleveland, detroit; f4-europe: monza, spa, silverstone, baku, budapest, spielberg; f4-asia: lusail, bahrain, sepang, singapore.
3. `generateGrid`: seeded PRNG mulberry32. Per driver: draw nationality by weighted draw over mix nats that have a list in `names` (others skipped); first and last uniformly from that list; redraw while the full name already exists.
4. Code: surname ASCII-folded (NFD, strip diacritics), letters only, uppercased; first 3 letters (pad with 'X' if shorter). On clash: first-name initial + first 2 surname letters; if still clashing: first 2 code letters + A..Z in order; then first letter + B..Z + A..Z in order.
5. Number: unique integer in [2, 99], drawn from the seeded PRNG without replacement.
6. Errors: `count` must be an integer in [0, 98], else `RangeError`; 0 returns `[]`; throw `RangeError` if no mix nat has a list. Inputs are not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | every `public/career/names/*.json` except blocklist | inspect | 16 files; `nat` equals the file name; ≥ 25 unique non-empty `first` and `last` |
| AT2 | all name lists and `blocklist.json` | compare case- and accent-insensitively | no `last` entry is in the blocklist |
| AT3 | `grids.json` | inspect | every series mix weight > 0 and sums to 1 ± 0.01; every mix nat has a name file; every id in `public/tracks/index.json` maps via `seriesForTrack` to an existing series; unknown id → `default` |
| AT4 | `generateGrid(11, 1, mix f4-latam, all lists)` twice | compare | identical; 11 drivers; unique `first + last`, unique `code` matching `/^[A-Z]{3}$/`, unique `number` in [2, 99] |
| AT5 | seed 1 vs seed 2, same args | compare | differ in at least one driver |
| AT6 | `generateGrid(98, s, mix f4-latam, lists)` for s = 1…20 (1960 drivers) | count nats | MEX share in [0.40, 0.50]; every driver's `nat` has weight > 0 in the mix |
| AT7 | mix `{ MEX: 1 }` with only `ARG` and `MEX` lists | `generateGrid(5, 3, …)` | all 5 `nat === 'MEX'`, names from the MEX list |
| AT8 | count 99, −1, 2.5; count 0 | call | first three throw `RangeError`; 0 → `[]` |
| AT9 | `{first: 'Diego', last: 'Ruiz', …}`; surname `'Núñez'` | `shortName`; code | `'D. Ruiz'`; code `'NUN'` |

## Acceptance criteria
- [ ] All AT rows pass.
- [ ] No real racing driver surname in any list (blocklist test) and no real series/team names in `grids.json`.

## Verification
```
npm run typecheck
npm run lint
npm test
```

## Out of scope
- UI wiring (task 296), team names, player name, career persistence, nationality flags, livery numbers.
