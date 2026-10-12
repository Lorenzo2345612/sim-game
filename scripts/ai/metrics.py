#!/usr/bin/env python3
"""Token metrics for worker runs, built from the logs in .ai/runs/.

Usage:
  scripts/ai/metrics.py              # per-task table + coder provider comparison
  scripts/ai/metrics.py --runs       # one line per run
  scripts/ai/metrics.py --csv FILE   # export every run to CSV
"""
import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / ".ai/runs"
NAME = re.compile(r"^(\d{8}-\d{6})-(acceptance|tester-pre|tester|coder|reviewer|fixer)-([a-z]+)-(.+?)(-resume)?\.json$")
FIELDS = ["stamp", "task", "role", "provider", "model", "resumed", "error", "turns", "seconds",
          "input", "output", "cache_read", "cache_write", "total"]


def task_status():
    status = {}
    readme = ROOT / "tasks/README.md"
    if readme.exists():
        for line in readme.read_text().splitlines():
            cells = [c.strip() for c in line.split("|")]
            if len(cells) > 4 and re.fullmatch(r"\d{3}", cells[1]):
                status[cells[1]] = cells[3]
    return status


def load_runs():
    runs = []
    for path in sorted(RUNS.glob("*.json")):
        m = NAME.match(path.name)
        if not m or m.group(4) == "adhoc":
            continue
        stamp, role, provider, label, resumed = m.groups()
        try:
            data = json.loads(path.read_text() or "{}")
        except json.JSONDecodeError:
            data = {"is_error": True}
        usage = data.get("modelUsage") or {}
        model = next(iter(usage), data.get("model", "?"))
        tok = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
        for u in usage.values():
            tok["input"] += u.get("inputTokens", 0)
            tok["output"] += u.get("outputTokens", 0)
            tok["cache_read"] += u.get("cacheReadInputTokens", 0)
            tok["cache_write"] += u.get("cacheCreationInputTokens", 0)
        runs.append({
            "stamp": stamp, "task": label[:3], "role": role, "provider": provider, "model": model,
            "resumed": bool(resumed), "error": bool(data.get("is_error")) or bool(data.get("timeout")),
            "turns": data.get("num_turns", 0), "seconds": round((data.get("duration_ms") or 0) / 1000),
            **tok, "total": sum(tok.values()),
        })
    return runs


def k(n):
    return f"{n / 1000:.1f}k"


def report(runs):
    status = task_status()
    by_task = defaultdict(list)
    for r in runs:
        by_task[r["task"]].append(r)

    print("task status   coder(provider:runs)  coder in/out/cache   coder total  all roles total  runs")
    coder_stats = defaultdict(lambda: {"tasks": 0, "done": 0, "runs": 0, "total": 0, "output": 0, "seconds": 0})
    for task in sorted(by_task):
        rs = by_task[task]
        coder = [r for r in rs if r["role"] in ("coder", "fixer")]
        prov = sorted({r["provider"] for r in coder if r["role"] == "coder"})
        c_in = sum(r["input"] for r in coder)
        c_out = sum(r["output"] for r in coder)
        c_cache = sum(r["cache_read"] + r["cache_write"] for r in coder)
        c_total = sum(r["total"] for r in coder)
        st = status.get(task, "?")
        print(f"{task}  {st:<12} {','.join(prov) or '-'}:{len(coder):<14} {k(c_in)}/{k(c_out)}/{k(c_cache):<10} "
              f"{k(c_total):>10}  {k(sum(r['total'] for r in rs)):>14}  {len(rs):>4}")
        if len(prov) == 1:
            s = coder_stats[prov[0]]
            s["tasks"] += 1
            s["done"] += st == "done"
            s["runs"] += len(coder)
            s["total"] += c_total
            s["output"] += c_out
            s["seconds"] += sum(r["seconds"] for r in coder)

    print("\ncoder provider  tasks  done  avg runs/task  avg tokens/task  avg output/task  avg min/task")
    for prov, s in sorted(coder_stats.items()):
        n = max(s["tasks"], 1)
        print(f"{prov:<15} {s['tasks']:>5} {s['done']:>5} {s['runs'] / n:>14.1f} {k(s['total'] / n):>16} "
              f"{k(s['output'] / n):>16} {s['seconds'] / n / 60:>13.1f}")

    print("\nby role/model   runs  tokens total  output")
    roles = defaultdict(lambda: [0, 0, 0])
    for r in runs:
        key = f"{r['role']}/{r['model']}"
        roles[key][0] += 1
        roles[key][1] += r["total"]
        roles[key][2] += r["output"]
    for key, (n, total, out) in sorted(roles.items()):
        print(f"{key:<36} {n:>4} {k(total):>12} {k(out):>7}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", action="store_true", help="one line per run")
    parser.add_argument("--csv", help="export runs to CSV")
    args = parser.parse_args()
    runs = load_runs()
    if args.csv:
        with open(args.csv, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(runs)
        print(f"{len(runs)} runs → {args.csv}")
    elif args.runs:
        for r in runs:
            print(" ".join(str(r[f]) for f in FIELDS))
    else:
        report(runs)


if __name__ == "__main__":
    main()
