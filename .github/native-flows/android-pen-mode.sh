#!/usr/bin/env bash
# Pen vs finger on the Android app (PR #959 rule): a finger alone keeps
# "Pencil or Touch"; the first stylus press on the page flips to "Pencil only".
# Runs after android-signed-in.yaml left a document open.
set -euo pipefail
OUT="$1"; KEY=surveyDrawMode
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
read_mode() { node .github/native-flows/webview-storage.mjs "$KEY"; }
W=$(adb shell wm size | sed 's/.*: //;s/x.*//' | tr -d '\r'); H=$(adb shell wm size | sed 's/.*x//' | tr -d '\r')
X=$((W / 2)); Y=$((H / 2))
adb shell input touchscreen swipe $X $Y $((X + 150)) $((Y + 150)) 300
sleep 2
after_finger=$(read_mode); echo "after finger: $after_finger"
[ "$after_finger" = "null" ] || { echo "::error::a finger changed the draw mode ($after_finger)"; exit 1; }
adb shell input stylus swipe $X $Y $((X + 150)) $((Y - 150)) 300
sleep 2
adb exec-out screencap -p > "$OUT/07-after-stylus.png"
after_pen=$(read_mode); echo "after stylus: $after_pen"
[ "$after_pen" = "pen" ] || { echo "::error::first stylus press did not switch to Pencil only ($after_pen)"; exit 1; }
echo "Pen mode check passed."
