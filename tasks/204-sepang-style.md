# 204 — Sepang style data (`sepang.style.json`)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
## Goal
Create `public/tracks/sepang.style.json` (schema: `docs/design/track-style.md`) from `docs/research/tracks/sepang-visual.md` (photos in `.ai/refs/sepang/`, viewable). Data only: no `src/` or `tools/` changes; if the renderer cannot express something, stop and escalate. Colours from photos/doc; no brand or sponsor text anywhere (including `marina`, `sphere`-style landmark names).
## Context

Colour cap: every channel <= `#dadada` (179 AT21), so the parser raises no warning. Colour predicates and the shared helpers are in `docs/design/track-style.md` and `tests/unit/acceptance/helpers/` (179, 188). Offsets are measured from the track edge.

## Files
- `public/tracks/sepang.style.json` — create (`"version": 1`)
- `tests/unit/acceptance/204-sepang-style.test.ts` — create (acceptance worker); reuses `helpers/colour.ts` and `helpers/brands.ts`
## Steps
Use `npm run track:locate -- sepang <lat> <lon>` (task 181) for centerline indices from the doc's lat/lon and turns. Encode (values are the target; adjust only to meet the table):
1. `palette`: asphalt `#4a4a4d`, grass `#6fa13a`, gravel `#c8cacc`; `edgeLines` color `#2b5fb5`; `kerbs` colors `#d8404a`/`#dadada`.
2. `runoffPaint`: pattern `none`; 2 `stripes` ranges (T15 hairpin and T1 areas) with colors `#d12b35`,`#dadada`,`#dac21f`,`#1e4f9f`, stripeMeters 3.
3. `barriers`: fence color `#0a8f86`, heightMeters 4, types `armco`,`wall`; concrete `#dadada`; armco `#9aa0a6`.
4. `pitBuilding`: storeys 2, heightMeters 10, depthMeters 16, facade `#9a9ea2`, roof `#6f7478`, doors `#2a2a2c`, accent `#0a8f86`, roofStyle `flat`, glazing 0.4.
5. `grandstands`: structure `#a8abae`, roof `#dadada`, seats `#d12b35`,`#dac21f`,`#1e4f9f`,`#dadada`, roofStyle `sail`.
6. `extraGrandstands`: 1 hillstand entry at T9-T11 (find with track:locate), rows 14, roof false.
7. `sky`: hdri `kloofendal_overcast_puresky`. No `floodlights`, no `props`.
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
| AT7 S1 | `sepang.style.json` | parsed | grandstands.roofStyle 'sail'. |
| AT8 S2 | `sepang.style.json` | parsed | edgeLines.color isBlue. |
| AT9 S3 | `sepang.style.json` | parsed | a runoffPaint range with isRed, isWhite, isYellow or isBlue (≥ 3 of them). |
| AT10 S4 | `sepang.style.json` | parsed | fence color isTeal. |
| AT11 S5 | `sepang.style.json` | parsed | pitBuilding facade isGrey, glazing ≥ 0.3 |
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
