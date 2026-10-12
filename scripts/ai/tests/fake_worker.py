#!/usr/bin/env python3
"""Test double for scripts/ai/worker.py, driven by a JSON script file.

Env:
  FAKE_SCRIPT  path to a JSON list of {"role", "task", "stdout", "exit"} entries.
               Entries are consumed in list order per (role, task); the last entry
               of a key repeats once exhausted. "task" matches the spec file basename
               (path-independent); null matches any task.
  FAKE_CALLS   path to a JSON-lines log; each call appends {"argv": [...]}.
               The existing lines are the consumption counter for (role, task).

Prints the entry's stdout and exits with its code. Writes no files.
"""
import json
import os
import sys
from pathlib import Path


def task_of(argv):
    if "--task" in argv and argv.index("--task") + 1 < len(argv):
        return Path(argv[argv.index("--task") + 1]).name
    return None


def used(role, task, log_path):
    p = Path(log_path)
    if not p.exists():
        return 0
    n = 0
    for line in p.read_text().splitlines():
        try:
            argv = json.loads(line)["argv"]
        except (ValueError, KeyError):
            continue
        if argv and argv[0] == role and task_of(argv) == task:
            n += 1
    return n


def pick(entries, role, task, log_path):
    matches = [e for e in entries
               if e.get("role") == role
               and (e.get("task") is None or Path(e["task"]).name == task)]
    if not matches:
        return {}
    return matches[min(used(role, task, log_path), len(matches) - 1)]


def main():
    argv = sys.argv[1:]
    log_path = os.environ["FAKE_CALLS"]
    role = argv[0] if argv else ""
    task = task_of(argv)
    entries = json.loads(Path(os.environ["FAKE_SCRIPT"]).read_text())
    entry = pick(entries, role, task, log_path)
    with open(log_path, "a") as f:
        f.write(json.dumps({"argv": argv}) + "\n")
    sys.stdout.write(entry.get("stdout", ""))
    sys.stdout.flush()
    raise SystemExit(entry.get("exit", 0))


if __name__ == "__main__":
    main()
