#!/usr/bin/env python3
"""PreToolUse guard for the Survey app's locked correctness invariants.

Watches edits to the load-bearing drawing/viewer files and asks for
confirmation ONLY when an edit looks like it breaks one of the rules the
project's CLAUDE.md marks as "NEVER break". Otherwise it stays silent and
allows the edit through. Heuristic + high-precision: warn, don't nag.
"""
import json
import os
import re
import sys


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def allow():
    sys.exit(0)


def ask(reasons):
    msg = (
        "Possible break of a locked invariant detected:\n- "
        + "\n- ".join(reasons)
        + "\n\nConfirm this edit is intentional before it lands."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": msg,
                }
            }
        )
    )
    sys.exit(0)


def main():
    data = read_input()
    ti = data.get("tool_input", {}) or {}
    path = ti.get("file_path", "") or ""
    base = os.path.basename(path)

    fabric_files = {
        "FabricDrawingCanvas.jsx",
        "FabricEraserCanvas.jsx",
        "FabricEditCanvas.jsx",
    }
    font_sensitive = fabric_files | {"PDFViewer.jsx", "PageAnnotationLayer.jsx"}

    # Text the edit will introduce.
    new_text = ti.get("new_string", "") or ti.get("content", "") or ""

    reasons = []

    # Rule 1 — fontFamily must be a single font name, never a fallback stack.
    # (The old Syncfusion zoom-signal and SVG-scaling checks were retired on
    # 2026-06-07 ahead of the pdf.js zoom/scroll/pan rebuild; only this
    # rasterizer-independent text rule outlives that migration.)
    if base in font_sensitive:
        for m in re.finditer(
            r"""fontFamily\s*[:=]\s*['"]([^'"]+)['"]""", new_text
        ):
            if "," in m.group(1):
                reasons.append(
                    "fontFamily is a multi-font fallback stack — Fabric.js "
                    "needs a single font name (cursor-drift gotcha)."
                )
                break

    if reasons:
        ask(reasons)
    allow()


if __name__ == "__main__":
    main()
