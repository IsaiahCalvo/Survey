#!/usr/bin/env bash
# The whole Android signed-in walk, run inside android-emulator-runner.
# Usage: android-signed-in-walk.sh <output dir>
#
# The CI emulator process sometimes dies mid-walk (adb "error: closed", then
# "could not connect to TCP port 5554"), most often ~35 s after the Arrow or
# Counter stylus input. When a step fails and the emulator is gone, this writes
# <output dir>/emulator-lost so the workflow can rerun the walk once on a fresh
# emulator. A failed check on a live emulator does not write it, so real
# failures still fail. walk-started tells the workflow the emulator booted and
# this script ran at all (a broken SDK download fails before that).
set -uo pipefail
OUT="$1"
mkdir -p "$OUT"
touch "$OUT/walk-started"

# Keep a live device log and a host load log, so a crash leaves a trail (the
# device cannot be asked for its log once the emulator is gone).
adb logcat -v time > "$OUT/logcat-live.txt" 2>&1 &
( while sleep 3; do
    echo "== $(date +%T) $(cut -d' ' -f1-3 /proc/loadavg) mem_avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)MB"
    ps -o pid=,stat=,rss=,pcpu=,etime=,comm= -p "$(pgrep -d, -f qemu-system || echo 1)" 2>/dev/null
  done ) > "$OUT/host-watch.txt" 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null' EXIT

fail() {
  echo "::error::$1 failed"
  if timeout 15 adb shell true >/dev/null 2>&1; then
    timeout 30 adb logcat -d > "$OUT/logcat.txt"
  else
    echo "::warning::the emulator is gone (adb cannot reach it); this is a CI emulator crash, not an app failure"
    touch "$OUT/emulator-lost"
  fi
  exit 1
}

adb reverse tcp:54421 tcp:54421 || fail "adb reverse"
# A slow CI emulator pops "Pixel Launcher isn't responding" over the app.
adb shell settings put global hide_error_dialogs 1
adb install -r android/app/build/outputs/apk/debug/app-debug.apk || fail "install"
# Editor first, then wipe the app so the owner signs in fresh.
timeout 400 bash .github/native-flows/android-editor-project-menu.sh "$OUT" || fail "editor project menu"
adb shell pm clear com.kalvoe.survey || fail "pm clear"
maestro test --format junit --output "$OUT/report.xml" --test-output-dir "$OUT" .github/native-flows/android-signed-in.yaml || fail "signed-in flow"
for step in pen-mode counter-after-arrow delete-point snap voice-mic undo-toast-check; do
  timeout 300 bash ".github/native-flows/android-$step.sh" "$OUT" || fail "$step"
done
adb reverse --remove-all
maestro test --format junit --output "$OUT/report-offline.xml" --test-output-dir "$OUT" .github/native-flows/android-offline-relaunch.yaml || fail "offline relaunch"
timeout 300 bash .github/native-flows/android-pdf-tools-offline.sh "$OUT" || fail "pdf tools offline"
echo "Android signed-in walk passed."
