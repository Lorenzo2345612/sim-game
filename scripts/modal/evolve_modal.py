"""Residual racecraft training on Modal (CPU): one container per track, outputs in the `simgame-evolve` volume.

Launch (runs on after the local machine disconnects):
  modal run --detach scripts/modal/evolve_modal.py --tracks monza,mexico,spa --hours 8 \
      --seed public/ai-models/cleveland-f4/expert.json
Fetch:   modal volume get simgame-evolve models/<track>-f4-residual scripts/evolve/models/scratch/
Logs:    modal app logs simgame-evolve
"""
import pathlib
import threading
import time

import modal

_HERE = pathlib.Path(__file__).resolve()
ROOT = _HERE.parents[2] if len(_HERE.parents) > 2 else _HERE.parent  # inside the container the module sits at /root
CPU = 16  # physical cores per track; ~0.8 USD/h with 8 GiB
VOL = "/vol"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "ca-certificates")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_24.x | bash -", "apt-get install -y nodejs")
    .add_local_file(ROOT / "package.json", "/repo/package.json", copy=True)
    .add_local_file(ROOT / "package-lock.json", "/repo/package-lock.json", copy=True)
    .run_commands("cd /repo && npm ci --ignore-scripts --no-audit --no-fund")
    .add_local_file(ROOT / "tsconfig.json", "/repo/tsconfig.json", copy=True)
    .add_local_dir(ROOT / "src", "/repo/src", copy=True)
    .add_local_dir(ROOT / "public/tracks", "/repo/public/tracks", copy=True)
    .add_local_dir(ROOT / "public/cars", "/repo/public/cars", copy=True)
    .add_local_dir(ROOT / "scripts/evolve", "/repo/scripts/evolve", copy=True, ignore=["models/**", "runs/**"])
)
app = modal.App("simgame-evolve", image=image)
vol = modal.Volume.from_name("simgame-evolve", create_if_missing=True)

# Same settings as the Cleveland residual run that produced gen331 (task 288).
BASE_ARGS = (
    "--pop 100 --gens 100000 --speed-laps 3 --evals 2 --speed-mut 0.15 --line mintime --racecraft --opponents 6 "
    "--residual --max-faults 5 --res-offset 5 --res-up 0.12 --res-down 0.35 --kick-after 40"
).split()


@app.function(cpu=CPU, memory=8192, timeout=24 * 3600, volumes={VOL: vol})
def train(track: str, hours: float, seed_name: str, seed_json: str, extra: list[str]) -> str:
    import os
    import signal
    import subprocess

    vroot = pathlib.Path(VOL)
    for d in ("models", "runs", "seeds", "logs"):
        (vroot / d).mkdir(parents=True, exist_ok=True)
    ev = pathlib.Path("/repo/scripts/evolve")
    for d in ("models", "runs"):
        p = ev / d
        if not p.exists():
            p.symlink_to(vroot / d)
    args = ["npx", "tsx", "scripts/evolve/evolve.mts", "--track", track, "--workers", str(CPU - 1), *BASE_ARGS,
            "--model-dir", f"{track}-f4-residual", *extra]
    # Preemption restarts this function: continue from this track's newest population instead of the seed.
    snaps = sorted((vroot / "runs").glob(f"{track}-f4-*/pop.json"), key=lambda f: f.stat().st_mtime)
    if snaps:
        args += ["--resume", str(snaps[-1])]
    elif seed_json:
        seed = vroot / "seeds" / seed_name
        seed.write_text(seed_json)
        args += ["--resume", str(seed)]
    log = open(vroot / "logs" / f"{track}-{time.strftime('%Y%m%dT%H%M%S')}.log", "w")
    proc = subprocess.Popen(args, cwd="/repo", stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    stop = threading.Event()

    def commit_loop() -> None:
        while not stop.wait(300):
            log.flush()
            vol.commit()

    threading.Thread(target=commit_loop, daemon=True).start()
    try:
        proc.wait(timeout=hours * 3600)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=60)
    stop.set()
    log.close()
    vol.commit()
    return f"{track}: exit {proc.returncode}"


@app.local_entrypoint()
def main(tracks: str, hours: float = 8.0, seed: str = "", extra: str = "") -> None:
    seed_json = pathlib.Path(seed).read_text() if seed else ""
    seed_name = pathlib.Path(seed).parent.name + "-" + pathlib.Path(seed).name if seed else ""
    calls = [(t, hours, seed_name, seed_json, extra.split()) for t in tracks.split(",") if t]
    for r in train.starmap(calls):
        print(r)
