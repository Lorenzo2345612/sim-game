"""Summary of a bench-matrix dir: per race, each group's positions and median best lap, and order changes by cause."""
import collections
import json
import pathlib
import statistics
import sys

NAMES = {"front": "A", "mid": "B", "back": "C"}
for f in sorted(pathlib.Path(sys.argv[1]).glob("*.json")):
    try:
        d = json.loads(f.read_text())
    except ValueError:
        print(f"{f.stem}: no output")
        continue
    a_is_new = not f.stem.startswith(("solo-old", "old-"))
    label = {"A": "new" if a_is_new else "old", "B": "old" if a_is_new else "new", "C": "classic"}
    parts = []
    for g in ("front", "mid", "back"):
        r = [x for x in d["rows"] if x["grp"] == g]
        if not r:
            continue
        best = [x["best"] for x in r if x.get("best")]
        mb = f"{statistics.median(best):.2f}" if best else "-"
        parts.append(f"{label[NAMES[g]]} pos{[x['pos'] for x in r]} best {mb} pass {sum(x['passes'] for x in r)} out {sum(x['out'] for x in r)}")
    kinds = collections.Counter()
    for e in d.get("events", []):
        if e["t"] < 20:  # start shuffle
            continue
        w = label[NAMES[e["winner"].rstrip("0123456789")]]
        l = label[NAMES[e["loser"].rstrip("0123456789")]]
        kinds[f"{w}>{l}:{e['kind']}"] += 1
    print(f"{f.stem:22s} | " + " | ".join(parts))
    print(" " * 23 + "| " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items())))
