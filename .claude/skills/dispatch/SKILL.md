---
name: dispatch
description: Execute task specs from tasks/ with cheap worker models via scripts/ai/worker.py (coder on GLM flash, tester on Qwen flash, reviewer on Kimi), loop on review findings and escalate when they fail. Use when the user asks to implement, build, run, execute or continue tasks.
---

# dispatch (Claude only, the planner)

Claude does not edit `src/`, `tests/` or `tools/` (a hook blocks it). All code is written by the workers. Claude only launches workers, reads their short reports, decides and fixes specs.

## Commands

```
python3 scripts/ai/worker.py ping                                  # check providers
python3 scripts/ai/worker.py acceptance --task tasks/NNN-x.md      # Qwen flash, test-first
python3 scripts/ai/worker.py coder    --task tasks/NNN-x.md        # GLM flash
python3 scripts/ai/worker.py tester   --task tasks/NNN-x.md        # Qwen flash
python3 scripts/ai/worker.py reviewer --task tasks/NNN-x.md        # Kimi
python3 scripts/ai/worker.py fixer    --task tasks/NNN-x.md --note "..."   # DeepSeek flash (second opinion)
# add --heavy for the role's large model
# --provider mimo (or SIMGAME_PROVIDER=mimo) forces Xiaomi MiMo
# --resume continues that role's last session for the same task (keeps its context; only --note is sent)
```

If a provider answers with a quota or balance error (429/402), `worker.py` retries on its own with MiMo (`fallback` in `ai/providers.json`). If the report says `quota error` on MiMo too, stop and tell the user: no more providers.

Workers take minutes: launch them with Bash `run_in_background` and wait for the notification. Bash timeout: 600000 ms.

## Pipeline per task

1. Check that the task's dependencies are `done` in `tasks/README.md`. Mark the task `in progress`.
2. `acceptance` (Qwen flash): writes `tests/unit/acceptance/NNN-*.test.ts` from the spec's "Acceptance tests" table; expect `STATUS: READY` with failing tests. If `UNTESTABLE` rows: fix the table (planner, Opus) and rerun. Commit the acceptance tests before the coder starts (`test: acceptance tests (task NNN)`), so any later change shows in `git diff`. Specs without the table (Phase 0) skip this step.
3. `coder`. If `STATUS: BLOCKED`, read the reason: it is almost always an ambiguous or incomplete spec → fix the spec (not the code) and relaunch.
4. `tester`. If `FAIL`, pass the failures to the coder: `coder --task ... --note "<tester FAILURES>"`.
5. `reviewer`. If `CHANGES` or `REJECTED`, pass only the BLOCKER findings to the coder with `--note`. Ignore MINOR unless cheap; DOUBT items you decide by reading the cited code.
6. Repeat 4-5 until `APPROVED` with tests passing.
7. Mark the task `done` in the spec and in `tasks/README.md`. Summarize to the user in 2-3 lines.

Task statuses: pending | in progress | done | blocked.

## Fix rounds

Coder fix rounds (after tester FAIL or reviewer CHANGES) use `coder --task ... --resume --note "<findings>"`: the coder keeps what it already read. Also with `--heavy`. Tester, reviewer, acceptance and fixer always start fresh (independent judgement). If the resumed session cannot be found, `worker.py` starts a fresh one automatically.

## Escalation (to avoid spending on loops)

- 2 failed rounds with the flash model → same round with `--heavy`.
- 1 failed round with `--heavy` → `fixer` (other provider and model family) with all findings in `--note`.
- If it still fails: the problem is the spec. Re-split the task, or add detail (pseudocode, hints) ONLY for the part that failed. Tell the user.
- Never write the code yourself to unblock.

## Parallel

Tasks marked parallelizable in `tasks/README.md` (no shared files) can be launched together with several background Bash calls. Never two workers on the same task or the same files.

## Saving context

- Read only the report that `worker.py` prints. Full logs in `.ai/runs/` only if the report is not enough to decide, and with `tail`/`grep`, never whole.
- To review code use `git diff --stat` and read only the fragments cited by the reviewer.

## Brevity (mandatory)

- Specs, guides and messages to the user: concise and to the point. No introductions, no repeating what is already in `ai/guides/`, no justifying the obvious.
- To the user: result in a few lines (what was done, what fails, what is next). No long summaries.
- When requesting work from workers or subagents: require minimal output (the report block, no extra text).
