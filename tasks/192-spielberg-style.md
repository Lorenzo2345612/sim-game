# 192 — Spielberg track style data

Status: pending
Phase: 1
Depends on: 181, 182, 183, 184, 185, 186, 187, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`public/tracks/spielberg.style.json` encodes the look of Spielberg (Alpine hillside) so the renderer shows its signature features (design `docs/design/track-style.md`).

## Context

Data only. Schema, limits and defaults: `docs/design/track-style.md` (colours `#rrggbb`, every channel <= 0xda or the parser warns; unknown keys are warnings, which fail `check:styles`). Source: `docs/research/tracks/spielberg-visual.md` (Top 10 and per-turn table); photos in `.ai/refs/spielberg/` may be viewed to pick hex values. Get centerline indices with `npm run track:locate -- spielberg <lat> <lon>` (use the doc's landmark coordinates; for turns, locate the turn's lat/lon or step along `public/tracks/spielberg.json`). Wrap-around ranges are allowed but each range covers <= 40 % of the lap. No brand or sponsor text anywhere in the file. `tests/unit/acceptance/helpers/colour.ts` (179) and `brands.ts` (188) are shared helpers; the acceptance worker reuses them.

## Files

- `public/tracks/spielberg.style.json` — create — the style file.
- `tests/unit/acceptance/192-spielberg-style.test.ts` — create (acceptance role) — rows below.

## Steps

Encode, with every value picked from the research doc and photos:

1. Run-off paint range `stripes` at T1 with red `#C8312C` and white; green `#2F8F5B` strip via kerbs.
2. Kerbs red/white; `outerStrip` green `#2F8F5B`; kerb range at T10 with red/white/green look (colours red and white, strip green).
3. Pit building (~47.2190, 14.7600): 2-3 storeys, ~11 m, facade anthracite grey `#4B4E52`, white trim, glazing >= 0.4, red accent.
4. Grandstands: red/white seats; >= 2 `extraGrandstands` on T1/T2 and T3 hillsides plus one grey-roofed at T6-T7.
5. Barriers: silver armco, white-wrapped tyres, curved concrete; `fence` 3-4 m green `#4F6B3A`.
6. Palette: asphalt `#424245`, grass `#6FA23A`, gravel `#D5C7A2`.
7. Sky: leave `hdri` unset. Do not model the bull sculpture.

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
| S1 | `public/tracks/spielberg.style.json` | parsed | a runoffPaint range with isRed and isWhite stripes (T1) |
| S2 | `public/tracks/spielberg.style.json` | parsed | kerbs.outerStrip or a kerb range isGreen |
| S3 | `public/tracks/spielberg.style.json` | parsed | pitBuilding glazing ≥ 0.4, facade isGrey |
| S4 | `public/tracks/spielberg.style.json` | parsed | extraGrandstands ≥ 2 |

## Acceptance criteria

- [ ] `public/tracks/spielberg.style.json` exists and every row above passes.
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
