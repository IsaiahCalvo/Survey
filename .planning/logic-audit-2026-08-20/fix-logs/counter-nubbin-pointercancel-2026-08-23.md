# Product bug: Counter nubbin pointercancel left preview stale — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip:** `d1eedf15` (harness). Product `d659e3c1`.  
**Does not mark the `/goal` complete.** Does **not** re-claim unblocked GAP = 0.  
Does **not** claim leftover-18 GAP = 0.

390 vs desktop missing control is exhausted this campaign (Counter Start + series Delete landed). Select text caret / Zoom % / TabBar / Forms / stamp / measure / Group / Extract / Note-Link / Print stay receipted or compile-hidden.

Switched class: **pointercancel vs zoomGeneration**. Nubbin `pointerup` already commits `pointerAngle`. `onPointerCancel` dropped only the drag ref, so the live preview + stored angle stayed stale — undo / zoom / isolation could not see the nub. Distinct from leftover-18 / X-01 / nubbin orbit / Start / series Delete. Did **not** invent flatten / stamp / Forms.

## Product

Min-viable in `src/components/SVGAnnotationLayer.jsx`:

- `onPointerCancel` now commits the live preview (same `counter:rotate-commit` as pointerup)
- `zoomGeneration` also flushes an in-flight nubbin rotate before the page re-lays out

High-risk file; min-viable only. No `file.id` stamp. FabricEraserCanvas / viewBox / canvas sizing / Fabric `fontFamily` / CORS `*` untouched. 8448 / 75/250 not loosened.

## Live-proved

Playwright `e2e-counter-nubbin-pointercancel.spec.mjs` **2 / 2 (8.0s)** on Vite `http://127.0.0.1:5261`. Focused Node `counterNubbinOrbit` + leftover18 **15 / 15**.

`?testPdf=clickable-link-test.pdf`. `viewBox="0 0 612 792"`. `file.id` null.

Desktop pin `d43cfe77-…` cancel Δ **110.14°**. Zoom flush Δ **153.00°**. 390 pin `844fd270-…` cancel Δ **116.38°**. Zoom flush Δ **156.37°**.

### Intended — **pass**

pointercancel persists the live nubbin angle. Body left/top held. Ctrl+= mid-drag flushes via `zoomGeneration` (no double-commit on pointerup).

### Break — **pass**

| Control | Input | Result |
|---|---|---|
| No-move cancel | pointerdown then pointercancel | angle Δ **< 1** |
| Undo | Ctrl+Z after deselect | restores default angle |

### Edge

| Slice | Evidence |
|---|---|
| 390 | same SVG nubbin; cancel + zoom flush |
| hubPreview | nubbin **0**; Draw **0** |
| viewBox | `0 0 612 792` |
| `file.id` | null |

## Leftover-18

Still parked. X-01 still needs coordinator lease + real saved `file.id`. Goal stays OPEN.
