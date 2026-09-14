#!/usr/bin/env bash
# RYA-340 selected-sentence Re-record regression suite.
# Runs the two-context browser harness against an isolated SpeechEdit service.
#
#   run-suite.sh [url] [out-dir]
#
# Re-run UNCHANGED against Astra's integrated candidate by changing only the
# service URL/port (start a fresh service from candidate's dist on a free port):
#   SPEECHEDIT_WEB_ROOT=<candidate>/src/renderer/dist PORT=3374 bun scripts/web-server.ts
#   run-suite.sh http://127.0.0.1:3374 <candidate-out-dir>
set -euo pipefail
URL="${1:-http://127.0.0.1:3364}"
OUT="${2:-$(dirname "$0")/runs/$(date +%Y%m%d-%H%M%S)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/home/ryan/.nvm/versions/node/v25.9.0/bin:$ROOT/node_modules/.bin:$PATH"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DISPLAY="${DISPLAY:-:0}"
if [ -z "${XAUTHORITY:-}" ]; then
  XAUTHORITY="$(ls /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1 || true)"
fi
export XAUTHORITY
mkdir -p "$OUT"
cd "$ROOT"
echo "RYA-340 suite url=$URL out=$OUT DISPLAY=$DISPLAY"
set +e
env -u ELECTRON_RUN_AS_NODE QA336_OUT="$OUT" QA336_RUN_MS="${QA336_RUN_MS:-300000}" \
  electron scripts/qa336-sentence-rerecord.cjs "$URL" --no-sandbox
CODE=$?
set -e
echo "exit=$CODE  trace=$OUT/qa336-trace.json"
# 0 = all checks pass, 2 = at least one acceptance check failed, 1 = harness error/timeout.
exit "$CODE"
