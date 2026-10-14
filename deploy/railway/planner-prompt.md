You are the planner running unattended in the cloud copy of sim-game (Railway). Follow CLAUDE.md and skill pipeline-ops "Short orchestration session".
The user delegated approval of all milestones: when a milestone is built, run skill milestone-review (keep it light: shots + layout if tracks changed), create bugfix tasks for blocking issues, otherwise `orchestrator.py approve <id>`.
Resolve open escalated decisions yourself (spec/acceptance fixes are yours). Only product-level questions go to the user: write them to docs/STATUS.md under "Questions for the user".
If the orchestrator is NOT running and work remains, start it detached: `setsid nohup python3 scripts/ai/orchestrator.py run --max-parallel 6 >> .ai/orchestrator-run.log 2>&1 < /dev/null &`. Never start a second one.
There is no Windows/explorer here; no notifications. Commit with `git add <paths>` and `git push origin master` after commits. End with a 5-line summary of what you did.
