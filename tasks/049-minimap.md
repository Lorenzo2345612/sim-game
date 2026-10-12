# 049 — Minimap

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

A top-down, north-up minimap of the track with a car dot, drawn on a canvas.

## Context

World: east = +X, north = -Z. Input is just the `centerline` array of any `TrackData`/`TrackDataV2` (`[x, z][]`); no imports from other tasks. Acceptance tests for this task are Vitest in `tests/unit/acceptance/` (pure mapping only, no canvas).

## Files

- `src/ui/minimap.ts` — create — pure fit function plus canvas drawer.
- `tests/unit/ui/minimap.test.ts` — create — extra edge tests.

## Steps

```ts
export interface MinimapTransform { scale: number; offsetX: number; offsetY: number }
/** Uniform scale to fit points in width×height with `padding` px on each side, centred; north-up. */
export function fitMinimap(points: readonly [number, number][], width: number, height: number, padding: number): MinimapTransform;
/** px x = worldX*scale + offsetX ; px y = worldZ*scale + offsetY (−Z world maps to smaller y, i.e. up). */
export function toMinimap(t: MinimapTransform, worldX: number, worldZ: number, out: { x: number; y: number }): { x: number; y: number };
export class Minimap {
  constructor(container: HTMLElement, centerline: readonly [number, number][], size?: number); // default 160, canvas appended
  update(carX: number, carZ: number): void; // redraw dot only (track path drawn once to an offscreen/static layer)
  dispose(): void;
}
```

- Degenerate input (0 or 1 point, zero extent): scale 1, centred.
- Aspect ratio preserved (same scale on both axes); mapped points lie inside `[padding, size - padding]`.
- Drawer: track as a 3 px white polyline, start line marker, red car dot radius 4. No allocation in `update`.
- Canvas CSS: `position: absolute; top: 12px; right: 12px; pointer-events: none`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/049-minimap.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | centerline square 100 m | `fitMinimap(points, 160, 160, padding 8)` | all mapped points inside [8, 152]; aspect preserved |
| AT2 | car at centerline[0] | dot position | equals mapped centerline[0] ±0.5 px |
| AT3 | track north-up | mapping | +X world → +x px, −Z world → −y px (north up) |

## Acceptance criteria

- [ ] All AT rows pass; `fitMinimap`/`toMinimap` import nothing from DOM.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into `main.ts` (task 054), zoom/rotation, ghost or sector markers.

