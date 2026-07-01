#!/usr/bin/env bash
# agent-cli/full-e2e.sh — the Phase-B per-step e2e gate.
#
# Runs the full reliable e2e suite (existing green gates + the 4 new engine guards),
# warm-retrying each (the ~1.5MB viewer JIT-compiles on first open after a build, so a
# first run can false-fail). Exits non-zero if any test still fails after 3 warm attempts.
#
# Requires a dev server on APP_URL (default http://localhost:5186). Backend node scripts
# self-load .env/.env.local. macOS has no GNU `timeout`, so a portable watchdog is used.
#
#   APP_URL=http://localhost:5186 bash agent-cli/full-e2e.sh
#
# Excluded (pre-existing drift/obsolete — see debug/defragilize/A1-COVERAGE.md):
#   survey-roundtrip.mjs (obsolete API), version-history-e2e.mjs (spotlight-glow drift),
#   regress-idle-disappearance.mjs ('Select Template' flow removed).
set -uo pipefail
export APP_URL="${APP_URL:-http://localhost:5186}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || exit 99
LOGDIR="${FULL_E2E_LOGDIR:-/tmp/full-e2e-logs}"
mkdir -p "$LOGDIR"

run_to() { # run_to <secs> <logfile> <cmd...>
  local secs=$1 log=$2; shift 2
  ( "$@" > "$log" 2>&1 ) & local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL "$pid" 2>/dev/null ) & local watcher=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
  return $rc
}

# Gate scripts (none need CLI args — survey-marker-roundtrip uses its default doc).
TESTS=(
  "render-smoke.mjs"
  "callout-e2e.mjs"
  "callout-interaction-e2e.mjs"
  "roundtrip-save-reopen.mjs"
  "reupload-survival.mjs"
  "yjs-roundtrip.mjs"
  "excel-corruption-e2e.mjs"
  "import-once-roundtrip.mjs"
  "repro-sleep-wake.mjs"
  "lock-document-e2e.mjs"
  "undo-redo-e2e.mjs"
  "spaces-crud-e2e.mjs"
  "form-field-persistence-e2e.mjs"
  "survey-marker-roundtrip-e2e.mjs"
)

declare -a RESULTS
FAILS=0
for script in "${TESTS[@]}"; do
  log="$LOGDIR/${script%.mjs}.log"
  ok=0
  for attempt in 1 2 3; do
    if run_to 220 "$log" node "agent-cli/$script"; then ok=1; break; fi
    echo "  [$script] attempt $attempt failed; warm-retry..." >&2
    sleep 4
  done
  if [ "$ok" = 1 ]; then RESULTS+=("PASS  $script"); else RESULTS+=("FAIL  $script  (log: $log)"); FAILS=$((FAILS+1)); fi
  echo "  done: $script -> $([ "$ok" = 1 ] && echo PASS || echo FAIL)" >&2
done

echo ""
echo "======== FULL E2E SUMMARY ========"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "======== ${FAILS} fail(s) / ${#TESTS[@]} total ========"
exit "$FAILS"
