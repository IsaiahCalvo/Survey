#!/usr/bin/env bash
# #1118 / #1122: on touch or pen, a line end snaps onto another line end or a
# polygon corner within 14 screen px (snap ring r 16), and a line / arrow drag
# within 5 degrees of a 45-degree step locks onto it (drawSnap.js
# drawSnapEventOptions; mouse keeps 8 px and Shift-only angles). Both apply
# only to pointerType touch/pen and only while annotation snapping is on (the
# default; Alt or the snapping preference off turns the endpoint pull off).
# Runs after android-pen-mode.sh: draw mode is "Pencil only", so page input
# goes through the stylus (a finger is ignored).
set -euo pipefail
OUT="$1"
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
pick() {
  r=$(ev "(() => { const want = '$1'; const bs = [...document.querySelectorAll('button,[role=button],[role=menuitem]')].filter(b => b.offsetParent); const name = b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim(); const b = bs.find(b => name(b) === want) || bs.find(b => name(b).startsWith(want)); if (!b) return 'missing: ' + bs.map(name).filter(Boolean).join(' | '); b.click(); return 'ok'; })()")
  echo "pick $1: $r"; [ "$r" = "ok" ] || exit 1; sleep 1
}
count() { ev "document.querySelectorAll('g[data-annotation-index]').length"; }
shot() { adb exec-out screencap -p > "$OUT/26-snap.png"; }
fail() { echo "::error::$1"; shot; exit 1; }
# Indices of all annotation wrappers, comma separated.
indices() { ev "[...document.querySelectorAll('g[data-annotation-index]')].map(g => g.getAttribute('data-annotation-index')).join(',')"; }
# The index that is in the current set but not in $1.
newidx() { ev "(() => { const old = new Set('$1'.split(',')); const n = [...document.querySelectorAll('g[data-annotation-index]')].map(g => g.getAttribute('data-annotation-index')).filter(i => !old.has(i)); return n.length === 1 ? n[0] : 'none:' + n.join(','); })()"; }
# A committed straight line renders as a visible <line x1 y1 x2 y2> (page
# units, svgAnnotationRenderers renderLine) inside g[data-annotation-index];
# hit bands use stroke="transparent". Prints "x1 y1 x2 y2" in page units.
ends() { ev "(() => { const g = document.querySelector('g[data-annotation-index=\"$1\"]'); const l = g && [...g.querySelectorAll('line')].find(l => l.getAttribute('stroke') !== 'transparent'); if (!l) return 'none'; return ['x1', 'y1', 'x2', 'y2'].map(a => (+l.getAttribute(a)).toFixed(3)).join(' '); })()"; }
# Device px of the line's end point $2 (1 or 2) via its screen CTM
# (device px = CSS px * devicePixelRatio).
endpx() { ev "(() => { const g = document.querySelector('g[data-annotation-index=\"$1\"]'); const l = [...g.querySelectorAll('line')].find(l => l.getAttribute('stroke') !== 'transparent'); const m = l.getScreenCTM(); const p = new DOMPoint(+l.getAttribute('x$2'), +l.getAttribute('y$2')).matrixTransform(m); const d = window.devicePixelRatio || 1; return Math.round(p.x * d) + ' ' + Math.round(p.y * d); })()"; }
# Draw one line with the stylus and echo the new annotation's index.
draw() {
  local before; before=$(indices)
  adb shell input stylus swipe "$1" "$2" "$3" "$4" 300; sleep 1.5
  local n; n=$(newidx "$before")
  # The first press after another flow can just clear the old selection.
  case "$n" in none*) adb shell input stylus swipe "$1" "$2" "$3" "$4" 300; sleep 1.5; n=$(newidx "$before");; esac
  echo "$n"
}
W=$(adb shell wm size | sed 's/.*: //;s/x.*//' | tr -d '\r'); H=$(adb shell wm size | sed 's/.*x//' | tr -d '\r')
# Upper-middle of the page: the page ends near 74% of the screen height and
# earlier flows left marks near 65% on the right.
( pick Line ) || { pick Shapes; pick Line; }
# Line A: a horizontal-ish drag (0 degrees is itself a 45-degree step).
A=$(draw $((W * 3 / 10)) $((H * 52 / 100)) $((W * 6 / 10)) $((H * 52 / 100)))
echo "line A index: $A"
case "$A" in none*) fail "Line A was not committed ($A)";; esac
EA=$(ends "$A"); echo "line A ends (page): $EA"
[ "$EA" != "none" ] || fail "Line A has no visible <line> element"
AE=$(endpx "$A" 2); echo "line A end (device px): $AE"
set -- $AE
# The tool stays armed after a draw, so line B is just another drag. Start
# ~8 device px off A's end (well under 14 CSS px on any DPR >= 1); end at a
# free angle (~62 degrees) so the assist does not matter for B.
BX=$(($1 + 6)); BY=$(($2 + 5))
B=$(draw "$BX" "$BY" $((W * 3 / 4)) $((H * 48 / 100)))
echo "line B index: $B"
case "$B" in none*) fail "Line B was not committed ($B)";; esac
EB=$(ends "$B"); echo "line B ends (page): $EB"
[ "$EB" != "none" ] || fail "Line B has no visible <line> element"
ok=$(node -e "const a = process.argv[1].split(' ').map(Number), b = process.argv[2].split(' ').map(Number); const dx = b[0] - a[2], dy = b[1] - a[3]; console.log(Math.hypot(dx, dy) <= 0.5 ? 'ok' : 'off by ' + dx.toFixed(3) + ',' + dy.toFixed(3))" "$EA" "$EB")
echo "B start vs A end: $ok"
[ "$ok" = "ok" ] || fail "Line B start ($EB) did not snap to line A end ($EA): $ok page units (started 6,5 device px off)"
# Line C: 300 device px at 42 degrees (3 off 45), up and to the right, far
# from A and B's ends so no endpoint pull applies.
CX=$((W * 25 / 100)); CY=$((H * 58 / 100))
read -r DX DY < <(node -e "const r = 42 * Math.PI / 180; console.log(Math.round(300 * Math.cos(r)), Math.round(300 * Math.sin(r)))")
C=$(draw "$CX" "$CY" $((CX + DX)) $((CY - DY)))
echo "line C index: $C"
case "$C" in none*) fail "Line C was not committed ($C)";; esac
EC=$(ends "$C"); echo "line C ends (page): $EC"
[ "$EC" != "none" ] || fail "Line C has no visible <line> element"
ang=$(node -e "const c = process.argv[1].split(' ').map(Number); console.log((Math.atan2(Math.abs(c[3] - c[1]), Math.abs(c[2] - c[0])) * 180 / Math.PI).toFixed(3))" "$EC")
echo "line C angle: $ang (drawn at 42)"
shot
node -e "process.exit(Math.abs(+process.argv[1] - 45) <= 0.5 ? 0 : 1)" "$ang" || { echo "::error::Line C angle $ang, expected 45 +/- 0.5 (drawn at 42)"; exit 1; }
echo "Snap check passed."
