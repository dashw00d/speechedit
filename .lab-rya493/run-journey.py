#!/usr/bin/env python3
"""RYA-493 host/guest export journey runner (isolated; no product source edits).

Starts one isolated SpeechEdit web service on a free loopback port with its own
SPEECHEDIT_REVIEW_DIR / SPEECHEDIT_CACHE_DIR, runs the Electron host/guest
export journey against it, then stops only that service.

Usage: python3 .lab-rya493/run-journey.py
Exit codes: 0 pass, 2 acceptance failure, 1 harness/setup error.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODE_BIN = os.environ.get("QA493_NODE_BIN", "/home/ryan/.nvm/versions/node/v25.9.0/bin")
BUN = str(Path(NODE_BIN) / "bun")
ELECTRON = str(ROOT / "node_modules/.bin/electron")
WEB_DIST = os.environ.get("QA493_WEB_DIST", str(ROOT / "src/renderer/dist"))
RUN_TIMEOUT = int(os.environ.get("QA493_TIMEOUT", "480"))


def log(msg):
    print(f"[rya493] {msg}", flush=True)


def base_env():
    env = os.environ.copy()
    env["PATH"] = f"{NODE_BIN}:{ROOT / 'node_modules/.bin'}:" + env.get("PATH", "")
    env["XDG_RUNTIME_DIR"] = env.get("XDG_RUNTIME_DIR", "/run/user/1000")
    env["DISPLAY"] = env.get("DISPLAY", ":0")
    if not env.get("XAUTHORITY"):
        auth = sorted(Path("/run/user/1000").glob(".mutter-Xwaylandauth.*"))
        if auth:
            env["XAUTHORITY"] = str(auth[0])
    env.pop("ELECTRON_RUN_AS_NODE", None)
    return env


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(os.environ.get("QA493_OUT", ROOT / ".lab-rya493" / "runs" / stamp))
    out.mkdir(parents=True, exist_ok=True)
    env = base_env()

    if not Path(WEB_DIST, "index.html").exists():
        raise SystemExit(f"web root missing index.html: {WEB_DIST} (build first)")

    port = free_port()
    service_env = {
        **env,
        "HOST": "127.0.0.1",
        "PORT": str(port),
        "SPEECHEDIT_REVIEW_DIR": str(out / "reviews"),
        "SPEECHEDIT_CACHE_DIR": str(out / "cache"),
        "SPEECHEDIT_WEB_ROOT": WEB_DIST,
        "QA493_OUT": str(out),
        "QA493_RUN_MS": str((RUN_TIMEOUT - 30) * 1000),
    }
    log(f"service http://127.0.0.1:{port} reviews={service_env['SPEECHEDIT_REVIEW_DIR']}")

    with (out / "service.log").open("w") as logf:
        service = subprocess.Popen(
            [BUN, "scripts/web-server.ts"], cwd=ROOT, env=service_env, stdout=logf, stderr=logf
        )
    try:
        ready = False
        for _ in range(150):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as r:
                    ready = r.status == 200
                    break
            except Exception:
                time.sleep(0.1)
        if not ready:
            raise SystemExit("web service did not become ready; see " + str(out / "service.log"))

        log("running Electron host/guest export journey")
        result = subprocess.run(
            [ELECTRON, "--no-sandbox", str(ROOT / ".lab-rya493/qa493-export-journey.cjs"), f"http://127.0.0.1:{port}"],
            cwd=ROOT, env=service_env, timeout=RUN_TIMEOUT,
        )
        code = result.returncode
    finally:
        log(f"service exit-before-cleanup={service.poll()}")
        service.terminate()
        try:
            service.wait(timeout=5)
        except subprocess.TimeoutExpired:
            service.kill()
            service.wait()

    verdict = {0: "PASS", 2: "FAIL", 1: "ERROR"}.get(code, f"EXIT {code}")
    log(f"{verdict} — evidence {out}")
    sys.exit(code)


if __name__ == "__main__":
    main()
