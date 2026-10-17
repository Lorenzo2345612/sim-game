# 202 — Las Vegas style data (`lasvegas.style.json`)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
## Goal
Create `public/tracks/lasvegas.style.json` (schema: `docs/design/track-style.md`) from `docs/research/tracks/lasvegas-visual.md` (photos in `.ai/refs/lasvegas/`, viewable). Data only: no `src/` or `tools/` changes; if the renderer cannot express something, stop and escalate. Colours from photos/doc; no brand or sponsor text anywhere (including `marina`, `sphere`-style landmark names).
## Context

Colour cap: every channel <= `#dadada` (179 AT21), so the parser raises no warning. Colour predicates and the shared helpers are in `docs/design/track-style.md` and `tests/unit/acceptance/helpers/` (179, 188). Offsets are measured from the track edge.

## Files
- `public/tracks/lasvegas.style.json` — create (`"version": 1`)
- `tests/unit/acceptance/202-lasvegas-style.test.ts` — create (acceptance worker); reuses `helpers/colour.ts` and `helpers/brands.ts`
## Steps
Use `npm run track:locate -- lasvegas <lat> <lon>` (task 181) for centerline indices from the doc's lat/lon and turns. Encode (values are the target; adjust only to meet the table):
1. `palette`: asphalt `#3a3c40`, grass `#b9a284`, gravel `#b9a284`; `edgeLines` color `#4a78c8`; `kerbs` colors `#cf2a2a`/`#dadada`.
2. `floodlights`: style `arm`, heightMeters 9, heads 1, spacingMeters 30, offsetMeters 6, side `both`, whole lap.
3. `barriers`: concrete `#cfcfce` with bandColor `#2f9e5a`; armco `#8e9093`; fence heightMeters 4.5, types `armco`,`wall`, color `#8f949a`.
4. `pitBuilding` (pits left): storeys 4, heightMeters 20, depthMeters 25, facade `#2b2d30`, roof `#3a3c40`, doors `#1c1c1e`, accent `#da3f9a`, roofStyle `folded`, glazing 0.5.
5. `grandstands`: structure `#3a3c40`, roof `#2a2c30`, seats `#dadada`,`#8e9093`, roofStyle `flat`; 1 `extraGrandstands` main stand opposite the pits.
6. `props`: 2 `footbridge` on the Strip straight, color `#9fd8da` (lit glass walls), heightMeters 7.
7. `runoffPaint`: 1 `solid` range at the pit exit with `#3fae5a`. No `sky` key.
## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| C6 | `npm run -s check:styles` | run | exit 0 |
| S1 | `lasvegas.style.json` | parsed | floodlights non-null. |
| S2 | `lasvegas.style.json` | parsed | fence heightMeters 4-5, types include 'wall'. |
| S3 | `lasvegas.style.json` | parsed | edgeLines.color isBlue. |
| S4 | `lasvegas.style.json` | parsed | pitBuilding storeys ≥ 4, facade isDark or isWhite |
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
