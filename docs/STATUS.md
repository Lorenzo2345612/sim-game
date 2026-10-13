# Project status

Update this file when a phase starts/ends or a plan decision changes. Live task state is in `tasks/README.md` and `python3 scripts/ai/orchestrator.py status`.

## Now (2026-10-12)

- **Phase 0: done** (tasks 001–021). Playable prototype: Monza centerline, Rapier car (Kenney placeholder), chase camera, HUD, lap timer. `npm run dev`.
- **Phase 1: running unattended** (tasks 022–056) via orchestrator v2 (worktrees, JSON reports, max 6 parallel), gated by deliverables in `tasks/milestones.json`: M0 (approved, build in `builds/M0`), M1.1 real tracks (active), M1.2 scenery + menu, M1.3 gameplay, M1.4 F4 car. Design: `ai/guides/phase1.md`. Goal: Monza, Spa, Silverstone with elevation, kerbs, run-offs, barriers, forests, grandstands, pits; surface grip, track limits, gearbox, gamepad, cameras, HUD v2, minimap, ghost, audio, presets, track menu.
- 053 F4 car: source GLB in `assets/vendor/f4/` (CC-BY, licensed), spec written (heavy, complex); also removes all Kenney assets. Runs in milestone M1.4.

## In flight (planner side)

- Test roles back on Qwen only (2026-10-12; tester A/B removed, Qwen cap 4). Early 'stalls' were the old watchdog killing long generations (fixed in c5c6853) and the ambiguous 031 table.
- Phase 1.5 planned: specs 058–070, milestone M1.5 (plan + tables in `docs/plans/phase15.md`, design `ai/guides/vehicle-dynamics.md`, lab reference `ai/lab/vehicle-model.mjs`). Pure modules 058–064 and 067 are prefetched. Car model research for 1.6 in `docs/research/car-models.md` (asset-scout running).
- M1.1: the user delegated approval (2026-10-12). When built: run skill `milestone-review`; if no blocking problems, `python3 scripts/ai/orchestrator.py approve M1.1` yourself and report the review to the user; if blocking problems, create bugfix tasks instead and do not approve.
- Phase 1.6 planned: specs 071–074, milestone M1.6 (`docs/plans/phase16.md`), prefetch 071, 072. Specs 075/076 (GT3 D textures + definition) being written by a Sonnet spec-writer: when `tasks/075-*.md` and `tasks/076-*.md` exist, add them to `tasks/tasks.json` (deps 071 / 072, 075; 075 Models heavy, coder on MiMo in `ai/experiments.json`), append to M1.6 `tasks` and `prefetch` 075, run `orchestrator.py readme`, commit.
- Background watcher in the planner session waits for M1.1 build (re-arm after a session restart with an until-loop on `tasks/milestones.json` M1.1 `builtAt`).

## Pipeline (how work gets done)

Planner (Claude Opus, main session) designs and writes acceptance tables; Sonnet subagents write/review specs; cheap workers code (GLM/MiMo), test (Qwen), review (Kimi K3) via `scripts/ai/worker.py`; `scripts/ai/orchestrator.py` runs it all unattended; dashboard at http://127.0.0.1:8765 (token stats at `/stats`). Details: `CLAUDE.md`, skills `plan-feature`, `pipeline-ops`.

Coder A/B (GLM vs MiMo) per task in `ai/experiments.json`; results so far (Phase 0): GLM 13 tasks, 1.2 rounds, 775k tokens, 4.1 min/task; MiMo 7 tasks, 1.0 rounds, 673k tokens, 7.2 min/task. `python3 scripts/ai/metrics.py`.

## Next

1. Finish Phase 1; review screenshots of the three tracks; tune physics with skill `physics-lab` if the handling feels off.
2. F4 car (053) when the asset arrives.
3. Automation step 2: orchestrator calls the planner headless (`claude -p` with Opus) on decisions via `ORCH_DECIDE_CMD`, user notified only for product questions.
4. Automation step 3: server deployment — Docker sandbox for workers, systemd services for orchestrator + dashboard, `claude setup-token`, Remote Control (or Telegram) as the user channel, push to a private GitHub repo per task.
5. Later phases (PRD §11): AI opponents and races (Phase 2), online (Phase 3).

## Known follow-ups

- Handling: M0 car spins too easily under brake + steer (equal brake on 4 wheels, no ABS, fast keyboard steer, equal rear side grip). Planned fix after M1.x as a bugfix task with heavy models: brake bias ~62/38, light ABS, more rear side grip, optional stability assist; ATs: no spin (rear slip < 25°) at 150 km/h full brake + full steer 2 s, realistic 200–0 distance, car still turns while braking. Calibrate first with skill `physics-lab`.

- Task 021 (dashboard) was written by the planner; its acceptance table has no automated test yet.
- Phase 0 visual polish noted: Kenney wheel pivot offset, no shadows (Phase 1 task 042 adds them), all Kenney assets to be removed with the F4 car.
