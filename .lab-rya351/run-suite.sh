#!/usr/bin/env bash
# RYA-351 co-op merge/conflict regression suite.
# Runs the two-context browser harness against an isolated SpeechEdit service.
#
#   run-suite.sh [url] [out-dir]
#
# Re-run UNCHANGED against Astra's integrated candidate by changing only the
# service URL/port (start a fresh service from the candidate's dist on a free
# port, e.g. via this lab's start-service.sh):
#   run-suite.sh http://127.0.0.1:3375 <candidate-out-dir>
#
# Exit codes: 0 = all checks pass, 2 = at least one acceptance check failed,
#             1 = harness error / timeout.
set -euo pipefail
URL="${1:-http://127.0.0.1:3365}"
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
echo "RYA-351 suite url=$URL out=$OUT DISPLAY=$DISPLAY"
set +e
env -u ELECTRON_RUN_AS_NODE QA351_OUT="$OUT" QA351_RUN_MS="${QA351_RUN_MS:-360000}" \
  electron scripts/qa351-coop-merge-regression.cjs "$URL" --no-sandbox
CODE=$?
set -e
echo "exit=$CODE  trace=$OUT/qa351-trace.json"
exit "$CODE"
