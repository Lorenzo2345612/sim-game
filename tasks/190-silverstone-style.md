# 190 — Silverstone track style data

Status: pending
Phase: 1
Depends on: 181, 182, 183, 184, 185, 186, 187, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/silverstone.style.json` encodes the look of Silverstone (flat airfield) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/silverstone-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/silverstone/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- silverstone <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/silverstone.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them.

## Files

- `public/tracks/silverstone.style.json` — create — the style file.
- `tests/unit/acceptance/190-silverstone-style.test.ts` — create (acceptance role) — rows below.

## Steps

Encode, with every value picked from the research doc and photos:

1. Pit building "Wing" (left of straight, ~52.0720, -1.0155): 3 storeys, ~18 m, `roofStyle` `folded`, anthracite facade, red accent, dark doors, glazing ~0.5.
2. Kerbs red/white; `outerStrip` green `#2EA06A` along Abbey/Village.
3. Barriers: `tyres.beltColor` orange `#DA702A`, white concrete walls, armco; `fence` 3-4 m grey.
4. Run-off paint: default `none`; optional red `stripes` range under barriers.
5. Grandstands: white roof, blue seats, `roofStyle` `sail`; `extraGrandstands` at Copse/Woodcote and opposite pits.
6. Props: >= 2 `footbridge` over the pit straight and Wellington; 1 `scoreboard` at Luffield (~T7).
7. Palette: asphalt `#4A4A4D`, grass `#6DA03A`, gravel `#7A6C5A`.
8. Sky: `hdri` `kloofendal_overcast_puresky`.

No `src/` or `tools/` changes. If the renderer cannot express something, stop and escalate; do not code around it. Keep the file small: at most the ranges and props listed above.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| C6 | `npm run -s check:styles` | run | exit 0 |
| S1 | `public/tracks/silverstone.style.json` | parsed | pitBuilding roofStyle 'folded', accent isRed, doors isDark |
| S2 | `public/tracks/silverstone.style.json` | parsed | grandstands.roof isWhite, seats include isBlue |
| S3 | `public/tracks/silverstone.style.json` | parsed | a tyres beltColor isOrange or isRed |
| S4 | `public/tracks/silverstone.style.json` | parsed | ≥ 2 footbridge props |
| S5 | `public/tracks/silverstone.style.json` | parsed | sky.hdri overcast |

## Acceptance criteria

- [ ] `public/tracks/silverstone.style.json` exists and every row above passes.
- [ ] `git diff --stat` shows no file under `src/` or `tools/`.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run -s check:styles
```

## Out of scope

- Any change in `src/`, `tools/`, other tracks' files, tasks.json or docs.
- Vegetation, buildings, landmarks, banking, night lighting (see design doc).
