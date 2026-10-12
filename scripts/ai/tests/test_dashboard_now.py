"""/api/now: live workers joined to processes and transcripts (DASH_PS_FILE + CLAUDE_WORKERS_DIR fixtures)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.ai.tests.test_dashboard_stats import DASHBOARD, make_fixture

SID_A, SID_B = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"


def stamp(secs_ago):
    return (datetime.now(timezone.utc) - timedelta(seconds=secs_ago)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def a_line(mid, ts, content, usage, cwd="/x/.ai/wt/002"):
    return json.dumps({"type": "assistant", "timestamp": ts, "cwd": cwd,
                       "message": {"id": mid, "role": "assistant", "content": content, "usage": usage}})


def usage(i, o, cr, cw):
    return {"input_tokens": i, "output_tokens": o, "cache_read_input_tokens": cr, "cache_creation_input_tokens": cw}


def make_now_fixture(root, home):
    make_fixture(root)
    root = Path(root)
    tasks = [{"num": "001", "title": "Alpha", "status": "done", "deps": []},
             {"num": "002", "title": "Beta", "status": "in progress", "deps": ["001"]},
             {"num": "003", "title": "Gamma", "status": "todo", "deps": ["001"]},
             {"num": "004", "title": "Delta", "status": "todo", "deps": ["002"]}]
    (root / "tasks/tasks.json").write_text(json.dumps({"tasks": tasks}))
    (root / "tasks/milestones.json").write_text(json.dumps({"milestones": [
        {"id": "M1", "title": "Second", "tasks": ["001", "002", "003", "004"], "status": "open"}]}))
    (root / "ai/providers.json").write_text(json.dumps({
        "providers": {"glm": {"maxConcurrent": 1}, "qwen": {"maxConcurrent": 2}},
        "roles": {"coder": {"provider": "glm", "model": "glm-5.3-flash", "heavyModel": "glm-5.3"},
                  "acceptance": {"provider": "qwen", "model": "qwen3.8-flash", "heavyModel": "qwen3.8-max"}}}))
    (root / "ai/experiments.json").write_text("{}")
    (root / ".ai/state.json").write_text(json.dumps({"002": {"stage": "coder", "fixRounds": 1}}))
    (root / ".ai/decisions/002-coder.md").unlink()
    (root / ".ai/events.log").write_text("\n".join(json.dumps(
        {"ts": f"2026-10-11T1{i}:00:00", "task": "002", "event": "step" if i == 5 else "start", "detail": str(i)})
        for i in range(8)) + "\n")
    proj = Path(home) / "projects/-x--ai-wt-002"
    proj.mkdir(parents=True)
    pad = a_line("pad", stamp(500), [{"type": "text", "text": "x" * 300}], usage(0, 0, 0, 0))
    (proj / f"{SID_A}.jsonl").write_text("\n".join(
        [pad] * 600 + [
            a_line("m1", stamp(40), [{"type": "text", "text": "start"}], usage(10, 5, 100, 50)),
            a_line("m1", stamp(39), [{"type": "text", "text": "start"}], usage(10, 20, 100, 50)),
            a_line("m2", stamp(30), [{"type": "tool_use", "name": "Edit",
                                      "input": {"file_path": "/x/.ai/wt/002/src/track/terrain.ts"}}], usage(1, 2, 3, 4)),
            json.dumps({"type": "user", "timestamp": stamp(12), "message": {"role": "user", "content": []}}),
        ]) + "\n")
    (proj / f"{SID_B}.jsonl").write_text(a_line(
        "n1", stamp(7), [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": "Reading the spec\nnow"}],
        usage(1, 1, 1, 1)) + "\n")
    ps = ["  PID  PPID     ELAPSED COMMAND",
          "  100     1       10:00 python3 scripts/ai/orchestrator.py run --max-parallel 6",
          "  200   100    01:05:07 python3 scripts/ai/worker.py coder --task tasks/002-beta.md --heavy --resume",
          f"  201   200    01:05:06 claude -p do it --model glm-5.3 --append-system-prompt x --resume {SID_A}",
          "  300   100       00:42 python3 scripts/ai/worker.py acceptance --task tasks/003-gamma.md --provider mimo",
          f"  301   300       00:41 claude -p do it --model mimo-v2.6-flash --session-id {SID_B}",
          "  400     1       00:01 grep worker.py"]
    (root / "ps.txt").write_text("\n".join(ps) + "\n")


class NowApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.home = tempfile.TemporaryDirectory()
        make_now_fixture(cls.tmp.name, cls.home.name)
        env = {**os.environ, "ORCH_ROOT": cls.tmp.name, "CLAUDE_WORKERS_DIR": cls.home.name,
               "DASH_PS_FILE": str(Path(cls.tmp.name) / "ps.txt"),
               "QUOTA_MOCK": str(Path(cls.tmp.name) / ".ai/mock-quota.json")}
        cls.proc = subprocess.Popen([sys.executable, str(DASHBOARD), "--port", "0"], env=env, cwd=cls.tmp.name,
                                    stdout=subprocess.PIPE, text=True)
        cls.base = cls.proc.stdout.readline().strip().split("Dashboard: ")[1]
        with urllib.request.urlopen(cls.base + "/api/now", timeout=10) as r:
            cls.now = json.loads(r.read())
        cls.w = {w["task"]: w for w in cls.now["workers"]}

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stdout.close()
        cls.tmp.cleanup()
        cls.home.cleanup()

    def test_summary(self):
        n = self.now
        self.assertEqual((n["state"], n["orchestratorRunning"]), ("running", True))
        self.assertEqual(n["byRole"], {"coder": 1, "acceptance": 1})
        self.assertEqual(n["milestone"]["id"], "M1")
        self.assertEqual((n["milestone"]["done"], n["milestone"]["total"]), (1, 4))
        self.assertEqual((n["queued"], n["blocked"], n["decisions"]), (0, 1, []))

    def test_worker_mapping(self):
        a = self.w["002"]
        self.assertEqual((a["role"], a["verb"], a["provider"], a["model"]), ("coder", "coding", "glm", "glm-5.3"))
        self.assertTrue(a["heavy"] and a["resume"])
        self.assertEqual((a["fixRounds"], a["title"], a["pid"]), (1, "Beta", 200))
        self.assertEqual(a["elapsedSec"], 3907)
        b = self.w["003"]
        self.assertEqual((b["verb"], b["provider"], b["model"]), ("writing acceptance tests", "mimo", "mimo-v2.6-flash"))
        self.assertFalse(b["heavy"])

    def test_tokens_dedup_by_message(self):
        self.assertEqual(self.w["002"]["tokens"], 10 + 20 + 100 + 50 + 1 + 2 + 3 + 4)
        self.assertEqual(self.w["003"]["tokens"], 4)

    def test_activity_from_transcript_tail(self):
        act = self.w["002"]["activity"]
        self.assertEqual((act["kind"], act["text"]), ("tool", "Edit src/track/terrain.ts"))
        self.assertTrue(10 <= act["agoSec"] <= 20, act)
        act = self.w["003"]["activity"]
        self.assertEqual((act["kind"], act["text"]), ("text", "Reading the spec now"))

    def test_events_skip_steps(self):
        evs = self.now["events"]
        self.assertEqual(len(evs), 5)
        self.assertNotIn("step", {e["event"] for e in evs})
        self.assertTrue(evs[-1]["ts"].endswith("Z"))

    def test_status_workers_unchanged(self):
        with urllib.request.urlopen(self.base + "/api/status", timeout=10) as r:
            d = json.loads(r.read())
        self.assertEqual(sorted(w["task"] for w in d["workers"]), ["002", "003"])


class NowIdle(unittest.TestCase):
    def run_now(self, mutate):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as home:
            make_now_fixture(root, home)
            (Path(root) / "ps.txt").write_text("PID PPID ELAPSED COMMAND\n")
            mutate(Path(root))
            code = ("import json,sys; sys.path.insert(0, %r); import dashboard; print(json.dumps(dashboard.now_view()))"
                    % str(DASHBOARD.parent))
            env = {**os.environ, "ORCH_ROOT": root, "CLAUDE_WORKERS_DIR": home,
                   "DASH_PS_FILE": str(Path(root) / "ps.txt")}
            return json.loads(subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True,
                                             check=True).stdout)

    def test_waiting_for_approval(self):
        def mutate(root):
            (root / "tasks/milestones.json").write_text(json.dumps({"milestones": [
                {"id": "M1", "title": "Second", "tasks": ["001"], "status": "built"}]}))
        n = self.run_now(mutate)
        self.assertEqual(n["state"], "approval")
        self.assertIn("M1", n["reason"])
        self.assertIn("approval", n["reason"])

    def test_waiting_for_decision(self):
        n = self.run_now(lambda r: (r / ".ai/decisions/026-coder.md").write_text("x"))
        self.assertEqual(n["state"], "waiting-decision")
        self.assertEqual(n["reason"], "Waiting for decision 026")
        self.assertEqual(n["decisions"], ["026-coder.md"])

    def test_stopped_with_ready_tasks_and_up_next(self):
        n = self.run_now(lambda r: None)
        self.assertEqual(n["state"], "stopped")
        self.assertEqual(n["queued"], 2)
        self.assertEqual([t["num"] for t in n["upNext"]], ["002", "003"])
        self.assertEqual(n["upNext"][0]["next"], "coding")
        self.assertEqual(n["upNext"][1]["next"], "writing acceptance tests")
        self.assertEqual(n["upNext"][1]["provider"], "qwen")

    def test_idle_when_all_done(self):
        def mutate(root):
            tasks = [{"num": "001", "title": "Alpha", "status": "done", "deps": []}]
            (root / "tasks/tasks.json").write_text(json.dumps({"tasks": tasks}))
            (root / "tasks/milestones.json").write_text(json.dumps({"milestones": [
                {"id": "M1", "title": "S", "tasks": ["001"], "status": "approved"}]}))
        n = self.run_now(mutate)
        self.assertEqual(n["state"], "idle")
        self.assertEqual(n["workers"], [])


if __name__ == "__main__":
    unittest.main()
