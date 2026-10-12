"""Dashboard /api/stats aggregation and /api/decision validation against a temp ORCH_ROOT."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REAL_ROOT = Path(__file__).resolve().parents[3]
DASHBOARD = REAL_ROOT / "scripts" / "ai" / "dashboard.py"


def run_file(root, stamp, role, provider, label, model, inp, out, cr, cw, turns=5, secs=60):
    usage = {model: {"inputTokens": inp, "outputTokens": out, "cacheReadInputTokens": cr,
                     "cacheCreationInputTokens": cw}}
    name = f"{stamp}-{role}-{provider}-{label}.json"
    (root / ".ai/runs" / name).write_text(json.dumps(
        {"modelUsage": usage, "num_turns": turns, "duration_ms": secs * 1000, "is_error": False}))


def make_fixture(root):
    root = Path(root)
    for d in (".ai/runs", ".ai/decisions", "tasks", "ai"):
        (root / d).mkdir(parents=True, exist_ok=True)
    tasks = [{"num": "001", "title": "Alpha", "status": "done"}, {"num": "002", "title": "Beta", "status": "in progress"}]
    (root / "tasks/tasks.json").write_text(json.dumps({"tasks": tasks}))
    (root / "tasks/milestones.json").write_text(json.dumps({"milestones": [
        {"id": "M0", "title": "First", "tasks": ["001"], "status": "approved"},
        {"id": "M1", "title": "Second", "tasks": ["002"], "status": "open"}]}))
    (root / "ai/providers.json").write_text(json.dumps({"providers": {"glm": {"maxConcurrent": 2}}, "roles": {}}))
    (root / "ai/experiments.json").write_text(json.dumps({"coderAssignments": {"glm": ["001"], "mimo": ["002"]}}))
    (root / ".ai/state.json").write_text(json.dumps({"001": {"stage": "done", "fixRounds": 0},
                                                     "002": {"stage": "coder", "fixRounds": 2}}))
    run_file(root, "20261010-100000", "coder", "glm", "001-alpha", "glm-5.3-flash", 1000, 100, 9000, 0, secs=120)
    run_file(root, "20261010-110000", "reviewer", "kimi", "001-alpha", "k3-256k", 500, 50, 0, 0)
    run_file(root, "20261011-100000", "coder", "mimo", "002-beta", "mimo-v2.6-flash", 2000, 200, 0, 0, secs=180)
    run_file(root, "20261011-110000", "coder", "mimo", "002-beta-resume", "mimo-v2.6-flash", 1000, 100, 0, 0, secs=60)
    run_file(root, "20261011-120000", "tester", "qwen", "002-beta", "qwen3.8-flash", 300, 30, 0, 0)
    run_file(root, "20261011-130000", "coder", "glm", "adhoc", "glm-5.3-flash", 9, 9, 9, 9)  # ignored
    (root / ".ai/decisions/002-coder.md").write_text("# Decision needed\nBody text\n")
    (root / ".ai/decisions/003-coder.resolved.md").write_text("old")
    (root / ".ai/mock-quota.json").write_text("{}")


class DashboardApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        make_fixture(cls.tmp.name)
        env = {**os.environ, "ORCH_ROOT": cls.tmp.name, "QUOTA_MOCK": str(Path(cls.tmp.name) / ".ai/mock-quota.json")}
        cls.proc = subprocess.Popen([sys.executable, str(DASHBOARD), "--port", "0"], env=env, cwd=cls.tmp.name,
                                    stdout=subprocess.PIPE, text=True)
        cls.base = cls.proc.stdout.readline().strip().split("Dashboard: ")[1]

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stdout.close()
        cls.tmp.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_totals_and_groups(self):
        code, d = self.get("/api/stats")
        self.assertEqual(code, 200)
        t = d["totals"]
        self.assertEqual((t["runs"], t["total"], t["output"], t["cacheRead"]), (5, 14280, 480, 9000))
        self.assertEqual(d["byProvider"]["glm"]["total"], 10100)
        self.assertEqual(d["byProvider"]["mimo"]["runs"], 2)
        self.assertEqual(d["byModel"]["k3-256k"]["total"], 550)
        self.assertEqual(d["byRole"]["coder"]["runs"], 3)
        self.assertEqual(d["byMilestone"]["M1"]["total"], 3630)
        self.assertEqual(d["byMilestone"]["M1"]["tasks"], 1)
        self.assertAlmostEqual(d["byMilestone"]["M1"]["avgPerRun"]["total"], 1210)
        self.assertAlmostEqual(d["byProvider"]["glm"]["avgPerTask"]["seconds"], 120)

    def test_per_task_rows(self):
        _, d = self.get("/api/stats")
        rows = {r["task"]: r for r in d["byTask"]}
        self.assertEqual(rows["002"]["milestone"], "M1")
        self.assertEqual(rows["002"]["coderProvider"], "mimo")
        self.assertEqual(rows["002"]["runs"], 3)
        self.assertEqual(rows["002"]["fixRounds"], 2)
        self.assertEqual(rows["002"]["byRole"], {"coder": 3300, "tester": 330})
        self.assertEqual(rows["001"]["title"], "Alpha")

    def test_ab_comparison(self):
        _, d = self.get("/api/stats")
        glm, mimo = d["abCoder"]["glm"], d["abCoder"]["mimo"]
        self.assertEqual((glm["tasks"], glm["avgRounds"], glm["approvedFirstPassPct"]), (1, 0, 100))
        self.assertEqual((mimo["tasks"], mimo["avgRounds"], mimo["approvedFirstPassPct"]), (1, 2, 0))
        self.assertEqual(mimo["avgTokens"], 3300)
        self.assertAlmostEqual(mimo["avgMinutes"], 4.0)

    def test_filters(self):
        _, d = self.get("/api/stats?milestone=M1")
        self.assertEqual((d["totals"]["runs"], d["totals"]["total"]), (3, 3630))
        _, d = self.get("/api/stats?provider=glm")
        self.assertEqual(d["totals"]["total"], 10100)
        self.assertEqual(list(d["byProvider"]), ["glm"])
        _, d = self.get("/api/stats?milestone=M0&role=reviewer")
        self.assertEqual(d["totals"]["total"], 550)

    def test_timeline_and_cost(self):
        _, d = self.get("/api/stats")
        days = {x["day"]: x for x in d["timeline"]}
        self.assertEqual(days["2026-10-10"]["byProvider"], {"glm": 10100, "kimi": 550})
        self.assertEqual(days["2026-10-11"]["total"], 3630)
        # glm: (1000*0.15 + 9000*0.03 + 100*0.50) / 1e6
        self.assertAlmostEqual(d["byProvider"]["glm"]["costUsd"], 0.00047, places=4)
        self.assertTrue(d["estimate"])
        self.assertEqual(d["unpricedModels"], [])

    def test_pages(self):
        for path in ("/", "/stats"):
            with urllib.request.urlopen(self.base + path, timeout=10) as r:
                self.assertEqual(r.status, 200)
                self.assertIn(b"<html", r.read())

    def test_decision_content(self):
        code, d = self.get("/api/decision?file=002-coder.md")
        self.assertEqual(code, 200)
        self.assertIn("Body text", d["content"])

    def test_decision_validation(self):
        for bad in ("../tasks/tasks.json", "..%2Ftasks%2Ftasks.json", "sub/002-coder.md", "002-coder.txt",
                    "missing.md", "", "..", "%2e%2e%2f002-coder.md"):
            code, d = self.get("/api/decision?file=" + bad)
            self.assertEqual(code, 400, bad)
            self.assertIn("error", d)
        self.assertEqual(self.get("/api/decision")[0], 400)

    def test_resolve_validation_unchanged(self):
        req = urllib.request.Request(self.base + "/api/action", method="POST",
                                     data=json.dumps({"action": "resolve", "file": "../tasks/tasks.json"}).encode())
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(cm.exception.code, 400)

    def test_status_backward_compatible(self):
        _, d = self.get("/api/status")
        for key in ("tasks", "done", "total", "running", "events", "decisions", "tokens", "commits", "milestones",
                    "orchestratorRunning", "worktrees", "providers", "quota"):
            self.assertIn(key, d)
        self.assertEqual(d["decisions"], ["002-coder.md"])
        t = {x["num"]: x for x in d["tasks"]}
        self.assertEqual(t["002"]["milestone"], "M1")
        self.assertEqual(t["002"]["tokens"], 3630)


if __name__ == "__main__":
    unittest.main()
