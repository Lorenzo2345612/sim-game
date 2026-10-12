"""Acceptance tests for tasks/infra/001-orchestrator.md (AT1..AT11).

Each test builds a temporary git repo with a minimal tasks/README.md and specs,
points ORCH_WORKER_CMD at scripts/ai/tests/fake_worker.py and runs
scripts/ai/orchestrator.py as a subprocess.
"""
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


def success_script(overrides=None, drop=()):
    entries = [{"role": r, "task": None, "stdout": SUCCESS[r], "exit": 0}
               for r in ALL_ROLES if r not in drop]
    for role, stdout in (overrides or {}).items():
        for e in entries:
            if e["role"] == role:
                e["stdout"] = stdout
    return entries


class OrchestratorAcceptanceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="orch-at-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.specs = {}
        self.rows = []
        self.tracked = []
        self.committed = False
        self.last_proc = None
        self.git("init", "-q")
        self.git("config", "user.name", "Orchestrator Test")
        self.git("config", "user.email", "orch-test@example.invalid")
        self.git("config", "commit.gpgsign", "false")

    # -- fixtures ----------------------------------------------------------

    def add_task(self, num, title, *, deps=(), complexity="simple",
                 status="pending", acceptance=True):
        files = [f"src/{num}.ts"]
        spec = self.repo / "tasks" / f"{num}-{title.lower()}.md"
        spec.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"# {num} — {title}", "",
                 f"Status: {status}",
                 f"Depends on: {', '.join(deps) if deps else '-'}",
                 f"Complexity: {complexity}",
                 "", "## Goal", "", "Goal.", "", "## Files", ""]
        lines += [f"- `{f}` — create" for f in files]
        if acceptance:
            lines += ["", "## Acceptance tests", "",
                      "| ID | Given | When | Then |", "|---|---|---|---|",
                      "| AT1 | fixture | run | passes |"]
        spec.write_text("\n".join(lines) + "\n")
        self.specs[num] = spec

        readme = "# Tasks\n\n| # | Title | Status | Depends on | Parallel with |\n"
        readme += "|---|---|---|---|---|\n"
        self.rows.append((num, title, status, deps))
        for n, t, s, d in self.rows:
            readme += f"| {n} | {t} | {s} | {', '.join(d) if d else '-'} | - |\n"
        (self.repo / "tasks/README.md").write_text(readme)

        for f in files:
            p = self.repo / f
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("export const x = 1;\n")
        # Untracked stand-ins for the files the workers would create: they make
        # the "no test commit" / test-commit assertions meaningful.
        acc = self.repo / "tests/unit/acceptance" / f"{num}-fake.test.ts"
        acc.parent.mkdir(parents=True, exist_ok=True)
        acc.write_text("// fake acceptance test\n")
        if complexity == "complex":
            edge = self.repo / "tests/unit/edge" / f"{num}-fake.test.ts"
            edge.parent.mkdir(parents=True, exist_ok=True)
            edge.write_text("// fake edge test\n")

        rel = ["tasks/README.md", str(spec.relative_to(self.repo))]
        self.tracked += [r for r in rel + files if r not in self.tracked]

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

    def git(self, *args):
        p = subprocess.run(["git", "-C", str(self.repo), *args],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, f"git {' '.join(args)}: {p.stderr}")
        return p.stdout

    def run_orch(self, args):
        self.commit_scaffold()
        env = {k: v for k, v in os.environ.items()
               if not re.match(r"^(GIT_|ORCH_|FAKE_|SIMGAME_|CLAUDE_|ANTHROPIC_)", k)}
        env.update({
            "ORCH_ROOT": str(self.repo),
            "ORCH_WORKER_CMD": shlex.join([sys.executable, str(FAKE_WORKER)]),
            "FAKE_SCRIPT": str(self.script_path),
            "FAKE_CALLS": str(self.calls_path),
        })
        self.last_proc = subprocess.run([sys.executable, str(ORCHESTRATOR), *args],
                                        cwd=self.repo, env=env, capture_output=True,
                                        text=True, timeout=120, stdin=subprocess.DEVNULL)
        return self.last_proc

    def diag(self):
        p = self.last_proc
        return f"\norch exit={p.returncode}\nstdout:\n{p.stdout[-2000:]}\nstderr:\n{p.stderr[-2000:]}"

    def calls(self):
        if not self.calls_path.exists():
            return []
        out = []
        for line in self.calls_path.read_text().splitlines():
            argv = json.loads(line)["argv"]
            task = None
            if "--task" in argv and argv.index("--task") + 1 < len(argv):
                task = Path(argv[argv.index("--task") + 1]).name
            out.append({"argv": argv, "role": argv[0], "task": task})
        return out

    def calls_for(self, num):
        return [c for c in self.calls() if c["task"] and c["task"].startswith(f"{num}-")]

    def note_of(self, call):
        argv = call["argv"]
        return argv[argv.index("--note") + 1] if "--note" in argv else None

    def readme_status(self, num):
        for line in (self.repo / "tasks/README.md").read_text().splitlines():
            if line.startswith(f"| {num} |"):
                return line.split("|")[3].strip()
        return None

    def spec_status(self, num):
        m = re.search(r"^Status:\s*(.+)$", self.specs[num].read_text(), re.M)
        return m.group(1).strip() if m else None

    def git_subjects(self):
        return self.git("log", "--format=%s", "--reverse").splitlines()

    def events(self):
        p = self.repo / ".ai/events.log"
        if not p.exists():
            return []
        return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]

    # -- acceptance tests -----------------------------------------------------

    def test_AT1_simple_task_pipeline_commits_in_order(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("001")],
                         ["acceptance", "coder", "reviewer"], self.diag())
        self.assertEqual(self.readme_status("001"), "done", self.diag())
        self.assertEqual(self.spec_status("001"), "done", self.diag())
        subjects = self.git_subjects()
        self.assertIn("test: acceptance tests (task 001)", subjects, self.diag())
        feats = [s for s in subjects if re.fullmatch(r"feat: .* \(task 001\)", s)]
        self.assertTrue(feats, f"no feat commit in {subjects}{self.diag()}")
        self.assertLess(subjects.index("test: acceptance tests (task 001)"),
                        subjects.index(feats[0]), self.diag())

    def test_AT2_complex_task_runs_all_stages(self):
        self.add_task("002", "Beta", complexity="complex")
        self.write_script(success_script())
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("002")],
                         ["acceptance", "tester-pre", "coder", "tester", "reviewer"],
                         self.diag())

    def test_AT3_dependent_task_starts_after_its_dependency_completes(self):
        self.add_task("002", "Base")
        self.add_task("003", "Dependent", deps=["002"])
        self.write_script(success_script())
        self.run_orch(["run", "--max-parallel", "3"])
        all_calls = self.calls()
        dep_reviewer = max((i for i, c in enumerate(all_calls)
                            if c["role"] == "reviewer" and c["task"].startswith("002-")),
                           default=None)
        first_003 = min((i for i, c in enumerate(all_calls)
                         if c["task"].startswith("003-")), default=None)
        self.assertIsNotNone(dep_reviewer, f"no reviewer call for 002{self.diag()}")
        self.assertIsNotNone(first_003, f"no call for 003{self.diag()}")
        self.assertGreater(first_003, dep_reviewer, self.diag())

    def test_AT4_fix_note_contains_only_blocker_lines(self):
        self.add_task("004", "Gamma")
        entries = success_script()
        entries = [e for e in entries if e["role"] != "reviewer"]
        entries.append({"role": "reviewer", "task": None, "exit": 0,
                        "stdout": "VERDICT: CHANGES\nFINDINGS:\n"
                                  "- [BLOCKER] src/a.ts:3 — blocker-text — fix it\n"
                                  "- [MINOR] src/b.ts:9 — minor-text — polish it\n"})
        entries.append({"role": "reviewer", "task": None, "exit": 0,
                        "stdout": "VERDICT: APPROVED\n"})
        self.write_script(entries)
        self.run_orch(["run"])
        calls = self.calls_for("004")
        coders = [c for c in calls if c["role"] == "coder"]
        reviewers = [c for c in calls if c["role"] == "reviewer"]
        self.assertEqual(len(reviewers), 2, self.diag())
        self.assertEqual(len(coders), 2, self.diag())
        self.assertIn("--resume", coders[1]["argv"], self.diag())
        note = self.note_of(coders[1])
        self.assertIsNotNone(note, self.diag())
        self.assertIn("blocker-text", note, self.diag())
        self.assertNotIn("minor-text", note, self.diag())

    def test_AT5_tester_fail_escalates_then_waits_for_decision(self):
        self.add_task("005", "Delta", complexity="complex")
        self.write_script(success_script(overrides={
            "tester": "STATUS: FAIL\nFAILURES: src/d.ts:2 — assertion wrong\n"}))
        self.run_orch(["run"])
        calls = self.calls_for("005")
        self.assertEqual([c["role"] for c in calls],
                         ["acceptance", "tester-pre", "coder", "tester",
                          "coder", "tester", "coder", "tester",
                          "coder", "tester", "fixer", "tester"], self.diag())
        self.assertNotIn("--resume", calls[2]["argv"], self.diag())
        for i in (4, 6, 8):
            self.assertIn("--resume", calls[i]["argv"], self.diag())
        self.assertNotIn("--heavy", calls[4]["argv"], self.diag())
        self.assertNotIn("--heavy", calls[6]["argv"], self.diag())
        self.assertIn("--heavy", calls[8]["argv"], self.diag())
        self.assertNotIn("--resume", calls[10]["argv"], self.diag())
        self.assertTrue((self.repo / ".ai/decisions/005-tester.md").exists(), self.diag())
        self.assertEqual(self.readme_status("005"), "waiting decision", self.diag())

    def test_AT6_spec_silent_decision_does_not_block_independent_task(self):
        self.add_task("003", "Echo", complexity="complex")
        self.add_task("004", "Foxtrot")
        self.write_script(success_script(overrides={"tester-pre": "STATUS: READY\nSPEC_SILENT: x\n"}))
        self.run_orch(["run"])
        self.assertTrue((self.repo / ".ai/decisions/003-tester-pre.md").exists(), self.diag())
        self.assertEqual([c for c in self.calls_for("003") if c["role"] == "coder"],
                         [], self.diag())
        self.assertEqual(self.readme_status("004"), "done", self.diag())

    def test_AT7_resumes_from_saved_stage(self):
        self.add_task("007", "Golf")
        self.write_script(success_script())
        (self.repo / ".ai").mkdir()
        (self.repo / ".ai/state.json").write_text(
            json.dumps({"007": {"stage": "reviewer", "fixRounds": 0}}))
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("007")], ["reviewer"],
                         self.diag())

    def test_AT8_quota_error_stops_with_exit_3(self):
        self.add_task("008", "Hotel")
        self.write_script(success_script(drop=("acceptance",)) + [
            {"role": "acceptance", "task": None, "exit": 1,
             "stdout": "[worker] quota error: provider out of balance\n"}])
        p = self.run_orch(["run"])
        self.assertEqual(p.returncode, 3, self.diag())
        self.assertIn("quota", [ev["event"] for ev in self.events()], self.diag())
        self.assertEqual(len(self.calls()), 1, self.diag())

    def test_AT9_dry_run_lists_tasks_without_side_effects(self):
        self.add_task("009", "Nine")
        self.add_task("010", "Ten")
        self.write_script(success_script())
        self.commit_scaffold()
        before_status = self.git("status", "--porcelain")
        before_log = self.git("log", "--format=%s", "--reverse")
        p = self.run_orch(["run", "--dry-run"])
        self.assertIn("009", p.stdout, self.diag())
        self.assertIn("010", p.stdout, self.diag())
        self.assertEqual(self.calls(), [], self.diag())
        self.assertEqual(self.git("status", "--porcelain"), before_status, self.diag())
        self.assertEqual(self.git("log", "--format=%s", "--reverse"), before_log, self.diag())
        self.assertFalse((self.repo / ".ai").exists(), self.diag())

    def test_AT10_resolved_decision_reruns_the_stage(self):
        self.add_task("010", "India")
        entries = success_script(drop=("acceptance",))
        # a (role, task)'s entries are consumed in list order: BLOCKED first, READY on re-run
        entries[:0] = [
            {"role": "acceptance", "task": None, "exit": 0,
             "stdout": "STATUS: BLOCKED\nUNTESTABLE: row ambiguous\n"},
            {"role": "acceptance", "task": None, "exit": 0,
             "stdout": "STATUS: READY\nUNTESTABLE: none\n"},
        ]
        self.write_script(entries)
        self.run_orch(["run"])
        decision = self.repo / ".ai/decisions/010-acceptance.md"
        self.assertTrue(decision.exists(), self.diag())
        decision.rename(self.repo / ".ai/decisions/010-acceptance.resolved.md")
        n_before = len(self.calls())
        self.run_orch(["run"])
        new_roles = [c["role"] for c in self.calls()[n_before:]]
        self.assertEqual(new_roles, ["acceptance", "coder", "reviewer"], self.diag())

    def test_AT11_spec_without_acceptance_section_skips_acceptance_and_test_commit(self):
        self.add_task("011", "Juliet", acceptance=False)
        self.write_script(success_script())
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("011")],
                         ["coder", "reviewer"], self.diag())
        self.assertFalse([s for s in self.git_subjects() if s.startswith("test:")],
                         f"unexpected test commit{self.diag()}")


if __name__ == "__main__":
    unittest.main()
