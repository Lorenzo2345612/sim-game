"""Auto-retry, graceful restart, structured decisions, brief, triage and notifications."""
import json
import subprocess
import sys
import time
import unittest

from .harness import ORCHESTRATOR, Harness, report_json, success_script


def entry(role, stdout="", exit=0, **kw):
    return {"role": role, "task": None, "stdout": stdout, "exit": exit, **kw}


def script_with(first, role, rest=None):
    """success_script where `role` starts with the `first` entries."""
    base = [e for e in success_script() if e["role"] != role]
    ok = [e for e in success_script() if e["role"] == role]
    return base + first + ok


class ResilienceTest(Harness):
    def setup_task(self, **kw):
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2})
        self.add_task("001", "Alpha", **kw)

    def acceptance_calls(self):
        return [c for c in self.calls() if c["role"] == "acceptance"]

    def test_retry_once_then_succeeds(self):
        self.setup_task()
        self.write_script(script_with([entry("acceptance", "")], "acceptance"))
        p = self.run_orch(["run"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(len(self.acceptance_calls()), 2)
        self.assertEqual([e["event"] for e in self.events()].count("retry"), 1)
        self.assertEqual(json.loads((self.repo / ".ai/state.json").read_text())["001"]["retries"], 1)
        self.assertEqual(p.returncode, 0)

    def test_retry_once_then_decision(self):
        self.setup_task()
        self.write_script([entry("acceptance", "", 1)])
        self.run_orch(["run"])
        self.assertEqual(len(self.acceptance_calls()), 2, self.diag())
        side = json.loads((self.repo / ".ai/decisions/001-acceptance.json").read_text())
        self.assertEqual(side["category"], "infra")
        self.assertEqual(self.task_status("001"), "waiting decision")

    def test_stalled_retry_is_heavy(self):
        self.setup_task()
        stalled = entry("acceptance", "[worker] STALLED after 8.0 min\n", 124)
        self.write_script(script_with([stalled], "acceptance"))
        self.run_orch(["run"])
        calls = self.acceptance_calls()
        self.assertNotIn("--heavy", calls[0]["argv"])
        self.assertIn("--heavy", calls[1]["argv"], self.diag())
        self.assertIn("--resume", calls[1]["argv"], self.diag())
        self.assertIn("INTERRUPTED", calls[1]["argv"], self.diag())

    def test_timeout_retry_resumes_session(self):
        self.setup_task()
        timeout = entry("acceptance", "[worker] TIMEOUT after 20.0 min\n", 124)
        self.write_script(script_with([timeout], "acceptance"))
        self.run_orch(["run"])
        calls = self.acceptance_calls()
        self.assertIn("--resume", calls[1]["argv"], self.diag())
        self.assertNotIn("--heavy", calls[1]["argv"], self.diag())

    def test_models_heavy_applies_to_test_roles_not_reviewer(self):
        self.setup_task(complexity="complex")
        self.tasks[0]["models"] = "heavy"
        self.write_registry()
        self.write_script(success_script())
        self.run_orch(["run"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        by_role = {c["role"]: c["argv"] for c in self.calls()}
        for role in ("acceptance", "tester-pre", "tester", "coder"):
            self.assertIn("--heavy", by_role[role], role)
        self.assertNotIn("--heavy", by_role["reviewer"])

    def blocked_coder(self):
        out = ("[worker] role=coder model=m provider=glm log=.ai/runs/x-coder.json\n"
               + report_json({"status": "BLOCKED", "files": [], "verification": [], "decisions": [],
                              "pending": ["Is the Goal for tire grip per axle or per wheel?"]}))
        self.write_script(success_script({"coder": out}))

    def test_structured_decision(self):
        self.setup_task()
        self.blocked_coder()
        self.run_orch(["run"])
        md = (self.repo / ".ai/decisions/001-coder.md").read_text()
        side = json.loads((self.repo / ".ai/decisions/001-coder.json").read_text())
        self.assertEqual(side["category"], "spec")
        self.assertEqual(side["stage"], "coder")
        self.assertEqual(side["title"], "Alpha")
        self.assertIn("Is the Goal for tire grip per axle or per wheel?", side["questions"])
        self.assertIn("## Acceptance tests", side["specExcerpt"])
        self.assertIn("## Goal", side["specExcerpt"])
        self.assertEqual(side["log"], ".ai/runs/x-coder.json")
        for text in ("Category: spec", "- Is the Goal", "## Spec excerpt", "## Suggested options",
                     "Full run log: .ai/runs/x-coder.json"):
            self.assertIn(text, md)

    def test_brief(self):
        self.set_providers({"glm": 2})
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta", deps=["001"])
        (self.repo / "tasks/milestones.json").write_text(json.dumps(
            {"milestones": [{"id": "M1", "title": "First", "status": "open", "tasks": ["001", "002"]}]}))
        self.tracked.append("tasks/milestones.json")
        self.blocked_coder()
        self.quota_mock = {"glm": [{"window": "5h", "used": 95, "limit": 100, "remaining": 5,
                                    "resetAt": "x", "unit": "requests"}]}
        self.run_orch(["run"])
        p = self.run_orch(["brief"])
        self.assertEqual(p.returncode, 0, self.diag())
        lines = p.stdout.splitlines()
        self.assertLessEqual(len(lines), 20)
        for text in ("milestone M1 First [open]: 0/2", "NOT running", "decision 001-coder [spec]",
                     "Is the Goal", "QUOTA LOW: glm 5h 5/100", "waiting decision 1"):
            self.assertIn(text, p.stdout)
        self.assertNotIn("QUOTA", self.run_orch(["brief", "--no-quota"]).stdout)

    def test_brief_build_ready(self):
        self.add_task("001", "Alpha", status="done")
        (self.repo / "tasks/milestones.json").write_text(json.dumps(
            {"milestones": [{"id": "M1", "title": "First", "status": "built", "tasks": ["001"],
                             "buildOk": True, "testsOk": True}]}))
        self.tracked.append("tasks/milestones.json")
        out = self.run_orch(["brief", "--no-quota"]).stdout
        self.assertIn("BUILD READY M1", out)

    def triage_cmd(self, payload):
        path = self.tmp / "triage.py"
        path.write_text("import sys\nsys.stdin.read()\nprint(" + repr(json.dumps(payload)) + ")\n")
        return f"{sys.executable} {path}"

    def notify_cmd(self):
        path = self.tmp / "notify.py"
        path.write_text("import sys\nopen(sys.argv[0].replace('notify.py','notes.txt'),'a').write(sys.argv[-1]+'\\n')\n")
        return f"{sys.executable} {path}"

    def notes(self):
        p = self.tmp / "notes.txt"
        return [n for n in p.read_text().splitlines() if "needs the planner" in n] if p.exists() else []

    def test_triage_retry_resolves_and_reruns(self):
        self.setup_task()
        self.write_script(script_with([entry("acceptance", ""), entry("acceptance", "")], "acceptance"))
        cmd = self.triage_cmd({"action": "retry", "category": "infra", "note": "transient"})
        self.run_orch(["run"], {"ORCH_TRIAGE_CMD": cmd, "ORCH_NOTIFY_CMD": self.notify_cmd()})
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertTrue((self.repo / ".ai/decisions/001-acceptance.resolved.md").exists())
        self.assertFalse((self.repo / ".ai/decisions/001-acceptance.md").exists())
        self.assertIn("transient", (self.repo / ".ai/decisions/001-acceptance.resolved.md").read_text())
        self.assertIn("triaged", [e["event"] for e in self.events()])
        self.assertEqual(self.notes(), [])

    def test_triage_escalate_keeps_decision_and_notifies(self):
        self.setup_task()
        self.blocked_coder()
        cmd = self.triage_cmd({"action": "escalate", "category": "product", "note": "ask the user"})
        self.run_orch(["run"], {"ORCH_TRIAGE_CMD": cmd, "ORCH_NOTIFY_CMD": self.notify_cmd()})
        side = json.loads((self.repo / ".ai/decisions/001-coder.json").read_text())
        self.assertEqual(side["category"], "product")
        self.assertEqual(side["triage"]["action"], "escalate")
        self.assertIn("Category: product", (self.repo / ".ai/decisions/001-coder.md").read_text())
        self.assertEqual(self.task_status("001"), "waiting decision")
        notes = self.notes()
        self.assertEqual(len(notes), 1, self.diag())
        self.assertIn("001", notes[0])

    def test_triage_garbage_escalates(self):
        self.setup_task()
        self.blocked_coder()
        path = self.tmp / "bad.py"
        path.write_text("print('not json')\n")
        self.run_orch(["run"], {"ORCH_TRIAGE_CMD": f"{sys.executable} {path}"})
        side = json.loads((self.repo / ".ai/decisions/001-coder.json").read_text())
        self.assertEqual(side["triage"]["action"], "escalate")

    def test_notifier_failure_does_not_break_run(self):
        self.setup_task()
        self.blocked_coder()
        p = self.run_orch(["run"], {"ORCH_NOTIFY_CMD": "/nonexistent/notifier"})
        self.assertEqual(p.returncode, 0, self.diag())
        self.assertTrue((self.repo / ".ai/decisions/001-coder.md").exists())

    def test_graceful_restart_drains_then_reexecs(self):
        self.setup_task()
        self.write_script(script_with([], "acceptance"))
        entries = json.loads(self.script_path.read_text())
        for e in entries:
            if e["role"] == "acceptance":
                e["sleep"] = 3
        self.write_script(entries)
        self.commit_scaffold()
        proc = subprocess.Popen([sys.executable, str(ORCHESTRATOR), "run"], cwd=self.repo, env=self.env(
            {"ORCH_NO_EXEC": "1"}), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            stdin=subprocess.DEVNULL)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        deadline = time.time() + 30
        while time.time() < deadline and not self.calls():
            time.sleep(0.1)
        self.assertTrue(self.calls(), "worker never started")
        r = self.run_orch(["restart"])
        self.assertEqual(r.returncode, 0, self.diag())
        out, err = proc.communicate(timeout=60)
        self.assertEqual(proc.returncode, 75, out + err)
        self.assertIn("restart exec", out)
        self.assertEqual([c["role"] for c in self.calls()], ["acceptance"])
        state = json.loads((self.repo / ".ai/state.json").read_text())
        self.assertEqual(state["001"]["stage"], "tester-pre")
        self.assertFalse((self.repo / ".ai/orchestrator.lock").exists())

    def test_restart_without_orchestrator(self):
        self.setup_task()
        self.assertEqual(self.run_orch(["restart"]).returncode, 1)


if __name__ == "__main__":
    unittest.main()


class PrefetchTest(Harness):
    def test_prefetch_runs_listed_tasks_of_later_milestone_only(self):
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta")
        self.add_task("003", "Gamma")
        (self.repo / "tasks/milestones.json").write_text(json.dumps({"milestones": [
            {"id": "M1", "title": "First", "status": "open", "tasks": ["001"]},
            {"id": "M2", "title": "Second", "status": "open", "tasks": ["002", "003"], "prefetch": ["002"]}]}))
        self.tracked.append("tasks/milestones.json")
        self.write_script(success_script())
        self.run_orch(["run"])
        ran = {c.get("task") for c in self.calls()}
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(self.task_status("002"), "done", self.diag())
        self.assertNotEqual(self.task_status("003"), "done", self.diag())
        self.assertNotIn("003", ran, self.diag())

    def test_first_prefetched_task_uses_primary_lane(self):
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2, "mimo": 4})
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta")
        (self.repo / "tasks/milestones.json").write_text(json.dumps({"milestones": [
            {"id": "M1", "title": "First", "status": "open", "tasks": ["001"]},
            {"id": "M2", "title": "Second", "status": "open", "tasks": ["002"], "prefetch": ["002"]}]}))
        self.tracked.append("tasks/milestones.json")
        self.write_script(success_script())
        self.run_orch(["run"])
        calls = [c for c in self.calls() if "tasks/002" in " ".join(c["argv"])]
        self.assertTrue(calls, self.diag())
        for c in calls:
            self.assertNotIn("--provider", c["argv"], self.diag())

    def test_prefetched_tasks_run_on_fallback_provider(self):
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2, "mimo": 4})
        self.add_task("001", "Alpha")
        self.add_task("002", "Beta")
        (self.repo / "tasks/milestones.json").write_text(json.dumps({"milestones": [
            {"id": "M1", "title": "First", "status": "open", "tasks": ["001"]},
            {"id": "M2", "title": "Second", "status": "open", "tasks": ["002"], "prefetch": ["002"]}]}))
        self.tracked.append("tasks/milestones.json")
        self.write_script(success_script())
        self.run_orch(["run"], {"SIMGAME_PREFETCH_PRIMARY": "0"})
        for c in self.calls():
            if "tasks/002" in " ".join(c["argv"]):
                self.assertIn("--provider", c["argv"], self.diag())
            if "tasks/001" in " ".join(c["argv"]):
                self.assertNotIn("--provider", c["argv"], self.diag())
