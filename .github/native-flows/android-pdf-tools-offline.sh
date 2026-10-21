#!/usr/bin/env bash
# PDF tools with no network (#1029): run after android-offline-relaunch.yaml,
# with adb reverse removed so the local API is gone. Opens the cached sample
# drawing, rotates it, checks Save fails with the offline message, downloads
# (share sheet), then compresses and downloads again. Usage: <script> OUT_DIR
set -euo pipefail
OUT="$1"
maestro test --test-output-dir "$OUT" .github/native-flows/android-pdf-tools-offline.yaml
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
# Click a button by its label in the web view. Lists labels on a miss.
pick() {
  r=$(ev "(() => { const want = '$1'; const bs = [...document.querySelectorAll('button,[role=button],[role=menuitem]')].filter(b => b.offsetParent && !b.disabled); const name = b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim(); const b = bs.find(b => name(b) === want) || bs.find(b => name(b).startsWith(want)); if (!b) return 'missing: ' + bs.map(name).filter(Boolean).join(' | '); b.click(); return 'ok'; })()")
  echo "pick $1: $r"; [ "$r" = "ok" ] || exit 1; sleep 1
}
# Wait up to $2 seconds for an enabled button whose label starts with $1.
wait_button() {
  for _ in $(seq 1 "$2"); do
    r=$(ev "(() => [...document.querySelectorAll('button')].some(b => b.offsetParent && !b.disabled && (b.getAttribute('aria-label') || b.textContent || '').trim().startsWith('$1')) ? 'yes' : 'no')()")
    [ "$r" = "yes" ] && return 0; sleep 1
  done
  echo "dialog: $(ev "(() => (document.querySelector('.pdft-card')?.innerText || 'no dialog').replace(/\\s+/g, ' ').slice(0, 400))()")"
  echo "::error::no '$1' button after $2s"; adb exec-out screencap -p > "$OUT/pdf-tools-stuck.png"; exit 1
}
# Download hands the file to Android's share sheet; check it shows, then close it.
share_sheet() {
  for _ in $(seq 1 20); do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
    if adb shell cat /sdcard/ui.xml | grep -Eq 'text="[^"]*(Share|share|Copy|Nearby|Drive)[^"]*"'; then
      adb exec-out screencap -p > "$OUT/$1.png"
      adb shell input keyevent KEYCODE_BACK; sleep 2; return 0
    fi
    sleep 1
  done
  adb exec-out screencap -p > "$OUT/$1-missing.png"
  echo "::error::no share sheet after Download ($1)"; exit 1
}
open_tools() {
  pick "More document options"
  pick "PDF tools"
  wait_button "Rotate pages" 20
}

open_tools
pick "Rotate pages"
wait_button "Turn every page" 60
pick "Turn every page"
pick "Run"
wait_button "Save as new document" 120
adb exec-out screencap -p > "$OUT/21-offline-rotated.png"
pick "Save as new document"
for _ in $(seq 1 30); do
  msg=$(ev "(() => document.querySelector('.pdft-error')?.textContent || '')()")
  [ -n "$msg" ] && break; sleep 1
done
echo "save offline: $msg"
case "$msg" in *"Not saved. Download it instead"*) ;; *) echo "::error::Save offline did not say 'Not saved. Download it instead' ($msg)"; exit 1 ;; esac
adb exec-out screencap -p > "$OUT/22-offline-save-refused.png"
pick "Download"
share_sheet 23-offline-rotate-share
pick "Close"
open_tools
pick "Compress"
pick "Run"
wait_button "Download" 120
adb exec-out screencap -p > "$OUT/24-offline-compressed.png"
pick "Download"
share_sheet 25-offline-compress-share
echo "Offline PDF tools check passed."
