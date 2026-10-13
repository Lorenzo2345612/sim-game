# Pipeline backlog

Changes to `scripts/ai/*` and `ai/*` wanted while a milestone is open. Apply in one batch after the user approves the milestone, then `orchestrator.py restart` once.

- Dashboard: show prefetched tasks separately from the active milestone.
- Drain: on restart, kill prefetched workers immediately instead of waiting for them (they rerun the same stage).
- reviewer.md: record a baseline of failing checks on HEAD and report only regressions; assertion-neutral helper edits in protected tests forced by the spec are MINOR (insight 034-round2).
- coder.md: if a spec-mandated change breaks a protected test, report BLOCKED with file:line and the proposed patch (insight 034-round2).
- Retire `tests/unit/core/task002-contract.test.ts` (types/constants must equal architecture.md blocks verbatim: breaks every time a phase extends them); replace with a guide-sync note. Needs a small bugfix task.
