# 021 — Local progress dashboard for the AI pipeline

Status: done
Phase: 0
Depends on: nothing
Complexity: simple
Roles: acceptance, coder, reviewer

## Goal

`python3 scripts/ai/dashboard.py` serves a local web page that shows the pipeline progress live and offers a few whitelisted actions, so the user can follow the work without a terminal.

## Context

Python 3.12 stdlib only (`http.server`, `json`, `subprocess`); one HTML page with inline CSS/JS, no build, no npm. Tests: Python `unittest` in `scripts/ai/tests/` (not Vitest), run with `python3 -m unittest discover -s scripts/ai/tests -t .`. Reuse `scripts/ai/orchestrator.py` (`read_tasks`, `load_state`) and `scripts/ai/metrics.py` (`load_runs`) by importing them; respect `ORCH_ROOT` like the orchestrator does.

## Files

- `scripts/ai/dashboard.py` — create
- `scripts/ai/dashboard.html` — create (served at `/`)
- `scripts/ai/tests/test_acceptance_dashboard.py` — created by the acceptance worker

## Contract

- CLI: `dashboard.py [--port 8765]`. Binds to `127.0.0.1` only.
- `GET /` → the HTML page. It polls `/api/status` every 3 s and renders: task table (number, title, status, saved stage, fix rounds) with a progress bar (done/total), running worker processes, last 30 events, open decisions (with a "Resolved" button), coder-provider token summary, last 10 git commits.
- `GET /api/status` → JSON `{tasks: [{num,title,status,stage,fixRounds}], done, total, running: [str], events: [obj], decisions: [str], tokens: {provider: {tasks, total}}, commits: [str], orchestratorRunning: bool}`.
- `POST /api/action` with JSON `{"action": ...}`; only these actions, anything else → HTTP 400:
  - `run` (optional `only`: "018,019"): start `orchestrator.py run` detached (`start_new_session=True`, output appended to `.ai/orchestrator-run.log`) unless one is already running → 409.
  - `stop`: terminate the running orchestrator and its workers.
  - `resolve` with `file`: rename `.ai/decisions/<file>` to `<stem>.resolved.md`; `file` must be a plain name inside `.ai/decisions` (no `/`, no `..`) → else 400.
  - `tests`: run `npm test` and return `{ok, tail}` (last 40 lines).
- The orchestrator command is injectable for tests via env `DASH_ORCH_CMD` (default `python3 scripts/ai/orchestrator.py`).

## Acceptance tests (defined by the planner with Opus, before coding)

Start the server on a free port in a thread/subprocess against a temporary `ORCH_ROOT` repo with a `tasks/README.md` of 3 tasks (1 done), `.ai/state.json`, `.ai/events.log` with 2 lines and one `.ai/decisions/002-tester.md`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | server running | `GET /` | 200, `text/html`, body contains `sim-game` and `/api/status` |
| AT2 | fixture repo | `GET /api/status` | JSON with 3 tasks, `done` 1, `total` 3, the stage from state.json, 2 events, decisions `["002-tester.md"]` |
| AT3 | `DASH_ORCH_CMD` = a script that sleeps 5 s | `POST run` twice | first 200, second 409; `orchestratorRunning` true in status |
| AT4 | orchestrator started by AT3 | `POST stop` | 200; within 3 s `orchestratorRunning` false |
| AT5 | — | `POST resolve` with `002-tester.md` | file renamed to `002-tester.resolved.md`; decisions list empty |
| AT6 | — | `POST resolve` with `../x.md` or `a/b.md` | 400, nothing renamed |
| AT7 | — | `POST {"action":"rm -rf"}` | 400 |
| AT8 | server started | inspect bound address | host is `127.0.0.1` |

## Acceptance criteria

- [ ] AT1–AT8 pass; existing `scripts/ai/tests` still pass.
- [ ] Manual: `python3 scripts/ai/dashboard.py` then open http://127.0.0.1:8765 shows the real repo state.

## Verification

```
python3 -m unittest discover -s scripts/ai/tests -t .
```

## Out of scope

- Arbitrary command execution, authentication, remote access, websockets, charts libraries, editing specs from the page.
