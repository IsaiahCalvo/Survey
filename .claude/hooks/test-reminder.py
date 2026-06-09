#!/usr/bin/env python3
"""PostToolUse reminder to run the test suite after touching a load-bearing file.

The project's CLAUDE.md says to run `npm test` after editing any high-risk
file. This surfaces that reminder automatically so it never gets skipped.
"""
import json
import os
import sys


HIGH_RISK = {
    "PDFViewer.jsx",
    "viewerShared.js",
    "PageAnnotationLayer.jsx",
    "FabricDrawingCanvas.jsx",
    "FabricEraserCanvas.jsx",
    "FabricEditCanvas.jsx",
    "SVGAnnotationLayer.jsx",
    "package.json",
    "vite.config.js",
}


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    ti = data.get("tool_input", {}) or {}
    base = os.path.basename(ti.get("file_path", "") or "")
    if base not in HIGH_RISK:
        sys.exit(0)

    msg = (
        f"You just edited a load-bearing file ({base}). Per project rules, "
        "run the test suite before declaring done: npm test "
        "(node scripts/run-node-tests.mjs)."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": msg,
                }
            }
        )
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
