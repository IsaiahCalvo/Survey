#!/usr/bin/env bash
# Survey agent hands-free in the Android app (#1058): open the survey panel,
# tap the gold mic, check it records, tap again, check it stops. The emulator
# has no real voice, so this proves the permission and on/off path only.
# Uses the seeded agent drawing (#1090); the fake Groq would fill D-1-17 from
# any speech, which needs a mic feed the CI emulator does not have yet.
set -euo pipefail
OUT="$1"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
adb shell pm grant com.kalvoe.survey android.permission.RECORD_AUDIO
maestro test --test-output-dir "$OUT" .github/native-flows/android-open-agent-drawing.yaml
# The page reloaded, so point the devtools forward at the web view again.
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
sleep 3
click() { ev "(() => { const b = [...document.querySelectorAll('button,[role=button]')].find(b => b.offsetParent && (b.getAttribute('aria-label') || '').startsWith('$1')); if (!b) return 'missing'; b.click(); return 'ok'; })()"; }
echo "open survey: $(click 'Open survey')"; sleep 2
MIC='Survey agent: talk hands-free'
r=$(click "$MIC"); echo "mic tap: $r"; [ "$r" = ok ] || { adb exec-out screencap -p > "$OUT/12-voice-mic.png"; echo "::error::no hands-free mic in the survey panel"; exit 1; }
recording=false
for i in 1 2 3 4 5 6; do sleep 1; [ "$(ev "!!document.querySelector('.is-recording')")" = true ] && { recording=true; break; }; done
adb exec-out screencap -p > "$OUT/12-voice-mic.png"
echo "recording: $recording"
[ "$recording" = true ] || { echo "::error::hands-free mic did not start"; exit 1; }
ev "(() => { const b = document.querySelector('.is-recording'); b && b.click(); return 'ok'; })()" >/dev/null
sleep 2
[ "$(ev "!!document.querySelector('.is-recording')")" = false ] || { echo "::error::hands-free mic did not stop"; exit 1; }
echo "Voice mic check passed."
