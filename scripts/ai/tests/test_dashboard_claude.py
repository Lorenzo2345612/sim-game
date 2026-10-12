"""Claude Code transcript usage in /api/stats and the /api/task endpoint (temp ORCH_ROOT + CLAUDE_PROJECTS_DIR)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from scripts.ai.tests.test_dashboard_stats import DASHBOARD, make_fixture


def line(kind, ts, model=None, mid=None, usage=None, prompt=None, cwd="/home/u/sim-game"):
    d = {"type": kind, "timestamp": ts, "cwd": cwd, "uuid": f"u-{ts}-{mid}"}
    if kind == "assistant":
        d["requestId"] = "req-" + str(mid)
        d["message"] = {"id": mid, "model": model, "usage": usage}
    else:
        d["message"] = {"role": "user", "content": prompt}
    return json.dumps(d)


def usage(i, o, cr, cw):
    return {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": cr, "cache_creation_input_tokens": cw}


def make_claude(d):
    d = Path(d)
    (d / "sess1/subagents").mkdir(parents=True)
    (d / "sess1.jsonl").write_text("\n".join([
        line("user", "2026-10-11T10:00:00.000Z", prompt="plan things"),
        line("assistant", "2026-10-11T10:00:05.000Z", "claude-opus-5-5", "m1", usage(2, 10, 1000, 100)),
        line("assistant", "2026-10-11T10:00:06.000Z", "claude-opus-5-5", "m1", usage(2, 50, 1000, 100)),
        line("assistant", "2026-10-11T10:00:07.000Z", "claude-opus-5-5", "m1", usage(2, 50, 1000, 100)),
        line("assistant", "2026-10-11T10:00:20.000Z", "claude-opus-5-5", "m2", usage(3, 20, 2000, 0)),
        "not json",
    ]) + "\n")
    (d / "sess1/subagents/agent-a.jsonl").write_text("\n".join([
        line("user", "2026-10-11T11:00:00.000Z", prompt="Review tasks/002-beta.md carefully"),
        line("assistant", "2026-10-11T11:00:10.000Z", "claude-sonnet-5-5", "s1", usage(5, 100, 500, 50)),
    ]) + "\n")
    (d / "sess1/subagents/agent-a.meta.json").write_text(json.dumps(
        {"agentType": "spec-reviewer", "description": "Check spec 002"}))
    (d / "sess1/subagents/agent-b.jsonl").write_text("\n".join([
        line("user", "2026-10-11T12:00:00.000Z", prompt="Batch tasks/003-x.md to tasks/018-y.md"),
        line("assistant", "2026-10-11T12:00:10.000Z", "claude-sonnet-5-5", "s2", usage(7, 70, 0, 0)),
    ]) + "\n")
    # must be ignored: worker config dir cwd, and non-claude model
    (d / "worker.jsonl").write_text(line("assistant", "2026-10-11T10:00:00.000Z", "claude-sonnet-5-5", "w1",
                                         usage(999, 999, 999, 999), cwd="/home/u/.claude-workers/x") + "\n")
    (d / "glm.jsonl").write_text(line("assistant", "2026-10-11T10:00:00.000Z", "glm-5.3-flash", "g1",
                                      usage(888, 888, 888, 888)) + "\n")


class ClaudeUsage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cdir = tempfile.TemporaryDirectory()
        make_fixture(cls.tmp.name)
        make_claude(cls.cdir.name)
        env = {**os.environ, "ORCH_ROOT": cls.tmp.name, "TZ": "UTC", "CLAUDE_PROJECTS_DIR": cls.cdir.name,
               "QUOTA_MOCK": str(Path(cls.tmp.name) / ".ai/mock-quota.json")}
        cls.proc = subprocess.Popen([sys.executable, str(DASHBOARD), "--port", "0"], env=env, cwd=cls.tmp.name,
                                    stdout=subprocess.PIPE, text=True)
        cls.base = cls.proc.stdout.readline().strip().split("Dashboard: ")[1]

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stdout.close()
        cls.tmp.cleanup()
        cls.cdir.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_dedupe_and_models(self):
        _, d = self.get("/api/stats?provider=claude")
        opus, sonnet = d["byModel"]["claude-opus-5-5"], d["byModel"]["claude-sonnet-5-5"]
        # m1 counted once (max of streamed copies) + m2
        self.assertEqual((opus["input"], opus["output"], opus["cacheRead"], opus["cacheWrite"]), (5, 70, 3000, 100))
        self.assertEqual((sonnet["input"], sonnet["output"], sonnet["cacheRead"]), (12, 170, 500))
        self.assertEqual(list(d["byProvider"]), ["claude"])
        self.assertNotIn("glm-5.3-flash", d["byModel"])
        self.assertEqual(d["unpricedModels"], [])
        self.assertGreater(opus["costUsd"], 0)

    def test_roles_and_buckets(self):
        _, d = self.get("/api/stats?provider=claude")
        self.assertEqual(set(d["byRole"]), {"planner", "planner-subagent"})
        rows = {r["task"]: r for r in d["byTask"]}
        self.assertEqual(rows["002"]["runs"], 1)
        self.assertEqual(rows["plan"]["title"], "Planning (no task)")
        self.assertEqual(rows["plan"]["runs"], 2)  # main session + multi-task batch subagent

    def test_worker_stats_unchanged(self):
        _, d = self.get("/api/stats?provider=glm")
        self.assertEqual(d["totals"]["total"], 10100)
        _, d = self.get("/api/stats")
        self.assertIn("claude", d["options"]["providers"])

    def test_task_endpoint(self):
        code, d = self.get("/api/task?num=002")
        self.assertEqual(code, 200)
        self.assertEqual((d["num"], d["title"], d["fixRounds"]), ("002", "Beta", 2))
        by = [(r["provider"], r["role"]) for r in d["runs"]]
        self.assertEqual(by.count(("mimo", "coder")), 2)
        self.assertIn(("claude", "planner-subagent"), by)
        self.assertEqual(d["runs"][0]["start"], "2026-10-11T10:00:00Z")
        resumed = [r for r in d["runs"] if r["resumed"]][0]
        self.assertEqual(resumed["round"], 1)
        cl = [r for r in d["runs"] if r["provider"] == "claude"][0]
        self.assertEqual((cl["model"], cl["description"]), ("claude-sonnet-5-5", "Check spec 002"))
        self.assertEqual(d["totals"]["runs"], len(d["runs"]))

    def test_task_validation(self):
        for bad in ("", "12", "1234", "abc", "../1", "0x1"):
            self.assertEqual(self.get("/api/task?num=" + bad)[0], 400, bad)
        self.assertEqual(self.get("/api/task")[0], 400)
        self.assertEqual(self.get("/api/task?num=999")[0], 404)


if __name__ == "__main__":
    unittest.main()
