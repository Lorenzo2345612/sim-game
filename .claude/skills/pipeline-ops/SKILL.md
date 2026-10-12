---
name: pipeline-ops
description: Operate the unattended AI pipeline — start/stop/queue the orchestrator, check status, resolve planner decisions, run the dashboard and the game dev server. Use when the user asks how it is going, to run/continue/stop tasks, or after a session restart.
---

# pipeline-ops (planner)

Everything runs detached from Claude Code (`setsid nohup`), so it survives session restarts and does not appear in the session's shell/agent panel.

## Status (cheap, check first)

```
python3 scripts/ai/orchestrator.py status          # one line per task: status, saved stage, fix rounds
tail -20 .ai/orchestrator-run.log                  # live steps
ls .ai/decisions/                                  # open planner decisions (*.md without .resolved)
ps -eo pid,etime,args | grep -E "[o]rchestrator.py run|[w]orker.py"
python3 scripts/ai/metrics.py                      # tokens per task/provider/role
git log --oneline -10
```
Dashboard: `setsid nohup python3 scripts/ai/dashboard.py > .ai/dashboard.log 2>&1 < /dev/null &` → http://127.0.0.1:8765 (status, events, decisions with "Resolved" button, run/stop, npm test).

## Run

```
setsid nohup python3 scripts/ai/orchestrator.py run [--max-parallel 3] [--only 020,021] >> .ai/orchestrator-run.log 2>&1 < /dev/null &
setsid nohup scripts/ai/run-after.sh 021 >> .ai/orchestrator-run.log 2>&1 < /dev/null &   # queue after the running one (script waits for it)
```
Only one orchestrator runs at a time (`.ai/orchestrator.lock`; a second `run` exits 4). Tasks run in worktrees `.ai/wt/<num>`; `orchestrator.py cleanup [--all] [--sessions DAYS]` removes leftovers. To stop: kill its process group (`kill -TERM -- -<pgid>`), never `pkill -f` with a pattern that matches your own shell. A restarted orchestrator resumes each task from its saved stage. Restart it after changing `orchestrator.py`/`worker.py` rules (running processes keep the old code).

## Deliverables (milestones)

`tasks/milestones.json` lists ordered deliverables (M0, M1.1, M1.2, …), each with its tasks and status `open → built → approved`. The orchestrator only runs the active (first non-approved) milestone's tasks; when they are all done it runs `npm run build` into `builds/<id>/`, tags the commit (`m1.1`), notifies and exits. The user plays it (dashboard "Play", or `python3 scripts/ai/play.py <id> --open` → http://localhost:53xx) and approves (dashboard "Approve & continue", or `orchestrator.py approve <id>` then `run`). Manual build: `orchestrator.py build <id>`. New tasks must be added to `tasks/tasks.json` AND to a milestone.

## Decisions

The orchestrator writes `.ai/decisions/<NNN>-<stage>.md` (SPEC_SILENT, UNTESTABLE, BLOCKED, escalation exhausted) and continues with other tasks. Planner: read it, fix the spec (or the acceptance table — Opus only) and commit, then rename the file to `<NNN>-<stage>.resolved.md` and start/restart the orchestrator; the stage reruns. Only product-level questions go to the user.

## Failure patterns seen

- Worker silent for minutes after reading context → stalled (watchdog kills at 8 min, `STALLED`). Large single-file tasks: split them or mark `Type: bugfix` (heavy models).
- Contradictory spec criteria → coder/reviewer ask for a planner decision; fix the spec, never let the coder weaken tests.
- Visual bugs pass unit tests: render tasks need a Playwright acceptance row with pixel checks.
- Orchestrator commit failures are logged as `commit-failed` events; files not listed in a spec's `## Files` stay uncommitted — check `git status` after each batch.

## Game and previews

- Game: `setsid nohup npx vite --port 5173 --strictPort --host 127.0.0.1 > .ai/vite-dev.log 2>&1 < /dev/null &` → http://localhost:5173 (`?track=spa` once task 043 lands). On WSL open URLs in Windows with `cmd.exe /c start "" <url>`, files with `explorer.exe "$(wslpath -w <file>)"`.
- Renders/screenshots: skill `render-preview`.
