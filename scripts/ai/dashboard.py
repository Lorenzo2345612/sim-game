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

ROOT = orch.ROOT
HTML = Path(__file__).resolve().parent / "dashboard.html"
ORCH_CMD = shlex.split(os.environ.get("DASH_ORCH_CMD") or "python3 scripts/ai/orchestrator.py")
LOG = ROOT / ".ai/orchestrator-run.log"
started = []  # Popen objects launched by this dashboard


def processes():
    out = subprocess.run(["ps", "-eo", "pid,etime,args"], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines()[1:]:
        pid, etime, args = line.strip().split(None, 2)
        if ("orchestrator.py run" in args or "worker.py " in args) and "grep" not in args:
            rows.append({"pid": int(pid), "etime": etime, "args": args})
    return rows


def orchestrator_pids():
    pids = [p["pid"] for p in processes() if "orchestrator.py run" in p["args"]]
    pids += [p.pid for p in started if p.poll() is None and p.pid not in pids]
    return pids


def status():
    tasks = orch.read_tasks() if orch.README.exists() else []
    state = orch.load_state()
    rows = [{"num": t["num"], "title": t["title"], "status": t["status"],
             "stage": state.get(t["num"], {}).get("stage", ""),
             "fixRounds": state.get(t["num"], {}).get("fixRounds", 0)} for t in tasks]
    events = []
    if orch.EVENTS.exists():
        for line in orch.EVENTS.read_text().splitlines()[-30:]:
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
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
    commits = orch.git("log", "--format=%h %ad %s", "--date=format:%m-%d %H:%M", "-10").stdout.splitlines()
    return {
        "tasks": rows,
        "done": sum(r["status"] == "done" for r in rows),
        "total": len(rows),
        "running": [f"{p['pid']} {p['etime']} {p['args'][:140]}" for p in processes()],
        "events": events,
        "decisions": decisions,
        "tokens": {k: {"tasks": len(v["tasks"]), "total": v["total"]} for k, v in tokens.items()},
        "commits": commits,
        "orchestratorRunning": bool(orchestrator_pids()),
    }


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
        if not file.endswith(".md") or "/" in file or ".." in file or not src.is_file():
            return 400, {"error": "invalid decision file"}
        src.rename(src.with_name(file[:-3] + ".resolved.md"))
        return 200, {"ok": True}
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
        if self.path == "/":
            self.send(200, HTML.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/status":
            self.send(200, status())
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
    print(f"Dashboard: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
