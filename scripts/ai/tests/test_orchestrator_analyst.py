"""Round analyst: runs before fix round 2, injectable via ORCH_ANALYST_CMD."""
import json
import sys

from .harness import Harness, report_json, success_script


def reviewer_changes(problem="blocker-text"):
    return {"role": "reviewer", "task": None, "exit": 0, "stdout": report_json(
        {"verdict": "CHANGES", "checks": {"typecheck": "pass", "lint": "pass", "test": "pass"},
         "findings": [{"severity": "BLOCKER", "location": "src/a.ts:3", "problem": problem, "fix": "f"}]})}


def analysis(**kw):
    return {"fault": "coder", "evidence": "ev-text", "action": "guide_coder", "note": "do-this",
            "dismissed": [], "improvements": [{"target": "ai/agents/reviewer.md", "change": "c", "why": "w"}], **kw}


class AnalystTest(Harness):
    def setup_failing(self, fails=2, forever=False):
        self.set_providers({"glm": 2, "qwen": 2, "kimi": 2})
        self.add_task("001", "Alpha")
        entries = [e for e in success_script() if e["role"] != "reviewer"]
        entries += [reviewer_changes()] * (1 if forever else fails)
        if not forever:
            entries.append([e for e in success_script() if e["role"] == "reviewer"][0])
        self.write_script(entries)

    def analyst_cmd(self, payload=None, body=None):
        path = self.tmp / "analyst.py"
        out = body or f"print({json.dumps(payload)!r})"
        path.write_text("import sys\nopen(sys.argv[0].replace('analyst.py','payloads.txt'),'a')"
                        ".write(sys.stdin.read().replace('\\n',' ')+'\\n')\n" + out + "\n")
        return f"{sys.executable} {path}"

    def payloads(self):
        p = self.tmp / "payloads.txt"
        return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []

    def coders(self):
        return [c for c in self.calls_for("001") if c["role"] == "coder"]

    def reviewers(self):
        return [c for c in self.calls_for("001") if c["role"] == "reviewer"]

    def test_guide_coder_note_in_round_2(self):
        self.setup_failing(2)
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(analysis())})
        self.assertEqual(self.task_status("001"), "done", self.diag())
        coders = self.coders()
        self.assertEqual(len(coders), 3)
        note = self.note_of(coders[2])
        self.assertTrue(note.startswith("Round analyst guidance:\ndo-this"), note)
        self.assertIn("blocker-text", note)
        self.assertNotIn("do-this", self.note_of(coders[1]))
        payload = self.payloads()[0]
        for key in ("spec", "acceptanceTests", "reports", "diff", "rolePrompts"):
            self.assertIn(key, payload)
        self.assertIn("tests/unit/acceptance/001-fake.test.ts", payload["acceptanceTests"])
        self.assertTrue(any(h["role"] == "reviewer" for h in payload["reports"]))

    def test_insights_written(self):
        self.setup_failing(2)
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(analysis())})
        md = (self.repo / ".ai/insights/001-round2.md").read_text()
        for text in ("Fault: coder", "Action: guide_coder", "ev-text", "ai/agents/reviewer.md"):
            self.assertIn(text, md)
        lines = (self.repo / ".ai/insights/insights.jsonl").read_text().splitlines()
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        self.assertEqual((rec["task"], rec["fault"], rec["action"]), ("001", "coder", "guide_coder"))
        self.assertIn("analyst", [e["event"] for e in self.events()])
        brief = self.run_orch(["brief", "--no-quota"]).stdout
        self.assertIn("insights: 1 unreviewed", brief)
        (self.repo / ".ai/insights/001-round2.md").rename(self.repo / ".ai/insights/001-round2.reviewed.md")
        self.assertNotIn("insights:", self.run_orch(["brief", "--no-quota"]).stdout)

    def test_dismiss_reruns_verifier_without_round_once(self):
        self.setup_failing(2)
        a = analysis(action="dismiss_findings", fault="reviewer", dismissed=["blocker-text"])
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(a)})
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertEqual(len(self.coders()), 2)
        reviewers = self.reviewers()
        self.assertEqual(len(reviewers), 3)
        note = self.note_of(reviewers[2])
        self.assertIn("blocker-text", note)
        self.assertIn("ev-text", note)
        self.assertIn("spec line", note)
        self.assertEqual(json.loads((self.repo / ".ai/state.json").read_text())["001"]["fixRounds"], 1)

    def test_dismiss_only_once(self):
        self.setup_failing(forever=True)
        a = analysis(action="dismiss_findings", fault="reviewer", dismissed=["blocker-text"])
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(a)})
        self.assertEqual(len(self.payloads()), 1)
        self.assertEqual(len(self.reviewers()), 6, self.diag())
        self.assertEqual(len([c for c in self.calls_for("001") if c["role"] == "fixer"]), 1)
        self.assertTrue((self.repo / ".ai/decisions/001-reviewer.md").exists())

    def test_escalate_creates_decision_without_triage(self):
        self.setup_failing(2)
        a = analysis(action="escalate", fault="acceptance_tests", note="AT2 contradicts AT4?")
        triage = self.tmp / "triage_ran"
        tpath = self.tmp / "triage.py"
        tpath.write_text(f"open({str(triage)!r},'w').write('x')\nprint('{{}}')\n")
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(a), "ORCH_TRIAGE_CMD": f"{sys.executable} {tpath}"})
        side = json.loads((self.repo / ".ai/decisions/001-reviewer.json").read_text())
        self.assertEqual(side["category"], "tests")
        self.assertIn("AT2 contradicts AT4?", side["questions"])
        self.assertIsNone(side["triage"])
        self.assertFalse(triage.exists())
        self.assertEqual(self.task_status("001"), "waiting decision")
        self.assertEqual(len(self.coders()), 2)

    def test_escalate_spec_category(self):
        self.setup_failing(2)
        a = analysis(action="escalate", fault="spec", note="ambiguous")
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(a)})
        side = json.loads((self.repo / ".ai/decisions/001-reviewer.json").read_text())
        self.assertEqual(side["category"], "spec")

    def test_analyst_failure_continues_as_before(self):
        self.setup_failing(2)
        self.run_orch(["run"], {"ORCH_ANALYST_CMD": self.analyst_cmd(body="print('not json')")})
        self.assertEqual(self.task_status("001"), "done", self.diag())
        coders = self.coders()
        self.assertEqual(len(coders), 3)
        self.assertNotIn("Round analyst", self.note_of(coders[2]))
        self.assertFalse((self.repo / ".ai/insights").exists())
        self.assertTrue(any("failed" in e["detail"] for e in self.events() if e["event"] == "analyst"))

    def test_analyst_off_by_default_with_orch_root(self):
        self.setup_failing(2)
        self.run_orch(["run"])
        self.assertEqual(self.task_status("001"), "done", self.diag())
        self.assertFalse((self.repo / ".ai/insights").exists())
