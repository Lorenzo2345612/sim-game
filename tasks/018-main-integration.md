# 018 — Integrate everything in main.ts (browser game)

Status: pending
Phase: 0
Depends on: 002, 003, 006, 007, 009, 012, 013, 014, 015, 016, 017
Roles: coder, reviewer

## Goal

`npm run dev` shows Monza with a drivable car (W accelerates, arrows steer, R resets) and the HUD with km/h and times.

## Context

`main.ts` is the only place that wires layers (`ai/guides/architecture.md`, "Layers and allowed dependencies"). Signatures used (exact, from their specs): 003 `new FixedStepLoop(step)`, `advance(frameSeconds): { steps, alpha }`; 007 `buildRibbon(centerline, width, y)`; 009 `new KeyboardInput(target: EventTarget)`, `update(dt): DriverInput`; 012 `createScene(): { scene, camera, ground, sun }`, `createRenderer(canvas): { renderer, resize(width, height, camera), dispose() }`; 013 `createTrackObject(ribbon, track): { group, dispose() }`; 014 `CarRenderer.load(url)`, `.root`, `.update(state)`; 015 `new ChaseCamera(camera)`, `.snap(state)`, `.update(state, dt)`; 016 `new Hud(container)`, `.update({ speedKmh, lap, currentLapTime, lastLapTime, bestLapTime })`; 017 `Game.create(track)`, `getPrevState()`, `getCurrentState()`, `getLapInfo()`, `simTime`, and `createVehicleState`, `interpolateVehicleState` from `src/core/interpolation.ts`; 002 `MS_TO_KMH`, `TrackData`. `index.html` already has `#game`, `#hud`, `#status` (task 001). `npm run build:tracks` already generated `public/tracks/monza.json`; the car model is at `public/models/race.glb`.

## Files

- `src/main.ts` — modify (replaces the placeholder)

## Steps

1. `import './ui/hud.css';` plus the required modules.
2. Declare the global type in the same file (make the file a module with `export {};` if needed):
```ts
declare global {
  interface Window {
    __SIMGAME__?: { ready: boolean; getSpeedKmh(): number; getLap(): number; getSimTime(): number };
  }
}
```
3. `async function main()`, invoked as `main().catch(onError)`. `status = document.getElementById('status')`. Wrap everything in `try/catch`: on error `status.textContent = 'Error: ' + message` (`message = e instanceof Error ? e.message : String(e)`) and `console.error(e)`.
4. Flow:
   1. `status.textContent = 'Loading…'`.
   2. `const res = await fetch('/tracks/monza.json')`; if `!res.ok` throw `Error('Could not load monza.json')`; `track: TrackData = await res.json()`.
   3. `const game = await Game.create(track)`.
   4. `canvas = document.getElementById('game') as HTMLCanvasElement`; `handle = createRenderer(canvas)` (012); `{ scene, camera } = createScene()` (012); `trackObj = createTrackObject(buildRibbon(track.centerline, track.widthMeters, 0.02), track)` (013, 007); `scene.add(trackObj.group)`.
   5. `car = await CarRenderer.load('/models/race.glb')` (014); `scene.add(car.root)`.
   6. `chase = new ChaseCamera(camera)` (015); `chase.snap(game.getCurrentState())`.
   7. `keyboard = new KeyboardInput(window)`; `hud = new Hud(document.getElementById('hud') as HTMLElement)`.
   8. `loop = new FixedStepLoop((dt) => game.step(keyboard.update(dt)))`; `interp = createVehicleState(4)` (reused).
   9. Resize: `window.addEventListener('resize', () => handle.resize(window.innerWidth, window.innerHeight, camera))` plus one initial call.
   10. `requestAnimationFrame(frameFn)` with `last` (ms) set on the first frame: `frame = Math.min((now - last) / 1000, 0.25); last = now; const { alpha } = loop.advance(frame); interpolateVehicleState(game.getPrevState(), game.getCurrentState(), alpha, interp); car.update(interp); chase.update(interp, frame); hud.update({ speedKmh: Math.abs(interp.forwardSpeed) * MS_TO_KMH, ...game.getLapInfo() }); handle.renderer.render(scene, camera); requestAnimationFrame(frameFn)`. No per-frame allocations.
   11. When loading finishes: hide `#status` (`status.style.display = 'none'`) and set `window.__SIMGAME__ = { ready: true, getSpeedKmh: () => Math.abs(game.getCurrentState().forwardSpeed) * MS_TO_KMH, getLap: () => game.getLapInfo().lap, getSimTime: () => game.simTime }`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/018-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | repo after the task | read `public/tracks/monza.json` | parses; id 'monza'; centerline length > 2000 |
| AT2 | `index.html` | parse text | contains elements `#game` (canvas), `#hud`, `#status` and script `/src/main.ts` |
| AT3 | `src/main.ts` text | read | references `__SIMGAME__`, `getSpeedKmh`, `getLap`, `getSimTime` and imports `./ui/hud.css` |

## Acceptance criteria

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- [ ] Manual check (`npm run dev`, open the URL): the car is visible on Monza; W/ArrowUp accelerates; left/right arrows steer; R resets to the start point; the HUD shows km/h and times.
- [ ] The acceptance tests AT1-AT3 pass (`public/tracks/monza.json` parses with `id === 'monza'` and `centerline.length > 2000`; `index.html` has `#game`, `#hud`, `#status` and `/src/main.ts`; `main.ts` references `__SIMGAME__`, `getSpeedKmh`, `getLap`, `getSimTime` and imports `./ui/hud.css`).
- [ ] `window.__SIMGAME__.ready === true` after load; `#status` hidden.
- [ ] If the fetch fails, `#status` shows "Error: ...".

## Verification

```
npm run typecheck
npm run lint
npm test
npm run build
```

## Out of scope

- New unit tests (task 019 covers this).
- Menus, track selection, audio, pause, gamepad, performance metrics, anything else on `window`.
- Code comments only where logic is non-obvious.
