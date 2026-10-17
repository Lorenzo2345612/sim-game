# 201 — Singapore style data (`singapore.style.json`)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
## Goal
Create `public/tracks/singapore.style.json` (schema: `docs/design/track-style.md`) from `docs/research/tracks/singapore-visual.md` (photos in `.ai/refs/singapore/`, viewable). Data only: no `src/` or `tools/` changes; if the renderer cannot express something, stop and escalate. Colours from photos/doc; no brand or sponsor text anywhere (including `marina`, `sphere`-style landmark names).
## Context

Colour cap: every channel <= `#dadada` (179 AT21), so the parser raises no warning. Colour predicates and the shared helpers are in `docs/design/track-style.md` and `tests/unit/acceptance/helpers/` (179, 188). Offsets are measured from the track edge.

## Files
- `public/tracks/singapore.style.json` — create (`"version": 1`)
- `tests/unit/acceptance/201-singapore-style.test.ts` — create (acceptance worker); reuses `helpers/colour.ts` and `helpers/brands.ts`
## Steps
Use `npm run track:locate -- singapore <lat> <lon>` (task 181) for centerline indices from the doc's lat/lon and turns. Encode (values are the target; adjust only to meet the table):
1. `palette`: asphalt `#3a3b3d`, grass `#5a8a4a`, gravel `#9a9ea2`; `kerbs` colors `#cf2a2a`/`#dadada`.
2. `floodlights`: style `arm`, heightMeters 8, heads 2, spacingMeters 20, offsetMeters 6, side `both`, whole lap.
3. `barriers`: concrete `#dadada` with bandColor `#dac000`; armco `#b8babb`; fence heightMeters 4.5, types `armco`,`wall`, color `#9aa0a6`.
4. `runoffPaint`: 2 `stripes` ranges: T1 area blue `#1f3f93` + yellow `#dac500`; T18-T19 green `#3f9a4c` + white `#dadada`; stripeMeters 3.
5. `pitBuilding` (pits left, ~350 m): storeys 3, heightMeters 16, depthMeters 20, facade `#dadada`, roof `#5aa092`, doors `#3a3a3c`, accent `#dac000`, roofStyle `curved`, glazing 0.4.
6. `grandstands`: structure `#8d9195`, roof `#d0d4d6`, seats `#2f6fc2`,`#dab800`, roofStyle `truss`; 2 `extraGrandstands` (Padang and Raffles Ave areas, found with track:locate).
7. `props`: `[]`. No `sky` key (day HDRI).
## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| AT2 C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| AT3 C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| AT4 C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| AT5 C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| AT6 C6 | `npm run -s check:styles` | run | exit 0 |
| AT7 S1 | `singapore.style.json` | parsed | floodlights non-null, style 'arm', heightMeters 6-9, spacingMeters 15-25. |
| AT8 S2 | `singapore.style.json` | parsed | fence heightMeters 4-5, types include 'wall'. |
| AT9 S3 | `singapore.style.json` | parsed | barriers.concrete.bandColor isYellow, color isWhite. |
| AT10 S4 | `singapore.style.json` | parsed | pitBuilding roofStyle 'curved', roof isTeal or isGreen. |
| AT11 S5 | `singapore.style.json` | parsed | grandstands.seats include isBlue and isYellow |
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
