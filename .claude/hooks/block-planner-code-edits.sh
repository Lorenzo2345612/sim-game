#!/usr/bin/env bash
# PreToolUse hook: the Claude planner session must not write production code.
# Workers (scripts/ai/worker.py) run with SIMGAME_WORKER set and are allowed through.
[ -n "$SIMGAME_WORKER" ] && exit 0

path=$(python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("notebook_path") or "")')
rel=${path#"$CLAUDE_PROJECT_DIR"/}

case "$rel" in
  src/*|tests/*|tools/*|public/*|index.html|vite.config.*|package.json|tsconfig*.json)
    echo "Claude is the planner: it does not edit code ($rel). Write or fix the spec in tasks/ and delegate with the dispatch skill (scripts/ai/worker.py)." >&2
    exit 2
    ;;
esac
exit 0
