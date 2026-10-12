---
name: render-preview
description: Produce screenshots or interactive previews of the car, a track (top-down), the running game or downloaded asset packs, using headless Chrome/Playwright against a Vite server. Use when the user asks to see, render, preview or screenshot something.
---

# render-preview (planner)

Tools live in `scripts/preview/` (committed); outputs go to `.ai/shots/` (git-ignored).

1. Serve the repo root: `setsid nohup npx vite --port 5199 --strictPort --host 127.0.0.1 > /tmp/vite-preview.log 2>&1 < /dev/null &` (wait until `curl -s http://127.0.0.1:5199/` answers).
2. Pick the tool:
   - Car close-up, interactive (orbit controls): open `http://localhost:5199/scripts/preview/car.html` (`?v=front34|rear34|side` for fixed views).
   - Headless screenshots: `google-chrome --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,720 --virtual-time-budget=15000 --screenshot=.ai/shots/<name>.png "<url>"`.
   - Track top-down: `node scripts/preview/topdown.mjs` (edit the track file/width inside) → `.ai/shots/monza-topdown.png`.
   - Running game with real input: a Playwright script like `tests/e2e/phase0.spec.ts` (`chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader'] })`, wait for `window.__SIMGAME__.ready`).
   - Asset gallery (EZ-Tree presets, Sketchfab embeds, local packs): copy packs into `.ai/preview/models/` with a `manifest.json` (asset-scout can download them), then serve `.ai/preview/` with `python3 -m http.server 5200` and open `scripts/preview/gallery.html` copied there. The gallery uses three/ez-tree from esm.sh (import map), not the project bundle.
3. Look at the PNG with the Read tool before reporting; show it to the user with `explorer.exe "$(wslpath -w .ai/shots/<name>.png)"`.
4. Software GL (swiftshader) has less depth precision than real GPUs: z-fighting seen only in headless can be a false alarm, but treat it as a real risk for low-end GPUs.
