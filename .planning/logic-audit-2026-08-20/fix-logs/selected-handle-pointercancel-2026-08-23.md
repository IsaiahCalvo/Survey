# Product bug: selected-handle pointercancel left preview stale — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Product:** `dc648c7b` (later harness-only commits).  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

390 vs desktop missing control is exhausted this campaign. Nubbin pointercancel already landed. Select text caret / Zoom % / TabBar / Forms / stamp / measure / Group / Extract / Note-Link / Print stay receipted or compile-hidden.

Switched class: **pointercancel vs zoomGeneration**. Selected bbox / `mtr` / line endpoint-midpoint / callout knee `pointerup` already commits from stored `currentResize` / `currentAngle` / `currentEndpoint` / `currentMidpoint` / `currentCalloutPatch`. `pointercancel` was unwired on the captured knob, so the live preview + stored geometry stayed stale — undo / zoom / isolation could not see the edit. Distinct from leftover-18 / X-01 / nubbin / create keep-track / eraser commit / survey-marker discard. Did **not** invent flatten / stamp / Forms.

## Product

Min-viable:

- `useSVGInteraction.js`: `zoomGeneration` flushes an in-flight selected-handle drag via `handlePointerUp`
- `SVGSelectionOverlay.jsx`: captured knobs call `onHandleCancel` on `pointercancel`
- `SVGAnnotationLayer.jsx`: wire `onHandleCancel={handlePointerUp}` + line `p1`/`p2`/`midpoint` cancel; root cancel still discards survey-marker

High-risk file; min-viable only. No `file.id` stamp. FabricEraserCanvas / viewBox / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-selected-handle-pointercancel.spec.mjs` **390 1 / 1** on Vite `http://127.0.0.1:5281` plus hubPreview chrome 0. Focused Node `selectedHandlePointercancel` + leftover18 **14 / 14**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

390 rect `7ced7389-…` cancel Δ **+230.94 × +173.21**. Zoom flush Δ **+76.98**. Undo restored.

### Intended — **pass**

pointercancel persists the live `br` resize. Left/top pinned. Ctrl+= mid-drag flushes via `zoomGeneration` (no double-commit on pointerup).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| No-move cancel | pointerdown then pointercancel | size Δ **< 2** |
| Undo | Ctrl+Z after deselect | restores pre-drag size |

### Edge

| Slice | Evidence |
|---|---|
| 390 | same SVG `br`; cancel + zoom flush |
| hubPreview | resize handles **0**; `mtr` **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
