# 119 — Livery data, palette and storage

Status: pending
Phase: 1
Depends on: 072
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure module defines the livery type, a 16-colour palette, parsing and per-car persistence.

## Context

Design: `docs/plans/game-features.md` section 119. `KeyValueStorage` is exported from `src/core/settings.ts` (import type from there). Palette is later reused by the race HUD / AI cars (094). `src/game/` holds pure game modules (no `three`, no DOM).

## Files

- `src/game/livery.ts` — create.
- `tests/unit/acceptance/119-livery-data.test.ts` — acceptance worker.

## Steps

```ts
import type { KeyValueStorage } from '../core/settings';
export type LiveryPattern = 'solid' | 'stripe' | 'split' | 'chevron';
export interface Livery { primary: string; secondary: string; accent: string; pattern: LiveryPattern; number: number }
export const LIVERY_PATTERNS: readonly LiveryPattern[];   // order: solid, stripe, split, chevron
export const LIVERY_PALETTE: readonly Livery[];           // 16 entries
export function defaultLivery(index: number): Livery;
export function parseLivery(json: unknown): Livery;
export function loadLivery(storage: KeyValueStorage, carId: string): Livery;
export function saveLivery(storage: KeyValueStorage, carId: string, livery: Livery): void;
```

1. Colours match `/^#[0-9a-f]{6}$/` (lowercase output; uppercase input accepted and lowercased). `number` integer 0–99.
2. `LIVERY_PALETTE`: 16 entries with 16 distinct `primary` values; planner-free choice of a readable set (red, orange, yellow, lime, green, teal, cyan, blue, navy, purple, magenta, pink, white, silver, black, brown); secondary = white or black (whichever contrasts), accent = a different palette colour; pattern 'solid'; number = index + 1.
3. `defaultLivery(i)`: copy of `LIVERY_PALETTE[((i % 16) + 16) % 16]` with `number = ((i + 1) % 100 + 100) % 100`; returns a new object each call.
4. `parseLivery` throws `Error` naming the field on non-object, bad colour, unknown pattern, non-integer or out-of-range number.
5. Storage key `livery:<carId>`, value JSON of the livery. `loadLivery`: missing, corrupt JSON or invalid content returns `defaultLivery(0)` (never throws). `saveLivery` validates through `parseLivery` first (throws on invalid).

Conventions: number bounds inclusive; invalid input throws except in `loadLivery`; no input mutation.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | LIVERY_PALETTE | inspect | 16 entries, all valid, 16 distinct primaries |
| AT2 | defaultLivery(17) | call | = palette[1] colours, number 18 |
| AT3 | parseLivery with primary '#12345g' / pattern 'dots' / number 100 | call | throws |
| AT4 | save then load (memory storage) / load with corrupt JSON | call | round-trips equal / defaultLivery(0) |

## Acceptance criteria

- [ ] AT1–AT4 pass.
- [ ] `grep -n "three" src/game/livery.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Shader, decals, editor UI, AI livery assignment.
