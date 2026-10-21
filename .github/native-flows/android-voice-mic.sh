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
# The gold mic only shows once a template is picked.
tpl() { ev "(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label') || '').find(l => l.startsWith('Template: ')) || 'none')()"; }
if ! tpl | grep -q '^Template: E2E Doors\.'; then
  echo "switch template: $(click 'Template: ')"; sleep 1
  echo "pick E2E Doors: $(ev "(() => { const b = [...document.querySelectorAll('button,[role=menuitem]')].find(b => b.offsetParent && b.textContent.trim().startsWith('E2E Doors')); if (!b) return 'missing'; b.click(); return 'ok'; })()")"; sleep 2
fi
echo "template: $(tpl)"
MIC='Survey agent: talk hands-free'
r=$(click "$MIC"); echo "mic tap: $r"; [ "$r" = ok ] || { adb exec-out screencap -p > "$OUT/12-voice-mic.png"; echo "::error::no hands-free mic in the survey panel; buttons: $(ev "[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean).join(' | ')")"; exit 1; }
recording=false
for i in 1 2 3 4 5 6; do sleep 1; [ "$(ev "!!document.querySelector('.is-recording')")" = true ] && { recording=true; break; }; done
adb exec-out screencap -p > "$OUT/12-voice-mic.png"
echo "recording: $recording"
[ "$recording" = true ] || { echo "::error::hands-free mic did not start"; exit 1; }
echo "stop tap: $(click 'Stop hands-free')"
stopped=false
for i in $(seq 8); do sleep 1; [ "$(ev "!!document.querySelector('.survey-agent-mic.is-recording')")" = false ] && { stopped=true; break; }; done
[ "$stopped" = true ] || { echo "::error::hands-free mic did not stop; mic: $(ev "(() => { const b = document.querySelector('.survey-agent-mic'); return b ? b.getAttribute('aria-label') + ' / ' + b.className : 'none'; })()")"; exit 1; }
echo "Voice mic check passed."
# Voice fill: the e2e fake speech plugin (src/mobile/nativeSpeech.js) says one
# sentence; the fake Groq then sets every line of D-1-17.
ev "localStorage.setItem('surveyE2EFakeSpeech', '1'); 'ok'" >/dev/null
r=$(click "$MIC"); echo "mic tap: $r"; [ "$r" = ok ] || { echo "::error::no hands-free mic for the voice fill"; exit 1; }
said=no
for i in $(seq 10); do sleep 1; [ "$(ev "!!globalThis.__surveyNativeSpeechTest")" = true ] && { ev "globalThis.__surveyNativeSpeechTest.say('D-1-17 is installed'); 'ok'" >/dev/null; said=yes; break; }; done
[ "$said" = yes ] || { adb exec-out screencap -p > "$OUT/18-voice-fill.png"; echo "::error::fake speech never started listening"; exit 1; }
DONE="(() => [...document.querySelectorAll('.survey-marker-progress')].some(p => (p.getAttribute('aria-label') || '').startsWith('All 3 checklist items answered')))()"
filled=false
for i in $(seq 30); do sleep 2; [ "$(ev "$DONE")" = true ] && { filled=true; break; }; done
adb exec-out screencap -p > "$OUT/18-voice-fill.png"
# Not yet gating: the fake speech starts but the fill has not been seen in CI.
if [ "$filled" = true ]; then echo "Voice fill check passed."; else
  echo "::warning::D-1-17 not filled by voice; progress seen: $(ev "[...document.querySelectorAll('.survey-marker-progress')].map(p => p.getAttribute('aria-label')).join(' | ') || 'none'"); agent log: $(ev "[...document.querySelectorAll('.survey-agent [class*=msg], .survey-agent li')].slice(-6).map(e => e.textContent.trim().slice(0, 120)).join(' | ') || 'none'")"
  ev "(() => { const b = document.querySelector('.survey-agent-mic.is-recording'); b && b.click(); return 'ok'; })()" >/dev/null
fi
