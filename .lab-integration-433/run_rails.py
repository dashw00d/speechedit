#!/usr/bin/env python3
"""RYA-463 integrated-candidate regression rail runner.

Starts an isolated SpeechEdit web service (candidate dist) on a free loopback
port per rail and runs each existing browser harness unchanged against it.
Writes per-rail logs + harness evidence under .lab-integration-433/runs/<rail>/.

Usage: run_rails.py [rail ...]   (no args = all rails)
"""
import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path("/home/ryan/dev/speechedit-integration")
LAB = ROOT / ".lab-integration-433"
RUNS = LAB / "runs"
NODE_BIN = "/home/ryan/.nvm/versions/node/v25.9.0/bin"
ELECTRON = str(ROOT / "node_modules/.bin/electron")
WEB_DIST = str(ROOT / "src/renderer/dist")
HARNESS_TIMEOUT_PAD = 90

# name, harness (relative to ROOT), OUT env var, RUN_MS env var, run budget (ms)
RAILS = [
    ("qa334", "scripts/qa334-sentence-rerecord.cjs", "QA336_OUT", "QA336_RUN_MS", 300000),
    ("qa336", "scripts/qa336-sentence-rerecord.cjs", "QA336_OUT", "QA336_RUN_MS", 300000),
    ("qa351", "scripts/qa351-coop-merge-regression.cjs", "QA351_OUT", "QA351_RUN_MS", 360000),
    ("qa352", "scripts/qa352-concurrent-cut-rerecord.cjs", "QA354_OUT", "QA354_RUN_MS", 360000),
    ("qa354", "scripts/qa354-concurrent-cut-rerecord.cjs", "QA354_OUT", "QA354_RUN_MS", 360000),
    ("qa365", "scripts/qa365-two-records-loss.cjs", "QA365_OUT", "QA365_RUN_MS", 360000),
    ("qa363-auto", ".lab-rya363/qa363-auto.cjs", "QA365_OUT", "QA365_RUN_MS", 360000),
    ("qa437", ".lab-rya429/qa437.cjs", "QA437_OUT", "QA437_RUN_MS", 300000),
    ("rya479", "scripts/owner-workspace-sync-smoke.cjs", "QA471_OUT", "QA471_RUN_MS", 360000),
    # RYA-504 wrong-key rail: needs the harness to write evidence into the rail dir.
    ("rya504", "scripts/edit-key-smoke.cjs", "RYA504_OUT", "RYA504_RUN_MS", 300000, ["--out={out}"]),
]
RAIL_BY_NAME = {r[0]: r for r in RAILS}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def base_env():
    env = os.environ.copy()
    env["PATH"] = f"{NODE_BIN}:{ROOT}/node_modules/.bin:" + env.get("PATH", "")
    env["XDG_RUNTIME_DIR"] = env.get("XDG_RUNTIME_DIR", "/run/user/1000")
    env["DISPLAY"] = env.get("DISPLAY", ":0")
    if not env.get("XAUTHORITY"):
        auth = sorted(Path("/run/user/1000").glob(".mutter-Xwaylandauth.*"))
        if auth:
            env["XAUTHORITY"] = str(auth[0])
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def run_rail(name):
    entry = RAIL_BY_NAME[name]
    _, harness, out_var, run_var, run_ms = entry[:5]
    extra = entry[5] if len(entry) > 5 else []
    out = RUNS / name
    out.mkdir(parents=True, exist_ok=True)
    port = free_port()
    env = base_env()
    env.update({
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "SPEECHEDIT_REVIEW_DIR": str(out / "reviews"),
        "SPEECHEDIT_CACHE_DIR": str(out / "cache"),
        "SPEECHEDIT_WEB_ROOT": WEB_DIST,
        out_var: str(out),
        run_var: str(run_ms),
    })
    started = time.time()
    with (out / "service.log").open("w") as log:
        service = subprocess.Popen(
            [f"{NODE_BIN}/bun", "scripts/web-server.ts"],
            cwd=ROOT, env=env, stdout=log, stderr=log,
        )
    ready = False
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1)
                ready = True
                break
            except Exception:
                time.sleep(0.1)
        if not ready:
            raise RuntimeError("service did not become ready")
        with (out / "harness.log").open("w") as hlog:
            argv = [ELECTRON, "--no-sandbox", str(ROOT / harness),
                    f"http://127.0.0.1:{port}"]
            argv += [a.format(out=out) for a in extra]
            proc = subprocess.run(
                argv,
                cwd=ROOT, env=env, stdout=hlog, stderr=subprocess.STDOUT,
                timeout=run_ms / 1000 + HARNESS_TIMEOUT_PAD,
            )
        code = proc.returncode
    except Exception as exc:  # noqa: BLE001
        code = 99
        (out / "harness.log").open("a").write(f"\nRUNNER ERROR: {exc}\n")
    finally:
        service.terminate()
        try:
            service.wait(timeout=5)
        except subprocess.TimeoutExpired:
            service.kill()
            service.wait()
    elapsed = round(time.time() - started, 1)
    print(f"{name}: exit={code} elapsed={elapsed}s out={out}", flush=True)
    return code


def main():
    wanted = os.sys.argv[1:] or [r[0] for r in RAILS]
    results = {}
    for name in wanted:
        if name not in RAIL_BY_NAME:
            print(f"unknown rail: {name}", flush=True)
            continue
        results[name] = run_rail(name)
    (RUNS / "rail-summary.json").write_text(json.dumps(results, indent=2) + "\n")
    print("SUMMARY " + json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
