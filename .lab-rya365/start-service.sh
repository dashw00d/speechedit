#!/usr/bin/env bash
# RYA-365 isolated SpeechEdit service for the non-overlapping re-record merge
# regression. Own port + own review dir + own whisper cache. Never share these
# with 3361/3362 (discovery), 3363 (bh333), 3364 (RYA-340), 3365 (RYA-351),
# 3366 (RYA-354) or 3376/3377 (Astra).
# Usage: start-service.sh <port> <lab-dir>
set -euo pipefail
PORT="${1:?usage: start-service.sh <port> <lab-dir>}"
DIR="${2:?usage: start-service.sh <port> <lab-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/home/ryan/.nvm/versions/node/v25.9.0/bin:$PATH"
mkdir -p "$DIR/reviews" "$DIR/whisper"
cd "$ROOT"
echo "SpeechEdit RYA-365 lab service: root=$ROOT port=$PORT reviewDir=$DIR/reviews"
exec env HOST=127.0.0.1 PORT="$PORT" \
  SPEECHEDIT_REVIEW_DIR="$DIR/reviews" \
  SPEECHEDIT_WEB_ROOT="$ROOT/src/renderer/dist" \
  SPEECHEDIT_CACHE_DIR="$DIR/whisper" \
  bun scripts/web-server.ts
