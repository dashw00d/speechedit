"""Run the keyboard browser rail with a private, bounded test service.

Example: python scripts/run-selection-keyboard.py --out docs/runs/rya505/candidate
Build the desired version first; --web-root can select a separately built baseline.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
parser.add_argument('--web-root', default='src/renderer/dist')
parser.add_argument('--port', type=int, default=3497)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = (root / args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
scratch = os.environ.get('PAPERCLIP_RUN_SCRATCH_DIR') or os.environ.get('PAPERCLIP_SCRATCH_DIR')
env = os.environ.copy()
env.pop('ELECTRON_RUN_AS_NODE', None)
# Reuse display authentication without reading or recording its contents.
if not env.get('DISPLAY'):
    auth = next(Path(f'/run/user/{os.getuid()}').glob('.mutter-Xwaylandauth.*'), None)
    if auth:
        env.update(DISPLAY=':0', XAUTHORITY=str(auth))
url = f'http://127.0.0.1:{args.port}'

def stop(process):
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()

with tempfile.TemporaryDirectory(prefix='selection-keyboard-', dir=scratch) as data:
    env.update(HOST='127.0.0.1', PORT=str(args.port),
               SPEECHEDIT_REVIEW_DIR=str(Path(data) / 'rooms'),
               SPEECHEDIT_CACHE_DIR=str(Path(data) / 'whisper'),
               SPEECHEDIT_WEB_ROOT=str((root / args.web_root).resolve()),
               KEYBOARD_OUT=str(out), KEYBOARD_RUN_MS='150000')
    server = browser = None
    with (out / 'service.log').open('w') as service_log, (out / 'harness.log').open('w') as browser_log:
        try:
            server = subprocess.Popen(['bun', 'scripts/web-server.ts'], cwd=root, env=env,
                                      stdout=service_log, stderr=service_log, start_new_session=True)
            time.sleep(.5)
            for _ in range(60):
                if server.poll() is not None:
                    raise RuntimeError('Own service failed to bind; refusing to test another listener')
                try:
                    html = urllib.request.urlopen(url, timeout=1).read().decode()
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Own service did not become ready')
            bundle = re.search(r'<script[^>]+src="([^"]+)"', html).group(1)
            content = urllib.request.urlopen(url + bundle).read()
            (out / 'served-build.json').write_text(json.dumps({
                'asset': bundle, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)
            }, indent=2) + '\n')
            browser = subprocess.Popen(['node_modules/.bin/electron', '--no-sandbox', '--disable-gpu',
                                        '--disable-dev-shm-usage', 'scripts/selection-keyboard-smoke.cjs', url],
                                       cwd=root, env=env, stdout=browser_log, stderr=browser_log,
                                       start_new_session=True)
            code = browser.wait(timeout=165)
        finally:
            stop(browser)
            stop(server)
    print((out / 'harness.log').read_text())
    raise SystemExit(code)
