# Pipeline backlog

Changes to `scripts/ai/*` and `ai/*` wanted while a milestone is open. Apply in one batch after the user approves the milestone, then `orchestrator.py restart` once.

- Dashboard: show prefetched tasks separately from the active milestone.
- Drain: on restart, kill prefetched workers immediately instead of waiting for them (they rerun the same stage).
- tester-pre/acceptance prompts: when a test calls a function whose signature the task extends, call it through a loose cast (`fn as unknown as (...args: unknown[]) => unknown`) so commit-tests tsc passes before coding (081 hit TS2554).
- Stale `<num>-<stage>.resolved.md` from an earlier round makes the orchestrator resume immediately while the new `.md` stays open (seen on 092); resolve by decision timestamp or archive old resolved files.
- Coder timeouts on mimo-flash (092 twice, 25 min): auto-escalate to heavy after one TIMEOUT.
- merge_task rebases task branches; a `git merge master` commit in the branch (merge-note fixes) is dropped and conflicts replay (159). Squash the branch onto master (`reset --soft master`) before rebasing.
- auto-prefetch: when a task of a later milestone becomes ready (all deps done) and MiMo slots are free, run it without a manual `prefetch` edit (done by hand 6× on 2026-10-16).
