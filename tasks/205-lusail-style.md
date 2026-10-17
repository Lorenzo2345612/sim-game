# 205 — Lusail style data (`lusail.style.json`)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
## Goal
Create `public/tracks/lusail.style.json` (schema: `docs/design/track-style.md`) from `docs/research/tracks/lusail-visual.md` (photos in `.ai/refs/lusail/`, viewable). Data only: no `src/` or `tools/` changes; if the renderer cannot express something, stop and escalate. Colours from photos/doc; no brand or sponsor text anywhere (including `marina`, `sphere`-style landmark names).
## Context

Colour cap: every channel <= `#dadada` (179 AT21), so the parser raises no warning. Colour predicates and the shared helpers are in `docs/design/track-style.md` and `tests/unit/acceptance/helpers/` (179, 188). Offsets are measured from the track edge.

## Files
- `public/tracks/lusail.style.json` — create (`"version": 1`)
- `tests/unit/acceptance/205-lusail-style.test.ts` — create (acceptance worker); reuses `helpers/colour.ts` and `helpers/brands.ts`
## Steps
Use `npm run track:locate -- lusail <lat> <lon>` (task 181) for centerline indices from the doc's lat/lon and turns. Encode (values are the target; adjust only to meet the table):
1. `palette`: asphalt `#4a4c4e`, grass `#cdb892` (sand), gravel `#c9b38a`; `kerbs` colors `#c8352f`/`#dadada`.
2. `runoffPaint`: pattern `none`; 3 `solid` ranges: T1/T4 orange `#da731f`, T10/T12 blue `#1f5fbf`, T16 maroon `#7a1f2f` (use track:locate).
3. `floodlights`: style `mast`, heightMeters 28, heads 6, spacingMeters 50, offsetMeters 10, side `both`, whole lap.
4. `barriers`: fence color `#2f7f6a`, heightMeters 4.5, types `armco`,`wall`; concrete `#dadada`, bandColor `#2a2a2c`; armco `#9aa0a6`.
5. `pitBuilding` (~400 m): storeys 2, heightMeters 10, depthMeters 18, facade `#dadada`, roof `#dadada`, doors `#2a2a2c`, accent `#7a1f2f`, roofStyle `folded`, glazing 0.3.
6. `grandstands`: structure `#c0c4c8`, roof `#dadada`, seats `#7a1f2f`,`#dadada`, roofStyle `truss`; 1 `extraGrandstands` main stand on the straight.
7. `props`: 3 `tent` props, color `#dadada`, paddock side. No `sky` key.
## Time budget (planner, after MiMo timeouts)

- Sources are only the spec, `docs/design/track-style.md`, `docs/research/tracks/<id>-visual.md`, the track json, an existing `*.style.json` as template and `npm run track:locate`. No web search, no WebFetch, no Overpass/OSM queries, no EXIF or photo analysis.
- Write the style json within your first 15 tool calls, then run the task tests and iterate. Where the research note is vague, choose plausible values that satisfy the acceptance table.

## Shared brand helper

`tests/unit/acceptance/helpers/brands.ts` is not on master (188 closed without it). If it is missing in your worktree, the acceptance worker creates it with exactly this content (byte-identical across style tasks so merges are clean; trailing newline, nothing else):

```ts
export const BRAND_DENY_LIST: readonly string[] = [
  'Pirelli', 'Rolex', 'Heineken', 'DHL', 'Aramco', 'Emirates', 'Petronas', 'Shell', 'Red Bull', 'Ferrari',
  'Mercedes', 'Gulf Air', 'Etihad', 'Qatar Airways', 'Crypto', 'Singtel', 'Marina Bay Sands', 'Sphere',
  'Formula 1', 'Indy', 'NASCAR',
];
```

## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| AT2 C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| AT3 C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| AT4 C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| AT5 C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| AT6 C6 | `npm run -s check:styles` | run | exit 0 |
| AT7 S1 | `lusail.style.json` | parsed | floodlights non-null, style 'mast', heightMeters 25-30, heads ≥ 4. |
| AT8 S2 | `lusail.style.json` | parsed | fence color isTeal or isGreen. |
| AT9 S3 | `lusail.style.json` | parsed | runoffPaint ranges with isOrange, isBlue and a maroon (isRed with l ≤ 0.35) colour. |
| AT10 S4 | `lusail.style.json` | parsed | pitBuilding storeys 2. |
| AT11 S5 | `lusail.style.json` | parsed | palette.grass isCream (sand) |
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
