# 253 — Run-off paint uses only the country's flag colours

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer
Milestone: M1.11 (design `docs/design/track-fidelity.md`)

## Goal

Every painted run-off area (`runoffPaint`) uses only the colours of the flag of the circuit's country, taken from a new data file.

## Context

Closed design rule. Schema: `docs/design/track-style.md`; parser `src/track/trackStyle.ts`; renderer `src/render/trackSurfaceRenderer.ts` (both unchanged). Style file `<id>.style.json` belongs to the `index.json` entry with the same `id`; its `country` selects the palette. Data-only task: no code in `src/`.

## Files

- `public/tracks/flag-palettes.json` — create.
- `public/tracks/*.style.json` — modify (only those with `runoffPaint`; colours only).
- `docs/design/track-style.md` — modify: one line under `runoffPaint`: colours must come from `public/tracks/flag-palettes.json` for the track's country; new tracks add their country there (main field colours only, no black, no emblem colours).
- `tests/unit/acceptance/253-runoff-flag-colours.test.ts` — create from the table.

## Steps

1. `flag-palettes.json`: object keyed by the exact `country` strings of `index.json`; value = flag colours in flag order, uppercase hex; flag white is `#DADADA`:
   - Italy `["#009246","#DADADA","#CE2B37"]`; Belgium `["#FDDA24","#EF3340"]`; United Kingdom `["#012169","#DADADA","#C8102E"]`; Mexico `["#006847","#DADADA","#CE1126"]`; United States `["#B22234","#DADADA","#3C3B6E"]`; Qatar `["#8A1538","#DADADA"]`; Bahrain `["#CE1126","#DADADA"]`; Malaysia `["#CC0001","#DADADA","#010066"]`; Azerbaijan `["#0092BC","#E4002B","#00AF66"]`; Hungary `["#CD2A3E","#DADADA","#436F4D"]`; Singapore `["#EF3340","#DADADA"]`; Austria `["#C8102E","#DADADA"]`.
   - Palette rule (user): only the main field colours of the flag; never black; emblem/charge colours (suns, stars, crescents, coats of arms) do not count (Argentina = light blue + white; Mexico = green, white, red). New countries follow the same rule.
2. In each style file with `runoffPaint`, rewrite only `colors` (top-level and every `ranges[].colors`):
   - effective pattern (own, else inherited from top level) `stripes` or `bands`: full country palette in flag order;
   - `solid`: `[nearest palette colour to the old colors[0]]` by RGB Euclidean distance, ignoring `#DADADA` (countries with one non-white colour use it);
   - top-level `colors` with pattern `none`: full palette.
3. Patterns, sides, start/end, `stripeMeters` and every non-`runoffPaint` field unchanged. Track `.json` files untouched. Keep each file's existing formatting/indentation.

Conventions: hex compared case-insensitively; exact tie in distance ⇒ earlier palette colour; no mutation of other fields.

## Acceptance tests (defined by the planner with Opus, before coding)

The acceptance worker embeds in the test the pre-task values taken from master at test-writing time: each style file's `runoffPaint` structure with all `colors` removed (AT4) and the sha256 of every track JSON (AT6).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `flag-palettes.json` + `index.json` | read | an entry exists for every distinct `country` in index.json; each entry has 2–4 colours matching `^#[0-9A-F]{6}$` |
| AT2 | every `public/tracks/*.style.json` with `runoffPaint` | collect top-level `colors` and every `ranges[].colors` | every colour (case-insensitive) is in the palette of that track's country |
| AT3 | same files | entries whose effective pattern is `stripes` or `bands` | colour list equals the full country palette in flag order |
| AT4 | same files vs `git show HEAD~:<file>` captured as fixtures at test-writing time OR recomputed from the pre-task values embedded in the test | deep compare with all `colors` fields removed | identical (patterns, sides, ranges, stripeMeters unchanged) |
| AT5 | each updated style file | parse with the existing `trackStyle.ts` parser | no validation errors |
| AT6 | `public/tracks/*.json` excluding `*.style.json` and `flag-palettes.json` | sha256 vs pre-task | unchanged |
| AT7 | `flag-palettes.json` | read every colour | no colour has max(R,G,B) < 0x40 (no black); Belgium = `["#FDDA24","#EF3340"]`, Malaysia has no `#FFCC00` |

## Acceptance criteria

- [ ] All six acceptance tests pass.
- [ ] `git diff --stat` touches only the Files listed.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Changes to `trackStyle.ts`, the renderer or the schema; kerb, barrier or other colours; track `.json` files; new tracks.
