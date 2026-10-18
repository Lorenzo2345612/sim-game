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

Closed design rule. Schema: `docs/design/track-style.md`; parser `src/track/trackStyle.ts`; renderer `src/render/trackSurfaceRenderer.ts` (renderer unchanged). Style file `<id>.style.json` belongs to the `index.json` entry with the same `id`; its `country` selects the palette. Data task plus one parser change (see Planner answers).

## Files

- `public/flags/palettes.json` — create.
- `src/track/trackStyle.ts` — modify: `runoffPaint` colours bypass `CHANNEL_CAP`.
- `public/tracks/*.style.json` — modify (only those with `runoffPaint`; colours only).
- `docs/design/track-style.md` — modify: one line under `runoffPaint`: colours must come from `public/flags/palettes.json` for the track's country; new tracks add their country there (main field colours only, no black, no emblem colours).
- `tests/unit/acceptance/253-runoff-flag-colours.test.ts` — create from the table.

## Steps

1. `flag-palettes.json`: object keyed by the exact `country` strings of `index.json`; value = flag colours in flag order, uppercase hex; white is the official white (`#FFFFFF` unless the source defines another). Values are the official specification (official RGB where given, otherwise the official Pantone published sRGB); copy them exactly:
   - Italy `["#008C45","#F4F5F0","#CD212A"]`; Belgium `["#FDDA24","#EF3340"]`; United Kingdom `["#00247D","#FFFFFF","#CF142B"]`; Mexico `["#006747","#FFFFFF","#C8102E"]`; United States `["#B31942","#FFFFFF","#0A3161"]`; Qatar `["#8A1538","#FFFFFF"]`; Bahrain `["#DA291C","#FFFFFF"]`; Malaysia `["#D50032","#FFFFFF","#071D49"]`; Azerbaijan `["#00B5E2","#EF3340","#509E2F"]`; Hungary `["#CE2939","#FFFFFF","#477050"]`; Singapore `["#EF3340","#FFFFFF"]`; Austria `["#C8102E","#FFFFFF"]`.
   - Sources (put them in `docs/design/track-style.md` next to the rule): Italy 2006 decree Pantone TCX; Belgium protocol guide Pantone 115/032 C; UK Flag Institute RGB; Mexico SEGOB Pantone 3425/186 C; USA State Dept Old Glory Red/Blue RGB; Qatar Law 14/2012 Pantone 1955 C; Bahrain flag guide Pantone 485 C; Malaysia ASEAN spec Pantone 199/2768 C; Azerbaijan flag law Pantone 306/032/362 C; Hungary MSZ 1361:2009 TCX; Singapore National Symbols Kit Pantone 032 C; Austria 2018 regulation Pantone 186 C.
   - Palette rule (user): only the main field colours of the flag; never black; emblem/charge colours (suns, stars, crescents, coats of arms) do not count (Argentina = light blue + white; Mexico = green, white, red). New countries follow the same rule.
2. In each style file with `runoffPaint`, rewrite only `colors` (top-level and every `ranges[].colors`):
   - effective pattern (own, else inherited from top level) `stripes` or `bands`: full country palette in flag order;
   - `solid`: `[nearest palette colour to the old colors[0]]` by RGB Euclidean distance, ignoring white (countries with one non-white colour use it);
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
| AT5 | each updated style file | parse with the `trackStyle.ts` parser | no validation errors |
| AT6 | `public/tracks/*.json` excluding `*.style.json` and `flag-palettes.json` | sha256 vs pre-task | unchanged |
| AT7 | `flag-palettes.json` | read every colour | no colour has max(R,G,B) < 0x40 (no black); Belgium = `["#FDDA24","#EF3340"]`, Malaysia has no `#FFCC00` |
| AT8 | `flag-palettes.json` | deep compare | equals exactly the 12 palettes listed in step 1 (order and hex) |

## Acceptance criteria

- [ ] All six acceptance tests pass.
- [ ] `git diff --stat` touches only the Files listed.

## Verification

```
npm run typecheck
npm run lint
npm test
```


## Planner-authorised test edits

- `tests/unit/acceptance/241-ermita-tracks.test.ts` AT4 (line ~234): exclude `*.style.json` from the byte-identity check.
- `tests/unit/acceptance/189-spa-style.test.ts` AT7 (dark colour in a spa stripes range), `tests/unit/acceptance/203-bahrain-style.test.ts` AT8 (cream + blue run-off), `tests/unit/acceptance/205-lusail-style.test.ts` AT9 (orange/blue/maroon ranges): delete the run-off colour assertions (superseded by the flag rule); keep their pattern/range assertions.
- `tests/unit/acceptance/253-runoff-flag-colours.test.ts`: palette path becomes `public/flags/palettes.json`.

## Planner answers

- Palette file moves to `public/flags/palettes.json` (outside `public/tracks/`, so track globs in 156/236/241 are unaffected; no edits there).
- `src/track/trackStyle.ts`: colours under `runoffPaint` (top-level `colors` and `ranges[].colors`) bypass `CHANNEL_CAP` — no clamp, no warning (user wants the exact flag tones on screen). All other style colours keep the cap. This fixes the no-warnings and `check:styles` tests.
- 224 POST4 timeout: flaky, unrelated; ignore. detroit unchanged and the solid/top-level rewrites as reported: accepted.

## Out of scope

- Changes to `trackStyle.ts`, the renderer or the schema; kerb, barrier or other colours; track `.json` files; new tracks.
