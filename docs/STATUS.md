# Project status

Update this file when a phase starts/ends or a plan decision changes. Live task state is in `tasks/README.md` and `python3 scripts/ai/orchestrator.py status`.

## Now (2026-10-12)

- **Phase 0: done** (tasks 001–021). Playable prototype: Monza centerline, Rapier car (Kenney placeholder), chase camera, HUD, lap timer. `npm run dev`.
- **Phase 1: running unattended** (tasks 022–055) via the orchestrator, max 3 parallel. Design: `ai/guides/phase1.md`. Goal: Monza, Spa, Silverstone with elevation, kerbs, run-offs, barriers, forests, grandstands, pits; surface grip, track limits, gearbox, gamepad, cameras, HUD v2, minimap, ghost, audio, presets, track menu.
- **Blocked:** 053 F4 car — waiting for the user to download https://sketchfab.com/3d-models/f4-tatuus-t014-chasis-d61ce2f877fb4bf29da381cfa4f0f3d7 into `assets/vendor/f4/`; then the planner details the spec (inspect nodes, gltf-transform simplify < 80k tris, separate wheels, livery materials). Never use the "Tatuus" name in game.

## Pipeline (how work gets done)

Planner (Claude Opus, main session) designs and writes acceptance tables; Sonnet subagents write/review specs; cheap workers code (GLM/MiMo), test (Qwen), review (Kimi K3) via `scripts/ai/worker.py`; `scripts/ai/orchestrator.py` runs it all unattended; dashboard at http://127.0.0.1:8765. Details: `CLAUDE.md`, skills `plan-feature`, `pipeline-ops`.

Coder A/B (GLM vs MiMo) per task in `ai/experiments.json`; results so far (Phase 0): GLM 13 tasks, 1.2 rounds, 775k tokens, 4.1 min/task; MiMo 7 tasks, 1.0 rounds, 673k tokens, 7.2 min/task. `python3 scripts/ai/metrics.py`.

## Next

1. Finish Phase 1; review screenshots of the three tracks; tune physics with skill `physics-lab` if the handling feels off.
2. F4 car (053) when the asset arrives.
3. Automation step 2: orchestrator calls the planner headless (`claude -p` with Opus) on decisions via `ORCH_DECIDE_CMD`, user notified only for product questions.
4. Automation step 3: server deployment — Docker sandbox for workers, systemd services for orchestrator + dashboard, `claude setup-token`, Remote Control (or Telegram) as the user channel, push to a private GitHub repo per task.
5. Later phases (PRD §11): AI opponents and races (Phase 2), online (Phase 3).

## Known follow-ups

- Task 021 (dashboard) was written by the planner; its acceptance table has no automated test yet.
- Phase 0 visual polish noted: Kenney wheel pivot offset, no shadows (Phase 1 task 042 adds them), all Kenney assets to be removed with the F4 car.
