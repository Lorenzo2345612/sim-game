# 191 — Budapest track style data

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/budapest.style.json` encodes the look of Hungaroring (dry bowl) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/budapest-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/budapest/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- budapest <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/budapest.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them.

## Files

- `public/tracks/budapest.style.json` — create — the style file.
- `tests/unit/acceptance/191-budapest-style.test.ts` — create (acceptance role) — rows below.

## Steps

Encode, with every value picked from the research doc and photos:

1. Palette: grass dry yellow-green `#8A9A4A` (saturation <= 0.45), gravel `#C2AE80`, asphalt `#4A4A4D`.
2. Kerbs red `#C8312C`/white; `outerStrip` green `#2E7D4F`; one kerb range at T6-T9 (~Driving Center chicane) with orange `#DA7A2A` and white colours.
3. Pit building (~47.5813, 19.2487): 2 storeys, ~9 m, white/light facade, glazing >= 0.2, flat roof, green accents.
4. Grandstands: blue seats, `roofStyle` `truss`, grey roof; `extraGrandstands` at T1 outside and T4-T6 hillside.
5. Barriers: silver armco, tyres `beltColor` blue-green `#3FA9A0`, `fence` ~4 m green-grey.
6. Props: orange `marshalPost` at T12; <= 6 props.
7. Sky: leave `hdri` unset.

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
| S1 | `public/tracks/budapest.style.json` | parsed | kerbs.outerStrip isGreen |
| S2 | `public/tracks/budapest.style.json` | parsed | kerb range with an isOrange colour (T6-T9) |
| S3 | `public/tracks/budapest.style.json` | parsed | palette.grass not isGreen-saturated: s ≤ 0.45 |
| S4 | `public/tracks/budapest.style.json` | parsed | pitBuilding glazing ≥ 0.2, facade isWhite or isLight |
| S5 | `public/tracks/budapest.style.json` | parsed | grandstands.seats include isBlue |

## Acceptance criteria

- [ ] `public/tracks/budapest.style.json` exists and every row above passes.
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
