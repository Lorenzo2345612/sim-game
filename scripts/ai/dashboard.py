#!/usr/bin/env python3
"""Local progress dashboard for the AI pipeline (spec: tasks/021-progress-dashboard.md).

Usage: python3 scripts/ai/dashboard.py [--port 8765]   → http://127.0.0.1:8765
Only whitelisted actions: run, stop, resolve, tests. Binds to 127.0.0.1.
"""
import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import orchestrator as orch  # noqa: E402  (respects ORCH_ROOT)
import metrics  # noqa: E402
import quota  # noqa: E402
import re  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from urllib.parse import parse_qs, urlparse  # noqa: E402

ROOT = orch.ROOT
HTML = Path(__file__).resolve().parent / "dashboard.html"
STATS_HTML = Path(__file__).resolve().parent / "stats.html"
ASSETS = {"/ui.css": ("ui.css", "text/css; charset=utf-8"), "/ui.js": ("ui.js", "text/javascript; charset=utf-8")}
ORCH_CMD = shlex.split(os.environ.get("DASH_ORCH_CMD") or "python3 scripts/ai/orchestrator.py")
LOG = ROOT / ".ai/orchestrator-run.log"
QUOTA = {}  # provider -> windows, refreshed every 60 s by refresh_quota()
started = []  # Popen objects launched by this dashboard


def proc_table():
    """All processes as {pid, ppid, etime, args}. DASH_PS_FILE (ps -eo pid,ppid,etime,args output) overrides ps."""
    src = os.environ.get("DASH_PS_FILE")
    out = Path(src).read_text() if src else subprocess.run(
        ["ps", "-eo", "pid,ppid,etime,args"], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines()[1:]:
        parts = line.strip().split(None, 3)
        if len(parts) == 4 and parts[0].isdigit() and parts[1].isdigit():
            rows.append({"pid": int(parts[0]), "ppid": int(parts[1]), "etime": parts[2], "args": parts[3]})
    return rows


def ours(pid):
    """False when the process belongs to another tree (cwd outside ROOT, or ORCH_ROOT elsewhere). Unreadable -> True."""
    root = os.path.realpath(ROOT)
    try:
        cwd = os.path.realpath(f"/proc/{pid}/cwd")
        if not os.path.exists(f"/proc/{pid}/cwd"):
            return True
        if cwd != root and not cwd.startswith(root + os.sep):
            return False
    except OSError:
        return True
    try:
        env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    except OSError:
        return True
    for item in env:
        if item.startswith(b"ORCH_ROOT=") and os.path.realpath(item[10:].decode(errors="replace")) != root:
            return False
    return True


def processes():
    return [{k: p[k] for k in ("pid", "etime", "args")} for p in proc_table()
            if ("orchestrator.py run" in p["args"] or "worker.py " in p["args"]) and "grep" not in p["args"]
            and ours(p["pid"])]


def orchestrator_pids():
    pids = [p["pid"] for p in processes() if "orchestrator.py run" in p["args"]]
    pids += [p.pid for p in started if p.poll() is None and p.pid not in pids]
    return pids


def workers():
    out = []
    for p in processes():
        m = re.search(r"worker\.py (\S+) .*?--task tasks/(\d{3})", p["args"])
        if not m:
            continue
        pm = re.search(r"--provider (\S+)", p["args"])
        out.append({"pid": p["pid"], "etime": p["etime"], "role": m.group(1), "task": m.group(2),
                    "provider": pm.group(1) if pm else orch.provider_of(m.group(1), m.group(2)),
                    "heavy": "--heavy" in p["args"], "resume": "--resume" in p["args"]})
    return out


def all_runs():
    metrics.RUNS = ROOT / ".ai/runs"
    runs = metrics.load_runs()
    try:
        runs += metrics.load_claude_runs(metrics.claude_dirs(ROOT) if not os.environ.get("CLAUDE_PROJECTS_DIR") else None)
    except Exception:  # best-effort
        pass
    return runs


def task_tokens():
    totals = defaultdict(int)
    try:
        for r in all_runs():
            totals[r["task"]] += r["total"]
    except Exception:  # best-effort
        pass
    return totals


def insights(limit=None, task=None):
    f = orch.INSIGHTS / "insights.jsonl"
    out = []
    for line in f.read_text().splitlines() if f.exists() else []:
        try:
            i = json.loads(line)
        except ValueError:
            continue
        if task is None or i.get("task") == task:
            out.append({**i, "improvements": len(i.get("improvements", []))} if limit else i)
    return out[-limit:] if limit else out


def status():
    tasks = orch.read_tasks() if orch.REGISTRY.exists() else []
    state = orch.load_state()
    mile_of = {n: m["id"] for m in orch.read_milestones() for n in m["tasks"]}
    toks = task_tokens()
    rows = [{"num": t["num"], "title": t["title"], "status": t["status"],
             "stage": state.get(t["num"], {}).get("stage", ""),
             "fixRounds": state.get(t["num"], {}).get("fixRounds", 0),
             "milestone": mile_of.get(t["num"], ""), "tokens": toks.get(t["num"], 0)} for t in tasks]
    events = []
    if orch.EVENTS.exists():
        for line in orch.EVENTS.read_text().splitlines()[-100:]:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            events.append({**e, "ts": utc_iso(e["ts"]) if e.get("ts") else ""})
    decisions = sorted(p.name for p in orch.DECISIONS.glob("*.md")
                       if not p.name.endswith(".resolved.md")) if orch.DECISIONS.exists() else []
    tokens = defaultdict(lambda: {"tasks": set(), "total": 0})
    try:
        for r in metrics.load_runs():
            if r["role"] == "coder":
                tokens[r["provider"]]["tasks"].add(r["task"])
                tokens[r["provider"]]["total"] += r["total"]
    except Exception:  # metrics are best-effort
        pass
    commits = orch.git("log", "--format=%h %cI %s", "-10").stdout.splitlines()
    return {
        "tasks": rows,
        "done": sum(r["status"] == "done" for r in rows),
        "total": len(rows),
        "running": [f"{p['pid']} {p['etime']} {p['args'][:140]}" for p in processes()],
        "workers": workers(),
        "activeMilestone": (orch.active_milestone() or {}).get("id"),
        "events": events,
        "decisions": decisions,
        "insights": insights(10),
        "tokens": {k: {"tasks": len(v["tasks"]), "total": v["total"]} for k, v in tokens.items()},
        "commits": commits,
        "milestones": [{**m, "built": (ROOT / "builds" / m["id"] / "index.html").exists(),
                        **({"builtAt": utc_iso(m["builtAt"])} if m.get("builtAt") else {})}
                       for m in orch.read_milestones()],
        "orchestratorRunning": bool(orchestrator_pids()),
        "worktrees": orch.list_worktrees(),
        "providers": orch.provider_status(),
        "quota": QUOTA,
    }


# -- "now" view: what is running right this moment ---------------------------------

ROLE_VERB = {"acceptance": "writing acceptance tests", "tester-pre": "edge tests", "coder": "coding",
             "tester": "gap tests", "reviewer": "reviewing", "fixer": "fixing"}
STAGE_ROLE = {"acceptance": "acceptance", "tester-pre": "tester-pre", "coder": "coder", "commit-tests": "coder",
              "tester": "tester", "reviewer": "reviewer"}
TAIL_BYTES = 131072
_usage_cache = {}  # transcript path -> {"off": int, "ids": {message id: (in, out, cache read, cache write)}}


def etime_seconds(etime):
    days, _, rest = etime.rpartition("-")
    nums = [int(x) for x in rest.split(":")]
    while len(nums) < 3:
        nums.insert(0, 0)
    return int(days or 0) * 86400 + nums[0] * 3600 + nums[1] * 60 + nums[2]


def find_transcript(session_id):
    if not session_id:
        return None
    return next(iter(sorted((orch.WORKER_HOME / "projects").glob(f"*/{session_id}.jsonl"))), None)


def transcript_tokens(path):
    """Total tokens in a transcript, parsed incrementally (each message id counted once, at its max)."""
    c = _usage_cache.setdefault(str(path), {"off": 0, "ids": {}})
    try:
        size = path.stat().st_size
        if size < c["off"]:
            c["off"], c["ids"] = 0, {}
        with open(path, "rb") as f:
            f.seek(c["off"])
            data = f.read(size - c["off"])
    except OSError:
        return 0
    end = data.rfind(b"\n") + 1
    c["off"] += end
    for raw in data[:end].splitlines():
        if b'"usage"' not in raw:
            continue
        try:
            m = json.loads(raw).get("message") or {}
            u = m.get("usage") or {}
        except ValueError:
            continue
        if m.get("role") == "assistant" and m.get("id"):
            t = (u.get("input_tokens") or 0, u.get("output_tokens") or 0,
                 u.get("cache_read_input_tokens") or 0, u.get("cache_creation_input_tokens") or 0)
            old = c["ids"].get(m["id"], (0, 0, 0, 0))
            c["ids"][m["id"]] = tuple(max(a, b) for a, b in zip(old, t))
    return sum(sum(t) for t in c["ids"].values())


def short_path(p, cwd):
    p = str(p or "")
    for base in (cwd, str(ROOT)):
        if base and p.startswith(base.rstrip("/") + "/"):
            return p[len(base.rstrip("/")) + 1:]
    return p


def describe_tool(block, cwd):
    name, inp = block.get("name", "tool"), block.get("input") or {}
    if name in ("Edit", "Write", "Read", "MultiEdit", "NotebookEdit"):
        arg = short_path(inp.get("file_path") or inp.get("notebook_path"), cwd)
    elif name == "Bash":
        arg = " ".join(str(inp.get("command", "")).split())
    elif name in ("Grep", "Glob"):
        arg = inp.get("pattern", "")
    else:
        arg = " ".join(next((v for v in inp.values() if isinstance(v, str)), "").split())
    return re.sub(r"(?:/\S*?)?\.ai/wt/\d+/", "", f"{name} {arg}".strip())[:140]


def last_activity(path, now):
    """Latest tool call / assistant text from the tail of a transcript. Never reads the whole file."""
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(max(0, size - TAIL_BYTES))
            lines = f.read().splitlines()
    except OSError:
        return None
    if size > TAIL_BYTES:
        lines = lines[1:]
    last_ts, found = None, None
    for raw in reversed(lines):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        ts = d.get("timestamp")
        last_ts = last_ts or ts
        content = (d.get("message") or {}).get("content") if d.get("type") == "assistant" else None
        for b in reversed(content if isinstance(content, list) else []):
            if b.get("type") == "tool_use":
                found = ("tool", describe_tool(b, d.get("cwd")), ts)
            elif b.get("type") == "text" and (b.get("text") or "").strip():
                found = ("text", " ".join(b["text"].split())[:160], ts)
            if found:
                break
        if found:
            break
    if not found:
        return None
    kind, text, ts = found
    try:
        ago = max(0, int(now - datetime.fromisoformat((last_ts or ts).replace("Z", "+00:00")).timestamp()))
    except (ValueError, TypeError, AttributeError):
        ago = None
    return {"kind": kind, "text": text, "agoSec": ago}


def provider_of_model(model):
    cfg = orch.load_json(orch.PROVIDERS)
    for r in [*cfg.get("roles", {}).values(), cfg.get("fallback") or {}]:
        if model in (r.get("model"), r.get("heavyModel")):
            return r.get("provider")
    return None


def live_workers(now):
    """One entry per running worker.py, joined with its child claude process (model, session id) and transcript."""
    table = proc_table()
    titles = {t["num"]: t["title"] for t in (orch.read_tasks() if orch.REGISTRY.exists() else [])}
    state = orch.load_state()
    cfg_roles = orch.load_json(orch.PROVIDERS).get("roles", {})
    out = []
    for p in table:
        m = re.search(r"worker\.py (\S+) .*?--task tasks/(\d{3})", p["args"])
        if not m or "grep" in p["args"]:
            continue
        role, num = m.group(1), m.group(2)
        kid = next((k for k in table if k["ppid"] == p["pid"] and re.match(r"(\S*/)?claude\b", k["args"])), None)
        heavy = "--heavy" in p["args"]
        mm = (re.search(r"--model (\S+)", kid["args"]) if kid else None) or re.search(r"--model (\S+)", p["args"])
        model = mm.group(1) if mm else (cfg_roles.get(role, {}).get("heavyModel" if heavy else "model"))
        sid = re.search(r"--(?:session-id|resume) ([0-9a-f-]{36})", kid["args"]) if kid else None
        path = find_transcript(sid.group(1) if sid else None)
        pm = re.search(r"--provider (\S+)", p["args"])
        provider = provider_of_model(model) or (pm.group(1) if pm else orch.provider_of(role, num))
        st = state.get(num, {})
        out.append({"pid": p["pid"], "task": num, "title": titles.get(num, ""), "role": role,
                    "verb": ROLE_VERB.get(role, role), "provider": provider, "model": model, "heavy": heavy,
                    "resume": "--resume" in p["args"], "fixRounds": st.get("fixRounds", 0),
                    "stage": st.get("stage", ""), "elapsedSec": etime_seconds(p["etime"]),
                    "tokens": transcript_tokens(path) if path else 0,
                    "activity": last_activity(path, now) if path else None})
    return sorted(out, key=lambda w: w["task"])


def now_view():
    now = time.time()
    tasks = orch.read_tasks() if orch.REGISTRY.exists() else []
    state = orch.load_state()
    done = {t["num"] for t in tasks if t["status"] == "done"}
    live = live_workers(now)
    running = {w["task"] for w in live}
    am = orch.active_milestone()
    scope = orch.milestone_scope()
    pending_dec = {n for n, s in state.items() if s.get("decision") and not orch.decision_resolved(n)}
    ready = orch.ready_tasks(tasks, done, running, pending_dec, None)
    ready_nums = {t["num"] for t in ready}
    blocked = [t["num"] for t in tasks if (scope is None or t["num"] in scope) and t["num"] not in done | running
               | ready_nums | pending_dec and t["status"] not in orch.FINISHED and any(d not in done for d in t["deps"])]
    slots = orch.provider_status()

    def nxt(t):
        st = state.get(t["num"], {}).get("stage", "")
        role = STAGE_ROLE.get(st or "acceptance")
        prov = orch.provider_of(role, t["num"]) if role else None
        cap = slots.get(prov or "", {})
        return {"num": t["num"], "title": t["title"], "next": ROLE_VERB.get(role, st), "provider": prov,
                "waitingSlot": bool(cap.get("max") and cap["running"] >= cap["max"]), "stage": st}

    scoped = [t for t in tasks if am and t["num"] in am["tasks"]] if am else tasks
    prog = {"id": am["id"] if am else None, "title": am["title"] if am else "", "status": (am or {}).get("status", ""),
            "done": sum(t["status"] == "done" for t in scoped), "total": len(scoped)}
    decisions = sorted(p.name for p in orch.DECISIONS.glob("*.md") if not p.name.endswith(".resolved.md")) \
        if orch.DECISIONS.exists() else []
    orch_running = bool(orchestrator_pids())
    by_role = defaultdict(int)
    for w in live:
        by_role[w["role"]] += 1
    if live:
        code, reason = "running", ""
    elif am and am.get("status") == "built":
        code, reason = "approval", f"{am['id']} built, waiting for your approval"
    elif decisions:
        code, reason = "waiting-decision", "Waiting for decision " + ", ".join(d.split("-")[0] for d in decisions)
    elif ready and not orch_running:
        code, reason = "stopped", f"Orchestrator stopped, {len(ready)} task{'s' if len(ready) != 1 else ''} ready to run"
    elif orch_running:
        code, reason = "running", "Orchestrator running, picking the next task"
    elif am is None and tasks:
        code, reason = "idle", "All milestones approved"
    else:
        code, reason = "idle", "Nothing to do"
    events = []
    if orch.EVENTS.exists():
        for line in orch.EVENTS.read_text().splitlines()[-60:]:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("event") != "step":
                events.append({**e, "ts": utc_iso(e["ts"]) if e.get("ts") else ""})
    return {"now": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "state": code, "reason": reason, "orchestratorRunning": orch_running, "milestone": prog,
            "workers": live, "byRole": dict(by_role), "queued": len(ready), "blocked": len(blocked),
            "decisions": decisions, "upNext": [nxt(t) for t in ready[:8]], "events": events[-5:]}


# -- token accounting -----------------------------------------------------------

# USD per 1M tokens: (input, cached input, output). Estimates only (pay-as-you-go list prices).
PRICES = {
    "glm-5.3-flash": (0.15, 0.03, 0.50),
    "glm-5.3": (1.40, 0.26, 4.40),
    "k3": (3.00, 0.30, 15.00),
    "k3-256k": (3.00, 0.30, 15.00),
    "kimi-for-coding": (0.95, 0.19, 4.00),
    "qwen3.8-flash": (0.15, 0.019, 0.47),
    "deepseek-v4.1-flash": (0.15, 0.019, 0.47),
    "mimo-v2.6-flash": (0.145, 0.0145, 0.29),
    "mimo-v2.6-pro": (0.435, 0.0435, 0.87),
    # ESTIMATES (Anthropic list prices as best known); cache writes billed at CLAUDE_WRITE_MULT x input.
    "claude-opus-5-5": (5.00, 0.50, 25.00),
    "claude-sonnet-5-5": (3.00, 0.30, 15.00),
    "claude-haiku-5-5": (1.00, 0.10, 5.00),
}
CLAUDE_WRITE_MULT = 1.25


def price_of(model):
    p = PRICES.get(model)
    if p or not model.startswith("claude-"):
        return p
    return next((v for k, v in PRICES.items() if k.startswith("claude-") and model.startswith(k)), None)
SUM = ("runs", "turns", "input", "output", "cacheRead", "cacheWrite", "total", "seconds", "costUsd")


def run_cost(r):
    p = price_of(r["model"])
    if not p:
        return 0.0
    wm = CLAUDE_WRITE_MULT if r["provider"] == "claude" else 1.0
    return (r["input"] * p[0] + r["cache_write"] * p[0] * wm + r["cache_read"] * p[1] + r["output"] * p[2]) / 1e6


def blank():
    return {k: 0 for k in SUM} | {"tasks": set()}


def add(g, r):
    g["runs"] += 1
    g["turns"] += r["turns"]
    g["input"] += r["input"]
    g["output"] += r["output"]
    g["cacheRead"] += r["cache_read"]
    g["cacheWrite"] += r["cache_write"]
    g["total"] += r["total"]
    g["seconds"] += r["seconds"]
    g["costUsd"] += run_cost(r)
    if r["task"] != metrics.PLANNING:
        g["tasks"].add(r["task"])


def finish(g):
    n, t = max(g["runs"], 1), max(len(g["tasks"]), 1)
    g["tasks"] = len(g["tasks"])
    g["costUsd"] = round(g["costUsd"], 4)
    g["avgPerRun"] = {"total": g["total"] / n, "output": g["output"] / n, "seconds": g["seconds"] / n,
                      "turns": g["turns"] / n}
    g["avgPerTask"] = {"total": g["total"] / t, "output": g["output"] / t, "seconds": g["seconds"] / t,
                       "runs": g["runs"] / t}
    return g


def group(runs, keyf):
    out = defaultdict(blank)
    for r in runs:
        add(out[keyf(r)], r)
    return {k: finish(v) for k, v in sorted(out.items())}


def compute_stats(runs, tasks, milestones, state, assignments, flt=None):
    flt = flt or {}
    mile_of = {n: m["id"] for m in milestones for n in m["tasks"]}
    info = {t["num"]: t for t in tasks}
    coder_prov = defaultdict(set)
    for r in runs:
        if r["role"] == "coder":
            coder_prov[r["task"]].add(r["provider"])
    for prov, nums in assignments.items():
        if isinstance(nums, list):
            for n in nums:
                if n not in coder_prov:
                    coder_prov[n].add(prov)

    def coder_of(num):
        return "+".join(sorted(coder_prov.get(num, ())))

    sel = [r for r in runs
           if (not flt.get("milestone") or mile_of.get(r["task"], "") == flt["milestone"])
           and (not flt.get("provider") or r["provider"] == flt["provider"])
           and (not flt.get("role") or r["role"] == flt["role"])]

    by_role_task = defaultdict(lambda: defaultdict(int))
    for r in sel:
        by_role_task[r["task"]][r["role"]] += r["total"]
    task_rows = []
    for num, g in group(sel, lambda r: r["task"]).items():
        st = state.get(num, {})
        task_rows.append({"task": num, "title": info.get(num, {}).get("title", "") or ("Planning (no task)" if num == metrics.PLANNING else ""),
                          "status": info.get(num, {}).get("status", ""), "milestone": mile_of.get(num, ""),
                          "coderProvider": coder_of(num), "fixRounds": st.get("fixRounds"),
                          "byRole": dict(by_role_task[num]), **{k: v for k, v in g.items() if k != "tasks"}})

    ab = {}
    seen = {r["task"] for r in sel}
    for prov in sorted({coder_of(t) for t in seen if coder_of(t) and "+" not in coder_of(t)}):
        nums = {t for t in seen if coder_of(t) == prov}
        cr = [r for r in sel if r["task"] in nums and r["role"] in ("coder", "fixer")]
        rounds = [state[t].get("fixRounds", 0) for t in nums if t in state]
        ab[prov] = {"tasks": len(nums), "avgRounds": sum(rounds) / len(rounds) if rounds else None,
                    "avgTokens": sum(r["total"] for r in cr) / len(nums),
                    "avgMinutes": sum(r["seconds"] for r in cr) / len(nums) / 60,
                    "approvedFirstPassPct": 100 * sum(x == 0 for x in rounds) / len(rounds) if rounds else None}

    days = defaultdict(lambda: defaultdict(int))
    for r in sel:
        d = r["stamp"][:8]
        days[f"{d[:4]}-{d[4:6]}-{d[6:]}"][r["provider"]] += r["total"]
    tot = blank()
    for r in sel:
        add(tot, r)
    return {
        "filters": {k: v for k, v in flt.items() if v},
        "totals": finish(tot),
        "byModel": group(sel, lambda r: r["model"]),
        "byProvider": group(sel, lambda r: r["provider"]),
        "byRole": group(sel, lambda r: r["role"]),
        "byMilestone": group(sel, lambda r: mile_of.get(r["task"], "(none)")),
        "byTask": task_rows,
        "abCoder": ab,
        "timeline": [{"day": d, "byProvider": dict(v), "total": sum(v.values())} for d, v in sorted(days.items())],
        "prices": {k: {"input": v[0], "cached": v[1], "output": v[2]} for k, v in PRICES.items()},
        "unpricedModels": sorted({r["model"] for r in sel if not price_of(r["model"])}),
        "estimate": True,
        "options": {"milestones": [m["id"] for m in milestones], "providers": sorted({r["provider"] for r in runs}),
                    "roles": sorted({r["role"] for r in runs})},
    }


def stats(flt=None):
    metrics.RUNS = ROOT / ".ai/runs"
    exp = orch.load_json(orch.EXPERIMENTS).get("coderAssignments", {})
    return compute_stats(all_runs(), orch.read_tasks() if orch.REGISTRY.exists() else [],
                         orch.read_milestones(), orch.load_state(), exp, flt)


def heavy_models():
    cfg = orch.load_json(ROOT / "ai/providers.json")
    roles = [*cfg.get("roles", {}).values(), cfg.get("fallback") or {}]
    normal = {r.get("model") for r in roles}
    return {r["heavyModel"] for r in roles if r.get("heavyModel")} - normal


def utc_iso(naive):
    """Server-local naive 'YYYY-MM-DDTHH:MM:SS' -> UTC ISO with Z."""
    try:
        dt = datetime.fromisoformat(naive).astimezone(timezone.utc)
    except ValueError:
        return naive
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso(stamp):
    return utc_iso(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}")


def task_detail(num):
    info = next((t for t in (orch.read_tasks() if orch.REGISTRY.exists() else []) if t["num"] == num), None)
    runs = sorted((r for r in all_runs() if r["task"] == num), key=lambda r: r["stamp"])
    if info is None and not runs:
        return None
    heavy, rounds, out, tot = heavy_models(), 0, [], blank()
    for r in runs:
        if r["provider"] != "claude" and (r["role"] == "fixer" or (r["role"] == "coder" and r["resumed"])):
            rounds += 1
        add(tot, r)
        out.append({"start": iso(r["stamp"]), "role": r["role"], "provider": r["provider"], "model": r["model"],
                    "heavy": r["model"] in heavy, "round": None if r["provider"] == "claude" else rounds,
                    "resumed": r["resumed"], "seconds": r["seconds"], "turns": r["turns"], "input": r["input"],
                    "output": r["output"], "cacheRead": r["cache_read"], "cacheWrite": r["cache_write"],
                    "total": r["total"], "costUsd": round(run_cost(r), 4), "result": r.get("result", ""),
                    "description": r.get("description", ""), "agent": r.get("agent", "")})
    st = orch.load_state().get(num, {})
    events = []
    if orch.EVENTS.exists():
        for line in orch.EVENTS.read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("task") == num and e.get("event") != "step":
                events.append({**e, "ts": utc_iso(e["ts"]) if e.get("ts") else ""})
    return {"num": num, "title": (info or {}).get("title", ""), "status": (info or {}).get("status", ""),
            "stage": st.get("stage", ""), "fixRounds": st.get("fixRounds", 0),
            "totals": finish(tot), "runs": out, "events": events[-40:],
            "analyst": insights(task=num)}


def quota_providers():
    return [*orch.provider_caps(), "claude"]


def quota_view():
    return {n: QUOTA.get(n) or quota.cached(n, 60) for n in quota_providers()}


def decision_text(file):
    file = str(file or "")
    src = orch.DECISIONS / file
    if not file.endswith(".md") or "/" in file or "\\" in file or ".." in file or not src.is_file():
        return None
    return src.read_text()[:20000]


def refresh_quota():
    while True:
        for name in quota_providers():
            QUOTA[name] = quota.cached(name, 0)
        time.sleep(60)


def action(body):
    name = body.get("action")
    if name == "run":
        if orchestrator_pids():
            return 409, {"error": "orchestrator already running"}
        argv = [*ORCH_CMD, "run"]
        only = str(body.get("only") or "").strip()
        if only:
            if not all(n.isdigit() and len(n) == 3 for n in only.split(",")):
                return 400, {"error": "only must be like 018,019"}
            argv += ["--only", only]
        LOG.parent.mkdir(parents=True, exist_ok=True)
        log = open(LOG, "a")
        started.append(subprocess.Popen(argv, cwd=ROOT, stdout=log, stderr=log,
                                        stdin=subprocess.DEVNULL, start_new_session=True))
        return 200, {"ok": True}
    if name == "stop":
        for pid in orchestrator_pids():
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
        for p in started:
            if p.poll() is None:
                p.wait(timeout=3)
        return 200, {"ok": True}
    if name == "resolve":
        file = str(body.get("file") or "")
        src = orch.DECISIONS / file
        if decision_text(file) is None:
            return 400, {"error": "invalid decision file"}
        src.rename(src.with_name(file[:-3] + ".resolved.md"))
        return 200, {"ok": True}
    if name in ("play", "approve"):
        mid = str(body.get("milestone") or "")
        if mid not in {m["id"] for m in orch.read_milestones()}:
            return 400, {"error": "unknown milestone"}
        if name == "approve":
            code = orch.approve(mid)
            if code != 0:
                return 409, {"error": f"{mid} is not built"}
            if not orchestrator_pids():
                return action({"action": "run"})
            return 200, {"ok": True}
        port = 5300 + [m["id"] for m in orch.read_milestones()].index(mid)
        if not (ROOT / "builds" / mid / "index.html").exists():
            return 409, {"error": "not built yet"}
        subprocess.Popen(["python3", "scripts/ai/play.py", mid, "--port", str(port)], cwd=ROOT,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return 200, {"ok": True, "url": f"http://localhost:{port}"}
    if name == "tests":
        p = subprocess.run(["npm", "test"], cwd=ROOT, capture_output=True, text=True)
        return 200, {"ok": p.returncode == 0, "tail": "\n".join((p.stdout + p.stderr).splitlines()[-40:])}
    return 400, {"error": "unknown action"}


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/":
            self.send(200, HTML.read_bytes(), "text/html; charset=utf-8")
        elif u.path in ASSETS:
            name, ctype = ASSETS[u.path]
            self.send(200, (HTML.parent / name).read_bytes(), ctype)
        elif u.path == "/stats":
            self.send(200, STATS_HTML.read_bytes(), "text/html; charset=utf-8")
        elif u.path == "/api/status":
            self.send(200, status())
        elif u.path == "/api/now":
            self.send(200, now_view())
        elif u.path == "/api/stats":
            data = stats({k: q.get(k, "") for k in ("milestone", "provider", "role")})
            data["quota"] = quota_view()
            self.send(200, data)
        elif u.path == "/api/task":
            num = q.get("num", "")
            if not (len(num) == 3 and num.isascii() and num.isdigit()):
                self.send(400, {"error": "num must be 3 digits"})
            else:
                data = task_detail(num)
                self.send(*((404, {"error": "unknown task"}) if data is None else (200, data)))
        elif u.path == "/api/decision":
            text = decision_text(q.get("file"))
            if text is None:
                self.send(400, {"error": "invalid decision file"})
            else:
                self.send(200, {"file": q["file"], "content": text})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/action":
            return self.send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except ValueError:
            return self.send(400, {"error": "bad json"})
        self.send(*action(body if isinstance(body, dict) else {}))

    def log_message(self, *args):
        pass


def make_server(port):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = make_server(args.port)
    threading.Thread(target=refresh_quota, daemon=True).start()
    print(f"Dashboard: http://127.0.0.1:{server.server_address[1]}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
