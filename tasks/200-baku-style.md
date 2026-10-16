# 200 — Baku style data (`baku.style.json`)

Status: pending
Phase: 1
Depends on: 181, 182, 183, 184, 185, 186, 187, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
## Goal
Create `public/tracks/baku.style.json` (schema: `docs/design/track-style.md`) from `docs/research/tracks/baku-visual.md` (photos in `.ai/refs/baku/`, viewable). Data only: no `src/` or `tools/` changes; if the renderer cannot express something, stop and escalate. Colours from photos/doc; no brand or sponsor text anywhere (including `marina`, `sphere`-style landmark names).
## Context

Colour cap: every channel <= `#dadada` (179 AT21), so the parser raises no warning. Colour predicates and the shared helpers are in `docs/design/track-style.md` and `tests/unit/acceptance/helpers/` (179, 188). Offsets are measured from the track edge.

## Files
- `public/tracks/baku.style.json` — create (`"version": 1`)
- `tests/unit/acceptance/200-baku-style.test.ts` — create (acceptance worker); reuses `helpers/colour.ts` and `helpers/brands.ts`
## Steps
Use `npm run track:locate -- baku <lat> <lon>` (task 181) for centerline indices from the doc's lat/lon and turns. Encode (values are the target; adjust only to meet the table):
1. `palette`: asphalt dark brown-grey `#4d4a47`, grass `#5a9a3a`, gravel `#cdb89a`; `edgeLines` white.
2. `kerbs`: colors `#c8312b`/`#dadada`, outerStrip `#dac200`.
3. `runoffPaint`: pattern `none` by default; 2 `bands` ranges (T1-T3 area and T17-T20 area, each < 40 % of lap) with colors `#58d23a`, `#d0432d`, stripeMeters 3.
4. `barriers`: concrete `#d8cdb0` with bandColor `#dac200`; armco `#8a8f93`; fence heightMeters 4.5, types `armco`,`wall`, color `#8a8f93`.
5. `pitBuilding` (pits left, ~300 m): storeys 2, heightMeters 9, depthMeters 15, facade `#dadada`, roof `#d9d9d9`, doors `#2a2a2c`, accent `#1f5a3a`, roofStyle `canopy`, glazing 0.3.
6. `grandstands`: structure `#b5b8bb`, roof `#dab030`, seats `#1f5a8f`,`#c8312b`,`#dadada`, roofStyle `flat`; 1 `extraGrandstands` entry on the pit straight, side opposite the pits, 12 rows.
7. `props`: `[]`. No `sky` key.
## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| C6 | `npm run -s check:styles` | run | exit 0 |
| S1 | `baku.style.json` | parsed | runoffPaint colours include isGreen and isRed. |
| S2 | `baku.style.json` | parsed | fence heightMeters 4-5, types include 'wall'. |
| S3 | `baku.style.json` | parsed | pitBuilding facade isWhite or isLight. |
| S4 | `baku.style.json` | parsed | palette.asphalt isDark |
## Acceptance criteria
- [ ] All table rows pass; `npm run -s check:styles` exits 0; only the files listed above changed.
## Verification
```
npm run typecheck
npm run lint
npm test
npm run -s check:styles
```
## Out of scope
- Landmarks (160), city buildings (157-159), night lighting (floodlights are poles only; sky stays a day HDRI), any `src/`/`tools/` change, other circuits.
