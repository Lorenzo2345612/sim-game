# 052 — Graphics presets and FPS overlay

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Pure preset settings persisted in localStorage plus an F3 FPS / draw-calls overlay.

## Context

Acceptance tests are Vitest in `tests/unit/acceptance/052-graphics-presets.test.ts`; the overlay test uses a minimal fake element like `tests/unit/ui/hud.test.ts` (no new dependency). The preset e2e check (`?preset=low`) lives in task 054 AT6. `settings.ts` is pure (no `window`): storage and dpr are injected. The overlay takes an injected DOM parent and key target.

## Files

- `src/core/settings.ts` — create
- `src/ui/fpsOverlay.ts` — create
- `tests/unit/core/settings.test.ts` — create (invalid stored value, default)

## Steps

```ts
export type Preset = 'low' | 'medium' | 'high';
export interface PresetSettings { pixelRatio: number; shadows: boolean; treeFarDistance: number; antialias: boolean }
export function presetSettings(preset: Preset, devicePixelRatio: number): PresetSettings;
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const SETTINGS_KEY = 'settings';
export function loadPreset(storage: KeyValueStorage): Preset;   // JSON {"preset": "..."}; invalid/missing → 'high'
export function savePreset(storage: KeyValueStorage, preset: Preset): void;
export interface FrameStats { fps: number; drawCalls: number }
export class FpsOverlay {
  constructor(parent: HTMLElement, keyTarget: EventTarget);   // hidden at start; F3 keydown toggles
  update(stats: FrameStats): void;
  readonly element: HTMLElement;
  dispose(): void;
}
```

- Values: low = pixelRatio 1, shadows false, treeFarDistance 600, antialias false; medium = min(dpr,1.5), true, 1000, true; high = min(dpr,2), true, 1500, true.
- Overlay element: id `fps-overlay`, text `<fps> FPS | <drawCalls> draw calls` (fps rounded); `display: none` when hidden.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into the tests named in Context before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | preset 'low' / 'medium' / 'high' | `presetSettings` | pixelRatio 1/min(dpr,1.5)/min(dpr,2); shadows off/on/on; tree LOD far 600/1000/1500 m; antialias false/true/true |
| AT2 | stored preset | reload | read from localStorage key `settings` |
| AT4 | FPS overlay toggled with F3 | DOM | overlay shows fps and draw calls |

## Acceptance criteria

- [ ] AT1, AT2 and AT4 pass under Vitest.
- [ ] `settings.ts` imports nothing and references no `window`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying presets, `?preset=` parsing, `__SIMGAME__` (task 054); a settings UI.
