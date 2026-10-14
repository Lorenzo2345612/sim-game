# 149 — Sausage kerb placement (builder)

Status: pending
Phase: 2
Depends on: 140
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Built tracks carry `sausages` (small yellow kerbs on the inside of chicane apexes), generated automatically and overridable per track.

## Context

M2.5, design `docs/plans/late-features.md` ("149"). Read the current code first: this task runs after 140 (`tools/track-builder/corners.ts` exports `CornerRun`/`detectCorners`; `hazards.ts`; `src/track/parseTrackData.ts`); adapt file names to what exists, keep the public contract. 140 does not export chicane pairs: detect them here with 140's rule (consecutive corner runs, wrapping, opposite `side`, both `minRadius < 80`, arc-length gap from the first run's `end` to the second's `start` < 120 m). `CornerRun.side` = turn side = inside. `KERB_WIDTH` = 1.2 (`src/core/constants.ts`). Rendering is 150. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/core/types.ts` — modify: `Sausage`, `TrackDataV2.sausages?: Sausage[]`.
- `src/track/parseTrackData.ts` — modify: default `sausages` to `[]` for v2.
- `tools/track-builder/sausages.ts` — create.
- `tools/track-builder/buildTrack.ts` — modify: compute and write `sausages` (always, `[]` if none); read per-track overrides from `tools/track-builder/tracks.json` entries.
- `public/tracks/*.json` — regenerate with `npm run build:tracks` for ALL ten ids in `tools/track-builder/tracks.json`.
- `tests/unit/acceptance/149-sausage-placement.test.ts` — create (acceptance worker).

## Steps

```ts
// types.ts
export interface Sausage { index: number; side: Side; offset: number; length: number } // offset: m from the centerline on `side`; length: m along the track
// sausages.ts
export interface SausageOverride { atMeters: number; side: Side; offsetMeters?: number; lengthMeters?: number }
export function buildSausages(points: Point2[], widthMeters: number, overrides?: SausageOverride[]): Sausage[];
```

1. Automatic: for each chicane (two runs per chicane), one sausage per run: `index` = centerline index of minimum radius within the run (same radius measure as `corners.ts`; first index on ties), `side` = run `side`, `offset` = `widthMeters/2 + KERB_WIDTH + 0.6`, `length` = 6.
2. Overrides (`tracks.json` field `sausages`): `index` = centerline index nearest to arc length `atMeters` (closed polyline, wrapping), defaults offset as above, length 6; override values replace the defaults when given.
3. Output sorted by `index` (ties: left before right); an automatic sausage within 3 indices and same side of an override is dropped.
4. `parseTrackData` accepts JSON without `sausages` (→ `[]`).

Conventions: arc length in metres; indices wrap with positive modulo; override `atMeters` outside [0, perimeter) wraps; empty/short input (n < 3) → `[]`; inputs not mutated; deterministic.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 140 AT3 chicane fixture, width 12 | build | 2 sausages: left arc apex on the left, right arc apex on the right; offset 6 + 1.2 + 0.6 = 7.8; length 6 |
| AT2 | rounded square R 30 (no chicane) | build | [] |
| AT3 | override { atMeters 1000, side 'left' } on that square | build | one sausage at the index nearest 1000 m, offset 7.8, length 6 |

## Acceptance criteria

- [ ] AT1–AT3 pass; all ten tracks rebuild with a `sausages` array; centerline, elevation, kerbs, barriers unchanged.
- [ ] Existing tests broken only by the new field are fixed minimally (ignore `sausages` in field lists) and reported.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering and colliders (150); changing 140's thresholds; kerb strips (142).
- README, tasks.json, milestones.json.
