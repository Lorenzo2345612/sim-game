"""Checks run once by the orchestrator and reach the verifiers; spec verification-gate rows do not escalate."""
import unittest
from pathlib import Path

from .harness import Harness, success_script


class ChecksTest(Harness):
    def setUp(self):
        super().setUp()
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2})
        self.add_task("001", "Alpha")
        self.write_script(success_script())

    def test_reviewer_gets_check_results(self):
        self.run_orch(["run"], {"ORCH_TYPECHECK_CMD": "true", "ORCH_FULL_LINT_CMD": "off",
                                "ORCH_TEST_CMD": "sh -c 'echo boom; exit 1'", "ORCH_E2E_CMD": "off"})
        rev = [c for c in self.calls() if c["role"] == "reviewer"][0]
        note = self.note_of(rev) or ""
        self.assertIn("typecheck: pass", note, self.diag())
        self.assertIn("test: FAIL\nboom", note)

    def test_no_checks_without_commands(self):
        self.run_orch(["run"])
        rev = [c for c in self.calls() if c["role"] == "reviewer"][0]
        self.assertIsNone(self.note_of(rev), self.diag())


class GateRowsTest(unittest.TestCase):
    def test_only_gates(self):
        import tempfile
        from scripts.ai import orchestrator as o
        with tempfile.TemporaryDirectory() as d:
            spec = Path(d) / "s.md"
            spec.write_text("| AT1 | a | b | c |\n| AT7 | suite | run | pass — verification gate only |\n")
            self.assertEqual(o.gate_rows(spec), {"AT7"})
            self.assertTrue(o.only_gates("AT7: suite-level gate", spec))
            self.assertFalse(o.only_gates("AT1, AT7", spec))
            self.assertFalse(o.only_gates("", spec))


class BugfixFirstTest(unittest.TestCase):
    def test_bugfix_sorted_first(self):
        from unittest import mock
        from scripts.ai import orchestrator as o
        tasks = [{"num": "010", "deps": [], "status": "pending"},
                 {"num": "020", "deps": [], "status": "pending", "type": "bugfix"}]
        with mock.patch.object(o, "milestone_scope", return_value=None):
            self.assertEqual([t["num"] for t in o.ready_tasks(tasks, set(), {}, set(), None)], ["020", "010"])
