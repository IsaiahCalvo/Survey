#!/usr/bin/env bash
# #1098: the project-archive Undo toast must sit fully on screen, clear of the
# safe-area insets and of the phone's bottom tab bar (.mobile-home-tabs).
# Runs android-undo-toast.yaml in two parts: part A (up to the toast), then a
# web-view check of the toast's box, then a tap on Undo in the web view (the
# toast lives only 5 s, too short to start Maestro again), then part B (the
# project is listed again).
set -euo pipefail
OUT="$1"
FLOW=.github/native-flows/android-undo-toast.yaml
TMP=$(mktemp -d)
# Header (appId/name/---) goes into both parts.
awk '/^---$/{print; exit} {print}' "$FLOW" > "$TMP/head.yaml"
cp "$TMP/head.yaml" "$TMP/a.yaml"; cp "$TMP/head.yaml" "$TMP/b.yaml"
awk 'f&&/^# --- split: toast up ---/{exit} f{print} /^---$/{f=1}' "$FLOW" >> "$TMP/a.yaml"
awk 'f{print} /^# --- split: after undo ---/{f=1}' "$FLOW" >> "$TMP/b.yaml"
maestro test --test-output-dir "$OUT" "$TMP/a.yaml"
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
r=$(ev "(() => {
  const t = [...document.querySelectorAll('.undo-toast')].find(e => e.offsetParent || getComputedStyle(e).position === 'fixed');
  if (!t) return 'FAIL no .undo-toast in the page';
  const b = t.getBoundingClientRect();
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const ins = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  p.remove();
  // The native shell may pass the inset as a CSS var instead of env().
  const nb = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--native-safe-area-bottom')) || 0;
  ins.bottom = Math.max(ins.bottom, nb);
  const vw = window.innerWidth, vh = window.innerHeight;
  const why = [];
  if (b.left < ins.left || b.top < ins.top) why.push('past top/left inset');
  if (b.right > vw - ins.right) why.push('past right edge/inset');
  if (b.bottom > vh - ins.bottom) why.push('past bottom edge/inset');
  const bar = [...document.querySelectorAll('.mobile-home-tabs')].find(e => e.offsetParent || getComputedStyle(e).display !== 'none');
  let barTop = null;
  if (bar) { const r = bar.getBoundingClientRect(); if (r.height > 0) { barTop = Math.round(r.top); if (b.bottom > r.top) why.push('overlaps tab bar'); } }
  const info = 'toast ' + [b.left, b.top, b.right, b.bottom].map(Math.round).join(',') + ' viewport ' + vw + 'x' + vh + ' insets ' + JSON.stringify(ins) + ' tabbarTop ' + barTop;
  return (why.length ? 'FAIL ' + why.join('; ') + ' | ' : 'ok | ') + info;
})()")
echo "undo toast: $r"
case "$r" in ok*) ;; *) echo "::error::Undo toast placement: $r"; exit 1 ;; esac
u=$(ev "(() => { const b = document.querySelector('.undo-toast .undo-toast__action'); if (!b) return 'missing'; b.click(); return 'ok'; })()")
echo "tap Undo: $u"; [ "$u" = "ok" ] || { echo "::error::Undo toast gone before Undo could be tapped"; exit 1; }
maestro test --test-output-dir "$OUT" "$TMP/b.yaml"
echo "Undo toast check passed."
