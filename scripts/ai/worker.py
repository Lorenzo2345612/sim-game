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
RUNS = ROOT / ".ai/runs"
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
    sys.exit(f"Falta la key {env_name} (ni en el entorno ni en ~/.qwen/settings.json)")


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
                print(f"FALLO {name:5} {model}: {str(e)[:120]}")


def build_prompt(args):
    parts = []
    if args.task:
        task_path = (ROOT / args.task).resolve()
        if not task_path.exists():
            sys.exit(f"No existe la tarea {args.task}")
        parts.append(f"Tu tarea está especificada en `{task_path.relative_to(ROOT)}`. Léela completa antes de empezar.")
    if args.prompt:
        parts.append(args.prompt)
    if args.note:
        parts.append(f"Contexto adicional del planificador:\n{args.note}")
    return "\n\n".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", help="coder | tester | reviewer | fixer | ping")
    parser.add_argument("--task", help="ruta a la especificación de tarea (tasks/NNN-*.md)")
    parser.add_argument("--prompt", help="instrucción libre")
    parser.add_argument("--note", help="contexto extra (p. ej. hallazgos del reviewer)")
    parser.add_argument("--heavy", action="store_true", help="usar el modelo pesado del rol")
    parser.add_argument("--model", help="forzar modelo")
    parser.add_argument("--provider", help="forzar proveedor (p. ej. mimo); usa el modelo de fallback")
    args = parser.parse_args()

    if os.environ.get("SIMGAME_WORKER"):
        sys.exit("Un worker no puede lanzar otros workers.")
    if args.role == "ping":
        return ping()
    if args.role not in CONFIG["roles"]:
        sys.exit(f"Rol desconocido: {args.role}")
    if not (args.task or args.prompt):
        sys.exit("Indica --task o --prompt")

    role = CONFIG["roles"][args.role]
    forced = args.provider or os.environ.get("SIMGAME_PROVIDER")
    fallback = CONFIG.get("fallback")
    if forced and forced != role["provider"]:
        if not fallback or fallback["provider"] != forced:
            sys.exit(f"Proveedor forzado desconocido o sin modelos: {forced}")
        targets = [fallback]
    else:
        targets = [role] + ([fallback] if fallback else [])

    for i, target in enumerate(targets):
        model = args.model or (target["heavyModel"] if args.heavy else target["model"])
        code, quota_error = run_worker(args, role, target["provider"], model)
        if not quota_error or i == len(targets) - 1:
            sys.exit(code)
        print(f"[worker] {target['provider']} sin cuota/saldo; reintentando con {targets[i + 1]['provider']}",
              flush=True)


def run_worker(args, role, provider_name, model):
    """Run one headless worker. Returns (exit_code, looks_like_quota_error)."""
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
        "DISABLE_TELEMETRY": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    })

    system_prompt = (ROOT / role["prompt"]).read_text()
    cmd = [
        "claude", "-p", build_prompt(args),
        "--model", model,
        "--append-system-prompt", system_prompt,
        "--setting-sources", "project",
        "--permission-mode", "bypassPermissions",
        "--disable-slash-commands",
        "--output-format", "json",
    ]

    RUNS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    label = Path(args.task).stem if args.task else "adhoc"
    log_path = RUNS / f"{stamp}-{args.role}-{provider_name}-{label}.json"

    before = changed_files()
    print(f"[worker] rol={args.role} modelo={model} proveedor={provider_name} log={log_path.relative_to(ROOT)}",
          flush=True)
    try:
        proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True,
                              timeout=role["timeoutMin"] * 60)
    except subprocess.TimeoutExpired:
        print(f"[worker] TIMEOUT tras {role['timeoutMin']} min")
        return 124, False

    log_path.write_text(proc.stdout or proc.stderr)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raw = proc.stderr or proc.stdout
        print(f"[worker] salida no JSON (exit {proc.returncode}):\n{raw[-1500:]}")
        return proc.returncode or 1, looks_like_quota(raw)

    result = (data.get("result") or "").strip()
    if data.get("is_error") and looks_like_quota(result):
        print(f"[worker] error de cuota: {result[:200]}")
        return 1, True
    if len(result) > REPORT_LIMIT:
        result = "…" + result[-REPORT_LIMIT:]
    after = changed_files()
    print(f"[worker] error={data.get('is_error')} turnos={data.get('num_turns')} "
          f"duración={round((data.get('duration_ms') or 0) / 1000)}s")
    print("[worker] cambios en git:")
    for line in sorted(after - before) or ["(ninguno nuevo)"]:
        print("  " + line)
    print("[worker] reporte:\n" + result)
    return (1 if data.get("is_error") else 0), False


def looks_like_quota(text):
    lowered = text.lower()
    return any(p in lowered for p in QUOTA_PATTERNS)


if __name__ == "__main__":
    main()
