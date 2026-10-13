# 074 — Credits screen

Status: pending
Phase: 1
Depends on: 044
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A Credits panel in the menu lists the attribution-required assets, generated from `ASSETS_LICENSES.md`.

## Context

`ASSETS_LICENSES.md` is a markdown table with columns Asset | Path | Author / source | License | URL | NC. CC-BY requires visible attribution. Source titles of GT3 rows contain real brand names ("real-brand shape, dev only"): the credits show a neutral description (the Asset column text up to the first " (" or " –" — for GT3 rows this is e.g. "GT3 car A source"), never a source model title or URL slug text. Menu from task 044 (`src/ui/menu.ts`). Acceptance tests: unit `tests/unit/acceptance/074-credits.test.ts`, e2e `tests/e2e/acceptance/074-credits.spec.ts`.

## Files

- `tools/assets/buildCredits.ts` — create: exports `parseCredits(markdown: string): CreditEntry[]`; CLI writes `public/credits.json`; npm script `build:credits`
- `public/credits.json` — generated and committed
- `src/ui/menu.ts` — modify: "Credits" button and panel (fetches `/credits.json`); Esc closes the panel

## Steps

1. `export interface CreditEntry { asset: string; author: string; license: string; url: string }`.
2. Include only rows whose License column starts with `CC-BY`; exclude CC0, MIT and others. Output order = file order.
3. Panel lists each entry with asset, author, license and url (url as a link). Element id `credits-panel`; button id `credits-btn`.

Conventions: whitespace trimmed; empty or table-less input returns `[]`; a CC-BY row missing author or url throws.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: current `ASSETS_LICENSES.md` | build credits | one entry per CC-BY row (≥ 4: F4 + three GT3), each with author, license, url |
| AT2 | unit: CC0 rows | build | excluded |
| AT3 | e2e: menu → Credits | open | every entry's author and url visible; Esc closes |

## Acceptance criteria

- [ ] AT1–AT3 pass; existing tests pass; `public/credits.json` matches the generator output.

## Verification

```
npm run build:credits
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

Editing `ASSETS_LICENSES.md`, in-game credits roll, localisation, de-branding the source rows.
