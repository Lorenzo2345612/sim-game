#!/usr/bin/env bash
# Every 40 min: fetch the newest model of a Modal run and race it against the current expert (soft, both grid orders).
# Usage: setsid nohup scripts/dev/watch-train.sh aggr10 6 >/dev/null 2>&1 &   (tag, hours)
set -u
TAG=$1; HOURS=${2:-6}
cd "$(dirname "$0")/../.."
OUT=.ai/bench-$TAG; DIR=scripts/evolve/models/scratch/$TAG; mkdir -p "$OUT" "$DIR"
MODAL=~/.local/share/pipx/venvs/modal/bin/modal; [ -x "$MODAL" ] || MODAL=modal
E=public/ai-models/cleveland-f4/expert.json
END=$(( $(date +%s) + HOURS * 3600 ))
while [ "$(date +%s)" -lt "$END" ]; do
  sleep 2400
  NEW=$("$MODAL" volume ls simgame-evolve "models/cleveland-f4-$TAG" 2>/dev/null | grep -o 'race-[0-9]*s-gen[0-9]*\.json' | sed 's/.*gen\([0-9]*\).*/\1 &/' | sort -n | tail -1 | cut -d' ' -f2)
  [ -z "$NEW" ] && continue
  [ -f "$OUT/${NEW%.json}.done" ] && continue
  "$MODAL" volume get simgame-evolve "models/cleveland-f4-$TAG/$NEW" "$DIR/" --force >/dev/null 2>&1 || continue
  N=$DIR/$NEW
  nice -n 19 npx tsx scripts/evolve/race-3way.mts "$N" "$E" --compound soft --seed 1 > "$OUT/${NEW%.json}-newfront.json" 2>/dev/null
  nice -n 19 npx tsx scripts/evolve/race-3way.mts "$E" "$N" --compound soft --seed 1 > "$OUT/${NEW%.json}-oldfront.json" 2>/dev/null
  python3 -I scripts/dev/bench-summary.py "$NEW" "$OUT/${NEW%.json}-newfront.json" "$OUT/${NEW%.json}-oldfront.json" >> "$OUT/summary.log" 2>&1
  touch "$OUT/${NEW%.json}.done"
done
