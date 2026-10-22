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
# `adb input` takes SCREEN px, but getBoundingClientRect * dpr is WebView px:
# below a status bar the two differ by the WebView's top offset (CI 2026-10-22:
# a press landed 52 CSS px above the side it aimed at). Edge-to-edge WebView
# (its height * dpr is the screen's) -> 0; else the status bar's bottom from
# dumpsys; else the screen height minus the WebView's height.
VH=$(ev "Math.round(window.innerHeight * (window.devicePixelRatio || 1))")
if [ $((H - VH)) -lt 8 ]; then TOP=0; else
  TOP=$(adb shell dumpsys window | tr -d '\r' | grep -m1 -oE 'type=statusBars frame=\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | sed -E 's/.*\]\[[0-9]+,([0-9]+)\]$/\1/' || true)
  [ -n "$TOP" ] || TOP=$((H - VH))
fi
echo "screen ${W}x${H}, webview height ${VH}, top offset ${TOP}"
# Right of the revision cloud, inside the page on a Pixel 7 (the page ends
# near 74% of the screen height, so 3/4 missed it).
X=$((W * 3 / 4)); Y=$((H * 13 / 20))
( pick Polygon ) || { pick Shapes; pick Polygon; }
N0=$(ev "document.querySelectorAll('g[data-annotation-index]').length")
# Four corners, then a tap back on the first one closes the polygon.
for p in "$((X - 150)) $((Y - 170))" "$((X + 150)) $((Y - 170))" "$((X + 150)) $((Y - 30))" "$((X - 150)) $((Y - 30))" "$((X - 150)) $((Y - 170))"; do
  # A short press, not `tap`, and gaps longer than a double-tap so each
  # press lands as one point.
  set -- $p; adb shell input stylus swipe "$1" "$2" "$1" "$2" 120; sleep 1.2
done
sleep 1
# If the tap on the first corner did not close it, Enter finishes the draft.
if [ "$(ev "document.querySelectorAll('g[data-annotation-index]').length")" = "$N0" ]; then
  echo "draft still open; pressing Enter"
  ev "(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), 'ok')" >/dev/null; sleep 1.5
fi
N=$(ev "document.querySelectorAll('g[data-annotation-index]').length")
echo "annotations: $N0 -> $N"
[ "$N" = "$((N0 + 1))" ] || { echo "::error::Polygon was not committed"; adb exec-out screencap -p > "$OUT/15-delete-point.png"; exit 1; }
# A finished polygon is selected the instant it lands; select it only if not.
before=$(count)
echo "points right after drawing: $before"
if [ "$before" != "4" ]; then
pick "Rectangle Select"
bb=$(ev "(() => { const g = document.querySelector('g[data-annotation-index=\"$N0\"]'); const r = g.getBoundingClientRect(); const d = window.devicePixelRatio || 1; return [r.left, r.top, r.right, r.bottom].map(v => Math.round(v * d)).join(' '); })()")
echo "polygon box: $bb"
set -- $bb; L=$1; T=$(($2 + TOP)); R=$3; B=$(($4 + TOP))
adb shell input stylus swipe $((L - 60)) $((T - 60)) $((R + 60)) $((B + 60)) 600
sleep 1.5
before=$(count)
if [ "$before" != "4" ]; then
  echo "box-select got $before; tapping the top edge"
  adb shell input stylus swipe $(((L + R) / 2)) "$T" $(((L + R) / 2)) "$T" 80
  sleep 1.5
  before=$(count)
fi
fi
echo "points before: $before"
[ "$before" = "4" ] || { echo "::error::Polygon not selected with 4 points (got $before)"; adb exec-out screencap -p > "$OUT/15-delete-point.png"; exit 1; }
# Screen position of corner 2 (device px = CSS px * devicePixelRatio).
xy=$(ev "(() => { const c = document.querySelector('[data-poly-vertex-index=\"2\"]'); const r = c.getBoundingClientRect(); const d = window.devicePixelRatio || 1; return Math.round((r.left + r.width / 2) * d) + ' ' + Math.round((r.top + r.height / 2) * d); })()")
echo "corner 2 at: $xy"
set -- $xy; set -- "$1" "$(($2 + TOP))"
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
# #1115: long-press on a SIDE of the selected polygon opens "Add point here"
# (data-poly-vertex-insert). The side's midpoint holds the "Add vertex" handle
# ([data-add-vertex], stops propagation), so pick a spot along corner 0 -> 1
# that actually hits the side's hit stroke ([data-poly-edge-hit]).
before=$(count)
echo "points before add: $before"
[ "$before" = "3" ] || { echo "::error::Polygon not selected with 3 points after delete (got $before)"; adb exec-out screencap -p > "$OUT/19-add-point.png"; exit 1; }
xy=$(ev "(() => { const c = i => { const r = document.querySelector('[data-poly-vertex-index=\"' + i + '\"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }; const a = c(0), b = c(1); const d = window.devicePixelRatio || 1; for (const t of [0.3, 0.25, 0.35, 0.2, 0.4]) { const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; const el = document.elementFromPoint(x, y); if (el && el.closest('[data-poly-edge-hit]')) return Math.round(x * d) + ' ' + Math.round(y * d); } return 'none'; })()")
echo "side point at: $xy"
[ "$xy" != "none" ] || { echo "::error::No spot on side 0-1 hits the side (handles cover it)"; adb exec-out screencap -p > "$OUT/19-add-point.png"; exit 1; }
set -- $xy; set -- "$1" "$(($2 + TOP))"
ev "(() => { window.__pd = []; const log = n => e => window.__pd.push(n + ':' + e.pointerType + '@' + (e.target.getAttribute?.('data-poly-edge-hit') ? 'edge' : e.target.tagName + '.' + (e.target.getAttribute?.('class') || '').slice(0, 30))); ['pointerdown', 'pointerup', 'pointercancel', 'contextmenu'].forEach(t => document.addEventListener(t, log(t), true)); return 'ok'; })()" >/dev/null
# The Polygon tool is still armed and its layer (svg.tool-crosshair) takes
# the stylus on the side; a finger is ignored in Pen mode. So go to the
# select tool first, as a user would.
( pick Select ) || ( pick "Rectangle Select" ) || true
echo "points after picking select: $(count)"
ev "(() => { try { localStorage.setItem('debugPolyEdge', '1'); } catch {} window.__polyEdgeLog = []; return 'ok'; })()" >/dev/null
adb shell input stylus swipe "$1" "$2" "$1" "$2" 900
sleep 1
r=$(ev "(() => { const b = document.querySelector('[data-poly-vertex-insert]'); if (!b) return 'no menu'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()")
echo "add point: $r"
sleep 1.5
adb exec-out screencap -p > "$OUT/19-add-point.png"
[ "$r" = "ok" ] || { echo "::error::Long-press on side did not open Add point here ($r) at $xy; events: $(ev "(window.__pd || []).join(' , ')"); menu items: $(ev "[...document.querySelectorAll('[role=menuitem]')].map(e => e.textContent.trim()).join(' | ') || 'none'")"; exit 1; }
after=$(count)
echo "points after add: $after"
[ "$after" = "$((before + 1))" ] || { echo "::error::Point count $before -> $after, expected $((before + 1))"; echo "polyEdge log: $(ev "JSON.stringify((window.__polyEdgeLog || []).slice(-60))")"; echo "events: $(ev "(window.__pd || []).join(' , ')")"; exit 1; }
echo "Add point check passed."
