#!/usr/bin/env bash
# #1002: a Counter placed right after an Arrow must be a full numbered marker,
# not a dot sized by the arrow's line width. Runs after android-pen-mode.sh
# (draw mode is Pencil only, so page input goes through the stylus).
set -euo pipefail
OUT="$1"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
pick() { maestro test -e TOOL="$1" .github/native-flows/android-pick-tool.yaml >/dev/null; }
W=$(adb shell wm size | sed 's/.*: //;s/x.*//' | tr -d '\r'); H=$(adb shell wm size | sed 's/.*x//' | tr -d '\r')
X=$((W / 2)); Y=$((H / 2))
pick Shapes
pick Arrow
adb shell input stylus swipe $((X - 120)) $((Y + 200)) $((X + 60)) $((Y + 40)) 300
sleep 1
pick Counter
adb shell input stylus tap $((X - 100)) $((Y - 200))
sleep 2
adb exec-out screencap -p > "$OUT/08-counter-after-arrow.png"
size=$(ev "(() => { const g = [...document.querySelectorAll('g[data-annotation-index]')].pop(); if (!g) return 'none'; const r = g.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); })()")
echo "counter size after arrow: ${size}px"
[ "$size" != "none" ] && [ "$size" -ge 12 ] || { echo "::error::Counter after Arrow is not a full marker (${size}px)"; exit 1; }
echo "Counter check passed."
