# 247 — Sausage kerbs fit the corner

Status: pending
Phase: 1
Depends on: 240, 241
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester
Milestone: M1.11 (design `docs/design/track-fidelity.md`, "Wave 2")

## Goal

Auto sausages get a length and offset derived from their corner (clamp 6..20 m, clear of the kerb, dropped if too tight) and render and collide along the offset line instead of a straight prism. All tracks are rebuilt.

## Context

Audit `docs/research/track-audit-kerbs.md`: fixed 6 m straight prisms with a fixed offset invade the track in curved corners. Depends on 240/241 only to serialise JSON rebuilds. `sausagePose`, `sausageHullPoints` and `createSausageGeometry` stay exported and unchanged (existing tests pin them). Rebuild with `npm run build:tracks`; only the `sausages` field of each `public/tracks/<id>.json` may change.

## Files

- `tools/track-builder/sausages.ts` — modify: new length/offset/drop rules.
- `tools/track-builder/buildTrack.ts` — modify: pass per-index half-widths.
- `src/track/sausages.ts` — modify: add `sausagePieces`.
- `src/render/sausageRenderer.ts` — modify: render pieces.
- `src/physics/trackColliders.ts` — modify: collide pieces.
- `public/tracks/*.json` — regenerate.
- `tests/unit/acceptance/247-sausage-fit-corner.test.ts` — create from the table; edge tests by tester-pre.

## Steps

```ts
// tools/track-builder/sausages.ts
export function buildSausages(points: Point2[], widthMeters: number, overrides?: SausageOverride[], halfWidths?: { left: number[]; right: number[] }): Sausage[]
// src/track/sausages.ts
export interface SausagePiece { position: Vec3; yaw: number; length: number }
export function sausagePieces(track: TrackDataV2, s: Sausage): SausagePiece[]
// src/render/sausageRenderer.ts (new export)
export function createSausageBodyGeometry(): THREE.BufferGeometry
```
1. Builder, auto sausages only: `length = clamp(0.5 · arcLength(run.start, run.end), 6, 20)` (existing `arcLength`, run = the chicane corner run whose apex is the sausage index); `offset = half(side, index) + KERB_WIDTH + 0.6`, `half` from `halfWidths[side][index]` else `widthMeters / 2`; drop the sausage if `offset ≥ 0.8 · radii(points)[index]`. Overrides keep their explicit values; omitted override fields keep today's defaults (offset `widthMeters/2 + KERB_WIDTH + 0.6`, length 6). `buildTrack.ts` passes `halfWidths` from the parallel analysis (`parallel.halfLeft/halfRight`) when `parallel.any`, else omits it.
2. `sausagePieces`: apex arc position = cumulative centerline arc length (closing edge included) at the wrapped index. `count = max(1, ceil(length / 1))` pieces of length `length / count`, piece k centred at arc `apex − length/2 + (k + 0.5) · length/count` (wrapped modulo lap length). Each piece's centre is interpolated linearly on its centerline segment; lateral = `sign · offset` along that segment's right normal `(−dz, dx)` (right = +1, left = −1; zero-length segment falls back to direction (0, −1)); `y` = linearly interpolated elevation + lateral · interpolated `tan(bank)`; `yaw = atan2(dx, dz)` of the segment.
3. Renderer: one `THREE.InstancedMesh` named `sausages` over all pieces of all sausages, geometry `createSausageBodyGeometry()` (same trapezoid cross-section, length 1 along Z centred at 0, plain yellow vertex colour, no cap rings); instance matrix = rotationY(yaw) · scale(1, 1, piece.length) at position. The first and last piece of each sausage get instance colour black, the rest white. `SausageObject.count` stays the number of sausages; empty `sausages` still gives an empty group. Dispose frees geometry and material.
4. Colliders: per piece one convex hull `sausageHullPoints(piece.length)` at the piece pose, surface `kerb` (same registration as today).

Conventions: metres; length clamp inclusive (6 and 20 allowed); drop test `offset ≥ 0.8·radii` inclusive; inputs not mutated; builder sorts output as today; no `three` in `src/track/sausages.ts`.

## Fixtures (tests)

- `STADIUM(R)`: closed loop, width 12, flat elevation 0, no terrain, no runoffs/barriers/sausages/kerbs unless the row adds them. Straight A (0,0)→(200,0) every 2 m (endpoint excluded); semicircle centred (200,−R) from (200,0) to (200,−2R), m = max(12, ceil(π·R)) points at angles π·j/m, j = 0..m−1; straight B (200,−2R)→(0,−2R) every 2 m; semicircle centred (0,−R) back to (0,0), same m. Every bend is a left turn (inside = left). Kerbs, when a row says "kerbs", cover every index on both sides.
- Shared definitions: `R(i)` = `cornerCurvature(centerline, i).radius` (`src/track/surfaces.ts`); `inner(i, side)` = that corner's `side` equals `side`; `half(side, i)` = `halfWidthAt(track, side, i)`; `clearance(p)` = XZ distance from p to the nearest centerline sample point (any index); `halfNear(p)` = min of both half-widths at that nearest index. Builder side uses `radii()` and `detectCorners()` from `tools/track-builder/corners.ts`.
- "Built track" = `public/tracks/<id>.json` for every id in `public/tracks/index.json` (config overrides = `sausages` in `tools/track-builder/tracks.json`; an auto sausage is one not within 3 indices of an override with the same side).
- Footprint samples: for each piece from `sausagePieces`, 5 points along the piece's arc span (evenly over the whole sausage) × 3 lateral points at ±0.25 and 0 across the 0.5 m base.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | every built track | read `sausages` | every auto sausage (not matching a config override) has `6 ≤ length ≤ 20`, `offset ≥ half(side,index) + 1.8 − 1e-6`, `offset < 0.8·radii(centerline)[index]` |
| AT2 | all built tracks together | read lengths | at least 3 distinct `length` values |
| AT3 | every built track | recompute with exported `detectCorners`/`radii` | every auto sausage `length = clamp(0.5·arcLength(run.start, run.end), 6, 20)` (±1e-6), run = the corner run whose apex is the sausage index |
| AT4 | every built track | sausage footprint samples (5 along the arc × 3 across the 0.5 m width) from the new render pose function | every sample `clearance ≥ halfNear + KERB_WIDTH + 0.1` |
| AT5 | `STADIUM(30)` + a right sausage `{index: apex of bend 1, offset 7.8, length 10}` | pose samples | every sample at lateral 7.8 ± 0.05 from the nearest centerline point; arc span 10 ± 0.5 |
| AT6 | config overrides with `lengthMeters` | build | override length kept verbatim |
| AT7 | rebuilt JSONs vs pre-task | deep compare | only `sausages` differs |

## Acceptance criteria

- [ ] AT1–AT7 pass; `npm run build:tracks` leaves only `sausages` changed in every JSON.
- [ ] Only the test edits listed above.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Override semantics beyond the rule above, `SAUSAGE_CAP_LENGTH` colouring on exact 0.4 m, banked-track tuning, kerb/barrier rules (245/246), QA report (249).

## Planner-authorised test edits

- `tests/unit/acceptance/149-sausage-placement.test.ts` AT1: `length` expectation becomes `clamp(0.5 · arcLength(run.start, run.end), 6, 20)` per run (the fixture's R 40 corners now give lengths above 6); offset 7.8 and indices unchanged.
- `tests/unit/edge/150-sausage-render-edge.test.ts` EDGE7 (one mesh `sausages`, `count` = total pieces, `obj.count` 2), EDGE8 (matrix equals the first piece of `sausagePieces`), `tests/unit/edge/150-sausage-render.post.test.ts` POST5 (single mesh `sausages` replaces per-length meshes; geometry length check moves to `createSausageBodyGeometry`, length 1): expectations only follow the new instancing rule.
- `tests/unit/edge/174-sausage-colliders-and-ring.post.test.ts`: tests that look up a collider at a `sausagePose` position use the first piece of `sausagePieces` instead.
- `tests/unit/edge/211-fontana-roval-edge.test.ts` EDGE6: replace the sha256 with `sha256sum public/tracks/fontana.json` after the rebuild.
- 097 AT3, 106 AT5, 155 AT5 already ignore `sausages`: unchanged.

## Questions for the planner

- End caps become whole first/last pieces (≤ 1 m) coloured black instead of the 0.4 m gradient. Confirm.
