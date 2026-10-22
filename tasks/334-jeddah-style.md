# 334 — Jeddah style file (data only)

Status: pending
Phase: 1
Depends on: 331
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/jeddah.style.json` so Jeddah gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/jeddah-visual.md` (Top 10) and photos in `.ai/refs/jeddah/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- jeddah <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/jeddah.style.json` — create
- `tests/unit/acceptance/334-jeddah-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Dark street asphalt `palette.asphalt` `#46484c`; sand-coloured `palette.gravel` `#c8bba0`; white `edgeLines`.
2. Pale walls with tyre blocks: `barriers.concrete` `#bdbdb8` with `bandColor` `#8a8d90`; `barriers.tyres.beltColor` `#1c1c1e`; `barriers.fence` height 4-6 m, types include `wall`, color `#8f949a`.
3. `floodlights`: style mast, height about 14 m, both sides, one or more `ranges` (each under 40 % of the lap, e.g. the fast esses idx 516-748 and the north run idx 878-1233).
4. Pit building: 3 storeys, height about 10 m, white facade `#d8d8d4`, `roofStyle` curved, glazing about 0.5, accent teal `#2a8a8a`.
5. `grandstands`: grey steel structure, `roofStyle` sail, dark blue seats; at least 2 `extraGrandstands` (one roofed near idx 0 right, one scaffold with roof false near the final hairpin idx 2809).
6. Red/white `kerbs.colors`.

## Time budget (planner, after MiMo timeouts)

- Sources are only the spec, `docs/design/track-style.md`, `docs/research/tracks/<id>-visual.md`, the track json, an existing `*.style.json` as template and `npm run track:locate`. No web search, no WebFetch, no Overpass/OSM queries, no EXIF or photo analysis.
- Write the style json within your first 15 tool calls, then run the task tests and iterate. Where the research note is vague, choose plausible values that satisfy the acceptance table.

## Shared brand helper

`tests/unit/acceptance/helpers/brands.ts` exists on master (exports `BRAND_DENY_LIST`). Import it; do not create or modify it.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| AT2 C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| AT3 C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| AT4 C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| AT5 C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| AT6 C6 | `npm run -s check:styles` | run | exit 0 |
| AT7 S1 | `jeddah.style.json` parsed | check signature | barriers fence types include 'wall', heightMeters ≥ 3.5 |
| AT8 S2 | `jeddah.style.json` parsed | check signature | at least 1 floodlights range (night race) |
| AT9 S3 | `jeddah.style.json` parsed | check signature | palette.asphalt lightness l < 0.35 |
| AT10 S4 | `jeddah.style.json` parsed | check signature | extraGrandstands ≥ 2 |

## Acceptance criteria

- [ ] `jeddah.style.json` exists, `version: 1`, passes every table row.
- [ ] `npm run -s check:styles` exits 0.
- [ ] No files changed outside `public/tracks/` and `tests/unit/acceptance/`.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run -s check:styles
```

## Out of scope

- Any change in `src/`, `tools/`, `tasks/tasks.json`; new renderer features, landmarks, vegetation, buildings, night lighting.
- Brand or sponsor text; other circuits' style files.
