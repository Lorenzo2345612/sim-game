# 197 — Road Atlanta (Braselton) style file (data only)

Status: pending
Phase: 1
Depends on: 181, 188
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/braselton.style.json` so Road Atlanta (Braselton) gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/braselton-visual.md` (Top 10) and photos in `.ai/refs/braselton/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- braselton <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/braselton.style.json` — create
- `tests/unit/acceptance/197-braselton-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Blue/yellow low serrated kerbs: `kerbs.colors` blue and yellow (and a green `outerStrip` if photos show it).
2. Pale-grey concrete walls (`barriers.concrete.color` light) with tall chain-link fence: `barriers.fence` height 3.5-4.5 m, types include `wall`.
3. Tan-orange gravel beds: `palette.gravel`.
4. Long white pit building (low, 1-2 storeys, white facade).
5. At least 1 `footbridge` prop at T11 and at least 3 `marshalPost` props with green colour (green-roof booths).
6. `floodlights`: tall poles (style `mast` or `arm`), wide spacing, partial ranges.
7. Hillside tents: a few `tent` props instead of big stands.

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
| AT7 S1 | `braselton.style.json` parsed | check signature | kerbs.colors include isBlue and isYellow, or a kerb range with them. |
| AT8 S2 | `braselton.style.json` parsed | check signature | barriers.concrete.color isLight and fence heightMeters ≥ 3.5 with types including 'wall'. |
| AT9 S3 | `braselton.style.json` parsed | check signature | ≥ 1 footbridge prop. |
| AT10 S4 | `braselton.style.json` parsed | check signature | floodlights non-null. |
| AT11 S5 | `braselton.style.json` parsed | check signature | ≥ 3 marshalPost props with isGreen colour |

## Acceptance criteria

- [ ] `braselton.style.json` exists, `version: 1`, passes every table row.
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
