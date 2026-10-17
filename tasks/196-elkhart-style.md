# 196 — Elkhart Lake style file (data only)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/elkhart.style.json` so Elkhart Lake gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/elkhart-visual.md` (Top 10) and photos in `.ai/refs/elkhart/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- elkhart <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/elkhart.style.json` — create
- `tests/unit/acceptance/196-elkhart-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Red/yellow alternating kerbs as default `kerbs.colors`; kerb `ranges` with grey/grey colours for the concrete rumble strips at Kink and T13.
2. At least 3 `footbridge` props over the track (front straight, T3-5, T8-9, T11), generic colour, no text.
3. At least 3 `tent` props on spectator hills; no `extraGrandstands` (use `[]` or omit).
4. Light grey/white concrete walls (`barriers.concrete`), tyre walls (`tyres`), catch fence at T5/T8/T13 via `barriers.ranges`.
5. Very bright green `palette.grass`; pea-gravel `palette.gravel` light or cream.
6. Right-side pit building, low (1 storey), modest garages.

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
| AT7 S1 | `elkhart.style.json` parsed | check signature | a kerb range with colours isRed + isYellow. |
| AT8 S2 | `elkhart.style.json` parsed | check signature | a kerb range with both colours isGrey (concrete rumble). |
| AT9 S3 | `elkhart.style.json` parsed | check signature | ≥ 3 footbridge props. |
| AT10 S4 | `elkhart.style.json` parsed | check signature | palette.gravel isLight or isCream. |
| AT11 S5 | `elkhart.style.json` parsed | check signature | extraGrandstands `[]` and ≥ 3 tent props |

## Acceptance criteria

- [ ] `elkhart.style.json` exists, `version: 1`, passes every table row.
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
