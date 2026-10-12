#!/usr/bin/env python3
"""Deterministic, resumable task orchestrator v2 (spec: tasks/infra/002-orchestrator-v2.md).

Registry tasks/tasks.json; every task runs in its own git worktree (.ai/wt/<num>, branch task/<num>):
acceptance → tester-pre (complex) → commit tests → coder → tester (complex) → reviewer
→ merge (rebase + ff-only) → cleanup → done, with fix rounds, escalation, per-provider caps,
quota routing and planner decisions queued in .ai/decisions/.

Usage:
  orchestrator.py run [--max-parallel N] [--only 018,019] [--dry-run]
  orchestrator.py status | brief [--no-quota] | migrate [--force] | readme
  orchestrator.py restart | stop [--graceful]   (signals the running orchestrator; restart drains, then re-execs)
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
import notify as notifier  # noqa: E402
import quota  # noqa: E402

ROOT = Path(os.environ.get("ORCH_ROOT") or Path(__file__).resolve().parents[2])
WORKER_CMD = shlex.split(os.environ.get("ORCH_WORKER_CMD") or "python3 scripts/ai/worker.py")
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
TRIAGE_TIMEOUT = 300
ANALYST_TIMEOUT = 600
ANALYST_ROUND = 3
INSIGHTS = AI / "insights"
TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
MAX_FIX_ROUNDS = 4
FINISHED = {"done", "blocked"}
E2E_BASE_PORT = 4200
EXCLUDES = (":!.ai", ":!node_modules")

lock = threading.RLock()
DRAIN = threading.Event()
drain_mode = {"mode": None}  # "restart" | "stop"
live = {}  # (task, role) -> running worker info, mirrored to .ai/running.json
slots = {}  # task num -> slot index
running_by_provider = {}
sems = {}


class QuotaError(Exception):
    pass


# -- registry, README, state, events -----------------------------------------

MILESTONES = ROOT / "tasks/milestones.json"
BUILDS = ROOT / "builds"


def read_milestones():
    return json.loads(MILESTONES.read_text())["milestones"] if MILESTONES.exists() else []


def write_milestones(ms):
    with lock:
        tmp = MILESTONES.with_suffix(".tmp")
        tmp.write_text(json.dumps({"milestones": ms}, indent=2) + "\n")
        tmp.replace(MILESTONES)


def active_milestone():
    """First milestone not approved; None when there are no milestones or all are approved."""
    return next((m for m in read_milestones() if m.get("status") != "approved"), None)


def milestone_scope():
    """Task numbers allowed to run now: the active milestone's tasks plus tasks in no milestone."""
    ms = read_milestones()
    if not ms:
        return None
    assigned = {n for m in ms for n in m["tasks"]}
    active = active_milestone()
    allowed = set(active["tasks"]) if active and active.get("status") == "open" else set()
    return allowed | {t["num"] for t in read_tasks() if t["num"] not in assigned}


def build_milestone(m):
    """Build a playable bundle into builds/<id>/, tag the commit and stop for user approval."""
    out = BUILDS / m["id"]
    build = subprocess.run(["npm", "run", "build", "--", "--outDir", str(out), "--emptyOutDir"], cwd=ROOT,
                           capture_output=True, text=True)
    tests = subprocess.run(["npm", "test"], cwd=ROOT, capture_output=True, text=True)
    head = git("rev-parse", "--short", "HEAD").stdout.strip()
    ok = build.returncode == 0
    if ok:
        git("tag", "-f", m["id"].lower())
    ms = read_milestones()
    for x in ms:
        if x["id"] == m["id"]:
            x.update(status="built" if ok else "open", builtAt=datetime.datetime.now().isoformat(timespec="seconds"),
                     commit=head, buildOk=ok, testsOk=tests.returncode == 0)
    write_milestones(ms)
    detail = f"{m['id']} build {'ok' if ok else 'FAILED'}, tests {'ok' if tests.returncode == 0 else 'FAILED'} @ {head}"
    event(None, "milestone", detail)
    notify(f"Milestone {m['id']} ({m['title']}) ready to play: python3 scripts/ai/play.py {m['id']} — then approve it."
           if ok else f"Milestone {m['id']} build failed: {build.stderr[-300:]}")
    return ok


def approve(mid):
    ms = read_milestones()
    for m in ms:
        if m["id"] == mid:
            if m.get("status") != "built":
                print(f"{mid} is {m.get('status')}, not built")
                return 1
            m["status"] = "approved"
            write_milestones(ms)
            event(None, "approved", mid)
            print(f"{mid} approved")
            return 0
    print(f"unknown milestone {mid}")
    return 1


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
                          "models": spec_header(text, "Models", "standard"),
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
    notifier.send(message, cwd=ROOT)


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
        else:
            head = git("rev-parse", "HEAD").stdout.strip()
            if git("merge-base", "--is-ancestor", head, "HEAD", cwd=path).returncode != 0:
                if git("rebase", "--autostash", head, cwd=path).returncode != 0:
                    git("rebase", "--abort", cwd=path)
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
    exp = load_json(EXPERIMENTS)
    split = exp.get("testerSplit", {})
    if role in split.get("roles", []) and str(num).isdigit():
        return split["providers"][int(num) % len(split["providers"])]
    if role == "coder":
        for prov, nums in exp.get("coderAssignments", {}).items():
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

def track(num, role, add=None):
    with lock:
        if add:
            live[(num, role)] = {"task": num, "role": role, **add}
        else:
            live.pop((num, role), None)
        AI.mkdir(parents=True, exist_ok=True)
        (AI / "running.json").write_text(json.dumps({"pid": os.getpid(), "running": list(live.values())}))


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
    cfg = load_json(PROVIDERS)
    role_cfg = cfg.get("roles", {}).get(role, {})
    model = role_cfg.get("heavyModel" if heavy else "model", "")
    if prov and prov != role_cfg.get("provider"):
        model = cfg.get("fallback", {}).get("heavyModel" if heavy else "model", model)
    track(num, role, add={"provider": prov, "model": model, "start": time.time()})
    try:
        with provider_slot(prov):
            proc = subprocess.run(argv, cwd=ROOT, env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    finally:
        track(num, role)
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


def listed(v):
    return v if isinstance(v, list) else [v] if v else []


def from_json(obj):
    def join(v):
        return "; ".join(v) if isinstance(v, list) else str(v or "")

    blockers = [f"[BLOCKER] {f.get('location', '')} — {f.get('problem', '')} — {f.get('fix', '')}"
                for f in obj.get("findings", []) if f.get("severity") == "BLOCKER"]
    questions = [str(q) for k in ("specSilent", "untestable", "pending", "decisions") for q in listed(obj.get(k))
                 if not is_none(str(q))]
    return {"status": obj.get("status") or obj.get("verdict") or "", "spec_silent": join(obj.get("specSilent")),
            "untestable": join(obj.get("untestable")), "failures": "\n".join(obj.get("failures", [])),
            "blockers": blockers, "questions": questions}


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
        "questions": [q for q in (field("SPEC_SILENT"), field("UNTESTABLE")) if not is_none(q)],
    }


def is_none(value):
    return value.strip().strip('"').lower() in ("", "none", "-", "nothing")


# -- per-task pipeline ---------------------------------------------------------

OPTIONS = {
    "infra": ["Retry the stage (rename the decision to .resolved.md and rerun the orchestrator)",
              "Check provider quota/keys and the run log"],
    "spec": ["Clarify the spec section named in the questions and commit",
             "Adjust the acceptance table (planner only) if a row is untestable"],
    "product": ["Ask the user for the product choice, then record it in the spec"],
    "tests": ["Fix the spec or acceptance rows if the tests contradict it",
              "Otherwise rerun so the coder gets another round"],
}


def spec_excerpt(spec, questions):
    if not spec:
        return ""
    text = " ".join(questions).lower()
    out = []
    for sec in re.split(r"(?m)^(?=## )", spec.read_text()):
        if not sec.startswith("## "):
            continue
        head = sec.splitlines()[0][3:].strip().lower()
        if head.startswith("acceptance tests") or (len(head) >= 4 and re.search(rf"\b{re.escape(head)}\b", text)):
            out.append(sec.strip())
    return "\n\n".join(out)[:4000]


def last_log(report):
    found = re.findall(r"\blog=(\S+)", report or "")
    return found[-1] if found else ""


def render_decision(d):
    bullets = "\n".join(f"- {q}" for q in d["questions"])
    options = "\n".join(f"- {o}" for o in d["options"])
    parts = [f"# Decision needed: task {d['num']} — {d['title']}", "",
             f"Stage: {d['stage']}", f"Category: {d['category']}", "", "## Questions", "", bullets, ""]
    if d["specExcerpt"]:
        parts += ["## Spec excerpt", "", d["specExcerpt"], ""]
    if d["failures"]:
        parts += ["## Failing tests / summary", "", "```", d["failures"], "```", ""]
    parts += ["## Suggested options", "", options, "", f"Full run log: {d['log'] or '(none)'}", ""]
    if d.get("triage"):
        parts += ["## Triage", "", f"Action: {d['triage'].get('action')} — {d['triage'].get('note', '')}", ""]
    parts.append(f"Resolve the spec/tests, then rename this file to `{d['num']}-{d['stage']}.resolved.md`.")
    return "\n".join(parts) + "\n"


def write_decision(d):
    with lock:
        DECISIONS.mkdir(parents=True, exist_ok=True)
        (DECISIONS / f"{d['num']}-{d['stage']}.md").write_text(render_decision(d))
        (DECISIONS / f"{d['num']}-{d['stage']}.json").write_text(json.dumps(d, indent=2) + "\n")


def claude_argv(var, name):
    cmd = os.environ.get(var)
    if cmd is None and not os.environ.get("ORCH_ROOT"):
        cmd = "default"
    if not cmd or cmd == "off":
        return None
    if cmd != "default":
        return shlex.split(cmd)
    schema = json.dumps(json.loads((ROOT / f"ai/schemas/{name}.json").read_text()), separators=(",", ":"))
    return ["claude", "-p", "--model", "sonnet", "--output-format", "json", "--permission-mode", "plan",
            "--disallowedTools", "Edit,Write,NotebookEdit,Bash",
            "--append-system-prompt", (ROOT / f"ai/agents/{name}.md").read_text(), "--json-schema", schema]


def triage_argv():
    return claude_argv("ORCH_TRIAGE_CMD", "triage")


def parse_triage(out):
    try:
        data = json.loads(out)
    except ValueError:
        m = re.search(r"\{.*\}", out, re.S)
        data = json.loads(m.group(0)) if m else {}
    if isinstance(data, dict) and isinstance(data.get("structured_output"), dict):
        data = data["structured_output"]
    elif isinstance(data, dict) and isinstance(data.get("result"), str) and "action" not in data:
        return parse_triage(data["result"])
    if not isinstance(data, dict) or data.get("action") not in ("retry", "rebase_retry", "escalate"):
        raise ValueError("no valid action")
    return {"action": data["action"], "category": data.get("category"), "note": str(data.get("note", ""))}


def run_triage(d, spec):
    """Headless triage; any failure degrades to escalate. Never edits specs (read-only tools, no write access)."""
    argv = triage_argv()
    if not argv:
        return None
    payload = json.dumps({**d, "spec": spec.read_text()[:12000] if spec else ""})
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "SIMGAME_WORKER")}
    try:
        p = subprocess.run(argv, cwd=ROOT, env=env, input=payload, capture_output=True, text=True, timeout=TRIAGE_TIMEOUT)
        return parse_triage(p.stdout)
    except Exception as e:  # noqa: BLE001
        return {"action": "escalate", "category": None, "note": f"triage failed: {type(e).__name__}: {e}"[:300]}


def decision(num, title, stage, question, report, st, category="spec", r=None, triage=True):
    spec = spec_path(num)
    r = r or {}
    questions = list(dict.fromkeys([*r.get("questions", []), *r.get("blockers", [])])) or [question]
    d = {"num": num, "title": title, "stage": stage, "category": category, "question": question,
         "questions": questions, "specExcerpt": spec_excerpt(spec, questions),
         "failures": (r.get("failures") or "").strip()[:3000], "options": OPTIONS[category],
         "log": last_log(report), "triage": None,
         "createdAt": datetime.datetime.now().isoformat(timespec="seconds")}
    write_decision(d)
    path = DECISIONS / f"{num}-{stage}.md"
    st["decision"] = path.name
    save_task_state(num, st)
    set_status(num, "waiting decision")
    event(num, "decision", f"{stage}: {question}")
    if DECIDE_CMD:
        subprocess.run([*shlex.split(DECIDE_CMD), str(path)], cwd=ROOT)
    t = run_triage(d, spec) if triage else None
    if t:
        d["triage"] = t
        tried = st.setdefault("triaged", {})
        if t["action"] != "escalate" and tried.get(stage, 0) >= 2:
            t = d["triage"] = {"action": "escalate", "category": category,
                               "note": f"triage already retried {stage} twice: {t['note']}"}
        if t["action"] != "escalate":
            tried[stage] = tried.get(stage, 0) + 1
            if t["action"] == "rebase_retry":
                try:
                    ensure_worktree(num)
                except Exception as e:  # noqa: BLE001
                    event(num, "error", f"rebase_retry: {e}"[:300])
            write_decision(d)
            path.replace(DECISIONS / f"{num}-{stage}.resolved.md")
            event(num, "triaged", f"{stage}: {t['action']} — {t['note']}"[:300])
            save_task_state(num, st)
            return "triaged"
        if t.get("category") in OPTIONS:
            d["category"] = t["category"]
            d["options"] = OPTIONS[d["category"]]
        event(num, "triaged", f"{stage}: escalate — {t['note']}"[:300])
        write_decision(d)
    notify(f"Task {num} needs the planner at {stage} [{d['category']}]: {question}")
    return "decision"


FAULTS = ("coder", "tester", "reviewer", "acceptance_tests", "spec", "infra")
ANALYST_ACTIONS = ("guide_coder", "dismiss_findings", "escalate")


def remember(st, role, r):
    st.setdefault("history", []).append({"role": role, "stage": st.get("stage"), "round": st.get("fixRounds", 0),
                                         "status": r.get("status"), "log": last_log(r.get("out", "")),
                                         "report": (r.get("out") or "")[-3000:]})
    st["history"] = st["history"][-20:]


def parse_analyst(out):
    try:
        data = json.loads(out)
    except ValueError:
        m = re.search(r"\{.*\}", out, re.S)
        data = json.loads(m.group(0)) if m else {}
    if isinstance(data, dict) and isinstance(data.get("structured_output"), dict):
        data = data["structured_output"]
    elif isinstance(data, dict) and isinstance(data.get("result"), str) and "action" not in data:
        return parse_analyst(data["result"])
    if not isinstance(data, dict) or data.get("action") not in ANALYST_ACTIONS or data.get("fault") not in FAULTS:
        raise ValueError("no valid fault/action")
    return {"fault": data["fault"], "evidence": str(data.get("evidence", "")), "action": data["action"],
            "note": str(data.get("note", "")), "dismissed": [str(x) for x in data.get("dismissed") or []],
            "improvements": [{k: str(i.get(k, "")) for k in ("target", "change", "why")}
                             for i in data.get("improvements") or [] if isinstance(i, dict)]}


def task_diff(num):
    path, base = wt_path(num), base_commit(num)
    diff = git("diff", base, "--", ".", *EXCLUDES, cwd=path).stdout
    new = git("ls-files", "--others", "--exclude-standard", cwd=path).stdout.split()
    if new:
        diff += "\n# untracked files: " + " ".join(new)
    return diff[:30000]


def analyst_payload(num, spec, st):
    path = wt_path(num)
    tests = {}
    base = base_commit(num)
    for f in dict.fromkeys([*git("show", "--name-only", "--format=", base, "--", "tests", cwd=path).stdout.split(),
                            *new_test_files(num)]):
        try:
            tests[f] = (path / f).read_text()[:8000]
        except OSError:
            pass
    prompts = {n: (ROOT / f"ai/agents/{n}.md").read_text() for n in ("coder", "tester", "reviewer")
               if (ROOT / f"ai/agents/{n}.md").exists()}
    return json.dumps({"task": num, "stage": st.get("stage"), "fixRounds": st.get("fixRounds", 0),
                       "spec": spec.read_text()[:20000], "acceptanceTests": tests, "reports": st.get("history", []),
                       "diff": task_diff(num), "rolePrompts": prompts})


def render_insight(num, k, a, stage):
    imps = "\n".join(f"- `{i['target']}`: {i['change']} (why: {i['why']})" for i in a["improvements"]) or "- none"
    dis = "\n".join(f"- {x}" for x in a["dismissed"]) or "- none"
    return (f"# Insight: task {num} round {k} ({stage})\n\nFault: {a['fault']}\nAction: {a['action']}\n\n"
            f"## Evidence\n\n{a['evidence']}\n\n## Note\n\n{a['note']}\n\n## Dismissed findings\n\n{dis}\n\n"
            f"## Improvement proposals (planner)\n\n{imps}\n\nReviewed: rename this file to `{num}-round{k}.reviewed.md`.\n")


def record_insight(num, k, stage, a):
    with lock:
        INSIGHTS.mkdir(parents=True, exist_ok=True)
        (INSIGHTS / f"{num}-round{k}.md").write_text(render_insight(num, k, a, stage))
        with open(INSIGHTS / "insights.jsonl", "a") as f:
            f.write(json.dumps({"ts": datetime.datetime.now().isoformat(timespec="seconds"), "task": num,
                                "round": k, "stage": stage, **a}) + "\n")
    event(num, "analyst", f"round{k} {stage}: fault={a['fault']} action={a['action']} "
                          f"improvements={len(a['improvements'])}"[:300])


def run_analyst(num, spec, st, k):
    """Headless round analyst; any failure -> None (continue as before). Never edits files."""
    argv = claude_argv("ORCH_ANALYST_CMD", "analyst")
    if not argv:
        return None
    env = {n: v for n, v in os.environ.items() if n not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "SIMGAME_WORKER")}
    try:
        p = subprocess.run(argv, cwd=ROOT, env=env, input=analyst_payload(num, spec, st), capture_output=True,
                           text=True, timeout=ANALYST_TIMEOUT)
        a = parse_analyst(p.stdout)
    except Exception as e:  # noqa: BLE001
        event(num, "analyst", f"round{k} failed: {type(e).__name__}: {e}"[:300])
        return None
    record_insight(num, k, st.get("stage"), a)
    return a


def retry_reason(r):
    out = r.get("out", "")
    for word in ("STALLED", "TIMEOUT"):
        if f"[worker] {word}" in out:
            return word
    return f"no report (exit {r.get('exit')})"


def call_retry(st, role, spec, num, **kw):
    """Worker call; retried once fresh when the run produced no report (stall, kill, transport error)."""
    r = call_worker(role, spec, num, **kw)
    key = f"{st.get('stage')}:{role}:{st.get('fixRounds', 0)}"
    tried = st.setdefault("retried", {})
    if r["status"] or tried.get(key) or DRAIN.is_set():
        return r
    tried[key] = 1
    st["retries"] = st.get("retries", 0) + 1
    save_task_state(num, st)
    reason = retry_reason(r)
    event(num, "retry", f"{st.get('stage')} {role}: {reason}")
    kw = {**kw, "resume": False}
    if reason in ("STALLED", "TIMEOUT"):
        kw.update(resume=True, note="INTERRUPTED")  # keep the session: continue, do not restart
    if reason == "STALLED":
        kw["heavy"] = True
    return call_worker(role, spec, num, **kw)


MAX_EMPTY_RETRIES = 2
MODULE_ERRORS = ("TS2307", "TS2305", "TS2724", "TS2614")


def base_commit(num):
    """Commit that added the acceptance tests, else the merge-base with the main checkout's HEAD."""
    path = wt_path(num)
    found = git("log", "--fixed-strings", f"--grep=test: acceptance tests (task {num})", "--format=%H", "-n1",
                    cwd=path).stdout.strip()
    return found or git("merge-base", f"task/{num}", "HEAD").stdout.strip()


def changed_files(num, base):
    path = wt_path(num)
    tracked = git("diff", "--name-only", base, cwd=path).stdout.splitlines()
    new = git("ls-files", "--others", "--exclude-standard", cwd=path).stdout.splitlines()
    return [f for f in dict.fromkeys([*tracked, *new]) if f]


def has_impl_changes(num):
    files = changed_files(num, base_commit(num))
    return any(not f.startswith(("tests/", ".ai/", "node_modules")) for f in files)


def new_test_files(num):
    out = git("status", "--porcelain", "--untracked-files=all", "--", "tests", cwd=wt_path(num)).stdout
    return [line[3:].strip() for line in out.splitlines()
            if line[3:].strip().endswith((".ts", ".tsx")) and "D" not in line[:2]]


def check_cmd(var, default):
    cmd = os.environ.get(var)
    if cmd is None and not os.environ.get("ORCH_ROOT"):
        cmd = default
    return None if not cmd or cmd == "off" else shlex.split(cmd)


def spec_stems(spec):
    m = re.search(r"^## Files(.*?)(?=^## |\Z)", spec.read_text(), re.M | re.S)
    paths = re.findall(r"`([^`\s]+\.\w+)`", m.group(1)) if m else []
    return [re.sub(r"\.\w+$", "", p) for p in paths]


def expected_missing(line, stems):
    m = re.search(r"['\"]([^'\"]+)['\"]", line)
    if not m:
        return False
    mod = re.sub(r"\.\w+$", "", re.sub(r"^[./@~]+", "", m.group(1)))
    return bool(mod) and any(s.endswith(mod) or mod.endswith(s) for s in stems)


IMPLICIT_ANY = ("TS7006", "TS7031")  # cascades from modules the task has not created yet


def lint_tests(num, spec):
    """Errors in the new acceptance test files (eslint + tsc), or ''. Missing modules the spec will create are fine."""
    files = new_test_files(num)
    lint, tsc = check_cmd("ORCH_LINT_CMD", "npx eslint"), check_cmd("ORCH_TSC_CMD", "npx tsc --noEmit -p .")
    if not files or not (lint or tsc):
        return ""
    cwd, errors = wt_path(num), []
    if lint:
        p = subprocess.run([*lint, *files], cwd=cwd, capture_output=True, text=True, timeout=600)
        if p.returncode != 0:
            errors.append(f"eslint:\n{(p.stdout + p.stderr).strip()[-2000:]}")
    if tsc:
        p = subprocess.run(tsc, cwd=cwd, capture_output=True, text=True, timeout=600)
        stems = spec_stems(spec)
        bad = [ln for ln in (p.stdout + p.stderr).splitlines()
               if re.search(r"error TS\d+", ln) and any(ln.startswith(f) for f in files)
               and not any(c in ln for c in IMPLICIT_ANY)
               and not (any(c in ln for c in MODULE_ERRORS) and expected_missing(ln, stems))]
        if bad:
            errors.append("tsc:\n" + "\n".join(bad)[-2000:])
    return "\n".join(errors)


def fix_call(spec, num, round_no, note, st, heavy=False):
    if round_no <= 2:
        return call_retry(st, "coder", spec, num, resume=True, heavy=heavy, note=note)
    if round_no == 3:
        return call_retry(st, "coder", spec, num, resume=True, heavy=True, note=note)
    return call_retry(st, "fixer", spec, num, heavy=heavy, note=note)


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
        while True:
            result = _run_task(task, slot)
            if result != "triaged":
                return result
    finally:
        with lock:
            slots.pop(num, None)


def _run_task(task, slot):
    num, title = task["num"], task["title"]
    spec = spec_path(num)
    info = spec_info(spec)
    complex_ = task.get("complexity") == "complex"
    models_heavy = task.get("models") == "heavy"
    heavy = task.get("type") == "bugfix" or models_heavy
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
        if DRAIN.is_set():
            event(num, "drained", st["stage"])
            return "drained"
        stage = st["stage"]
        event(num, "step", stage)

        if stage == "acceptance":
            if not info["acceptance"]:
                advance("tester-pre")
                continue
            r = call_retry(st, "acceptance", spec, num, heavy=models_heavy)
            if r["status"] != "READY" or not is_none(r["untestable"]):
                return decision(num, title, stage, f"acceptance {r['status'] or 'failed'}; "
                                f"untestable: {r['untestable'] or '?'}", r["out"], st,
                                "spec" if r["status"] else "infra", r)
            advance("tester-pre")

        elif stage == "tester-pre":
            if complex_:
                r = call_retry(st, "tester-pre", spec, num, heavy=models_heavy)
                if r["status"] != "READY":
                    return decision(num, title, stage, f"tester-pre {r['status'] or 'failed'}: "
                                    f"{r['spec_silent'] or '?'}", r["out"], st,
                                    "spec" if r["status"] else "infra", r)
                if not is_none(r["spec_silent"]):
                    event(num, "spec-silent", str(r["spec_silent"])[:500])
            advance("commit-tests")

        elif stage == "commit-tests":
            if info["acceptance"] or complex_:
                errs = lint_tests(num, spec)
                if errs:
                    event(num, "tests-lint", errs[:300])
                    call_worker("acceptance", spec, num, resume=True, heavy=models_heavy,
                                note=f"Your test files fail lint/typecheck. Fix only your own test files:\n{errs}")
                    errs = lint_tests(num, spec)
                if errs:
                    return decision(num, title, stage, "acceptance tests fail lint/typecheck", "", st, "tests",
                                    {"failures": errs})
                wt_commit(num, f"test: acceptance tests (task {num})")
            advance("coder")

        elif stage == "coder":
            note = "Previous run left no implementation outside tests/. Implement the spec." \
                if st.get("emptyRetries") else None
            r = call_retry(st, "coder", spec, num, heavy=heavy, note=note)
            remember(st, "coder", r)
            if r["status"] == "BLOCKED":
                return decision(num, title, stage, "coder blocked", r["out"], st, "spec", r)
            if not r["status"]:
                if DRAIN.is_set():
                    continue
                return decision(num, title, stage, "coder produced no report", r["out"], st, "infra", r)
            if r["status"] != "OK":
                st["fixRounds"] = st.get("fixRounds", 0) + 1
            advance("tester" if complex_ else "reviewer")

        elif stage in ("tester", "reviewer"):
            if not has_impl_changes(num):
                if st.get("emptyRetries", 0) >= MAX_EMPTY_RETRIES:
                    return decision(num, title, stage, "coder delivered no changes outside tests/", "", st, "infra")
                st["emptyRetries"] = st.get("emptyRetries", 0) + 1
                st["retries"] = st.get("retries", 0) + 1
                event(num, "empty-diff", f"{stage}: no changes outside tests/ -> coder")
                advance("coder")
                continue
            if stage == "tester":
                r = call_retry(st, "tester", spec, num, heavy=models_heavy, note=st.pop("verifyNote", None))
                failed = r["status"] != "PASS"
                note = f"Tester failures to fix:\n{r['failures'] or r['out'][-1500:]}"
            else:
                r = call_retry(st, "reviewer", spec, num, note=st.pop("verifyNote", None))
                failed = r["status"] in ("CHANGES", "REJECTED") and bool(r["blockers"]) or \
                    r["status"] not in ("APPROVED", "CHANGES", "REJECTED")
                note = "Reviewer BLOCKER findings to fix:\n" + "\n".join(r["blockers"]) if r["blockers"] \
                    else f"Reviewer could not complete:\n{r['out'][-1500:]}"
            if not failed:
                advance("reviewer" if stage == "tester" else "merge")
                continue
            remember(st, stage, r)
            if not r["status"] and DRAIN.is_set():
                continue
            st["fixRounds"] = st.get("fixRounds", 0) + 1
            if st["fixRounds"] > MAX_FIX_ROUNDS:
                return decision(num, title, stage, "escalation exhausted", r["out"], st,
                                "tests" if r["status"] else "infra", r)
            save_task_state(num, st)
            if st["fixRounds"] == ANALYST_ROUND and not st.get("analyzed") and not DRAIN.is_set():
                st["analyzed"] = True
                save_task_state(num, st)
                a = run_analyst(num, spec, st, ANALYST_ROUND)
                if a and a["action"] == "escalate":
                    cat = {"acceptance_tests": "tests", "infra": "infra"}.get(a["fault"], "spec")
                    return decision(num, title, stage, f"round analyst ({a['fault']}): {a['note'][:200]}", r["out"], st,
                                    cat, {"questions": [a["note"] or a["evidence"]], "failures": a["evidence"]},
                                    triage=False)
                if a and a["action"] == "dismiss_findings" and not st.get("dismissed"):
                    st["dismissed"] = True
                    st["fixRounds"] -= 1
                    st["verifyNote"] = ("Previously reported findings were judged false positives by the round "
                                        "analyst. Dismissed:\n" + "\n".join(f"- {x}" for x in a["dismissed"]) +
                                        f"\nEvidence: {a['evidence']}\nDo not re-raise them unless you can cite a "
                                        "spec line that requires them.")
                    save_task_state(num, st)
                    continue
                if a and a["action"] == "guide_coder" and a["note"]:
                    note = f"Round analyst guidance:\n{a['note']}\n\n{note}"
            fr = fix_call(spec, num, st["fixRounds"], note, st, heavy=heavy)
            remember(st, "fix", fr)
            if fr["status"] == "BLOCKED":
                return decision(num, title, stage, "fix round blocked", fr["out"], st, "spec", fr)
            if not fr["status"]:
                st["fixRounds"] -= 1
                save_task_state(num, st)
                if DRAIN.is_set():
                    continue
                return decision(num, title, stage, "fix run produced no report", fr["out"], st, "infra", fr)

        elif stage == "merge":
            err = merge_task(num, title)
            if err:
                return decision(num, title, stage, "merge into the main branch failed", err, st, "infra")
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

DECISION_POLL = float(os.environ.get("ORCH_DECISION_POLL", "30"))


def decision_resolved(num):
    name = load_state().get(num, {}).get("decision")
    return bool(name) and (DECISIONS / name.replace(".md", ".resolved.md")).exists()


def ready_tasks(tasks, done, running, waiting, only):
    out = []
    scope = milestone_scope()
    for t in sorted(tasks, key=lambda t: t["num"]):
        if scope is not None and t["num"] not in scope:
            continue
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


def reexec():
    release_lock()
    argv = [sys.executable, *sys.argv]
    if os.environ.get("ORCH_NO_EXEC"):
        print(f"[orch] restart exec: {shlex.join(argv)}", flush=True)
        return 75
    print("[orch] restarting", flush=True)
    sys.stdout.flush()
    os.execv(sys.executable, argv)


def signal_running(sig, what):
    pid = lock_holder()
    if not pid:
        print("orchestrator not running")
        return 1
    os.kill(pid, sig)
    print(f"{what} requested (pid {pid})")
    return 0


def stop(graceful):
    if graceful:
        return signal_running(signal.SIGUSR2, "graceful stop")
    pid = lock_holder()
    if not pid:
        print("orchestrator not running")
        return 1
    try:
        pgid = os.getpgid(pid)
        os.killpg(pgid, signal.SIGTERM) if pgid == pid else os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    print(f"stopped (pid {pid})")
    return 0


def run(max_parallel, only, dry_run):
    if not REGISTRY.exists():
        print("tasks/tasks.json missing: run `orchestrator.py migrate` first")
        return 2
    tasks = read_tasks()
    done = {t["num"] for t in tasks if t["status"] == "done"}

    if dry_run:
        m = active_milestone()
        if m:
            print(f"active milestone: {m['id']} {m['title']} ({m.get('status', 'open')})")
        state = load_state()
        for t in ready_tasks(tasks, done, set(), set(), only):
            print(f"{t['num']} {t['title']} — stage: {state.get(t['num'], {}).get('stage', 'acceptance')}")
        return 0

    if not acquire_lock():
        print(f"another orchestrator is running (pid {lock_holder()})")
        return 4
    atexit.register(release_lock)
    signal.signal(signal.SIGTERM, lambda *_: (release_lock(), os._exit(143)))

    def start_drain(mode):
        drain_mode["mode"] = drain_mode["mode"] or mode
        DRAIN.set()

    for sig, mode in ((signal.SIGHUP, "restart"), (signal.SIGUSR1, "restart"), (signal.SIGUSR2, "stop")):
        signal.signal(sig, lambda *_, m=mode: start_drain(m))
    for name, cap in provider_caps().items():
        if cap:
            sems[name] = threading.BoundedSemaphore(cap)
    reconcile()
    tasks = read_tasks()

    running, waiting = {}, set()
    quota_hit = False
    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        while True:
            waiting -= {n for n in waiting if decision_resolved(n)}
            if not quota_hit and not DRAIN.is_set():
                for t in ready_tasks(tasks, done, running, waiting, only)[:max_parallel - len(running)]:
                    running[t["num"]] = pool.submit(run_task, t)
            if not running:
                if quota_hit or DECISION_POLL <= 0 or not any(load_state().get(n, {}).get("decision") for n in waiting):
                    break
                DRAIN.wait(DECISION_POLL)
                tasks = read_tasks()
                continue
            finished, _ = wait(running.values(), timeout=DECISION_POLL if DECISION_POLL > 0 else None, return_when=FIRST_COMPLETED)
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
                if result != "drained":
                    (done.add if result == "done" else waiting.add)(num)
            tasks = read_tasks()

    if DRAIN.is_set():
        event(None, "drained", drain_mode["mode"])
        if drain_mode["mode"] == "restart":
            return reexec()
        return 0

    if quota_hit:
        notify("Orchestrator stopped: provider quota exhausted.")
        return 3
    m = active_milestone()
    if m and m.get("status") == "open" and all(n in done for n in m["tasks"]):
        build_milestone(m)
        return 0
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


def human(seconds):
    m = int(seconds // 60)
    return f"{m // 60}h{m % 60:02d}m" if m >= 60 else f"{m}m"


def quota_warnings(timeout=1.5):
    """Low-window warnings from a 5 min disk cache; fetches missing providers in threads, bounded by timeout."""
    cache_file = AI / "quota-cache.json"
    try:
        cache = json.loads(cache_file.read_text())
    except (OSError, ValueError):
        cache = {}
    now = time.time()
    names = [n for n in load_json(PROVIDERS).get("providers", {})]
    stale = [n for n in names if now - cache.get(n, {}).get("ts", 0) > 300]

    def fetch(n):
        cache[n] = {"ts": time.time(), "value": quota.cached(n, 0)}

    threads = [threading.Thread(target=fetch, args=(n,), daemon=True) for n in stale]
    for t in threads:
        t.start()
    end = time.time() + timeout
    for t in threads:
        t.join(max(0, end - time.time()))
    if stale:
        try:
            AI.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({n: dict(v) for n, v in list(cache.items())}))
        except OSError:
            pass
    out = []
    for n in names:
        value = cache.get(n, {}).get("value")
        for w in value if isinstance(value, list) else []:
            if w.get("limit") and w["remaining"] / w["limit"] < quota.LOW:
                out.append(f"{n} {w['window']} {w['remaining']}/{w['limit']} left")
    return out


def brief(use_quota=True):
    lines = []
    tasks = read_tasks()
    state = load_state()
    done = {t["num"] for t in tasks if t["status"] == "done"}
    holder = lock_holder()
    m = active_milestone()
    if m:
        ntasks = [n for n in m["tasks"]]
        lines.append(f"milestone {m['id']} {m['title']} [{m.get('status', 'open')}]: "
                     f"{sum(n in done for n in ntasks)}/{len(ntasks)} tasks done")
    lines.append(f"orchestrator: {'running pid ' + str(holder) if holder else 'NOT running'}")
    try:
        live_now = json.loads((AI / "running.json").read_text()).get("running", []) if holder else []
    except (OSError, ValueError):
        live_now = []
    for w in sorted(live_now, key=lambda w: w["task"]):
        lines.append(f"  running {w['task']} {w['role']} {w.get('provider')}/{w.get('model')} "
                     f"{human(time.time() - w['start'])}")
    waiting = {n for n, s in state.items() if s.get("decision") and not decision_resolved(n)}
    scope = milestone_scope()
    todo = [t for t in tasks if t["status"] not in FINISHED and t["num"] not in done
            and (scope is None or t["num"] in scope) and t["num"] not in waiting
            and t["num"] not in {w["task"] for w in live_now}]
    queued = sum(all(d in done for d in t["deps"]) for t in todo)
    lines.append(f"queued {queued}, blocked by deps {len(todo) - queued}, waiting decision {len(waiting)}, "
                 f"done {len(done)}/{len(tasks)}")
    for f in sorted(DECISIONS.glob("*.md")) if DECISIONS.exists() else []:
        if f.name.endswith(".resolved.md"):
            continue
        try:
            d = json.loads(f.with_suffix(".json").read_text())
        except (OSError, ValueError):
            d = {"category": "?", "questions": [f.read_text().split("Question:")[-1].strip().splitlines()[0]]}
        lines.append(f"  decision {f.stem} [{d.get('category')}] {str(d['questions'][0])[:140] if d.get('questions') else ''}")
    bad = [e for e in (json.loads(x) for x in EVENTS.read_text().splitlines() if x.strip())
           if e["event"] in ("error", "retry", "commit-failed", "quota", "decision")] if EVENTS.exists() else []
    for e in bad[-3:]:
        lines.append(f"  recent {e['ts'][5:16]} {e['task'] or '-'} {e['event']} {str(e['detail'])[:90]}")
    unreviewed = [f for f in INSIGHTS.glob("*.md") if not f.name.endswith(".reviewed.md")] if INSIGHTS.exists() else []
    if unreviewed:
        lines.append(f"insights: {len(unreviewed)} unreviewed in .ai/insights/")
    if use_quota:
        warn = quota_warnings()
        if warn:
            lines.append("QUOTA LOW: " + "; ".join(warn))
    ready = [x for x in read_milestones() if x.get("status") == "built"]
    for x in ready:
        lines.append(f"BUILD READY {x['id']} (build {'ok' if x.get('buildOk') else 'FAILED'}, "
                     f"tests {'ok' if x.get('testsOk') else 'FAILED'}): python3 scripts/ai/play.py {x['id']} "
                     f"then orchestrator.py approve {x['id']}")
    print("\n".join(lines[:20]))
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
    br = sub.add_parser("brief")
    br.add_argument("--no-quota", action="store_true")
    sub.add_parser("restart")
    sp = sub.add_parser("stop")
    sp.add_argument("--graceful", action="store_true")
    m = sub.add_parser("migrate")
    m.add_argument("--force", action="store_true")
    sub.add_parser("readme")
    a = sub.add_parser("approve")
    a.add_argument("milestone")
    b = sub.add_parser("build")
    b.add_argument("milestone")
    c = sub.add_parser("cleanup")
    c.add_argument("--all", action="store_true")
    c.add_argument("--sessions", type=int, metavar="DAYS")
    args = parser.parse_args()
    if args.cmd == "status":
        return status()
    if args.cmd == "brief":
        return brief(not args.no_quota)
    if args.cmd == "restart":
        return signal_running(signal.SIGUSR1, "graceful restart")
    if args.cmd == "stop":
        return stop(args.graceful)
    if args.cmd == "migrate":
        return migrate(args.force)
    if args.cmd == "readme":
        write_readme(read_tasks())
        return 0
    if args.cmd == "approve":
        return approve(args.milestone)
    if args.cmd == "build":
        m = next((x for x in read_milestones() if x["id"] == args.milestone), None)
        return 0 if m and build_milestone(m) else 1
    if args.cmd == "cleanup":
        return cleanup(args.all, args.sessions)
    only = set(args.only.split(",")) if args.only else None
    return run(max(1, args.max_parallel), only, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
