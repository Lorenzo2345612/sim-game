# 193 — Mexico City track style data

Status: pending
Phase: 1
Depends on: 181, 182, 183, 184, 185, 186, 187, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/mexico.style.json` encodes the look of Autodromo Hermanos Rodriguez (flat park) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/mexico-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/mexico/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- mexico <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/mexico.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them.

## Files

- `public/tracks/mexico.style.json` — create — the style file.
- `tests/unit/acceptance/193-mexico-style.test.ts` — create (acceptance role) — rows below.

## Steps

Encode, with every value picked from the research doc and photos:

1. Kerbs red/white; `outerStrip` green `#2FA060`.
2. Run-off paint: `stripes` range red/white at T1-T3 and Foro Sol section (T13-T15); default `none`.
3. Barriers: `concrete.color` green `#3E8E4E` (wrapped walls), tyres, `fence` 4-5 m grey.
4. Pit building (~19.4065, -99.0895): 3 storeys, ~14 m, light grey facade, yellow `#DAC020` accent band, glazing ~0.4, white doors, flat roof.
5. Grandstands: structure grey-silver, dark roof, `roofStyle` `truss`; `extraGrandstands` at T1 and Foro Sol (T13-T15, both sides).
6. Palette: asphalt `#3E3E42`, grass `#6FA83A`.
7. Props: <= 6 (e.g. `footbridge` over the straight, `tent` behind pits).

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
| S1 | `public/tracks/mexico.style.json` | parsed | kerbs.outerStrip isGreen |
| S2 | `public/tracks/mexico.style.json` | parsed | runoffPaint stripes isRed + isWhite |
| S3 | `public/tracks/mexico.style.json` | parsed | barriers.concrete.color isGreen (green-wrapped walls) |
| S4 | `public/tracks/mexico.style.json` | parsed | pitBuilding storeys 3, accent isYellow |
| S5 | `public/tracks/mexico.style.json` | parsed | grandstands.roofStyle 'truss', roof isDark |

## Acceptance criteria

- [ ] `public/tracks/mexico.style.json` exists and every row above passes.
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
