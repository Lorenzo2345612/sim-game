#!/usr/bin/env python3
"""Serve a milestone build so the user can play it: python3 scripts/ai/play.py M1.1 [--port N] [--open]

Builds live in builds/<id>/ (made by `orchestrator.py build <id>` or automatically when a milestone completes).
Each build is served at the root of its own port, because the game fetches absolute paths like /tracks/<id>.json.
"""
import argparse
import functools
import http.server
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def port_for(mid):
    ids = [m["id"] for m in json.loads((ROOT / "tasks/milestones.json").read_text())["milestones"]]
    return 5300 + (ids.index(mid) if mid in ids else len(ids))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("milestone")
    parser.add_argument("--port", type=int)
    parser.add_argument("--open", action="store_true", help="open the Windows browser (WSL)")
    args = parser.parse_args()
    root = ROOT / "builds" / args.milestone
    if not (root / "index.html").exists():
        sys.exit(f"no build at {root} — run: python3 scripts/ai/orchestrator.py build {args.milestone}")
    port = args.port or port_for(args.milestone)
    url = f"http://localhost:{port}"
    print(f"{args.milestone}: {url}", flush=True)
    if args.open:
        subprocess.run(["cmd.exe", "/c", "start", "", url], stderr=subprocess.DEVNULL)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
