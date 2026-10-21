#!/usr/bin/env bash
# #1002: a Counter placed right after an Arrow must be a full numbered marker,
# not a dot sized by the arrow's line width. Runs after android-pen-mode.sh
# (draw mode is Pencil only, so page input goes through the stylus).
set -euo pipefail
OUT="$1"
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
# Click a toolbar button by its label in the web view (the rail buttons are
# icon-only, so Maestro cannot always see their names). Lists labels on a miss.
pick() {
  r=$(ev "(() => { const want = '$1'; const bs = [...document.querySelectorAll('button,[role=button],[role=menuitem]')].filter(b => b.offsetParent); const name = b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim(); const b = bs.find(b => name(b) === want) || bs.find(b => name(b).startsWith(want)); if (!b) return 'missing: ' + bs.map(name).filter(Boolean).join(' | '); b.click(); return 'ok'; })()")
  echo "pick $1: $r"; [ "$r" = "ok" ] || exit 1; sleep 1
}
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
size=$(ev "(() => { const g = [...document.querySelectorAll('g[data-annotation-index]')].filter(g => { const t = g.querySelector('text'); return t && /^[0-9]+$/.test((t.textContent || '').trim()); }).pop(); if (!g) return 'none'; const r = g.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); })()")
echo "counter size after arrow: ${size}px"
[ "$size" != "none" ] && [ "$size" -ge 12 ] || { echo "::error::Counter after Arrow is not a full marker (${size}px)"; exit 1; }
echo "Counter check passed."
