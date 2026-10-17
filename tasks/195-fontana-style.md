# 195 — Fontana style file (data only)

Status: pending
Phase: 1
Depends on: 181, 188, 168
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Create `public/tracks/fontana.style.json` so Fontana gets its own look (design: `docs/design/track-style.md`).

## Context

Source: `docs/research/tracks/fontana-visual.md` (Top 10) and photos in `.ai/refs/fontana/` (workers may view them). Schema, limits and defaults: `docs/design/track-style.md`. Convert lat/lon to centerline indices with `npm run track:locate -- fontana <lat> <lon>`. Colours from photos/doc as `#rrggbb`, every channel <= 0xda (brighter ones warn and fail check:styles). No brand or sponsor text anywhere in the file. If the renderer cannot express something, stop and escalate; do not touch `src/` or `tools/`.

## Files

- `public/tracks/fontana.style.json` — create
- `tests/unit/acceptance/195-fontana-style.test.ts` — create (acceptance role, from the table)

## Steps

Encode only these (schema-supported; skip the rest of the doc). Row C2 also requires non-default pitBuilding, kerbs.colors, barriers.fence, grandstands (structure/roof/seats) and palette, so set each from the photos. Keep every range under 40 % of the lap, props total under 30:

1. Huge front grandstand with red/gold seats (`grandstands.seats` red and yellow); structure and roof colours from photos.
2. Right-side pit building with red roof (`pitBuilding.roof` red, brown-brick `facade`, 2 storeys).
3. Water-tower scoreboard: one red/black `scoreboard` or `tower` prop in the infield (red `color`).
4. Concrete walls and catch fence: `barriers.fence` height 4-5 m, types `armco` and `wall`; blue-white wall band if the photos show it (no lettering).
5. `palette.grass` bright green; `palette.asphalt` grey cracked tint; dry brown `palette.gravel`.
6. Kerb colours from photos; hazy pale-blue sky only if an existing `sky.hdri` name fits (else omit).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 C1 | `public/tracks/<id>.style.json` and `<id>.json` | `parseTrackStyle(raw, centerline.length)` | errors `[]`; warnings `[]` |
| AT2 C2 | parsed | sections | pitBuilding, kerbs.colors, barriers (fence set), grandstands and palette are all non-default |
| AT3 C3 | every range (kerbs, runoffPaint, barriers, floodlights, extraGrandstands) | span length | each covers ≤ 40 % of the lap and ≥ 1 index; ranges for the same section and side do not repeat an identical start/end |
| AT4 C4 | every prop | index | `0 ≤ index < centerline.length`; total props ≤ 30 |
| AT5 C5 | file text | brand check | contains none of the strings in the shared deny list `tests/unit/acceptance/helpers/brands.ts` (created by 188: Pirelli, Rolex, Heineken, DHL, Aramco, Emirates, Petronas, Shell, Red Bull, Ferrari, Mercedes, Gulf Air, Etihad, Qatar Airways, Crypto, Singtel, Marina Bay Sands, Sphere, Formula 1, Indy, NASCAR) case-insensitive, checked on string values that are not hex colours |
| AT6 C6 | `npm run -s check:styles` | run | exit 0 |
| AT7 S1 | `fontana.style.json` parsed | check signature | grandstands.seats include isRed and isYellow. |
| AT8 S2 | `fontana.style.json` parsed | check signature | pitBuilding roof isRed. |
| AT9 S3 | `fontana.style.json` parsed | check signature | a scoreboard or tower prop with isRed colour. |
| AT10 S4 | `fontana.style.json` parsed | check signature | fence heightMeters ≥ 4, types include 'wall'. |
| AT11 S5 | `fontana.style.json` parsed | check signature | palette.grass isGreen |

## Acceptance criteria

- [ ] `fontana.style.json` exists, `version: 1`, passes every table row.
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
