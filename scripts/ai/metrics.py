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
import os
import re
from datetime import datetime
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


def outcome(data):
    """pass / fail / stalled / '' (unknown) for one worker result file."""
    if data.get("timeout"):
        return "stalled"
    so = data.get("structured_output")
    word = str(so.get("verdict") or so.get("status") or "") if isinstance(so, dict) else ""
    if not word:
        m = re.findall(r"(?:STATUS|VERDICT): (\w+)", str(data.get("result") or ""))
        word = m[-1] if m else ""
    word = word.upper()
    if word in ("OK", "PASS", "READY", "APPROVED"):
        return "pass"
    if word in ("CHANGES", "BLOCKED", "PARTIAL", "FAIL", "REJECTED") or data.get("is_error"):
        return "fail"
    return "pass" if word else ""


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
            "result": outcome(data),
        })
    return runs


# -- Claude Code transcripts (planner Opus + Sonnet subagents) ------------------------------

TASK_REF = re.compile(r"tasks/(\d{3})")
_PARSE_CACHE = {}  # path -> (mtime_ns, size, parsed)


def claude_dirs(root=ROOT):
    env = os.environ.get("CLAUDE_PROJECTS_DIR")
    if env:
        return [Path(env)]
    bases = [Path.home() / ".claude"]
    cfg = os.environ.get("CLAUDE_CONFIG_DIR_PLANNER") or os.environ.get("CLAUDE_CONFIG_DIR")
    if cfg and Path(cfg).resolve() != bases[0].resolve():
        bases.append(Path(cfg))
    slug = re.sub(r"[^A-Za-z0-9]", "-", str(root))
    return [d for b in bases for d in sorted((b / "projects").glob(slug + "*"))
            if d.name == slug or d.name.startswith(slug + "--claude-worktrees")]


def _text(content):
    if isinstance(content, str):
        return content
    return " ".join(b.get("text", "") for b in content if isinstance(b, dict)) if isinstance(content, list) else ""


def parse_transcript(path):
    """Unique assistant messages (streamed duplicates collapsed by message id) + first user prompt."""
    msgs, prompt, worker = {}, "", False
    for line in path.read_text(errors="replace").splitlines():
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if not isinstance(d, dict):
            continue
        if ".claude-workers" in str(d.get("cwd") or ""):
            worker = True
        if d.get("type") == "user" and not prompt:
            prompt = _text((d.get("message") or {}).get("content"))
        if d.get("type") != "assistant":
            continue
        m, u = d.get("message") or {}, (d.get("message") or {}).get("usage") or {}
        model = str(m.get("model") or "")
        if not model.startswith("claude-") or not u:
            continue
        try:
            ts = datetime.fromisoformat(str(d["timestamp"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        key = m.get("id") or d.get("requestId") or d.get("uuid")
        cur = msgs.setdefault(key, {"ts": ts, "model": model, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0})
        cur["ts"] = min(cur["ts"], ts)
        for k_, f in (("input", "input_tokens"), ("output", "output_tokens"),
                      ("cache_read", "cache_read_input_tokens"), ("cache_write", "cache_creation_input_tokens")):
            cur[k_] = max(cur[k_], int(u.get(f) or 0))
    return {"msgs": sorted(msgs.values(), key=lambda x: x["ts"]), "prompt": prompt, "worker": worker}


def _parsed(path):
    st = path.stat()
    hit = _PARSE_CACHE.get(str(path))
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    data = parse_transcript(path)
    _PARSE_CACHE[str(path)] = (st.st_mtime_ns, st.st_size, data)
    return data


def _runs_from(parsed, role, task, extra):
    """One run per (transcript, local day, model) so long sessions land on the right day."""
    groups = {}
    for m in parsed["msgs"]:
        local = m["ts"].astimezone()
        groups.setdefault((local.strftime("%Y%m%d"), m["model"]), []).append((local, m))
    runs = []
    for (day, model), items in sorted(groups.items()):
        tok = {k_: sum(m[k_] for _, m in items) for k_ in ("input", "output", "cache_read", "cache_write")}
        secs = sum(min((b[0] - a[0]).total_seconds(), 120) for a, b in zip(items, items[1:]))
        runs.append({"stamp": items[0][0].strftime("%Y%m%d-%H%M%S"), "task": task, "role": role, "provider": "claude",
                     "model": model, "resumed": False, "error": False, "turns": len(items), "seconds": round(secs),
                     **tok, "total": sum(tok.values()), "result": "", **extra})
    return runs


def load_claude_runs(dirs=None):
    runs, latest = [], {}
    for d in claude_dirs() if dirs is None else dirs:
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.jsonl")) + sorted(d.glob("*/subagents/*.jsonl")):
            key = (d.name, str(path.relative_to(d)))  # session copied across config dirs: keep the longest copy
            if key not in latest or path.stat().st_size > latest[key].stat().st_size:
                latest[key] = path
    for path in latest.values():
        try:
            p = _parsed(path)
        except OSError:
            continue
        if p["worker"] or not p["msgs"]:
            continue
        if path.parent.name == "subagents":
            meta = {}
            try:
                meta = json.loads(path.with_suffix(".meta.json").read_text())
            except (OSError, ValueError):
                pass
            refs = set(TASK_REF.findall(p["prompt"]))
            runs += _runs_from(p, "planner-subagent", refs.pop() if len(refs) == 1 else PLANNING,
                               {"agent": meta.get("agentType", ""), "description": meta.get("description", "")})
        else:
            runs += _runs_from(p, "planner", PLANNING, {"agent": "", "description": ""})
    return runs


PLANNING = "plan"


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
