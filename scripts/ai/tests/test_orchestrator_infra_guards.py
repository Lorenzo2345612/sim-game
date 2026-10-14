"""Infra failures never burn fix rounds: no-report coder runs, drain, empty diffs, acceptance test lint."""
import json
import subprocess
import sys
import time
import unittest

from .harness import ORCHESTRATOR, Harness, success_script
from .test_orchestrator_resilience import entry

TEST_FILE = "tests/unit/acceptance/{num}-fake.test.ts"


class InfraGuardsTest(Harness):
    def setUp(self):
        super().setUp()
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2})
        self.add_task("001", "Alpha")

    def state(self):
        return json.loads((self.repo / ".ai/state.json").read_text())["001"]

    def roles(self):
        return [c["role"] for c in self.calls()]

    def script(self, role, entries):
        self.write_script([e for e in success_script() if e["role"] != role] + entries)

    def decision(self, stage):
        return json.loads((self.repo / f".ai/decisions/001-{stage}.json").read_text())

    def coder_entry(self):
        return [e for e in success_script() if e["role"] == "coder"][0]

    def test_coder_without_report_never_counts_a_fix_round(self):
        self.script("coder", [entry("coder", "", 1)])
        self.run_orch(["run"])
        self.assertEqual(self.roles().count("coder"), 2, self.diag())
        self.assertNotIn("reviewer", self.roles())
        st = self.state()
        self.assertEqual(st["fixRounds"], 0)
        self.assertEqual(st["stage"], "coder")
        self.assertEqual(self.decision("coder")["category"], "infra")

    def test_drain_during_coder_reruns_same_stage_without_retry(self):
        self.script("coder", [entry("coder", "", 143, sleep=3), self.coder_entry()])
        self.commit_scaffold()
        proc = subprocess.Popen([sys.executable, str(ORCHESTRATOR), "run"], cwd=self.repo,
                                env=self.env({"ORCH_NO_EXEC": "1"}), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, stdin=subprocess.DEVNULL)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        deadline = time.time() + 30
        while time.time() < deadline and "coder" not in self.roles():
            time.sleep(0.1)
        self.assertIn("coder", self.roles())
        self.run_orch(["restart"])
        out, err = proc.communicate(timeout=60)
        self.assertEqual(proc.returncode, 75, out + err)
        st = self.state()
        self.assertEqual((st["stage"], st.get("fixRounds", 0), st.get("retries", 0)), ("coder", 0, 0))
        self.assertNotIn("reviewer", self.roles())
        self.run_orch(["run"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(self.roles().count("coder"), 2)
        self.assertEqual(self.state().get("fixRounds", 0), 0)
        self.assertNotIn("retry", [e["event"] for e in self.events()])

    def test_empty_diff_goes_back_to_coder_without_fix_round(self):
        ok = self.coder_entry()
        empty = {k: v for k, v in ok.items() if k != "writes"}
        self.script("coder", [empty, ok])
        self.run_orch(["run"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(self.roles().count("coder"), 2)
        self.assertEqual(self.roles().count("reviewer"), 1)
        self.assertIn("empty-diff", [e["event"] for e in self.events()])

    def test_empty_diff_three_times_creates_infra_decision(self):
        self.script("coder", [entry("coder", "STATUS: OK\n")])
        self.run_orch(["run"])
        self.assertEqual(self.roles().count("coder"), 3, self.diag())
        self.assertNotIn("reviewer", self.roles())
        self.assertEqual(self.decision("reviewer")["category"], "infra")
        st = self.state()
        self.assertEqual(st.get("fixRounds", 0), 0)
        self.assertEqual(st["retries"], 2)

    def lint_cmd(self):
        path = self.tmp / "lint.py"
        path.write_text("import sys\nbad=[f for f in sys.argv[1:] if 'UNUSED' in open(f).read()]\n"
                        "print('error no-unused-vars in', bad)\nsys.exit(1 if bad else 0)\n")
        return f"{sys.executable} {path}"

    def tsc_cmd(self, line):
        path = self.tmp / "tsc.py"
        path.write_text(f"print({line!r})\nraise SystemExit(2)\n")
        return f"{sys.executable} {path}"

    def acceptance_entries(self, first, second):
        ok = "STATUS: READY\nUNTESTABLE: none\n"
        return [entry("acceptance", ok, writes={TEST_FILE: first}),
                entry("acceptance", ok, writes={TEST_FILE: second})]

    def test_lint_failure_resumes_acceptance_once_then_passes(self):
        self.script("acceptance", self.acceptance_entries("// UNUSED\n", "// clean\n"))
        self.run_orch(["run"], {"ORCH_LINT_CMD": self.lint_cmd(), "ORCH_TSC_CMD": "off"})
        self.assertEqual(self.task_status("001"), "done", self.diag())
        acc = [c for c in self.calls() if c["role"] == "acceptance"]
        self.assertEqual(len(acc), 2)
        self.assertIn("--resume", acc[1]["argv"])
        self.assertIn("no-unused-vars", self.note_of(acc[1]))
        self.assertEqual(self.git("show", "HEAD:tests/unit/acceptance/001-fake.test.ts"), "// clean\n")

    def test_lint_still_failing_creates_tests_decision(self):
        self.script("acceptance", self.acceptance_entries("// UNUSED\n", "// UNUSED again\n"))
        self.run_orch(["run"], {"ORCH_LINT_CMD": self.lint_cmd(), "ORCH_TSC_CMD": "off"})
        self.assertEqual(self.roles().count("acceptance"), 2, self.diag())
        self.assertNotIn("coder", self.roles())
        d = self.decision("commit-tests")
        self.assertEqual(d["category"], "tests")
        self.assertIn("no-unused-vars", d["failures"])
        self.assertEqual(self.task_status("001"), "waiting decision")

    def tsc_error(self, module, code="TS2307"):
        return (f"tests/unit/acceptance/001-fake.test.ts(1,1): error {code}: Cannot find module "
                f"'{module}' or its corresponding type declarations.")

    def run_tsc(self, line):
        self.script("acceptance", self.acceptance_entries("// a\n", "// a\n"))
        self.run_orch(["run"], {"ORCH_LINT_CMD": "off", "ORCH_TSC_CMD": self.tsc_cmd(line)})

    def test_tsc_missing_module_from_spec_files_is_allowed(self):
        self.run_tsc(self.tsc_error("../../../src/001"))
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(self.roles().count("acceptance"), 1)

    def test_tsc_missing_module_not_in_spec_is_rejected(self):
        self.run_tsc(self.tsc_error("../../../src/other"))
        self.assertEqual(self.decision("commit-tests")["category"], "tests", self.diag())
        self.assertEqual(self.roles().count("acceptance"), 2)

    def test_tsc_other_error_codes_are_rejected(self):
        self.run_tsc(self.tsc_error("../../../src/001", "TS2322"))
        self.assertEqual(self.decision("commit-tests")["category"], "tests", self.diag())

    def test_tsc_new_api_on_existing_module_is_allowed(self):
        self.run_tsc("tests/unit/acceptance/001-fake.test.ts(3,7): error TS2339: Property 'lodCounts' "
                     "does not exist on type 'TreeField'.")
        self.assertEqual(self.task_status("001"), "done", self.diag())


if __name__ == "__main__":
    unittest.main()
