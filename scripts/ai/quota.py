#!/usr/bin/env python3
"""Provider quota windows (GLM, Kimi, Claude subscription). Usage: quota.py [--json] [provider]

Exit 1 if any window has < 10 % remaining. QUOTA_MOCK=<file.json> replaces HTTP
({provider: [windows] | {"unsupported": true}}); used by tests.
"""
import datetime
import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

GLM_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
KIMI_URL = "https://api.kimi.com/coding/v1/usages"
CLAUDE_URL = "https://api.anthropic.com/api/oauth/usage"
CLAUDE_CREDS = Path(os.environ.get("CLAUDE_CONFIG_DIR_PLANNER") or os.environ.get("CLAUDE_CONFIG_DIR")
                    or Path.home() / ".claude") / ".credentials.json"
CONSOLES = {"mimo": "https://platform.xiaomimimo.com"}
KEYS = {"glm": "GLM_API_KEY", "kimi": "KIMI_API_KEY"}
LOW = 0.10
_cache = {}
_lock = threading.Lock()


def key(env_name):
    if os.environ.get(env_name):
        return os.environ[env_name]
    qwen = Path.home() / ".qwen/settings.json"
    if qwen.exists():
        return json.loads(qwen.read_text()).get("env", {}).get(env_name)
    return None


def fetch(url, env_name):
    k = key(env_name)
    if not k:
        raise RuntimeError(f"missing key {env_name}")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + k, "user-agent": "sim-game-quota/1.0"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def iso_ms(ms):
    return datetime.datetime.fromtimestamp(int(ms) / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso(s):
    d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def window(name, used, limit, remaining, reset_at, unit="requests"):
    return {"window": name, "used": used, "limit": limit, "remaining": remaining, "resetAt": reset_at, "unit": unit}


def glm():
    out = []
    for lim in fetch(GLM_URL, KEYS["glm"]).get("data", {}).get("limits", []):
        if lim.get("unit") == 3 and lim.get("number") == 5:
            name = "5h"
        elif lim.get("unit") == 6:
            name = "week"
        else:
            continue
        out.append(window(name, lim["currentValue"], lim["usage"], lim["remaining"], iso_ms(lim["nextResetTime"])))
    return out


def kimi():
    data = fetch(KIMI_URL, KEYS["kimi"])
    out = []
    for lim in data.get("limits", []):
        w, d = lim.get("window", {}), lim.get("detail", {})
        if w.get("duration") == 300 and "MINUTE" in str(w.get("timeUnit")):
            lim_, rem = int(d["limit"]), int(d["remaining"])
            out.append(window("5h", int(d.get("used", lim_ - rem)), lim_, rem, iso(d["resetTime"])))
    month = data.get("usages", {}).get("limit_month_total")
    if month:
        used = round(month["used_ratio"] * 100)
        out.append(window("month", used, 100, 100 - used, iso(month["reset_time"]), "percent"))
    return out


def claude():
    tok = json.loads(CLAUDE_CREDS.read_text())["claudeAiOauth"]["accessToken"]
    req = urllib.request.Request(CLAUDE_URL, headers={"Authorization": "Bearer " + tok,
                                                      "anthropic-beta": "oauth-2025-04-20"})
    data = json.loads(urllib.request.urlopen(req, timeout=20).read())
    out = []
    for name, field in (("5h", "five_hour"), ("week", "seven_day"), ("week opus", "seven_day_opus"),
                        ("week sonnet", "seven_day_sonnet")):
        w = data.get(field)
        if w and w.get("utilization") is not None:
            used = round(w["utilization"])
            out.append(window(name, used, 100, 100 - used, iso(w["resets_at"]), "percent"))
    return out


def get(provider):
    if os.environ.get("QUOTA_MOCK"):
        return json.loads(Path(os.environ["QUOTA_MOCK"]).read_text()).get(provider, {"unsupported": True})
    if provider == "glm":
        return glm()
    if provider == "kimi":
        return kimi()
    if provider == "claude":
        return claude()
    return {"unsupported": True, "url": CONSOLES.get(provider, "")}


def cached(provider, ttl=60):
    with _lock:
        hit = _cache.get(provider)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    shared = Path(__file__).resolve().parents[2] / ".ai" / f"usage-{provider}.json"
    try:
        if provider == "claude" and shared.exists() and time.time() - json.loads(shared.read_text())["t"] < max(ttl, 90):
            value = json.loads(shared.read_text())["windows"]  # another process read it recently
        else:
            value = get(provider)
            if provider == "claude" and isinstance(value, list):
                shared.write_text(json.dumps({"t": time.time(), "windows": value}))
    except Exception as e:  # noqa: BLE001
        value = {"error": str(e)[:120]}
        if shared.exists() and time.time() - json.loads(shared.read_text())["t"] < 600:
            value = json.loads(shared.read_text())["windows"]  # rate-limited: last good reading
    with _lock:
        _cache[provider] = (time.time(), value)
    return value


def low_5h(provider):
    """True if the provider's 5 h window has < 10 % remaining (unknown -> False)."""
    value = cached(provider)
    if isinstance(value, list):
        return any(w["window"] == "5h" and w["limit"] and w["remaining"] / w["limit"] < LOW for w in value)
    return False


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    names = args or ["glm", "kimi", "mimo", "claude"]
    result = {n: cached(n, 0) for n in names}
    low = any(isinstance(v, list) and any(w["limit"] and w["remaining"] / w["limit"] < LOW for w in v)
              for v in result.values())
    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        for n, v in result.items():
            if isinstance(v, list):
                for w in v:
                    print(f"{n:5} {w['window']:6} {w['used']}/{w['limit']} left {w['remaining']} resets {w['resetAt']}")
            else:
                print(f"{n:5} {json.dumps(v)}")
    return 1 if low else 0


if __name__ == "__main__":
    sys.exit(main())
