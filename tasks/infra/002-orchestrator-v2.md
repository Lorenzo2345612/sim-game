# infra-002 — Orchestrator v2: JSON registry, JSON reports, worktrees, lock, provider caps

Status: pending
Complexity: complex
Depends on: infra-001
Roles: planner-defined tests, implementation by a Sonnet subagent in an isolated worktree

## Goal

Make the pipeline fully deterministic and parallel-safe: tasks come from `tasks/tasks.json`, worker reports are schema-validated JSON, every task runs in its own git worktree and is merged and cleaned up automatically, one orchestrator at a time, per-provider concurrency caps.

## Contract changes

1. **Registry** `tasks/tasks.json`: `{ "tasks": [ { "num": "022", "title", "status", "deps": ["…"], "complexity": "simple|complex", "type": "feature|bugfix", "phase": 1, "spec": "tasks/022-….md" } ] }`. Source of truth for status/deps/complexity/type. `orchestrator.py migrate` builds it once from `tasks/README.md` + spec headers. `tasks/README.md` is regenerated from it (`orchestrator.py readme`, also after every status change): intro line + `| # | Title | Status | Depends on |` table. Spec bodies still provide `## Files` and the acceptance section; spec `Status:` lines are no longer edited.
2. **JSON reports**: `ai/schemas/<role>.json` (acceptance, tester-pre, coder (also fixer), tester, reviewer) — JSON Schema with `additionalProperties: false`:
   - acceptance `{status: READY|BLOCKED, file: string, rows: integer, untestable: string[]}`
   - tester-pre `{status: READY|BLOCKED, file: string, gaps: string[], specSilent: string[]}`
   - coder `{status: OK|PARTIAL|BLOCKED, files: string[], verification: string[], decisions: string[], pending: string[]}`
   - tester `{status: PASS|FAIL|BLOCKED, tests: string[], failures: string[]}`
   - reviewer `{verdict: APPROVED|CHANGES|REJECTED, checks: {typecheck, lint, test: pass|fail|n/a}, findings: [{severity: BLOCKER|MINOR|DOUBT, location, problem, fix}]}`
   `worker.py` passes `--json-schema` and prints one line `[worker] report-json: <compact JSON>` taken from `structured_output`. The orchestrator uses that line; if missing, it falls back to the v1 text parser. Role prompts (`ai/agents/*.md`) replace their text report block with "return the JSON object required by the schema".
3. **Worktrees**: each task runs in `.ai/wt/<num>` on branch `task/<num>` created from the main branch HEAD when the task starts (reused if it exists); `node_modules` symlinked to the main repo's. Workers run with `cwd` = worktree via env `SIMGAME_WORKDIR` (worker.py: run claude, git status and the stall watchdog in WORKDIR; keep `.ai/runs` and `.ai/sessions` in the main repo). Commits happen in the worktree branch: tests commit after the test stages (`git add -A` minus `.ai`), task commit at the end (`git add -A` minus `.ai`). New stages after reviewer approval: `merge` (rebase `task/<num>` onto the main branch; on conflict: abort, decision `<num>-merge.md`, keep worktree; else `git merge --ff-only` in the main repo) → `cleanup` (`git worktree remove --force`, `git branch -d`) → `done`. On start: `git worktree prune`; worktrees of done or unknown tasks are removed; others kept. `merge` and `cleanup` are idempotent.
4. **Lock** `.ai/orchestrator.lock` (PID). A second `run` exits with code 4 while the PID is alive; a stale lock (dead PID) is taken over. Removed at exit.
5. **Provider caps**: `ai/providers.json` gets `maxConcurrent` per provider (glm 2, kimi 2, qwen 4, mimo 4). Each worker call holds a slot of the provider it will use (role provider, or the coder A/B provider from `ai/experiments.json`). `--max-parallel` default 6.
6. **E2E ports**: each running task gets env `E2E_PORT` = 4200 + slot; `playwright.config.ts` uses `process.env.E2E_PORT ?? 4173` and `reuseExistingServer: !process.env.E2E_PORT`.
7. **Cleanup command**: `orchestrator.py cleanup [--all] [--sessions DAYS]` removes worktrees of done/unknown tasks (`--all`: every worktree not used by a running orchestrator) and, with `--sessions`, worker transcripts in `~/.claude-workers/projects/*` older than DAYS.
8. **Dashboard**: `/api/status` adds `worktrees: [{num, branch, path}]` and `providers: {name: {running, max}}`; the page shows both.

9. **Quota** `scripts/ai/quota.py [--json] [provider]`: GLM `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` (Bearer key; `data.limits[]`: `usage` = limit, `currentValue` = used, `remaining`, `nextResetTime` ms; `unit` 3/`number` 5 = 5 h window, `unit` 6 = week) and Kimi `GET https://api.kimi.com/coding/v1/usages` (`limits[].detail` limit/used/remaining/resetTime for the 5 h window; `usages.limit_month_total.used_ratio`). Bailian and MiMo: `{"unsupported": true, "url": <console>}`. Keys from env or `~/.qwen/settings.json`, never printed. Returns per provider a list of `{window, used, limit, remaining, resetAt (ISO UTC), unit}`; exit 1 if any window has < 10 % remaining. The orchestrator checks quota before launching a worker on GLM/Kimi and, below 10 % in the 5 h window, routes that call to the fallback provider (`--provider mimo`); dashboard shows the quota table (refreshed every 60 s, cached).

## Acceptance tests (defined by the planner with Opus, before coding)

Python unittest in `scripts/ai/tests/test_acceptance_orchestrator_v2.py` (temp git repos, fake worker that also logs env `SIMGAME_WORKDIR`, and can emit `[worker] report-json:` lines). The v1 tests in `test_acceptance_orchestrator.py` are updated to write `tasks/tasks.json` fixtures; their expectations stay the same except where the contract above changes them (spec Status no longer edited; commits land via merge).

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | README + specs of 3 tasks (v1 layout) | `migrate` | tasks.json with 3 entries, deps/complexity/type from headers; `readme` regenerates an equivalent table |
| AT2 | fake coder prints `[worker] report-json: {"status":"OK",...}` and NO text report | run | parsed as OK (pipeline continues) |
| AT3 | reviewer JSON with findings BLOCKER + MINOR | run | fix note contains only the BLOCKER `problem`/`location` |
| AT4 | simple task, all succeed | run | worker calls had `SIMGAME_WORKDIR` = `<repo>/.ai/wt/<num>`; main branch log has the test commit and the task commit; `.ai/wt/<num>` and branch `task/<num>` no longer exist; tasks.json status done |
| AT5 | two independent tasks whose workers edit the same file differently (fake worker writes into WORKDIR) | run | first merges; second gets decision `<num>-merge.md`, its worktree kept, status `waiting decision` |
| AT6 | orchestrator running (lock held by a live PID) | second `run` | exit code 4, no worker calls |
| AT7 | lock file with a dead PID | run | takes over and runs |
| AT8 | maxConcurrent glm = 1, 3 ready tasks all coded by glm, fake coder sleeps 1 s and logs start/end times | run --max-parallel 6 | coder intervals never overlap; acceptance calls (qwen cap 4) do overlap |
| AT9 | leftover `.ai/wt/<num>` for a task marked done | run (or `cleanup`) | worktree and branch removed |
| AT10 | state.json says stage `merge` and the branch is already merged | run | no error; proceeds to cleanup and done |
| AT11 | two running tasks | env of their workers | distinct `E2E_PORT` values ≥ 4200 |
| AT12 | dashboard `/api/status` with one live worktree | GET | `worktrees` has it; `providers` lists caps |
| AT13 | quota functions with mocked HTTP responses (the samples above) | `quota.glm()`, `quota.kimi()` | windows parsed: glm 5h used 399/2000 remaining 1600, week 2439/10000; kimi 5h 63/100 remaining 37; reset times ISO UTC |
| AT14 | mocked kimi 5h remaining 5 % | orchestrator about to launch the reviewer | worker called with `--provider mimo` |

## Verification

```
python3 -m unittest discover -s scripts/ai/tests -t .
python3 scripts/ai/orchestrator.py migrate && python3 scripts/ai/orchestrator.py run --dry-run
```

## Out of scope

Calling the planner automatically, server deployment, notifications.
