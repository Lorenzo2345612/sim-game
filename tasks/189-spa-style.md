# 189 — Spa track style data

Status: pending
Phase: 1
Depends on: 181, 182, 183, 184, 185, 186, 187, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/spa.style.json` encodes the look of Spa-Francorchamps (Ardennes) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/spa-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/spa/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- spa <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/spa.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them.

## Files

- `public/tracks/spa.style.json` — create — the style file.
- `tests/unit/acceptance/189-spa-style.test.ts` — create (acceptance role) — rows below.

## Steps

Encode, with every value picked from the research doc and photos:

1. Run-off paint ranges `stripes` at Eau Rouge/Raidillon (T2-T4, ~50.4398, 5.9703) with red `#C84B4B`, yellow `#DAC020` and black; green `#2FBF8A` apron at La Source (~50.4455, 5.9663).
2. Kerbs red/white; `outerStrip` green `#2FB59A`.
3. Barriers: armco grey, tyre walls with red/white blocks at Bus Stop, white concrete; `fence` tall green chain-link `#3F6B3A`, 4-5 m.
4. Pit building (~50.4440, 5.9680): 2 storeys, ~10 m, facade grey, white/silver roof, glazing ~0.3.
5. Grandstands: blue seats, white roof, `extraGrandstands` at Raidillon exit and La Source.
6. Props: orange `marshalPost` at Bus Stop; <= 10 props.
7. Palette: asphalt `#3B3B3E`, grass `#6A9A3A`.
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
| S1 | `public/tracks/spa.style.json` | parsed | a runoffPaint range with stripes whose colors include isRed, isYellow and a dark (black) colour |
| S2 | `public/tracks/spa.style.json` | parsed | fence color isGreen |
| S3 | `public/tracks/spa.style.json` | parsed | grandstands.seats include isBlue |
| S4 | `public/tracks/spa.style.json` | parsed | pitBuilding storeys 2, facade isGrey |
| S5 | `public/tracks/spa.style.json` | parsed | sky.hdri `kloofendal_overcast_puresky` |

## Acceptance criteria

- [ ] `public/tracks/spa.style.json` exists and every row above passes.
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
