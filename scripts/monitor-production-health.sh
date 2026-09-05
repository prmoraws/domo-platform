#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_SCRIPT="$ROOT_DIR/scripts/check-production-health.sh"
LOG_DIR="$ROOT_DIR/var/log"
LOG_FILE="$LOG_DIR/health-monitor.log"

mkdir -p "$LOG_DIR"

TMP_FILE="$(mktemp)"

if "$HEALTH_SCRIPT" >"$TMP_FILE" 2>&1; then
  rm -f "$TMP_FILE"
  exit 0
fi

{
  echo
  echo "============================================================"
  echo "DOMO HEALTH FAILURE"
  date --iso-8601=seconds
  echo "============================================================"
  cat "$TMP_FILE"
} >> "$LOG_FILE"

rm -f "$TMP_FILE"

exit 1
