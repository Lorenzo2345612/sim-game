# 198 — Cleveland style file (data only)

Status: pending
Phase: 1
Depends on: 181, 188, 168
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/cleveland.style.json` so Cleveland gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/cleveland-visual.md` (Top 10) and photos in `.ai/refs/cleveland/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- cleveland <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/cleveland.style.json` — create
- `tests/unit/acceptance/198-cleveland-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Pale grey concrete runway: `palette.asphalt` light grey (l >= 0.5), white `edgeLines`.
2. Jersey walls light grey with catch fence: `barriers.fence` height 3.5-4.5 m, types include `wall`.
3. At least 2 `extraGrandstands` (temporary scaffold stands, roof false or true per photos) on straight sections.
4. No `floodlights` key.
5. Dry-yellow `palette.grass` option as seen in photos; `palette.gravel` omitted unless the doc shows gravel.
6. Low temporary pit building, light facade.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| C6 | `npm run -s check:styles` | run | exit 0 |
| S1 | `cleveland.style.json` parsed | check signature | palette.asphalt isLight or isGrey with l ≥ 0.5 (concrete runway). |
| S2 | `cleveland.style.json` parsed | check signature | fence types include 'wall', heightMeters ≥ 3.5. |
| S3 | `cleveland.style.json` parsed | check signature | extraGrandstands ≥ 2. |
| S4 | `cleveland.style.json` parsed | check signature | no floodlights |

## Acceptance criteria

- [ ] `cleveland.style.json` exists, `version: 1`, passes every table row.
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
