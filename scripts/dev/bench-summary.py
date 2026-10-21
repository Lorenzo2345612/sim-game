"""One line per bench pair from race-3way.mts: positions and median best lap of new vs expert in each grid order."""
import json
import statistics
import sys
import time

name, newfront, oldfront = sys.argv[1:4]


def grp(path: str, g: str) -> str:
    d = json.load(open(path))
    r = [x for x in d["rows"] if x["grp"] == g]
    best = [x["best"] for x in r if x.get("best")]
    return f"pos {[x['pos'] for x in r]} best {statistics.median(best):.2f}" if best else "no laps"


print(f"{time.strftime('%H:%M')} {name} | new front: new {grp(newfront, 'front')} vs old {grp(newfront, 'mid')}"
      f" | old front: new {grp(oldfront, 'mid')} vs old {grp(oldfront, 'front')}", flush=True)
