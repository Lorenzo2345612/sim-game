#!/usr/bin/env python3
"""Optional notifier hook that never raises. Disabled unless ORCH_NOTIFY_CMD is set
(shell-split; the message is appended as the last argument). Alerts live in the dashboard."""
import os
import shlex
import subprocess
import sys


def send(message, cwd=None):
    cmd = os.environ.get("ORCH_NOTIFY_CMD")
    if not cmd:
        return False
    try:
        subprocess.run([*shlex.split(cmd), message], cwd=cwd, timeout=30, capture_output=True)
        return True
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    send(" ".join(sys.argv[1:]) or "test")
