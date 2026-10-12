"""Acceptance tests for tasks/infra/002-orchestrator-v2.md (AT1..AT14)."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

from .harness import REAL_ROOT, Harness, report_json, success_script

sys.path.insert(0, str(REAL_ROOT / "scripts" / "ai"))
import quota  # noqa: E402

CODER_OK = {"status": "OK", "files": ["src/x.ts"], "verification": ["npm test: pass"], "decisions": [], "pending": []}


def reviewer_json(verdict, findings=()):
    return report_json({"verdict": verdict, "checks": {"typecheck": "pass", "lint": "pass", "test": "pass"},
                        "findings": list(findings)})


def finding(severity, location, problem):
    return {"severity": severity, "location": location, "problem": problem, "fix": "fix-" + problem}


class OrchestratorV2Test(Harness):
    def parse_table(self, path):
        rows = []
        for line in path.read_text().splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if line.startswith("|") and cells[0].isdigit():
                rows.append(tuple(cells))
        return rows

    def test_AT1_migrate_and_readme(self):
        v1 = [("001", "Alpha", "done", "-", "simple"), ("002", "Beta", "pending", "001", "complex"),
              ("003", "Gamma", "pending", "001, 002", "simple")]
        readme = "# Tasks\n\n| # | Title | Status | Depends on | Parallel with |\n|---|---|---|---|---|\n"
        for num, title, status, deps, cx in v1:
            readme += f"| {num} | {title} | {status} | {deps} | - |\n"
            spec = self.repo / "tasks" / f"{num}-{title.lower()}.md"
            spec.parent.mkdir(parents=True, exist_ok=True)
            spec.write_text(f"# {num} — {title}\n\nStatus: {status}\nPhase: 1\nDepends on: {deps}\n"
                            f"Complexity: {cx}\nType: {'bugfix' if num == '003' else 'feature'}\n")
            self.tracked.append(str(spec.relative_to(self.repo)))
        (self.repo / "tasks/README.md").write_text(readme)
        self.tracked.append("tasks/README.md")
        p = self.run_orch(["migrate"])
        self.assertEqual(p.returncode, 0, self.diag())
        reg = self.registry()
        self.assertEqual(sorted(reg), ["001", "002", "003"], self.diag())
        self.assertEqual(reg["003"]["deps"], ["001", "002"])
        self.assertEqual([reg[n]["complexity"] for n in ("001", "002", "003")], ["simple", "complex", "simple"])
        self.assertEqual([reg[n]["type"] for n in ("001", "002", "003")], ["feature", "feature", "bugfix"])
        self.assertEqual([reg[n]["status"] for n in ("001", "002", "003")], ["done", "pending", "pending"])
        self.assertEqual(reg["002"]["spec"], "tasks/002-beta.md")
        before = self.parse_table(self.repo / "tasks/README.md")
        (self.repo / "tasks/README.md").write_text("garbage\n")
        self.assertEqual(self.run_orch(["readme"]).returncode, 0, self.diag())
        after = self.parse_table(self.repo / "tasks/README.md")
        norm = lambda rows: [(r[0], r[1], r[2], r[3]) for r in rows]  # noqa: E731
        self.assertEqual(norm(after), norm(before), self.diag())
        header = (self.repo / "tasks/README.md").read_text()
        self.assertIn("| # | Title | Status | Depends on |", header)

    def test_AT2_json_report_without_text_is_parsed(self):
        self.add_task("001", "Alpha")
        entries = success_script()
        for e in entries:
            if e["role"] == "coder":
                e["stdout"] = report_json(CODER_OK)
        self.write_script(entries)
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("001")], ["acceptance", "coder", "reviewer"], self.diag())
        self.assertEqual(self.task_status("001"), "done", self.diag())

    def test_AT3_fix_note_contains_only_blocker(self):
        self.add_task("001", "Alpha")
        entries = [e for e in success_script() if e["role"] != "reviewer"]
        entries.append({"role": "reviewer", "task": None, "exit": 0, "stdout": reviewer_json(
            "CHANGES", [finding("BLOCKER", "src/a.ts:3", "blocker-text"),
                        finding("MINOR", "src/b.ts:9", "minor-text")])})
        entries.append({"role": "reviewer", "task": None, "exit": 0, "stdout": reviewer_json("APPROVED")})
        self.write_script(entries)
        self.run_orch(["run"])
        coders = [c for c in self.calls_for("001") if c["role"] == "coder"]
        self.assertEqual(len(coders), 2, self.diag())
        self.assertIn("--resume", coders[1]["argv"])
        note = self.note_of(coders[1])
        self.assertIn("blocker-text", note)
        self.assertIn("src/a.ts:3", note)
        self.assertNotIn("minor-text", note)
        self.assertNotIn("src/b.ts", note)

    def test_AT4_worktree_flow_merge_and_cleanup(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        self.run_orch(["run"])
        wt = str(self.repo / ".ai/wt/001")
        calls = self.calls_for("001")
        self.assertEqual([c["role"] for c in calls], ["acceptance", "coder", "reviewer"], self.diag())
        self.assertTrue(all(c["workdir"] == wt for c in calls), [c["workdir"] for c in calls])
        subjects = self.git_subjects()
        self.assertIn("test: acceptance tests (task 001)", subjects, self.diag())
        self.assertIn("feat: Alpha (task 001)", subjects, self.diag())
        self.assertLess(subjects.index("test: acceptance tests (task 001)"), subjects.index("feat: Alpha (task 001)"))
        self.assertTrue((self.repo / "tests/unit/acceptance/001-fake.test.ts").exists())
        self.assertEqual((self.repo / "src/001.ts").read_text(), "export const x = 2;\n")
        self.assertFalse(Path(wt).exists(), self.diag())
        self.assertNotIn("task/001", self.branches())
        self.assertEqual(self.task_status("001"), "done")
        self.assertFalse((self.repo / ".ai/orchestrator.lock").exists())

    def test_AT5_merge_conflict_becomes_decision(self):
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta")
        entries = success_script(drop=("coder",))
        entries += [{"role": "coder", "task": "001-alpha.md", "stdout": "STATUS: OK\n", "writes": {"shared.txt": "A\n"}},
                    {"role": "coder", "task": "002-beta.md", "stdout": "STATUS: OK\n", "sleep": 1.5,
                     "writes": {"shared.txt": "B\n"}}]
        self.write_script(entries)
        self.run_orch(["run", "--max-parallel", "2"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual((self.repo / "shared.txt").read_text(), "A\n")
        self.assertTrue((self.repo / ".ai/decisions/002-merge.md").exists(), self.diag())
        self.assertFalse((self.repo / ".ai/decisions/001-merge.md").exists())
        self.assertTrue((self.repo / ".ai/wt/002").exists(), self.diag())
        self.assertIn("task/002", self.branches())
        self.assertEqual(self.task_status("002"), "waiting decision", self.diag())
        self.assertEqual(self.git("status", "--porcelain", cwd=self.repo / ".ai/wt/002").strip(), "")

    def test_AT6_live_lock_blocks_second_run(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        holder = subprocess.Popen(["sleep", "60"])
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        (self.repo / ".ai").mkdir()
        (self.repo / ".ai/orchestrator.lock").write_text(str(holder.pid))
        p = self.run_orch(["run"])
        self.assertEqual(p.returncode, 4, self.diag())
        self.assertEqual(self.calls(), [])
        self.assertEqual((self.repo / ".ai/orchestrator.lock").read_text(), str(holder.pid))

    def test_AT7_stale_lock_is_taken_over(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        dead = subprocess.Popen(["true"])
        dead.wait()
        (self.repo / ".ai").mkdir()
        (self.repo / ".ai/orchestrator.lock").write_text(str(dead.pid))
        p = self.run_orch(["run"])
        self.assertEqual(p.returncode, 0, self.diag())
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertFalse((self.repo / ".ai/orchestrator.lock").exists())

    def test_AT8_provider_cap_serialises_coders(self):
        for n in ("001", "002", "003"):
            self.add_task(n, "T" + n)
        self.set_providers({"glm": 1, "kimi": 2, "qwen": 4, "mimo": 4})
        entries = success_script()
        for e in entries:
            if e["role"] in ("coder", "acceptance"):
                e["sleep"] = 1
        self.write_script(entries)
        p = self.run_orch(["run", "--max-parallel", "6"])
        self.assertEqual(p.returncode, 0, self.diag())
        coders = self.intervals("coder")
        self.assertEqual(len(coders), 3, self.diag())
        for (_, end), (start, _) in zip(coders, coders[1:]):
            self.assertLessEqual(end, start + 0.01, coders)
        acc = self.intervals("acceptance")
        self.assertEqual(len(acc), 3)
        self.assertTrue(any(start < end for (_, end), (start, _) in zip(acc, acc[1:])), acc)

    def test_AT9_leftover_worktree_of_done_task_is_removed(self):
        self.add_task("001", "Alpha", status="done")
        self.write_script(success_script())
        self.commit_scaffold()
        for mode in ("run", "cleanup"):
            self.git("worktree", "add", "-q", "-b", "task/001", str(self.repo / ".ai/wt/001"))
            p = self.run_orch([mode])
            self.assertEqual(p.returncode, 0, self.diag())
            self.assertFalse((self.repo / ".ai/wt/001").exists(), mode + self.diag())
            self.assertNotIn("task/001", self.branches(), mode)
        self.assertEqual(self.calls(), [])

    def test_AT10_merge_stage_is_idempotent(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        self.commit_scaffold()
        self.git("branch", "task/001")
        (self.repo / ".ai").mkdir()
        (self.repo / ".ai/state.json").write_text(json.dumps({"001": {"stage": "merge", "fixRounds": 0}}))
        p = self.run_orch(["run"])
        self.assertEqual(p.returncode, 0, self.diag())
        self.assertEqual(self.calls(), [], self.diag())
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertNotIn("task/001", self.branches())
        self.assertNotIn("error", [e["event"] for e in self.events()])

    def test_AT11_running_tasks_get_distinct_e2e_ports(self):
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta")
        entries = success_script()
        for e in entries:
            if e["role"] == "coder":
                e["sleep"] = 1
        self.write_script(entries)
        self.run_orch(["run", "--max-parallel", "2"])
        coders = [c for c in self.calls() if c["role"] == "coder"]
        ports = [int(c["e2e_port"]) for c in coders]
        self.assertEqual(len(ports), 2, self.diag())
        self.assertEqual(len(set(ports)), 2, ports)
        self.assertTrue(all(p >= 4200 for p in ports), ports)

    def test_AT12_dashboard_lists_worktrees_and_providers(self):
        self.add_task("001", "Alpha")
        self.set_providers({"glm": 2, "kimi": 2, "qwen": 4, "mimo": 4})
        self.commit_scaffold()
        self.git("worktree", "add", "-q", "-b", "task/001", str(self.repo / ".ai/wt/001"))
        code = ("import json,sys; sys.path.insert(0, %r); import dashboard; print(json.dumps(dashboard.status()))"
                % str(REAL_ROOT / "scripts/ai"))
        p = subprocess.run([sys.executable, "-c", code], env=self.env(), capture_output=True, text=True, cwd=self.repo)
        self.assertEqual(p.returncode, 0, p.stderr)
        data = json.loads(p.stdout)
        wts = {w["num"]: w for w in data["worktrees"]}
        self.assertEqual(wts["001"]["branch"], "task/001")
        self.assertEqual(wts["001"]["path"], str(self.repo / ".ai/wt/001"))
        self.assertEqual(data["providers"]["glm"], {"running": 0, "max": 2})
        self.assertEqual(data["providers"]["qwen"]["max"], 4)

    def test_AT13_quota_parsing(self):
        glm = {"data": {"limits": [
            {"type": "CREDIT_LIMIT", "unit": 3, "number": 5, "usage": 2000, "currentValue": 399, "remaining": 1600,
             "nextResetTime": 1791832399463},
            {"type": "CREDIT_LIMIT", "unit": 6, "number": 1, "usage": 10000, "currentValue": 2439, "remaining": 7561,
             "nextResetTime": 1792010198998}]}}
        kimi = {"limits": [{"window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
                            "detail": {"limit": "100", "used": "63", "remaining": "37",
                                       "resetTime": "2026-10-12T20:29:13.813161Z"}}],
                "usages": {"limit_month_total": {"used_ratio": 0.4159, "reset_time": "2026-10-20T00:00:00Z"}}}
        with mock.patch.object(quota, "fetch", return_value=glm):
            windows = {w["window"]: w for w in quota.glm()}
        self.assertEqual((windows["5h"]["used"], windows["5h"]["limit"], windows["5h"]["remaining"]), (399, 2000, 1600))
        self.assertEqual((windows["week"]["used"], windows["week"]["limit"]), (2439, 10000))
        self.assertEqual(windows["5h"]["resetAt"], "2026-10-12T19:13:19Z")
        with mock.patch.object(quota, "fetch", return_value=kimi):
            windows = {w["window"]: w for w in quota.kimi()}
        self.assertEqual((windows["5h"]["used"], windows["5h"]["limit"], windows["5h"]["remaining"]), (63, 100, 37))
        self.assertEqual(windows["5h"]["resetAt"], "2026-10-12T20:29:13Z")
        self.assertEqual(windows["month"]["used"], 42)
        for w in windows.values():
            self.assertRegex(w["resetAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(quota.get("qwen")["unsupported"], True)

    def test_AT14_low_quota_routes_to_fallback(self):
        self.add_task("001", "Alpha")
        self.set_providers({"glm": 2, "kimi": 2, "qwen": 4, "mimo": 4})
        self.quota_mock = {"kimi": [{"window": "5h", "used": 95, "limit": 100, "remaining": 5,
                                     "resetAt": "2026-10-12T20:29:13Z", "unit": "requests"}]}
        self.write_script(success_script())
        self.run_orch(["run"])
        calls = {c["role"]: c for c in self.calls_for("001")}
        argv = calls["reviewer"]["argv"]
        self.assertEqual(argv[argv.index("--provider") + 1], "mimo", self.diag())
        self.assertNotIn("--provider", calls["coder"]["argv"])
        self.assertNotIn("--provider", calls["acceptance"]["argv"])


if __name__ == "__main__":
    unittest.main()
