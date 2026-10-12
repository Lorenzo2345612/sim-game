#!/usr/bin/env python3
"""Deterministic, resumable task orchestrator (spec: tasks/infra/001-orchestrator.md).

Runs the worker pipeline for every ready task in tasks/README.md:
acceptance → tester-pre (complex) → commit tests → coder → tester (complex) → reviewer → done,
with fix rounds and escalation, planner decisions queued in .ai/decisions/.

Usage:
  orchestrator.py run [--max-parallel N] [--only 018,019] [--dry-run]
  orchestrator.py status
"""
import argparse
import datetime
import json
import os
import re
import shlex
import subprocess
import sys
import threading
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

ROOT = Path(os.environ.get("ORCH_ROOT") or Path(__file__).resolve().parents[2])
WORKER_CMD = shlex.split(os.environ.get("ORCH_WORKER_CMD") or "python3 scripts/ai/worker.py")
NOTIFY_CMD = os.environ.get("ORCH_NOTIFY_CMD")
DECIDE_CMD = os.environ.get("ORCH_DECIDE_CMD")
AI = ROOT / ".ai"
STATE = AI / "state.json"
EVENTS = AI / "events.log"
DECISIONS = AI / "decisions"
README = ROOT / "tasks/README.md"
TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
MAX_FIX_ROUNDS = 4
FINISHED = {"done", "blocked"}

lock = threading.RLock()


class QuotaError(Exception):
    pass


# -- files: README, specs, state, events ------------------------------------

def read_tasks():
    tasks = []
    for line in README.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and re.fullmatch(r"\d{3}", cells[0]):
            tasks.append({"num": cells[0], "title": cells[1], "status": cells[2],
                          "deps": re.findall(r"\d{3}", cells[3])})
    return tasks


def set_readme_status(num, status):
    with lock:
        lines = README.read_text().splitlines()
        for i, line in enumerate(lines):
            cells = line.split("|")
            if len(cells) > 3 and cells[1].strip() == num:
                cells[3] = f" {status} "
                lines[i] = "|".join(cells)
        README.write_text("\n".join(lines) + "\n")


def spec_path(num):
    found = sorted(p for p in (ROOT / "tasks").glob(f"{num}-*.md"))
    return found[0] if found else None


def spec_info(spec):
    text = spec.read_text()
    files_section = re.search(r"^## Files\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    acc = re.search(r"^## Acceptance tests.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    has_acc = bool(acc and re.search(r"^\|\s*AT\d+", acc.group(1), re.M))
    return {
        "complex": bool(re.search(r"^Complexity:\s*complex\b", text, re.M)),
        "acceptance": has_acc,
        "files": re.findall(r"`([^`\s]+)`", files_section.group(1)) if files_section else [],
    }


def set_spec_status(spec, status):
    with lock:
        text = spec.read_text()
        spec.write_text(re.sub(r"^Status:.*$", f"Status: {status}", text, count=1, flags=re.M))


def load_state():
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_task_state(num, data):
    with lock:
        state = load_state()
        state[num] = data
        AI.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state, indent=2))


def event(task, name, detail=""):
    with lock:
        AI.mkdir(parents=True, exist_ok=True)
        with open(EVENTS, "a") as f:
            f.write(json.dumps({"ts": datetime.datetime.now().isoformat(timespec="seconds"),
                                "task": task, "event": name, "detail": detail}) + "\n")
    print(f"[orch] {task or '-'} {name} {detail}".rstrip(), flush=True)


def notify(message):
    if NOTIFY_CMD:
        subprocess.run([*shlex.split(NOTIFY_CMD), message], cwd=ROOT)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def commit(paths, message):
    with lock:
        paths = [p for p in dict.fromkeys(paths) if (ROOT / p).exists()]
        if not paths:
            return False
        git("add", "--", *paths)
        if git("diff", "--cached", "--quiet", "--", *paths).returncode == 0:
            return False
        result = git("commit", "-q", "-m", message, "-m", TRAILER, "--", *paths)
        if result.returncode != 0:
            event(None, "commit-failed", f"{message}: {(result.stderr or result.stdout).strip()[:300]}")
            notify(f"Commit failed: {message}")
        return result.returncode == 0


# -- worker calls and report parsing -----------------------------------------

def call_worker(role, spec, resume=False, heavy=False, note=None):
    argv = [*WORKER_CMD, role, "--task", str(spec.relative_to(ROOT))]
    if resume:
        argv.append("--resume")
    if heavy:
        argv.append("--heavy")
    if note:
        argv += ["--note", note]
    proc = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    out = proc.stdout or ""
    if proc.returncode != 0 and "quota error" in out:
        raise QuotaError(role)
    return {"exit": proc.returncode, "out": out, **parse_report(out)}


def parse_report(out):
    statuses = re.findall(r"^\W*(?:STATUS|VERDICT):\s*([A-Z]+)", out, re.M)

    def field(name):
        m = re.findall(rf"^\W*{name}:\s*(.*)$", out, re.M)
        return m[-1].strip() if m else ""

    failures = re.search(r"^\W*FAILURES:(.*)", out, re.M | re.S)
    blockers = [line.strip() for line in out.splitlines() if "[BLOCKER]" in line]
    return {
        "status": statuses[-1] if statuses else "",
        "spec_silent": field("SPEC_SILENT"),
        "untestable": field("UNTESTABLE"),
        "failures": failures.group(1).strip().strip("`").strip() if failures else "",
        "blockers": blockers,
    }


def is_none(value):
    return value.strip().strip('"').lower() in ("", "none", "-", "nothing")


# -- per-task pipeline ---------------------------------------------------------

def decision(num, title, stage, question, report, st):
    with lock:
        DECISIONS.mkdir(parents=True, exist_ok=True)
        path = DECISIONS / f"{num}-{stage}.md"
        path.write_text(f"# Decision needed: task {num} — {title}\n\nStage: {stage}\n\n"
                        f"Question: {question}\n\n## Last report\n\n```\n{report.strip()}\n```\n\n"
                        f"Resolve the spec/tests, then rename this file to `{num}-{stage}.resolved.md`.\n")
    st["decision"] = path.name
    save_task_state(num, st)
    set_readme_status(num, "waiting decision")
    event(num, "decision", f"{stage}: {question}")
    if DECIDE_CMD:
        subprocess.run([*shlex.split(DECIDE_CMD), str(path)], cwd=ROOT)
    notify(f"Task {num} waits for a planner decision at {stage}: {question}")
    return "decision"


def fix_call(spec, round_no, note):
    if round_no <= 2:
        return call_worker("coder", spec, resume=True, note=note)
    if round_no == 3:
        return call_worker("coder", spec, resume=True, heavy=True, note=note)
    return call_worker("fixer", spec, note=note)


def run_task(task):
    num, title = task["num"], task["title"]
    spec = spec_path(num)
    info = spec_info(spec)
    st = load_state().get(num, {"stage": "acceptance", "fixRounds": 0})

    if st.get("decision"):
        resolved = DECISIONS / st["decision"].replace(".md", ".resolved.md")
        if not resolved.exists():
            return "decision"
        st.pop("decision")
        event(num, "resumed", f"decision resolved at {st['stage']}")

    set_readme_status(num, "in progress")
    event(num, "start", st["stage"])

    def advance(stage):
        st["stage"] = stage
        save_task_state(num, st)

    while True:
        stage = st["stage"]
        event(num, "step", stage)

        if stage == "acceptance":
            if not info["acceptance"]:
                advance("tester-pre")
                continue
            r = call_worker("acceptance", spec)
            if r["status"] != "READY" or not is_none(r["untestable"]):
                return decision(num, title, stage, f"acceptance {r['status'] or 'failed'}; "
                                f"untestable: {r['untestable'] or '?'}", r["out"], st)
            advance("tester-pre")

        elif stage == "tester-pre":
            if info["complex"]:
                r = call_worker("tester-pre", spec)
                if r["status"] != "READY" or not is_none(r["spec_silent"]):
                    return decision(num, title, stage, f"spec silent: {r['spec_silent'] or r['status']}",
                                    r["out"], st)
            advance("commit-tests")

        elif stage == "commit-tests":
            paths = [str(p.relative_to(ROOT)) for d in ("tests/unit/acceptance", "tests/unit/edge")
                     for p in (ROOT / d).glob(f"{num}-*")]
            if info["acceptance"] or info["complex"]:
                commit(paths, f"test: acceptance tests (task {num})")
            advance("coder")

        elif stage == "coder":
            r = call_worker("coder", spec)
            if r["status"] == "BLOCKED":
                return decision(num, title, stage, "coder blocked", r["out"], st)
            if r["status"] != "OK":
                st["fixRounds"] = st.get("fixRounds", 0) + 1
            advance("tester" if info["complex"] else "reviewer")

        elif stage in ("tester", "reviewer"):
            if stage == "tester":
                r = call_worker("tester", spec)
                failed = r["status"] != "PASS"
                note = f"Tester failures to fix:\n{r['failures'] or r['out'][-1500:]}"
            else:
                r = call_worker("reviewer", spec)
                failed = r["status"] in ("CHANGES", "REJECTED") and bool(r["blockers"]) or \
                    r["status"] not in ("APPROVED", "CHANGES", "REJECTED")
                note = "Reviewer BLOCKER findings to fix:\n" + "\n".join(r["blockers"]) if r["blockers"] \
                    else f"Reviewer could not complete:\n{r['out'][-1500:]}"
            if not failed:
                advance("reviewer" if stage == "tester" else "done")
                continue
            st["fixRounds"] = st.get("fixRounds", 0) + 1
            if st["fixRounds"] > MAX_FIX_ROUNDS:
                return decision(num, title, stage, "escalation exhausted", r["out"], st)
            save_task_state(num, st)
            fr = fix_call(spec, st["fixRounds"], note)
            if fr["status"] == "BLOCKED":
                return decision(num, title, stage, "fix round blocked", fr["out"], st)

        elif stage == "done":
            set_spec_status(spec, "done")
            set_readme_status(num, "done")
            paths = [str(spec.relative_to(ROOT)), "tasks/README.md", *info["files"]]
            if "package.json" in info["files"]:
                paths.append("package-lock.json")
            commit(paths, f"feat: {title} (task {num})")
            event(num, "done")
            return "done"


# -- scheduler -------------------------------------------------------------------

def ready_tasks(tasks, done, running, waiting, only):
    out = []
    for t in sorted(tasks, key=lambda t: t["num"]):
        if t["num"] in done or t["num"] in running or t["num"] in waiting:
            continue
        if only and t["num"] not in only:
            continue
        if t["status"] in FINISHED:
            continue
        if all(d in done for d in t["deps"]):
            out.append(t)
    return out


def run(max_parallel, only, dry_run):
    tasks = read_tasks()
    done = {t["num"] for t in tasks if t["status"] == "done"}
    state = load_state() if not dry_run else (json.loads(STATE.read_text()) if STATE.exists() else {})

    if dry_run:
        for t in ready_tasks(tasks, done, set(), set(), only):
            print(f"{t['num']} {t['title']} — stage: {state.get(t['num'], {}).get('stage', 'acceptance')}")
        return 0

    running, waiting = {}, set()
    quota = False
    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        while True:
            if not quota:
                for t in ready_tasks(tasks, done, running, waiting, only)[:max_parallel - len(running)]:
                    running[t["num"]] = pool.submit(run_task, t)
            if not running:
                break
            finished, _ = wait(running.values(), return_when=FIRST_COMPLETED)
            for num, fut in list(running.items()):
                if fut not in finished:
                    continue
                del running[num]
                try:
                    result = fut.result()
                except QuotaError as e:
                    quota = True
                    event(num, "quota", str(e))
                    continue
                (done.add if result == "done" else waiting.add)(num)

    if quota:
        notify("Orchestrator stopped: provider quota exhausted.")
        return 3
    summary = f"done: {sorted(done)}; waiting decision: {sorted(waiting)}"
    event(None, "finished", summary)
    notify(f"Orchestrator finished. {summary}")
    return 0


def status():
    state = load_state()
    for t in read_tasks():
        s = state.get(t["num"], {})
        print(f"{t['num']} {t['status']:<16} stage={s.get('stage', '-'):<12} fixRounds={s.get('fixRounds', 0)}"
              f"{'  decision=' + s['decision'] if s.get('decision') else ''}")
    return 0


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--max-parallel", type=int, default=3)
    r.add_argument("--only", help="comma-separated task numbers")
    r.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args()
    if args.cmd == "status":
        return status()
    only = set(args.only.split(",")) if args.only else None
    return run(max(1, args.max_parallel), only, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
