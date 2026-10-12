"""Dashboard process list ignores processes of other trees (e.g. unit-test orchestrators)."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dashboard  # noqa: E402


class ProcFilterTest(unittest.TestCase):
    def spawn(self, cwd, env=None):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], cwd=cwd,
                             env={**os.environ, **(env or {})}, stdin=subprocess.DEVNULL)
        self.addCleanup(p.kill)
        return p.pid

    def test_filter(self):
        other = tempfile.mkdtemp()
        inside = self.spawn(dashboard.ROOT)
        elsewhere = self.spawn(other)
        foreign_env = self.spawn(dashboard.ROOT, {"ORCH_ROOT": other})
        self.assertTrue(dashboard.ours(inside))
        self.assertFalse(dashboard.ours(elsewhere))
        self.assertFalse(dashboard.ours(foreign_env))
        self.assertTrue(dashboard.ours(2 ** 22 + 12345))
