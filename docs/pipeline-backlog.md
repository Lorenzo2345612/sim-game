# Pipeline backlog

Changes to `scripts/ai/*` and `ai/*` wanted while a milestone is open. Apply in one batch after the user approves the milestone, then `orchestrator.py restart` once.

- Dashboard: show prefetched tasks separately from the active milestone.
- Drain: on restart, kill prefetched workers immediately instead of waiting for them (they rerun the same stage).
- tester-pre/acceptance prompts: when a test calls a function whose signature the task extends, call it through a loose cast (`fn as unknown as (...args: unknown[]) => unknown`) so commit-tests tsc passes before coding (081 hit TS2554).
- Stale `<num>-<stage>.resolved.md` from an earlier round makes the orchestrator resume immediately while the new `.md` stays open (seen on 092); resolve by decision timestamp or archive old resolved files.
- Coder timeouts on mimo-flash (092 twice, 25 min): auto-escalate to heavy after one TIMEOUT.
- Acceptance: a row the spec marks as "verification gate only" still escalates as untestable (065 twice). Skip escalation when the untestable list only names rows tagged as gates in the spec.
