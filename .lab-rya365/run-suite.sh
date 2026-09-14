#!/usr/bin/env bash
# RYA-365 run the merge-level + two-context non-overlapping re-record regression.
#
#   run-suite.sh [url] [out-dir]
#
# Re-run UNCHANGED against Astra's integrated candidate by changing only the
# service URL/port (start a fresh service from the candidate's dist on a free
# port, e.g. via this lab's start-service.sh):
#   run-suite.sh http://127.0.0.1:3378 <candidate-out-dir>
#
# Exit codes: 0 = all checks pass, 2 = at least one acceptance check failed,
#             1 = harness error / timeout.
set -euo pipefail
URL="${1:-http://127.0.0.1:3367}"
OUT="${2:-$(dirname "$0")/runs/$(date +%Y%m%d-%H%M%S)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/home/ryan/.nvm/versions/node/v25.9.0/bin:$ROOT/node_modules/.bin:$PATH"
mkdir -p "$OUT"

echo "== QA365 merge-level regression (fast, deterministic) =="
set +e
bun "$ROOT/scripts/qa365-nonoverlap-voice-merge-regression.ts" | tee "$OUT/merge-level.log"
MERGE_CODE=${PIPESTATUS[0]}
set -e

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DISPLAY="${DISPLAY:-:0}"
if [ -z "${XAUTHORITY:-}" ]; then
  XAUTHORITY="$(ls /run/user/1000/.mutter-Xwaylandauth.* 2>/dev/null | head -1 || true)"
fi
export XAUTHORITY

echo "== QA365 two-context browser confirmation url=$URL =="
cd "$ROOT"
set +e
env -u ELECTRON_RUN_AS_NODE QA365_OUT="$OUT" QA365_RUN_MS="${QA365_RUN_MS:-360000}" \
  electron scripts/qa365-two-records-loss.cjs "$URL" --no-sandbox
BROWSER_CODE=$?
set -e
echo "merge-level exit=$MERGE_CODE  browser exit=$BROWSER_CODE  out=$OUT"

if [ "$MERGE_CODE" -eq 1 ] || [ "$BROWSER_CODE" -eq 1 ]; then exit 1; fi
if [ "$MERGE_CODE" -eq 2 ] || [ "$BROWSER_CODE" -eq 2 ]; then exit 2; fi
exit 0
