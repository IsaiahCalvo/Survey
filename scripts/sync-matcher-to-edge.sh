#!/usr/bin/env bash
#
# sync-matcher-to-edge.sh — KAL-309 guarded-copy mechanism (PLAN-KAL309 §C, F14/F15).
#
# Deno Edge Functions are isolated module contexts; importing the matcher from
# `../../../src/services/*.js` is not reliably resolvable at deploy time. So the six
# pure matcher/token ESM modules are COPIED byte-for-byte into
# `supabase/functions/_shared/matcher/`, keeping their .js extensions and the
# relative `./foo.js` imports between them intact (they only import each other).
#
# This script is the ONLY sanctioned way to refresh that copy. After running it,
# `tests/edgeMatcherDrift.test.mjs` (wired into scripts/run-node-tests.mjs) fails the
# whole suite if the copy ever drifts from src/services/*. Never hand-edit the copy.
#
# Usage:  bash scripts/sync-matcher-to-edge.sh        # refresh the copy
#         bash scripts/sync-matcher-to-edge.sh --check # exit 1 if a refresh is needed
set -euo pipefail

# Resolve the repo root from this script's location so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SRC="$ROOT/src/services"
DST="$ROOT/supabase/functions/_shared/matcher"

# The six modules the Edge matcher needs, in dependency order (informational only —
# cp does not care). rowIdToken + rowFingerprint are leaves; the rest import them.
FILES=(
  rowIdToken
  rowFingerprint
  excelConflictDetect
  excelIdentityRecord
  rowImportMatcher
  buildScopeImportPlans
)

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK=1
fi

if [[ "$CHECK" -eq 1 ]]; then
  status=0
  for f in "${FILES[@]}"; do
    if [[ ! -f "$DST/$f.js" ]] || ! cmp -s "$SRC/$f.js" "$DST/$f.js"; then
      echo "DRIFT: $f.js differs from src/services (run: bash scripts/sync-matcher-to-edge.sh)" >&2
      status=1
    fi
  done
  exit "$status"
fi

mkdir -p "$DST"
for f in "${FILES[@]}"; do
  cp "$SRC/$f.js" "$DST/$f.js"
done

echo "Synced ${#FILES[@]} matcher modules → supabase/functions/_shared/matcher/"
