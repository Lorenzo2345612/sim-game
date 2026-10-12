"""Shared fixtures for the orchestrator acceptance tests: temp git repo with tasks/tasks.json,
specs, a fake worker (fake_worker.py) and a subprocess runner for scripts/ai/orchestrator.py."""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REAL_ROOT = Path(__file__).resolve().parents[3]
ORCHESTRATOR = REAL_ROOT / "scripts" / "ai" / "orchestrator.py"
FAKE_WORKER = Path(__file__).resolve().parent / "fake_worker.py"

ALL_ROLES = ("acceptance", "tester-pre", "coder", "tester", "reviewer", "fixer")

SUCCESS = {
    "acceptance": "STATUS: READY\nUNTESTABLE: none\n",
    "tester-pre": "STATUS: READY\nSPEC_SILENT: none\n",
    "coder": "STATUS: OK\n",
    "tester": "STATUS: PASS\n",
    "reviewer": "VERDICT: APPROVED\n",
    "fixer": "STATUS: OK\n",
}

WRITES = {
    "acceptance": {"tests/unit/acceptance/{num}-fake.test.ts": "// fake acceptance test\n"},
    "tester-pre": {"tests/unit/edge/{num}-fake.test.ts": "// fake edge test\n"},
    "coder": {"src/{num}.ts": "export const x = 2;\n"},
}


def success_script(overrides=None, drop=(), writes=True):
    entries = [{"role": r, "task": None, "stdout": SUCCESS[r], "exit": 0,
                **({"writes": WRITES[r]} if writes and r in WRITES else {})}
               for r in ALL_ROLES if r not in drop]
    for role, stdout in (overrides or {}).items():
        for e in entries:
            if e["role"] == role:
                e["stdout"] = stdout
    return entries


def report_json(obj):
    return "[worker] report-json: " + json.dumps(obj, separators=(",", ":")) + "\n"


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="orch-at-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.specs = {}
        self.tasks = []
        self.tracked = [".gitignore"]
        self.committed = False
        self.last_proc = None
        self.quota_mock = {}
        (self.repo / ".gitignore").write_text(".ai/\nnode_modules/\n")
        self.git("init", "-q")
        self.git("config", "user.name", "Orchestrator Test")
        self.git("config", "user.email", "orch-test@example.invalid")
        self.git("config", "commit.gpgsign", "false")

    # -- fixtures ----------------------------------------------------------

    def add_task(self, num, title, *, deps=(), complexity="simple", status="pending",
                 acceptance=True, ttype="feature"):
        spec = self.repo / "tasks" / f"{num}-{title.lower()}.md"
        spec.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"# {num} — {title}", "", f"Status: {status}", "Phase: 1",
                 f"Depends on: {', '.join(deps) if deps else '-'}",
                 f"Complexity: {complexity}", f"Type: {ttype}",
                 "", "## Goal", "", "Goal.", "", "## Files", "", f"- `src/{num}.ts` — create"]
        if acceptance:
            lines += ["", "## Acceptance tests", "",
                      "| ID | Given | When | Then |", "|---|---|---|---|",
                      "| AT1 | fixture | run | passes |"]
        spec.write_text("\n".join(lines) + "\n")
        self.specs[num] = spec
        self.tasks.append({"num": num, "title": title, "status": status, "deps": list(deps),
                           "complexity": complexity, "type": ttype, "phase": 1,
                           "spec": str(spec.relative_to(self.repo))})
        self.write_registry()
        src = self.repo / f"src/{num}.ts"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text("export const x = 1;\n")
        self.tracked += [p for p in ("tasks/tasks.json", "tasks/README.md", str(spec.relative_to(self.repo)),
                                     f"src/{num}.ts") if p not in self.tracked]

    def write_registry(self, tasks=None):
        (self.repo / "tasks/tasks.json").write_text(json.dumps({"tasks": tasks or self.tasks}, indent=2))
        rows = "".join(f"| {t['num']} | {t['title']} | {t['status']} | {', '.join(t['deps']) or '-'} |\n"
                       for t in (tasks or self.tasks))
        (self.repo / "tasks/README.md").write_text(
            "# Tasks\n\nIntro.\n\n| # | Title | Status | Depends on |\n|---|---|---|---|\n" + rows)

    def set_providers(self, caps, extra_roles=None):
        roles = {"acceptance": "qwen", "tester-pre": "qwen", "coder": "glm", "tester": "qwen",
                 "reviewer": "kimi", "fixer": "qwen", **(extra_roles or {})}
        cfg = {"providers": {n: {"maxConcurrent": c} for n, c in caps.items()},
               "roles": {r: {"provider": p} for r, p in roles.items()},
               "fallback": {"provider": "mimo"}}
        (self.repo / "ai").mkdir(exist_ok=True)
        (self.repo / "ai/providers.json").write_text(json.dumps(cfg))
        self.tracked.append("ai/providers.json")

    def write_script(self, entries):
        self.script_path = self.tmp / "script.json"
        self.script_path.write_text(json.dumps(entries))
        self.calls_path = self.tmp / "calls.jsonl"

    def commit_scaffold(self):
        if self.committed:
            return
        self.committed = True
        self.git("add", "--", *self.tracked)
        self.git("commit", "-q", "-m", "init")

    # -- runner and probes --------------------------------------------------

    def git(self, *args, cwd=None):
        p = subprocess.run(["git", "-C", str(cwd or self.repo), *args], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, f"git {' '.join(args)}: {p.stderr}")
        return p.stdout

    def env(self, extra=None):
        env = {k: v for k, v in os.environ.items()
               if not re.match(r"^(GIT_|ORCH_|FAKE_|SIMGAME_|CLAUDE_|ANTHROPIC_|QUOTA_|E2E_)", k)}
        mock = self.tmp / "quota.json"
        mock.write_text(json.dumps(self.quota_mock))
        env.update({
            "ORCH_ROOT": str(self.repo),
            "ORCH_DECISION_POLL": "0",
            "ORCH_WORKER_CMD": shlex.join([sys.executable, str(FAKE_WORKER)]),
            "FAKE_SCRIPT": str(getattr(self, "script_path", "")),
            "FAKE_CALLS": str(self.tmp / "calls.jsonl"),
            "QUOTA_MOCK": str(mock),
            **(extra or {}),
        })
        return env

    def run_orch(self, args, extra_env=None):
        self.commit_scaffold()
        self.last_proc = subprocess.run([sys.executable, str(ORCHESTRATOR), *args], cwd=self.repo,
                                        env=self.env(extra_env), capture_output=True, text=True,
                                        timeout=120, stdin=subprocess.DEVNULL)
        return self.last_proc

    def diag(self):
        p = self.last_proc
        return f"\norch exit={p.returncode}\nstdout:\n{p.stdout[-2000:]}\nstderr:\n{p.stderr[-2000:]}"

    def raw_calls(self):
        path = self.tmp / "calls.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def calls(self):
        out = []
        for rec in self.raw_calls():
            if "argv" not in rec:
                continue
            argv = rec["argv"]
            task = None
            if "--task" in argv and argv.index("--task") + 1 < len(argv):
                task = Path(argv[argv.index("--task") + 1]).name
            out.append({"argv": argv, "role": argv[0], "task": task, **rec})
        return out

    def calls_for(self, num):
        return [c for c in self.calls() if c["task"] and c["task"].startswith(f"{num}-")]

    def intervals(self, role):
        """(start, end) per call of a role, paired through the log."""
        ends = {}
        for rec in self.raw_calls():
            if "end" in rec:
                ends.setdefault(json.dumps(rec["end"]["argv"]), []).append(rec["end"]["ts"])
        out = []
        for c in self.calls():
            if c["role"] == role:
                out.append((c["start"], ends[json.dumps(c["argv"])].pop(0)))
        return sorted(out)

    def note_of(self, call):
        argv = call["argv"]
        return argv[argv.index("--note") + 1] if "--note" in argv else None

    def registry(self):
        return {t["num"]: t for t in json.loads((self.repo / "tasks/tasks.json").read_text())["tasks"]}

    def task_status(self, num):
        return self.registry()[num]["status"]

    def git_subjects(self):
        return self.git("log", "--format=%s", "--reverse").splitlines()

    def events(self):
        p = self.repo / ".ai/events.log"
        if not p.exists():
            return []
        return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]

    def branches(self):
        return self.git("branch", "--format=%(refname:short)").split()
