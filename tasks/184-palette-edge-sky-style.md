# 184 — Palette tints, edge-line colour and sky overrides from the track style

Status: pending
Phase: 1
Depends on: 180, 183, 156, 157, 158, 159, 160, 168, 174, 175
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`style.palette`, `style.edgeLines` and `style.sky` change the asphalt/grass/gravel tint, the edge-line colour, the HDRI and the fog density. Default style reproduces today's output exactly.

## Context

Design: `docs/design/track-style.md` (File, Rendering). Types: `ResolvedTrackStyle`, `DEFAULT_TRACK_STYLE` from `src/track/trackStyle.ts` (179); optional trailing `style` plumbing and the loaded style in `main.ts` come from 180. Defaults are `null` = renderer default. Guide: `ai/guides/testing.md`.

## Files

- `src/render/surfaceMaterials.ts` — modify
- `src/render/trackMarkingsRenderer.ts` — modify
- `src/render/environment.ts` — modify
- `src/render/trackSurfaceRenderer.ts` — modify only if 183 did not already forward `options.style` to `createSurfaceMaterial` (183 adds the unused 4th `style?` param; 184 implements it)
- `src/main.ts` — modify (only `SceneStats.fogDensity`, its initial value and the `sceneStats()` field; pass the loaded style to `applyEnvironment` and `createTrackMarkingsObject`)
- `tests/unit/acceptance/184-palette-edge-sky-style.test.ts`, `tests/e2e/acceptance/184-palette-edge-sky-style.spec.ts` — acceptance worker creates

## Steps

Signatures (the new trailing params are optional; `style` undefined = default):

```ts
createSurfaceMaterial(kind: SurfaceMaterialKind, loadTexture?: (url: string) => THREE.Texture, macro?: THREE.Texture, style?: ResolvedTrackStyle, paint?: SurfacePaint): THREE.MeshStandardMaterial // 4th param added unused by 183, 5th `paint` is 183's; keep it unchanged
createTrackMarkingsObject(strips: SurfaceStrip[], style?: ResolvedTrackStyle): TrackMarkingsObject
export function envNameFor(trackId: string, style?: ResolvedTrackStyle): string
export function fogDensityFor(trackId: string, style?: ResolvedTrackStyle): number
applyEnvironment(scene, trackId, renderer, style?: ResolvedTrackStyle)   // existing params unchanged
```

1. Palette: only kinds `asphalt`, `grass`, `gravel`, and only when `style.palette.<kind>` is non-null: `material.color.set(hex)` (sRGB hex, so `color.getHexString()` equals the hex without `#`). Other kinds and null keys keep white.
2. Edge lines: when `style.edgeLines.color` is non-null the marking material colour is that hex. `registerWhitePaint` is called only if the colour is null (today's linear 0.7 grey) or the hex has HSL lightness ≥ 0.85; in the latter case scale the linear colour uniformly so its max channel is 0.7, then register.
3. `envNameFor` = `style?.sky.hdri ?? ENV_TABLE[trackId] ?? ENV_TABLE.monza`. `fogDensityFor` = (`FOG_TABLE[trackId] ?? FOG_TABLE.monza`).density × (`style?.sky.fogDensityScale ?? 1`). `applyEnvironment` uses both helpers for the HDRI path and the FogExp2 density.
4. `SceneStats.fogDensity: number` = `scene.fog.density` when the fog is `THREE.FogExp2`, else 0.

Conventions: no rounding; null/undefined style key = default; style is never mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Offsets are measured from the track edge, not the centerline. E2E rows use Playwright `page.route` on `**/tracks/monza.style.json`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | DEFAULT style | `createSurfaceMaterial(kind, load, macro, style)` for asphalt, grass, gravel | material `color` is white (1,1,1) as today |
| AT2 | palette `{asphalt: '#808080', grass: '#c0d080', gravel: '#dac090'}` | create | each material `.color.getHexString()` equals the given hex (in sRGB) |
| AT3 | edgeLines `{color: '#dac400'}` | `createTrackMarkingsObject(strips, style)` | marking material colour `#dac400`; `registerWhitePaint` not called for it (not white) |
| AT4 | DEFAULT style | createTrackMarkingsObject | colour unchanged from today (linear 0.7, 0.7, 0.7) and still registered as white paint |
| AT5 | sky `{hdri: 'kloofendal_overcast_puresky'}` for track monza | `envNameFor('monza', style)` | `'kloofendal_overcast_puresky'`; with default style → `ENV_TABLE.monza` |
| AT6 | sky `{fogDensityScale: 2}` | `fogDensityFor('monza', style)` | `2 × FOG_TABLE.monza.density` (±1e-12); default → unchanged |
| AT7 | e2e `?track=monza`, route style `{"version":1,"sky":{"fogDensityScale":2}}` | `scene.fog.density` via `__SIMGAME__.sceneStats()` (add `fogDensity` to sceneStats) | 2 × the value without the style (±1e-9) |

## Acceptance criteria

- [ ] Every AT row passes; existing tests 042, 080, 082, 099 and `tests/unit/render/environment.test.ts` pass unchanged.
- [ ] Calls without `style` produce the same materials as before.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 184-
```

## Out of scope

- Palette for runoff, kerb, concrete or terrain materials; ground/vegetation palette (156).
- New HDRI files; fog colour changes; night lighting (M2.2b).
- Editing any `public/tracks/*.style.json`.

## Planner-authorised edits (decision 184-coder)

- `tests/unit/edge/043-world-integration.test.ts` EDGE5: regex becomes `/applyEnvironment\(\s*scene\s*,\s*track\.id\s*,\s*handle\.renderer\s*(,\s*[\w.]+\s*)?\)/` (optional 4th argument). Nothing else in that file.
- AT7 e2e: if it times out under host load, raise that test's timeout to 180 s (`test.setTimeout(180_000)`) and the ready wait to 120 s; assertion unchanged.
- The coder's choices listed in the decision (no trackSurfaceRenderer change, HSL lightness rule, `SceneStats.fogDensity`) are accepted.
