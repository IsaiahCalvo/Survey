#!/usr/bin/env bash
# #1092: long-press on a selected polygon's corner opens a "Delete point" menu
# (SVGAnnotationLayer onVertexPointerDown: touch/pen held 500 ms without moving
# >8 px); deleting drops one point. Runs after android-pen-mode.sh (draw mode is
# Pencil only, so page input goes through the stylus).
set -euo pipefail
OUT="$1"
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
pick() {
  r=$(ev "(() => { const want = '$1'; const bs = [...document.querySelectorAll('button,[role=button],[role=menuitem]')].filter(b => b.offsetParent); const name = b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim(); const b = bs.find(b => name(b) === want) || bs.find(b => name(b).startsWith(want)); if (!b) return 'missing: ' + bs.map(name).filter(Boolean).join(' | '); b.click(); return 'ok'; })()")
  echo "pick $1: $r"; [ "$r" = "ok" ] || exit 1; sleep 1
}
# Distinct corner indices of the selected poly (only rendered while selected).
count() { ev "new Set([...document.querySelectorAll('[data-poly-vertex-index]')].map(e => e.getAttribute('data-poly-vertex-index'))).size"; }
W=$(adb shell wm size | sed 's/.*: //;s/x.*//' | tr -d '\r'); H=$(adb shell wm size | sed 's/.*x//' | tr -d '\r')
X=$((W / 2)); Y=$((H * 3 / 4))
( pick Polygon ) || { pick Shapes; pick Polygon; }
# Four corners, then a tap back on the first one closes the polygon.
for p in "$((X - 150)) $((Y - 100))" "$((X + 150)) $((Y - 100))" "$((X + 150)) $((Y + 100))" "$((X - 150)) $((Y + 100))" "$((X - 150)) $((Y - 100))"; do
  adb shell input stylus tap $p; sleep 0.6
done
sleep 1
pick Select
adb shell input stylus tap "$X" $((Y - 100))   # top edge midpoint
sleep 1.5
before=$(count)
echo "points before: $before"
[ "$before" = "4" ] || { echo "::error::Polygon not selected with 4 points (got $before)"; adb exec-out screencap -p > "$OUT/15-delete-point.png"; exit 1; }
# Screen position of corner 2 (device px = CSS px * devicePixelRatio).
xy=$(ev "(() => { const c = document.querySelector('[data-poly-vertex-index=\"2\"]'); const r = c.getBoundingClientRect(); const d = window.devicePixelRatio || 1; return Math.round((r.left + r.width / 2) * d) + ' ' + Math.round((r.top + r.height / 2) * d); })()")
echo "corner 2 at: $xy"
set -- $xy
adb shell input stylus swipe "$1" "$2" "$1" "$2" 900
sleep 1
r=$(ev "(() => { const b = document.querySelector('[data-poly-vertex-delete]'); if (!b) return 'no menu'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()")
echo "delete point: $r"
sleep 1.5
adb exec-out screencap -p > "$OUT/15-delete-point.png"
[ "$r" = "ok" ] || { echo "::error::Long-press did not open an enabled Delete point menu ($r)"; exit 1; }
after=$(count)
echo "points after: $after"
[ "$after" = "$((before - 1))" ] || { echo "::error::Point count $before -> $after, expected $((before - 1))"; exit 1; }
echo "Delete point check passed."
