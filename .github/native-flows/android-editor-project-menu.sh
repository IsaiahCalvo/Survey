#!/usr/bin/env bash
# Runs android-editor-project-menu.yaml in two parts: sign in as the editor and
# open Projects, then tap the "E2E Sample Project" row's More in the web view,
# then the menu checks.
set -euo pipefail
OUT="$1"
FLOW=.github/native-flows/android-editor-project-menu.yaml
TMP=$(mktemp -d)
awk '/^---$/{print; exit} {print}' "$FLOW" > "$TMP/a.yaml"; cp "$TMP/a.yaml" "$TMP/b.yaml"
awk 'f&&/^# --- split: open menu ---/{exit} f{print} /^---$/{f=1}' "$FLOW" >> "$TMP/a.yaml"
awk 'f{print} /^# --- split: open menu ---/{f=1}' "$FLOW" >> "$TMP/b.yaml"
maestro test --format junit --output "$OUT/report-editor.xml" --test-output-dir "$OUT" "$TMP/a.yaml"
PID=$(adb shell pidof com.kalvoe.survey | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$PID"
ev() { node .github/native-flows/webview-storage.mjs --eval "$1"; }
m=$(ev "(() => { const t = [...document.querySelectorAll('*')].filter(e => e.offsetParent && e.children.length === 0 && /E2E Sample Project/.test(e.textContent)); for (const e of t) { let r = e; for (let i = 0; i < 8 && r; i++, r = r.parentElement) { const b = r.querySelector('button[aria-label=\"More\"]'); if (b) { b.click(); return 'ok'; } } } return 'missing'; })()")
echo "row More: $m"; [ "$m" = ok ] || { echo "::error::no More button on the E2E Sample Project row"; exit 1; }
maestro test --format junit --output "$OUT/report-editor-b.xml" --test-output-dir "$OUT" "$TMP/b.yaml"
d=$(ev "(() => { const b = [...document.querySelectorAll('button,[role=menuitem]')].find(b => b.offsetParent && b.textContent.trim() === 'Delete'); if (!b) return 'missing'; if (b.getAttribute('aria-disabled') !== 'true') return 'not greyed'; b.click(); return 'ok'; })()")
echo "Delete tap: $d"; [ "$d" = ok ] || { echo "::error::Delete in the editor's menu: $d"; exit 1; }
seen=false
for i in $(seq 20); do sleep 0.5; [ "$(ev "document.body.innerText.includes('Only the project owner can do this')")" = true ] && { seen=true; break; }; done
adb exec-out screencap -p > "$OUT/14-editor-delete-reason.png"
[ "$seen" = true ] || { echo "::error::no 'Only the project owner can do this' toast after tapping Delete"; exit 1; }
sleep 1
[ "$(ev "document.body.innerText.includes('E2E Sample Project')")" = true ] || { echo "::error::project gone after the editor tapped Delete"; exit 1; }
echo "Editor menu check passed."
