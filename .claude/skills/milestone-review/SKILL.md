---
name: milestone-review
description: Automatic visual and handling review of a milestone build before handing it to the user. Use when a milestone shows BUILD READY, before telling the user to play it.
---

# milestone-review (planner)

Catches "tests pass but it looks/feels wrong" (blank track, HUD off-screen, car spins, wrong scale). Scripts in `scripts/review/`; outputs in `.ai/review/<id>/` (git-ignored).

1. Serve the build: `setsid nohup python3 scripts/ai/play.py <id> > /tmp/play-<id>.log 2>&1 < /dev/null &` (port in its first log line; M0=5300, next ids 5301...). Skip if already listening.
2. Run both (repo root, needs `node_modules`; ~2-5 min under software GL):
   - `node scripts/review/shots.mjs http://localhost:<port> .ai/review/<id>` -> PNGs + `report.json` (per track: shots at start / 4 s throttle / throttle+steer / top-down or minimap if exposed, console errors, fps, HUD rect, `__SIMGAME__` values). Builds without `?track=` support are captured once.
   - Optional: `node scripts/review/drive.mjs <url> <dir> <track> 6,8,10` (full throttle, shots at sim seconds; reaches the first corner/kerbs).
   - `node scripts/review/handling.mjs http://localhost:<port> .ai/review/<id>` -> `handling.json` (0-100, vmax, 150-0 braking, brake+steer spin test). Targets are in the `TARGETS` block at the top of the script; `null` = not measurable (build lacks heading/position getters).
3. Spawn a Sonnet subagent (Agent tool, `model: sonnet`). Give it the dir, the milestone entry in `tasks/milestones.json` and its task titles. Ask it to Read every PNG and both JSONs and return a short pass/fail list, each item with the PNG file name: blank/black screen, missing track/terrain/HUD, car floating or sunk, wrong scale, console errors, fps (swiftshader is slow; flag only < 5), handling outside targets, features the milestone promises but the shots do not show.
4. Decide:
   - No blocking issues: tell the user the build is ready; list the findings as known limitations; show 2-3 key shots with `explorer.exe "$(wslpath -w <png>)"`.
   - Blocking issues: create bugfix tasks (`Type: bugfix`) via `plan-feature`, then tell the user (or re-run after they land).
5. Stop the server if you started it (`kill <pid>`). Never touch the orchestrator.
