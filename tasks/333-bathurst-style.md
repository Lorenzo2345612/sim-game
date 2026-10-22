# 333 — Bathurst style file (data only)

Status: pending
Phase: 1
Depends on: 331
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/bathurst.style.json` so Bathurst gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/bathurst-visual.md` (Top 10) and photos in `.ai/refs/bathurst/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- bathurst <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/bathurst.style.json` — create
- `tests/unit/acceptance/333-bathurst-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Pale concrete walls: `barriers.concrete` color `#b9b7b0` with blue `bandColor` `#3a6cb0`; `barriers.fence` height 3-4 m, types include `wall`, color `#7d8186`.
2. Red/white `kerbs.colors` (`#c8302c`, `#d8d8d4`); white `edgeLines`.
3. `palette.grass` spring green `#6f9a45`; `palette.gravel` tan `#b98f62`; `palette.asphalt` dark grey `#55575a`.
4. Pit building: 2 storeys, flat roof, facade `#cfd0cf`, accent orange `#d86e22`, glazing about 0.4.
5. Main stand `grandstands` roofed (`roofStyle` truss, grey structure, blue/red seats) plus at least 2 `extraGrandstands`: one near idx 0 right (about 120 m, roof true), one scaffold (roof false) near Hell Corner idx 239 / Murray's idx 3083.
6. No `floodlights` key.

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
| AT7 S1 | `bathurst.style.json` parsed | check signature | barriers fence types include 'wall', heightMeters ≥ 2.5 |
| AT8 S2 | `bathurst.style.json` parsed | check signature | palette.grass has green as its largest channel |
| AT9 S3 | `bathurst.style.json` parsed | check signature | extraGrandstands ≥ 1 |
| AT10 S4 | `bathurst.style.json` parsed | check signature | no floodlights |

## Acceptance criteria

- [ ] `bathurst.style.json` exists, `version: 1`, passes every table row.
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
