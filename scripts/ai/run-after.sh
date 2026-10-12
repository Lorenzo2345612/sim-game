#!/bin/bash
# Wait for the current orchestrator to finish, then run the next batch.
while ps -eo args | grep -q "^python3 scripts/ai/orchestrator.py run"; do sleep 20; done
exec python3 scripts/ai/orchestrator.py run --only "$1"
