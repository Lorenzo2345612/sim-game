"""Acceptance tests for tasks/infra/001-orchestrator.md (AT1..AT11), updated for the v2 contract
(tasks/tasks.json registry, worktrees, commits landing through the merge stage).

Each test builds a temporary git repo (see harness.py), points ORCH_WORKER_CMD at
scripts/ai/tests/fake_worker.py and runs scripts/ai/orchestrator.py as a subprocess.
"""
import json
import re
import unittest

from .harness import Harness, success_script


class OrchestratorAcceptanceTest(Harness):
    # -- acceptance tests -----------------------------------------------------

    def test_AT1_simple_task_pipeline_commits_in_order(self):
        self.add_task("001", "Alpha")
        self.write_script(success_script())
        self.run_orch(["run"])
        self.assertEqual([c["role"] for c in self.calls_for("001")],
                         ["acceptance", "coder", "reviewer"], self.diag())
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertIn("Status: pending", self.specs["001"].read_text(), self.diag())
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
        self.assertEqual(self.task_status("005"), "waiting decision", self.diag())

    def test_AT6_spec_silent_decision_does_not_block_independent_task(self):
        self.add_task("003", "Echo", complexity="complex")
        self.add_task("004", "Foxtrot")
        self.write_script(success_script(overrides={"tester-pre": "STATUS: READY\nSPEC_SILENT: x\n"}))
        self.run_orch(["run"])
        self.assertTrue((self.repo / ".ai/decisions/003-tester-pre.md").exists(), self.diag())
        self.assertEqual([c for c in self.calls_for("003") if c["role"] == "coder"],
                         [], self.diag())
        self.assertEqual(self.task_status("004"), "done", self.diag())

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
