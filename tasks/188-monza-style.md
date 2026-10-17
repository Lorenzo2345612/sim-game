# 188 — Monza track style data

Status: pending
Phase: 1
Depends on: 181
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/monza.style.json` encodes the look of Monza (Parco di Monza, flat) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/monza-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/monza/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- monza <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/monza.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them. Task 188 (acceptance role) also creates `tests/unit/acceptance/helpers/brands.ts` with the deny list of row C5.

## Files

- `public/tracks/monza.style.json` — create — the style file.
- `tests/unit/acceptance/188-monza-style.test.ts` — create (acceptance role) — rows below.
- `tests/unit/acceptance/helpers/brands.ts` — create (acceptance role) — exported deny list for C5.

## Steps

Encode, with every value picked from the research doc and photos:

1. Pit building (right of straight, ~45.6190, 9.2810): 3 storeys, ~15 m high, glazing >= 0.3, cream tent roof (`roofStyle` `canopy`), grey shutter doors.
2. Kerbs red/white (`#C8201E`/`#DADADA`); `outerStrip` green `#1F9A6A`.
3. `runoffPaint`: default `none`; >= 2 ranges `stripes`/`bands` at Rettifilo (T1-T2) and Ascari/Parabolica using green `#1F9A6A`, red `#C8452E`, white.
4. Props: green footbridge over the start straight (index near start line); >= 4 orange `marshalPost` props at chicanes.
5. Barriers: armco grey-white, tyres, concrete; `fence` 4-5 m grey; a green-painted concrete wall range at Ascari exit.
6. Palette: asphalt `#3A3A3C`, grass `#6E8B3D`, gravel `#CFC4A8` (light beige).
7. Grandstands: cream structure, grey seats, `roofStyle` `truss`; add `extraGrandstands` opposite pits and at Rettifilo outside.
8. Sky: leave `hdri` unset.

No `src/` or `tools/` changes. If the renderer cannot express something, stop and escalate; do not code around it. Keep the file small: at most the ranges and props listed above.

## Reopened

`public/tracks/monza.style.json` is already on master (first pass closed without tests). This pass: acceptance writes `tests/unit/acceptance/188-monza-style.test.ts` and `helpers/brands.ts`; coder only fixes the style file if a row fails.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| AT2 C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| AT3 C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| AT4 C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| AT5 C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| AT6 C6 | `npm run -s check:styles` | run | exit 0 |
| AT7 S1 | `public/tracks/monza.style.json` | parsed | kerbs.colors has one isRed and one isWhite |
| AT8 S2 | `public/tracks/monza.style.json` | parsed | runoffPaint has ≥ 2 ranges, one with an isGreen colour |
| AT9 S3 | `public/tracks/monza.style.json` | parsed | props include a footbridge with an isGreen colour |
| AT10 S4 | `public/tracks/monza.style.json` | parsed | pitBuilding storeys ≥ 3, glazing ≥ 0.3, roof isCream |
| AT11 S5 | `public/tracks/monza.style.json` | parsed | ≥ 4 marshalPost props with isOrange colour |
| AT12 S6 | `public/tracks/monza.style.json` | parsed | palette.gravel isCream or isLight |

## Acceptance criteria

- [ ] `public/tracks/monza.style.json` exists and every row above passes.
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
