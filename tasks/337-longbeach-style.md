# 337 — Long Beach style file (data only)

Status: pending
Phase: 1
Depends on: 336
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/longbeach.style.json` so Long Beach gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/longbeach-visual.md` (Top 10) and photos in `.ai/refs/longbeach/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- longbeach <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/longbeach.style.json` — create
- `tests/unit/acceptance/337-longbeach-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Light concrete road-block walls: `barriers.concrete` color `#c8c8c4` with red `bandColor` `#c8302c`; `barriers.fence` height 4 m (catch fence 4-5 m), types include `wall`, color `#7a7e82`.
2. Red/white `kerbs.colors` (`#c8302c`, `#d8d8d4`); `edgeLines` pale blue `#4a78c8`.
3. `palette.grass` palm/lawn green `#5f8a3f`; `palette.gravel` sand `#c8b890`; `palette.asphalt` light city concrete `#b4b2ac`.
4. Pit building: temporary, 2 storeys, flat roof, facade white `#d4d4d0`, accent red `#c8302c`, glazing about 0.4.
5. Main stand `grandstands` bare aluminium (structure `#b4b8bc`, simple or no roof, red/white seats) plus at least 2 `extraGrandstands`: one near idx 0 right (about 120 m, roof true), one scaffold (roof false) near the west corner idx ~496 / the final hairpin idx ~1376 (verify with `track:locate`; indices are in the 1604-point centerline).
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
| AT7 S1 | `longbeach.style.json` parsed | check signature | barriers fence types include 'wall', heightMeters ≥ 2.5 |
| AT8 S2 | `longbeach.style.json` parsed | check signature | palette.grass has green as its largest channel |
| AT9 S3 | `longbeach.style.json` parsed | check signature | extraGrandstands ≥ 1 |
| AT10 S4 | `longbeach.style.json` parsed | check signature | no floodlights |

## Acceptance criteria

- [ ] `longbeach.style.json` exists, `version: 1`, passes every table row.
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
