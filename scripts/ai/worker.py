#!/usr/bin/env python3
"""Run a headless Claude Code worker backed by a cheap model (GLM, Kimi, Qwen/Bailian).

Usage:
  scripts/ai/worker.py <role> --task tasks/001-foo.md [--heavy] [--model M] [--note "extra context"]
  scripts/ai/worker.py <role> --prompt "free text task" [--heavy]
  scripts/ai/worker.py ping            # check every provider answers

If a provider fails with a quota/balance/rate-limit error, the run is retried once
on the "fallback" provider from ai/providers.json (Xiaomi MiMo). --provider forces a
provider for one run; SIMGAME_PROVIDER=mimo forces it for every run.

Roles and models live in ai/providers.json. Keys come from the environment
(GLM_API_KEY, KIMI_API_KEY, DASHSCOPE_API_KEY) or, as fallback, from the "env"
block of ~/.qwen/settings.json. Keys are never printed.

Prints a short report (worker's final message + changed files) so the planner's
context stays small. Full JSON transcript goes to .ai/runs/.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "ai/providers.json").read_text())
EXPERIMENTS_PATH = ROOT / "ai/experiments.json"
RUNS = ROOT / ".ai/runs"
SESSIONS = ROOT / ".ai/sessions"
WORKER_CONFIG_DIR = Path.home() / ".claude-workers"
REPORT_LIMIT = 4000
QUOTA_PATTERNS = ("429", "402", "quota", "insufficient", "balance", "rate limit", "rate_limit",
                  "usage limit", "exceeded", "余额", "限额", "额度")

# Variables from the parent Claude Code session that must not leak into the worker.
PARENT_VARS = [
    "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID", "CLAUDE_YOLO",
    "CLAUDE_EFFORT", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL", "CLAUDE_CONFIG_DIR",
]


def get_key(env_name):
    if os.environ.get(env_name):
        return os.environ[env_name]
    qwen = Path.home() / ".qwen/settings.json"
    if qwen.exists():
        value = json.loads(qwen.read_text()).get("env", {}).get(env_name)
        if value:
            return value
    sys.exit(f"Missing key {env_name} (not in the environment nor in ~/.qwen/settings.json)")


def changed_files():
    out = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
    return set(out.stdout.splitlines())


def ping():
    fallback = CONFIG.get("fallback", {})
    for name, prov in CONFIG["providers"].items():
        models = sorted({r["model"] for r in CONFIG["roles"].values() if r["provider"] == name})
        if fallback.get("provider") == name:
            models.append(fallback["model"])
        for model in models:
            body = json.dumps({"model": model, "max_tokens": 16,
                               "messages": [{"role": "user", "content": "ping"}]}).encode()
            key = get_key(prov["keyEnv"])
            req = urllib.request.Request(prov["baseUrl"] + "/v1/messages", data=body, headers={
                "content-type": "application/json", "x-api-key": key,
                "authorization": "Bearer " + key, "anthropic-version": "2023-06-01",
                "user-agent": "sim-game-worker/1.0"})
            try:
                urllib.request.urlopen(req, timeout=60).read()
                print(f"OK    {name:5} {model}")
            except Exception as e:  # noqa: BLE001
                print(f"FAIL  {name:5} {model}: {str(e)[:120]}")


def build_prompt(args):
    parts = []
    if args.task:
        task_path = (ROOT / args.task).resolve()
        if not task_path.exists():
            sys.exit(f"Task not found: {args.task}")
        parts.append(f"Your task is specified in `{task_path.relative_to(ROOT)}`. Read it fully before starting.")
    if args.prompt:
        parts.append(args.prompt)
    if args.note:
        parts.append(f"Additional context from the planner:\n{args.note}")
    return "\n\n".join(parts)


def resume_prompt(args):
    note = args.note or "Re-check your work."
    return (f"Continue the same task. New findings from the planner:\n{note}\n\n"
            "Fix only what they point to, re-run the Verification commands and reply with the report block.")


def task_number(args):
    return Path(args.task).name[:3] if args.task else None


def assigned_provider(args):
    """Provider forced for this coder task by the A/B experiment, if any."""
    if args.role != "coder" or not EXPERIMENTS_PATH.exists():
        return None
    assignments = json.loads(EXPERIMENTS_PATH.read_text()).get("coderAssignments", {})
    num = task_number(args)
    for provider, tasks in assignments.items():
        if isinstance(tasks, list) and num in tasks:
            return provider
    return None


def target_for(provider_name, role):
    """Model pair to use for a provider: the role's own pair or the fallback pair."""
    if provider_name == role["provider"]:
        return role
    fallback = CONFIG.get("fallback")
    if fallback and fallback["provider"] == provider_name:
        return fallback
    sys.exit(f"Provider {provider_name} has no models for role")


def session_file(args):
    label = Path(args.task).stem if args.task else "adhoc"
    return SESSIONS / f"{args.role}-{label}.txt"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", help="coder | tester | reviewer | fixer | ping")
    parser.add_argument("--task", help="path to the task spec (tasks/NNN-*.md)")
    parser.add_argument("--prompt", help="free-text instruction")
    parser.add_argument("--note", help="extra context (e.g. reviewer findings)")
    parser.add_argument("--heavy", action="store_true", help="use the role's heavy model")
    parser.add_argument("--model", help="force model")
    parser.add_argument("--provider", help="force provider (e.g. mimo); uses the fallback model")
    parser.add_argument("--resume", action="store_true",
                        help="continue this role's last session for the same task (keeps its context); "
                             "only --note is sent. Falls back to a fresh run if no session exists")
    args = parser.parse_args()

    if os.environ.get("SIMGAME_WORKER"):
        sys.exit("A worker cannot launch other workers.")
    if args.role == "ping":
        return ping()
    if args.role not in CONFIG["roles"]:
        sys.exit(f"Unknown role: {args.role}")
    if not (args.task or args.prompt):
        sys.exit("Provide --task or --prompt")

    role = CONFIG["roles"][args.role]
    forced = args.provider or os.environ.get("SIMGAME_PROVIDER")
    fallback = CONFIG.get("fallback")
    assigned = None if forced else assigned_provider(args)
    if forced and forced != role["provider"]:
        targets = [target_for(forced, role)]
    elif assigned and assigned != role["provider"]:
        # A/B experiment: assigned provider first, role's default provider on quota errors
        targets = [target_for(assigned, role), role]
    else:
        targets = [role] + ([fallback] if fallback else [])

    for i, target in enumerate(targets):
        model = args.model or (target["heavyModel"] if args.heavy else target["model"])
        code, quota_error = run_worker(args, role, target["provider"], model)
        if not quota_error or i == len(targets) - 1:
            sys.exit(code)
        print(f"[worker] {target['provider']} out of quota/balance; retrying with {targets[i + 1]['provider']}",
              flush=True)


def run_worker(args, role, provider_name, model, allow_resume=True):
    """Run one headless worker. Returns (exit_code, looks_like_quota_error)."""
    sess_path = session_file(args)
    resume_id = None
    if allow_resume and args.resume and sess_path.exists():
        resume_id = sess_path.read_text().strip() or None
    provider = CONFIG["providers"][provider_name]
    env = {k: v for k, v in os.environ.items() if k not in PARENT_VARS}
    env.update({
        "SIMGAME_WORKER": args.role,
        "CLAUDE_CONFIG_DIR": str(WORKER_CONFIG_DIR),
        "ANTHROPIC_BASE_URL": provider["baseUrl"],
        "ANTHROPIC_AUTH_TOKEN": get_key(provider["keyEnv"]),
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
        "CLAUDE_CODE_SUBAGENT_MODEL": model,
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        "DISABLE_TELEMETRY": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    })

    system_prompt = (ROOT / role["prompt"]).read_text()
    cmd = [
        "claude", "-p", resume_prompt(args) if resume_id else build_prompt(args),
        "--model", model,
        "--append-system-prompt", system_prompt,
        "--setting-sources", "project",
        "--permission-mode", "bypassPermissions",
        "--disable-slash-commands",
        "--output-format", "json",
    ]
    if resume_id:
        cmd += ["--resume", resume_id]

    RUNS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    label = Path(args.task).stem if args.task else "adhoc"
    suffix = "-resume" if resume_id else ""
    log_path = RUNS / f"{stamp}-{args.role}-{provider_name}-{label}{suffix}.json"

    before = changed_files()
    print(f"[worker] role={args.role} model={model} provider={provider_name} "
          f"{'resume=' + resume_id[:8] + ' ' if resume_id else ''}log={log_path.relative_to(ROOT)}", flush=True)
    try:
        proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True,
                              timeout=role["timeoutMin"] * 60)
    except subprocess.TimeoutExpired:
        print(f"[worker] TIMEOUT after {role['timeoutMin']} min")
        log_path.write_text(json.dumps({"timeout": True, "is_error": True, "model": model,
                                        "duration_ms": role["timeoutMin"] * 60000}))
        return 124, False

    log_path.write_text(proc.stdout or proc.stderr)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raw = proc.stderr or proc.stdout
        if resume_id and not looks_like_quota(raw):
            print("[worker] resume failed; starting a fresh session", flush=True)
            return run_worker(args, role, provider_name, model, allow_resume=False)
        print(f"[worker] non-JSON output (exit {proc.returncode}):\n{raw[-1500:]}")
        return proc.returncode or 1, looks_like_quota(raw)

    result = (data.get("result") or "").strip()
    if data.get("session_id"):
        SESSIONS.mkdir(parents=True, exist_ok=True)
        sess_path.write_text(data["session_id"])
    if data.get("is_error") and looks_like_quota(result):
        print(f"[worker] quota error: {result[:200]}")
        return 1, True
    if len(result) > REPORT_LIMIT:
        result = "…" + result[-REPORT_LIMIT:]
    after = changed_files()
    print(f"[worker] error={data.get('is_error')} turns={data.get('num_turns')} "
          f"duration={round((data.get('duration_ms') or 0) / 1000)}s")
    print("[worker] git changes:")
    for line in sorted(after - before) or ["(none new)"]:
        print("  " + line)
    print("[worker] report:\n" + result)
    return (1 if data.get("is_error") else 0), False


def looks_like_quota(text):
    lowered = text.lower()
    return any(p in lowered for p in QUOTA_PATTERNS)


if __name__ == "__main__":
    main()
