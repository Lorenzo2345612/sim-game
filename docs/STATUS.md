# Project status

Update this file when a phase starts/ends or a plan decision changes. Live task state is in `tasks/README.md` and `python3 scripts/ai/orchestrator.py status`.

## Paused (2026-10-12 night, by the user)

Orchestrator stopped with `orchestrator.py stop`; every task resumes from its saved stage. No open decisions.
Relaunch: `setsid nohup python3 scripts/ai/orchestrator.py run --max-parallel 5 >> .ai/orchestrator-run.log 2>&1 < /dev/null &` (dashboard still up on 127.0.0.1:8765; if not, see pipeline-ops). Then re-arm the planner watcher (decisions or milestone build).
State: M1.1 approved. M1.2 open (043, 044, 077 kerb-lip verges, 079 DEM canopy filter (AT4 relaxed to realistic range), 085 elevation smoothing/grade cap). New M1.2b "Track look" (080 surface materials, 081 terrain splat, 082 markings, 083 barrier textures; CC0 textures already in public/textures). 078 reverse gear in M1.3. 064 runs heavy (MiMo Pro) after 4 flash timeouts.
User feedback driving these: gravel looks bad, kerbs act as walls, invisible barriers (render lands with 043; barriers stay where they are), asphalt must be smooth not terrain-like, no reverse. Tracks are "inspired by", realistic grades (PRD §14).

## Now (2026-10-12)

- **Phase 0: done** (tasks 001–021). Playable prototype: Monza centerline, Rapier car (Kenney placeholder), chase camera, HUD, lap timer. `npm run dev`.
- **Phase 1: running unattended** (tasks 022–056) via orchestrator v2 (worktrees, JSON reports, max 6 parallel), gated by deliverables in `tasks/milestones.json`: M0 (approved, build in `builds/M0`), M1.1 real tracks (active), M1.2 scenery + menu, M1.3 gameplay, M1.4 F4 car. Design: `ai/guides/phase1.md`. Goal: Monza, Spa, Silverstone with elevation, kerbs, run-offs, barriers, forests, grandstands, pits; surface grip, track limits, gearbox, gamepad, cameras, HUD v2, minimap, ghost, audio, presets, track menu.
- 053 F4 car: source GLB in `assets/vendor/f4/` (CC-BY, licensed), spec written (heavy, complex); also removes all Kenney assets. Runs in milestone M1.4.

## In flight (planner side)

- Test roles back on Qwen only (2026-10-12; tester A/B removed, Qwen cap 4). Early 'stalls' were the old watchdog killing long generations (fixed in c5c6853) and the ambiguous 031 table.
- Phase 1.5 planned: specs 058–070, milestone M1.5 (plan + tables in `docs/plans/phase15.md`, design `ai/guides/vehicle-dynamics.md`, lab reference `ai/lab/vehicle-model.mjs`). Pure modules 058–064 and 067 are prefetched. Car model research for 1.6 in `docs/research/car-models.md` (asset-scout running).
- M1.1 and every later milestone (M1.2…M1.6): the user delegated approval (2026-10-12), to advance as far as possible while away. When built: run skill `milestone-review`; if no blocking problems, `python3 scripts/ai/orchestrator.py approve M1.1` yourself and report the review to the user; if blocking problems, create bugfix tasks instead and do not approve.
- Phase 1.6 planned: specs 071–074, milestone M1.6 (`docs/plans/phase16.md`), prefetch 071, 072, 075 (GT3 D = Mustang source: 075 textures/wheel nodes, 076 definition).
- Background watcher in the planner session waits for the next milestone build (re-arm after a session restart with an until-loop on `tasks/milestones.json`: any milestone with status open and `builtAt` set).

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

- 2026-10-13 stop: orchestrator and dashboard stopped for shutdown (61/84 done, M1.2 7/10). Pending decision: 071-tester AT3. Relaunch with the same commands as above.

- Known geometry issue (2026-10-13, from 097): wide run-offs/verges of one section overlap a neighbouring section (Monza rows 319-325 verge over rows 343-346, Spa ~3340 left), ~0.2-0.7 m apart in height. Candidate fix: cap strip lateral extent where another section is closer (task after M1.2 review if visible).

- 2026-10-13: WSL (14 GB) hit an OOM kill with --max-parallel 5 (workers + vitest Rapier track tests). Not caused by the pipeline (user side); keep --max-parallel 5. If the lock survives a crash, check `ps` and delete `.ai/orchestrator.lock`.

- 2026-10-13: M1.2 approved (944de0e). Review: no blocking issues; known: Monza far hills show few trees, Silverstone start lights look dark, tyre stacks look large up close, menu not covered by review shots. Old M0 handling (vmax 175, brake+steer spin) until M1.5.

## 2026-10-13 afternoon
- Milestone order (user, 2026-10-13: F4 model before M1.2c): M1.2b (running) → M1.3 → M1.4 → M1.2c (visual realism + tracks Mexico City, Daytona, Lusail, Sakhir, Braselton, Elkhart Lake, Sepang: 099–106) → M1.5 → M1.6 → M1.6b (LMP2/Hypercar 112–114) → M1.7 (audio 107–111) → M2.1 (race 087–095). 054 and 057 prefetched.
- Plans: docs/plans/{m1.2c-realism,m1.6b-prototypes,m1.7-audio,phase2-race}.md. Approval delegated: review with milestone-review, approve if no blocking issues.
- Session routine: watcher loop on .ai/decisions + builtAt; resolve decisions (most were acceptance-table tolerance/fixture issues; see plan-feature tolerance rule).
- M1.2b approved 2026-10-13 (delegated). Known limits: grid boxes not seen in start shots (car on pole slot), mown stripes faint, armco/tyre textures subtle (103 replaces barriers), M0 handling (vmax 176).
- New track data (a25ce7d): braselton (Road Atlanta, OSM, +0.06 %), elkhart (Road America, OSM, −1.16 % vs 6515 m; shape matches OSM and the real layout, accepted like Daytona), sepang (bacinger my-1999, +0.28 %, OSM mean 1.81 m). Start lines and grandstands approximate. In task 106.
