# 194 — Daytona style file (data only)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/daytona.style.json` so Daytona gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/daytona-visual.md` (Top 10) and photos in `.ai/refs/daytona/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- daytona <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/daytona.style.json` — create
- `tests/unit/acceptance/194-daytona-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Tall silver chain-link catch fence on posts: `barriers.fence` height 6-7 m, types `armco` and `wall`, silver-grey color.
2. White concrete walls with a blue band (`barriers.concrete`), blue/white SAFER look.
3. Painted blue/white run-off (`runoffPaint`, stripes or bands) on the Bus Stop and infield sections only (ranges, not whole lap).
4. Huge multicolour front stand: `grandstands.seats` 3-4 colours (patchwork), long roof; add `extraGrandstands` along the front stretch if the doc supports it.
5. Left-side pit building (garage block, 2 storeys, light facade); pit side is already in `daytona.json`.
6. Scoring pylon: one `tower` or `scoreboard` prop, index from the doc's lat/lon.
7. Light-mast rows: `floodlights` style `mast`, tall (25-30 m), several heads, wide spacing, along the front stretch/banking via ranges.
8. Bright green grass `palette.grass`; hard-sun Florida look; kerb colours from the photos (Bus Stop).

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
| AT7 S1 | `daytona.style.json` parsed | check signature | fence heightMeters ≥ 6 and types include 'wall'. |
| AT8 S2 | `daytona.style.json` parsed | check signature | runoffPaint colours include isBlue and isWhite. |
| AT9 S3 | `daytona.style.json` parsed | check signature | barriers.concrete.bandColor isBlue or concrete.color isWhite. |
| AT10 S4 | `daytona.style.json` parsed | check signature | a tower or scoreboard prop. |
| AT11 S5 | `daytona.style.json` parsed | check signature | grandstands.seats ≥ 3 colours. |
| AT12 S6 | `daytona.style.json` parsed | check signature | floodlights non-null, style 'mast' |

## Acceptance criteria

- [ ] `daytona.style.json` exists, `version: 1`, passes every table row.
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
