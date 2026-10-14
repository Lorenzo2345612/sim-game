#!/bin/bash
# Runs as root only to fix volume ownership, then drops to blort.
set -u
if [ "$(id -u)" = 0 ]; then
  chown blort:blort /home/blort
  exec gosu blort "$0" "$@"
fi
REPO=/home/blort/dev/sim-game
cd "$HOME"
if [ ! -d "$REPO/.git" ]; then
  echo "waiting for data restore into $REPO (see deploy/railway/README.md)"
  while [ ! -f "$HOME/.restore-done" ]; do sleep 30; done
fi
cd "$REPO"
[ -n "${GH_TOKEN:-}" ] && git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
git config --global user.name "${GIT_NAME:-Lorenzo Trujillo}"
[ -n "${GIT_EMAIL:-}" ] && git config --global user.email "$GIT_EMAIL"
[ -d node_modules ] || npm ci
rm -f .ai/orchestrator.lock
mkdir -p .ai
setsid nohup python3 scripts/ai/dashboard.py > .ai/dashboard.log 2>&1 < /dev/null &
if [ "${ORCH_AUTOSTART:-1}" = 1 ]; then
  setsid nohup python3 scripts/ai/orchestrator.py run --max-parallel "${ORCH_PARALLEL:-6}" >> .ai/orchestrator-run.log 2>&1 < /dev/null &
fi
exec /opt/simgame/planner-loop.sh
