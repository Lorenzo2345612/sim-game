# infra-001 — Deterministic task orchestrator

Status: done
Complexity: complex
Depends on: nothing
Roles: acceptance, coder, reviewer

## Goal

Replace the LLM dispatcher with `scripts/ai/orchestrator.py`: a resumable, unattended Python program that runs the per-task worker pipeline of `.claude/skills/dispatch/SKILL.md` for all ready tasks, commits results and queues planner decisions.

## Context

Python 3.12 stdlib only (no pip packages). Tests use `unittest`, run with `python3 -m unittest discover -s scripts/ai/tests -t .` from the repo root. Never call real workers in tests: the worker command is injectable. Read `scripts/ai/worker.py` (report format), `ai/agents/*.md` (report keywords), `tasks/README.md` and one spec (e.g. `tasks/017-*.md`) for the formats.

## Files

- `scripts/ai/orchestrator.py` — create
- `scripts/ai/tests/__init__.py` — create (empty)
- `scripts/ai/tests/fake_worker.py` — create: test double for worker.py
- `scripts/ai/tests/test_orchestrator.py` — create: extra tests beyond acceptance

## Contract

CLI: `orchestrator.py run [--max-parallel N=3] [--only 018,019] [--dry-run]` and `orchestrator.py status`. Exit codes: 0 finished or nothing runnable; 3 stopped on quota error.

Configuration via env (for tests): `ORCH_ROOT` (repo root, default parent of `scripts/`), `ORCH_WORKER_CMD` (default `python3 scripts/ai/worker.py`, split with `shlex`), `ORCH_NOTIFY_CMD` (optional; called with one argument, the message), `ORCH_DECIDE_CMD` (optional; called with the decision file path).

Rules:
- Tasks: rows of the `tasks/README.md` table (`| # | Title | Status | Depends on | ... |`); spec = `tasks/<#>-*.md`. Ready = status not `done`/`blocked`, all deps `done`. Run ready tasks in ascending number, at most N concurrently (threads); re-evaluate after each task finishes.
- Pipeline: `acceptance` (only if the spec has a `## Acceptance tests` section with table rows) → `tester-pre` (only if `Complexity: complex`) → commit tests → `coder` → `tester` (complex only) → `reviewer` → done.
- Worker call: `<worker cmd> <role> --task tasks/<file>.md [--resume] [--heavy] [--note "<text>"]`. Parse the LAST `STATUS:`/`VERDICT:` line in stdout plus the `SPEC_SILENT:`, `UNTESTABLE:`, `FAILURES:` and `FINDINGS:` fields.
- Outcomes: acceptance `READY` and `UNTESTABLE: none` → continue, else decision. tester-pre `READY` and `SPEC_SILENT: none` → continue, else decision. coder `OK` → continue; `BLOCKED` → decision; `PARTIAL` counts as a failed round. tester `PASS` → continue; `FAIL` → fix round with the FAILURES text. reviewer `APPROVED` → done; `CHANGES`/`REJECTED` → fix round with only the `[BLOCKER]` lines (no BLOCKER lines → done).
- Fix rounds (after the first coder run): 1 and 2 `coder --resume --note`, 3 `coder --resume --heavy --note`, 4 `fixer --note` (fresh). A 5th failure → decision "escalation exhausted". After each fix round rerun the step that failed (tester or reviewer).
- Decision: write `.ai/decisions/<#>-<stage>.md` (task, stage, question, last report). Task status in README becomes `waiting decision`; call `ORCH_DECIDE_CMD` if set; continue other tasks. When the file is renamed to `<same>.resolved.md`, the next `run` reruns that stage.
- Commits (`git add` explicit paths only, never `-A`): after the test stages, `tests/unit/acceptance/<#>-*` and `tests/unit/edge/<#>-*` → `test: acceptance tests (task <#>)`. On done, set `Status: done` in the spec and README, then commit the spec, the README and the backticked paths listed in the spec's `## Files` section that exist → `feat: <title> (task <#>)`. Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- State: `.ai/state.json` `{ "<#>": { "stage": str, "fixRounds": int } }`, written after every step; `run` resumes each task from its saved stage.
- Quota: worker exit ≠ 0 and stdout contains `quota error` → stop launching, wait for running steps, event `quota`, exit 3.
- Events: append JSON lines `{ts, task, event, detail}` to `.ai/events.log` (events: start, step, decision, done, quota, finished). Call `ORCH_NOTIFY_CMD` on decision, quota, finished.
- `--dry-run`: print the ordered list of ready tasks and their stages; no worker calls, no writes.
- `status`: print one line per task: number, status, saved stage, fix rounds.

## Acceptance tests (defined by the planner with Opus, before coding)

All tests build a temporary git repo (`tempfile`) with a minimal `tasks/README.md`, specs and a `scripts/ai/tests/fake_worker.py` invocation via `ORCH_WORKER_CMD`. The fake worker answers from a JSON script file (env `FAKE_SCRIPT`): list of `{role, task, stdout, exit}` consumed in order per (role, task), and appends each received argv to a calls log.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | simple task 001 with acceptance table, all workers succeed | `run` | calls: acceptance, coder, reviewer in that order; README `done`; spec `Status: done`; git log has `test: acceptance tests (task 001)` then `feat: ... (task 001)` |
| AT2 | task 002 `Complexity: complex`, all succeed | `run` | calls: acceptance, tester-pre, coder, tester, reviewer |
| AT3 | 003 depends on 002 | `run --max-parallel 3` | first call for 003 happens after 002's reviewer call |
| AT4 | reviewer returns `CHANGES` with one `[BLOCKER]` and one `[MINOR]` line, then `APPROVED` | `run` | second coder call has `--resume` and a `--note` containing the BLOCKER line and not the MINOR line; reviewer called twice |
| AT5 | tester always `FAIL` | `run` | after the first coder call: coder `--resume`, coder `--resume`, coder `--resume --heavy`, fixer (no `--resume`), each followed by tester; then `.ai/decisions/<#>-tester.md` exists and README says `waiting decision` |
| AT6 | tester-pre reports `SPEC_SILENT: x`; independent task 004 succeeds | `run` | decision file for the complex task; its coder never called; 004 reaches `done` |
| AT7 | `.ai/state.json` has the task at stage `reviewer` | `run` | first call is reviewer (no acceptance, no coder) |
| AT8 | a worker exits 1 with `quota error` in stdout | `run` | exit code 3; `.ai/events.log` has a `quota` event; no further calls start |
| AT9 | 2 ready tasks | `run --dry-run` | no calls logged, no files changed, stdout lists both tasks |
| AT10 | decision file renamed to `.resolved.md` | `run` again | the stage that raised it is called again |
| AT11 | spec has no `## Acceptance tests` section | `run` | no acceptance call, no test commit |

## Acceptance criteria

- [ ] AT1–AT11 pass: `python3 -m unittest discover -s scripts/ai/tests -t .`
- [ ] `python3 scripts/ai/orchestrator.py run --dry-run` on the real repo lists 018 and 019 (after 017 is done) and changes nothing.

## Verification

```
python3 -m unittest discover -s scripts/ai/tests -t .
python3 scripts/ai/orchestrator.py status
python3 scripts/ai/orchestrator.py run --dry-run
```

## Out of scope

- Calling Claude, Remote Control, Docker, systemd, quota accounting by credits, pushing to remotes. Third-party packages.
