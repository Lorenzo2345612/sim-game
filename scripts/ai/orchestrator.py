#!/usr/bin/env python3
"""Deterministic, resumable task orchestrator v2 (spec: tasks/infra/002-orchestrator-v2.md).

Registry tasks/tasks.json; every task runs in its own git worktree (.ai/wt/<num>, branch task/<num>):
acceptance → tester-pre (complex) → commit tests → coder → tester (complex) → reviewer
→ merge (rebase + ff-only) → cleanup → done, with fix rounds, escalation, per-provider caps,
quota routing and planner decisions queued in .ai/decisions/.

Usage:
  orchestrator.py run [--max-parallel N] [--only 018,019] [--dry-run]
  orchestrator.py status | migrate [--force] | readme
  orchestrator.py cleanup [--all] [--sessions DAYS]
Exit codes: 0 ok, 3 quota exhausted, 4 another orchestrator is running.
"""
import argparse
import atexit
import datetime
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quota  # noqa: E402

ROOT = Path(os.environ.get("ORCH_ROOT") or Path(__file__).resolve().parents[2])
WORKER_CMD = shlex.split(os.environ.get("ORCH_WORKER_CMD") or "python3 scripts/ai/worker.py")
NOTIFY_CMD = os.environ.get("ORCH_NOTIFY_CMD")
DECIDE_CMD = os.environ.get("ORCH_DECIDE_CMD")
AI = ROOT / ".ai"
STATE = AI / "state.json"
EVENTS = AI / "events.log"
DECISIONS = AI / "decisions"
WT = AI / "wt"
LOCK = AI / "orchestrator.lock"
SLOTS_FILE = AI / "slots.json"
REGISTRY = ROOT / "tasks/tasks.json"
README = ROOT / "tasks/README.md"
PROVIDERS = ROOT / "ai/providers.json"
EXPERIMENTS = ROOT / "ai/experiments.json"
WORKER_HOME = Path(os.environ.get("CLAUDE_WORKERS_DIR") or Path.home() / ".claude-workers")
TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
MAX_FIX_ROUNDS = 4
FINISHED = {"done", "blocked"}
E2E_BASE_PORT = 4200
EXCLUDES = (":!.ai", ":!node_modules")

lock = threading.RLock()
slots = {}  # task num -> slot index
running_by_provider = {}
sems = {}


class QuotaError(Exception):
    pass


# -- registry, README, state, events -----------------------------------------

def read_tasks():
    return json.loads(REGISTRY.read_text())["tasks"] if REGISTRY.exists() else []


def write_tasks(tasks):
    with lock:
        REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        tmp = REGISTRY.with_suffix(".tmp")
        tmp.write_text(json.dumps({"tasks": tasks}, indent=2) + "\n")
        tmp.replace(REGISTRY)
        write_readme(tasks)


def write_readme(tasks):
    rows = [f"| {t['num']} | {t['title']} | {t['status']} | {', '.join(t['deps']) or '-'} |" for t in tasks]
    README.write_text("# Tasks\n\nGenerated from `tasks/tasks.json` by `orchestrator.py readme`; do not edit by hand.\n\n"
                      "| # | Title | Status | Depends on |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")


def set_status(num, status):
    with lock:
        tasks = read_tasks()
        for t in tasks:
            if t["num"] == num:
                t["status"] = status
        write_tasks(tasks)


def spec_path(num):
    found = sorted((ROOT / "tasks").glob(f"{num}-*.md"))
    return found[0] if found else None


def spec_header(text, name, default):
    m = re.search(rf"^{name}:\s*(\S+)", text, re.M)
    return m.group(1) if m else default


def migrate(force):
    if REGISTRY.exists() and not force:
        print("tasks/tasks.json already exists (use --force to rebuild)")
        return 2
    tasks = []
    for line in README.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and re.fullmatch(r"\d{3}", cells[0]):
            spec = spec_path(cells[0])
            text = spec.read_text() if spec else ""
            phase = spec_header(text, "Phase", "")
            tasks.append({"num": cells[0], "title": cells[1], "status": cells[2],
                          "deps": re.findall(r"\d{3}", cells[3]),
                          "complexity": spec_header(text, "Complexity", "simple"),
                          "type": spec_header(text, "Type", "feature"),
                          "phase": int(phase) if phase.isdigit() else None,
                          "spec": str(spec.relative_to(ROOT)) if spec else ""})
    write_tasks(tasks)
    print(f"migrated {len(tasks)} tasks")
    return 0


def spec_info(spec):
    text = spec.read_text()
    acc = re.search(r"^## Acceptance tests.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return {"acceptance": bool(acc and re.search(r"^\|\s*AT\d+", acc.group(1), re.M))}


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


# -- git: main repo, worktrees -------------------------------------------------

def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd or ROOT, capture_output=True, text=True)


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


def wt_path(num):
    return WT / num


def branch_exists(num):
    return git("rev-parse", "--verify", "-q", f"refs/heads/task/{num}").returncode == 0


def ensure_worktree(num):
    with lock:
        path = wt_path(num)
        if not path.exists():
            WT.mkdir(parents=True, exist_ok=True)
            args = ["worktree", "add", str(path), f"task/{num}"] if branch_exists(num) \
                else ["worktree", "add", "-b", f"task/{num}", str(path), "HEAD"]
            r = git(*args)
            if r.returncode != 0:
                raise RuntimeError(f"worktree add failed: {r.stderr.strip()}")
        modules = ROOT / "node_modules"
        if modules.exists() and not (path / "node_modules").exists():
            (path / "node_modules").symlink_to(modules)
        spec = spec_path(num)
        if spec and not (path / spec.relative_to(ROOT)).exists():
            (path / spec.relative_to(ROOT)).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(spec, path / spec.relative_to(ROOT))
        return path


def remove_worktree(num):
    with lock:
        path = wt_path(num)
        if path.exists():
            git("worktree", "remove", "--force", str(path))
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)
        git("worktree", "prune")
        if branch_exists(num):
            git("branch", "-d", f"task/{num}")


def wt_commit(num, message):
    path = wt_path(num)
    if not path.exists():
        return False
    git("add", "-A", "--", ".", *EXCLUDES, cwd=path)
    if git("diff", "--cached", "--quiet", cwd=path).returncode == 0:
        return False
    r = git("commit", "-q", "-m", message, "-m", TRAILER, cwd=path)
    if r.returncode != 0:
        event(num, "commit-failed", f"{message}: {(r.stderr or r.stdout).strip()[:300]}")
    return r.returncode == 0


def list_worktrees():
    out = []
    for p in sorted(WT.glob("*")) if WT.exists() else []:
        if p.is_dir():
            out.append({"num": p.name, "branch": git("rev-parse", "--abbrev-ref", "HEAD", cwd=p).stdout.strip(),
                        "path": str(p)})
    return out


def reconcile(remove_all=False):
    git("worktree", "prune")
    status = {t["num"]: t["status"] for t in read_tasks()}
    removed = []
    for w in list_worktrees():
        if remove_all or status.get(w["num"], "done") == "done":
            remove_worktree(w["num"])
            removed.append(w["num"])
    if removed:
        event(None, "worktrees-removed", ",".join(removed))
    return removed


# -- providers, caps, quota ----------------------------------------------------

def load_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def provider_of(role, num):
    cfg = load_json(PROVIDERS)
    forced = os.environ.get("SIMGAME_PROVIDER")
    if forced:
        return forced
    if role == "coder":
        for prov, nums in load_json(EXPERIMENTS).get("coderAssignments", {}).items():
            if isinstance(nums, list) and num in nums:
                return prov
    return cfg.get("roles", {}).get(role, {}).get("provider")


def provider_caps():
    return {n: p.get("maxConcurrent") for n, p in load_json(PROVIDERS).get("providers", {}).items()}


def provider_status():
    used = load_json(SLOTS_FILE)
    return {n: {"running": used.get(n, 0), "max": m} for n, m in provider_caps().items()}


@contextmanager
def provider_slot(provider):
    sem = sems.get(provider)
    if sem:
        sem.acquire()
    with lock:
        running_by_provider[provider] = running_by_provider.get(provider, 0) + 1
        AI.mkdir(parents=True, exist_ok=True)
        SLOTS_FILE.write_text(json.dumps(running_by_provider))
    try:
        yield
    finally:
        with lock:
            running_by_provider[provider] -= 1
            SLOTS_FILE.write_text(json.dumps(running_by_provider))
        if sem:
            sem.release()


def alloc_slot(num):
    with lock:
        n = next(i for i in range(len(slots) + 1) if i not in slots.values())
        slots[num] = n
        return n


# -- worker calls and report parsing -----------------------------------------

def call_worker(role, spec, num, resume=False, heavy=False, note=None):
    argv = [*WORKER_CMD, role, "--task", str(spec.relative_to(ROOT))]
    if resume:
        argv.append("--resume")
    if heavy:
        argv.append("--heavy")
    if note:
        argv += ["--note", note]
    prov = provider_of(role, num)
    fallback = load_json(PROVIDERS).get("fallback", {}).get("provider")
    if prov and fallback and prov != fallback and quota.low_5h(prov):
        event(num, "quota-route", f"{role}: {prov} < 10% left in 5h window -> {fallback}")
        argv += ["--provider", fallback]
        prov = fallback
    env = {**os.environ, "SIMGAME_WORKDIR": str(wt_path(num)), "E2E_PORT": str(E2E_BASE_PORT + slots.get(num, 0))}
    with provider_slot(prov):
        proc = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    out = proc.stdout or ""
    if proc.returncode != 0 and "quota error" in out:
        raise QuotaError(role)
    return {"exit": proc.returncode, "out": out, **parse_report(out)}


def parse_report(out):
    lines = re.findall(r"^\[worker\] report-json: (.*)$", out, re.M)
    if lines:
        try:
            return from_json(json.loads(lines[-1]))
        except (ValueError, AttributeError, TypeError):
            pass
    return parse_text_report(out)


def from_json(obj):
    def join(v):
        return "; ".join(v) if isinstance(v, list) else str(v or "")

    blockers = [f"[BLOCKER] {f.get('location', '')} — {f.get('problem', '')} — {f.get('fix', '')}"
                for f in obj.get("findings", []) if f.get("severity") == "BLOCKER"]
    return {"status": obj.get("status") or obj.get("verdict") or "", "spec_silent": join(obj.get("specSilent")),
            "untestable": join(obj.get("untestable")), "failures": "\n".join(obj.get("failures", [])),
            "blockers": blockers}


def parse_text_report(out):
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
    set_status(num, "waiting decision")
    event(num, "decision", f"{stage}: {question}")
    if DECIDE_CMD:
        subprocess.run([*shlex.split(DECIDE_CMD), str(path)], cwd=ROOT)
    notify(f"Task {num} waits for a planner decision at {stage}: {question}")
    return "decision"


def fix_call(spec, num, round_no, note, heavy=False):
    if round_no <= 2:
        return call_worker("coder", spec, num, resume=True, heavy=heavy, note=note)
    if round_no == 3:
        return call_worker("coder", spec, num, resume=True, heavy=True, note=note)
    return call_worker("fixer", spec, num, heavy=heavy, note=note)


def merge_task(num, title):
    """Idempotent. Returns None when merged, else an error string."""
    with lock:
        if not branch_exists(num):
            return None
        wt_commit(num, f"feat: {title} (task {num})")
        if git("merge-base", "--is-ancestor", f"task/{num}", "HEAD").returncode == 0:
            return None
        path = ensure_worktree(num)
        head = git("rev-parse", "HEAD").stdout.strip()
        r = git("rebase", head, cwd=path)
        if r.returncode != 0:
            git("rebase", "--abort", cwd=path)
            return f"rebase conflict:\n{(r.stdout + r.stderr).strip()[-1500:]}"
        r = git("merge", "--ff-only", f"task/{num}")
        return None if r.returncode == 0 else f"ff-only merge failed:\n{(r.stdout + r.stderr).strip()[-1500:]}"


def run_task(task):
    num = task["num"]
    slot = alloc_slot(num)
    try:
        return _run_task(task, slot)
    finally:
        with lock:
            slots.pop(num, None)


def _run_task(task, slot):
    num, title = task["num"], task["title"]
    spec = spec_path(num)
    info = spec_info(spec)
    complex_, heavy = task.get("complexity") == "complex", task.get("type") == "bugfix"
    st = load_state().get(num, {"stage": "acceptance", "fixRounds": 0})

    if st.get("decision"):
        resolved = DECISIONS / st["decision"].replace(".md", ".resolved.md")
        if not resolved.exists():
            return "decision"
        st.pop("decision")
        event(num, "resumed", f"decision resolved at {st['stage']}")

    set_status(num, "in progress")
    event(num, "start", f"{st['stage']} slot={slot}")
    if st["stage"] not in ("merge", "cleanup", "done"):
        ensure_worktree(num)

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
            r = call_worker("acceptance", spec, num)
            if r["status"] != "READY" or not is_none(r["untestable"]):
                return decision(num, title, stage, f"acceptance {r['status'] or 'failed'}; "
                                f"untestable: {r['untestable'] or '?'}", r["out"], st)
            advance("tester-pre")

        elif stage == "tester-pre":
            if complex_:
                r = call_worker("tester-pre", spec, num)
                if r["status"] != "READY" or not is_none(r["spec_silent"]):
                    return decision(num, title, stage, f"spec silent: {r['spec_silent'] or r['status']}",
                                    r["out"], st)
            advance("commit-tests")

        elif stage == "commit-tests":
            if info["acceptance"] or complex_:
                wt_commit(num, f"test: acceptance tests (task {num})")
            advance("coder")

        elif stage == "coder":
            r = call_worker("coder", spec, num, heavy=heavy)
            if r["status"] == "BLOCKED":
                return decision(num, title, stage, "coder blocked", r["out"], st)
            if r["status"] != "OK":
                st["fixRounds"] = st.get("fixRounds", 0) + 1
            advance("tester" if complex_ else "reviewer")

        elif stage in ("tester", "reviewer"):
            if stage == "tester":
                r = call_worker("tester", spec, num)
                failed = r["status"] != "PASS"
                note = f"Tester failures to fix:\n{r['failures'] or r['out'][-1500:]}"
            else:
                r = call_worker("reviewer", spec, num)
                failed = r["status"] in ("CHANGES", "REJECTED") and bool(r["blockers"]) or \
                    r["status"] not in ("APPROVED", "CHANGES", "REJECTED")
                note = "Reviewer BLOCKER findings to fix:\n" + "\n".join(r["blockers"]) if r["blockers"] \
                    else f"Reviewer could not complete:\n{r['out'][-1500:]}"
            if not failed:
                advance("reviewer" if stage == "tester" else "merge")
                continue
            st["fixRounds"] = st.get("fixRounds", 0) + 1
            if st["fixRounds"] > MAX_FIX_ROUNDS:
                return decision(num, title, stage, "escalation exhausted", r["out"], st)
            save_task_state(num, st)
            fr = fix_call(spec, num, st["fixRounds"], note, heavy=heavy)
            if fr["status"] == "BLOCKED":
                return decision(num, title, stage, "fix round blocked", fr["out"], st)

        elif stage == "merge":
            err = merge_task(num, title)
            if err:
                return decision(num, title, stage, "merge into the main branch failed", err, st)
            advance("cleanup")

        elif stage == "cleanup":
            remove_worktree(num)
            advance("done")

        elif stage == "done":
            set_status(num, "done")
            commit(["tasks/tasks.json", "tasks/README.md"], f"chore: task {num} done")
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


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def lock_holder():
    try:
        pid = int(LOCK.read_text().strip())
    except (OSError, ValueError):
        return None
    return pid if pid_alive(pid) else None


def acquire_lock():
    AI.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            if lock_holder():
                return False
            LOCK.unlink(missing_ok=True)
            continue
        with os.fdopen(fd, "w") as f:
            f.write(str(os.getpid()))
        return True
    return False


def release_lock():
    if LOCK.exists() and LOCK.read_text().strip() == str(os.getpid()):
        LOCK.unlink(missing_ok=True)
    SLOTS_FILE.unlink(missing_ok=True)


def run(max_parallel, only, dry_run):
    if not REGISTRY.exists():
        print("tasks/tasks.json missing: run `orchestrator.py migrate` first")
        return 2
    tasks = read_tasks()
    done = {t["num"] for t in tasks if t["status"] == "done"}

    if dry_run:
        state = load_state()
        for t in ready_tasks(tasks, done, set(), set(), only):
            print(f"{t['num']} {t['title']} — stage: {state.get(t['num'], {}).get('stage', 'acceptance')}")
        return 0

    if not acquire_lock():
        print(f"another orchestrator is running (pid {lock_holder()})")
        return 4
    atexit.register(release_lock)
    signal.signal(signal.SIGTERM, lambda *_: (release_lock(), os._exit(143)))
    for name, cap in provider_caps().items():
        if cap:
            sems[name] = threading.BoundedSemaphore(cap)
    reconcile()
    tasks = read_tasks()

    running, waiting = {}, set()
    quota_hit = False
    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        while True:
            if not quota_hit:
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
                    quota_hit = True
                    event(num, "quota", str(e))
                    continue
                except Exception as e:  # noqa: BLE001
                    event(num, "error", f"{type(e).__name__}: {e}"[:300])
                    waiting.add(num)
                    continue
                (done.add if result == "done" else waiting.add)(num)
            tasks = read_tasks()

    if quota_hit:
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


def cleanup(remove_all, sessions_days):
    busy = lock_holder()
    removed = reconcile(remove_all=remove_all and not busy)
    if remove_all and busy:
        print(f"orchestrator running (pid {busy}): only done/unknown worktrees removed")
    print(f"worktrees removed: {removed or 'none'}")
    if sessions_days is not None:
        cutoff = time.time() - sessions_days * 86400
        files = [f for f in (WORKER_HOME / "projects").glob("*/*") if f.is_file() and f.stat().st_mtime < cutoff]
        for f in files:
            f.unlink()
        print(f"worker transcripts removed: {len(files)}")
    return 0


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--max-parallel", type=int, default=6)
    r.add_argument("--only", help="comma-separated task numbers")
    r.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    m = sub.add_parser("migrate")
    m.add_argument("--force", action="store_true")
    sub.add_parser("readme")
    c = sub.add_parser("cleanup")
    c.add_argument("--all", action="store_true")
    c.add_argument("--sessions", type=int, metavar="DAYS")
    args = parser.parse_args()
    if args.cmd == "status":
        return status()
    if args.cmd == "migrate":
        return migrate(args.force)
    if args.cmd == "readme":
        write_readme(read_tasks())
        return 0
    if args.cmd == "cleanup":
        return cleanup(args.all, args.sessions)
    only = set(args.only.split(",")) if args.only else None
    return run(max(1, args.max_parallel), only, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
