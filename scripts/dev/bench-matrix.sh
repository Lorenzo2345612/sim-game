#!/usr/bin/env bash
# Race matrix of a new residual model vs the published expert and the classic AI, logging every order change with its cause.
# Usage: scripts/dev/bench-matrix.sh <new.json> <outdir> [seeds]   (2 races in parallel, nice 19)
set -u
NEW=$1; OUT=$2; SEEDS=${3:-"1 2"}
cd "$(dirname "$0")/../.."; mkdir -p "$OUT"
E=public/ai-models/cleveland-f4/expert.json
run() { nice -n 19 npx tsx scripts/evolve/race-3way.mts "$2" "$3" --compound soft --seed "$4" --layout "$5" --log > "$OUT/$1-s$4.json" 2>/dev/null; }
jobs_=()
for s in $SEEDS; do
  jobs_+=("solo-new $NEW $E $s AAAAAAAAAAA" "solo-old $E $NEW $s AAAAAAAAAAA"
          "newfront $NEW $E $s AAAABBBBCCC" "oldfront $NEW $E $s BBBBAAAACCC" "mixed $NEW $E $s ABABABABCCC" "mixed2 $NEW $E $s BABABABACCC"
          "new-classic-front $NEW $E $s AAAACCCCCCC" "new-classic-back $NEW $E $s CCCCAAAACCC"
          "old-classic-front $E $NEW $s AAAACCCCCCC" "old-classic-back $E $NEW $s CCCCAAAACCC")
done
i=0
for j in "${jobs_[@]}"; do run $j & i=$((i+1)); [ $((i % 2)) -eq 0 ] && wait; done
wait
