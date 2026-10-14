#!/bin/bash
# Headless Opus planner: wakes when decisions/builds change, or the orchestrator is down.
set -u
cd /home/blort/dev/sim-game
LOG=.ai/planner-loop.log
last=""
lastrun=0
while true; do
  b=$(python3 scripts/ai/orchestrator.py brief --no-quota 2>&1)
  sig=$(printf '%s\n' "$b" | grep -E "decision |BUILD READY|\[built\]|NOT running" | grep -v "recent " | sort | md5sum | cut -c1-12)
  now=$(date +%s)
  if [ "${PLANNER_LOOP:-1}" = 1 ] && printf '%s' "$b" | grep -qE "decision |BUILD READY|\[built\]|NOT running" \
     && { [ "$sig" != "$last" ] || [ $((now - lastrun)) -gt "${PLANNER_REPEAT:-3600}" ]; }; then
    echo "=== $(date -Is) planner run sig=$sig" >> "$LOG"
    timeout 3600 claude -p --model opus --permission-mode bypassPermissions \
      "$(cat /opt/simgame/planner-prompt.md)" < /dev/null >> "$LOG" 2>&1
    echo "=== $(date -Is) exit $?" >> "$LOG"
    last=$sig; lastrun=$(date +%s)
  fi
  sleep "${PLANNER_INTERVAL:-300}"
done
