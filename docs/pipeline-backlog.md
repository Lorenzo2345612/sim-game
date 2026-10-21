# Pipeline backlog

Changes to `scripts/ai/*` and `ai/*` wanted while a milestone is open. Apply in one batch after the user approves the milestone, then `orchestrator.py restart` once.

- Dashboard: show prefetched tasks separately from the active milestone.
- Drain: on restart, kill prefetched workers immediately instead of waiting for them (they rerun the same stage).
- tester-pre/acceptance prompts: when a test calls a function whose signature the task extends, call it through a loose cast (`fn as unknown as (...args: unknown[]) => unknown`) so commit-tests tsc passes before coding (081 hit TS2554).
- Stale `<num>-<stage>.resolved.md` from an earlier round makes the orchestrator resume immediately while the new `.md` stays open (seen on 092); resolve by decision timestamp or archive old resolved files.
- Coder timeouts on mimo-flash (092 twice, 25 min): auto-escalate to heavy after one TIMEOUT.
- merge_task rebases task branches; a `git merge master` commit in the branch (merge-note fixes) is dropped and conflicts replay (159). Squash the branch onto master (`reset --soft master`) before rebasing.
- auto-prefetch: when a task of a later milestone becomes ready (all deps done) and MiMo slots are free, run it without a manual `prefetch` edit (done by hand 6× on 2026-10-16).
- Triage can rewrite `.ai/decisions/NNN-stage.md` after the planner already renamed it to `.resolved.md` (255, 268 on 2026-10-18): skip triage when a newer `.resolved.md` exists.
- Acceptance/e2e tests that poll transient or wall-clock-timed sim states flake under slow SwiftShader frames (070-round2, 093-round1, 174-round1, 294-round2): acceptance prompt must sample (simTime, value) per frame or poll inside a window, never one read per second or a transient state; offer a deterministic `stepSim(n)` hook.
- Later task regenerates data or tunes constants pinned by older frozen acceptance/edge/post tests (112, 114, 125, 160, 175, 176, 246, 254, 268, 269, 270, 301 insights): coder is barred from tests so it escalates and burns rounds. Add a pre-dispatch "conflict scan" (grep earlier tests for the touched files/constants/JSONs) to spec-writer/plan-feature and list the needed "Planner-authorised" edits up front; let the orchestrator apply listed authorised test edits mechanically.
- Coder repeatedly skips or half-applies the spec's "Planner-authorised test edits" (112-round1, 207-round1, 254-round1, 269-round1, 269-round3, 316-round1) and reviewer re-blocks on them (228-round3): coder prompt should require a checklist of each authorised edit before any src work; reviewer prompt should treat spec-authorised test edits as accepted.
- Merge-state failures left to coder rounds (159-round2 UU state, 273-round1 conflict markers): orchestrator should `git add`/resolve or grep for conflict markers itself and never start a coder round for infra faults.
- Edge tests (130-*) use FakeEl/window stubs lacking DOM APIs, so new UI code breaks them (293-round1, 294-round1, 314-round1): coder prompt for src/ui: use bare globals and `classList.add/remove`, `style.setProperty` with optional chaining; or ship one shared complete FakeDoc helper in tests/.
- Task reaches review with no acceptance tests (188-round1): orchestrator should block the coder stage until acceptance tests exist for tasks that have an acceptance table.
