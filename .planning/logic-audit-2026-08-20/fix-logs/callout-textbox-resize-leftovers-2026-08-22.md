# Callout text-box flip + knee-rollback leftovers — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

The grow/clamp hunt named two thinner leftovers: live flip past the opposite corner (Node-only) and resize-into-knee invalid-drop rollback (unproven live). Both are real product paths. This pass proved them intended+break+edge. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group. Did **not** invent `.env.local`. Did **not** replay Keep active, Survey notes, Mirror V, Reset, page Cut/Copy/Paste, module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers, PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile chrome, or corner **grow/clamp**.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| T-02 corner resize | Four corners **grow**, 20px clamp, undo, zoom grow, second-callout isolate. Flip was Node-only. Invalid-drop rollback was “not this hunt.” |
| Knee / leader / arrowTip / box move | Dragged `knee` / `arrowTip` / `line2` / `textBox`. Not a resize that swallows the knee. |
| E-01 Resize | Shape handles. Not callout `textBox-*`. |

## Source (before live)

`useSVGInteraction.js` `textBoxResize`: opposite corner is the fixed anchor; `newLeft = min(anchor, mv)` so dragging past the opposite corner remaps the box. Floor **20 page-px**. The resize `pointermove` branch **returns early** (no mid-drag pin / no `lastSafe` update). `handlePointerUp` still treats `partType === 'textBoxResize'` as a distance-rule drop: knee/arrow inside the new box, handle-gap, or line2 cut → roll width/height/position back to the **pre-drag snapshot**. Pen / shape creation returns **before** `handleSvgPointerDown`. Zoom: `viewBox={0 0 width height}`.

## Live-proved

Playwright `debug/scenarios/e2e-callout-textbox-resize-leftovers.spec.mjs` **1 / 1 (4.9s)** on reused Vite `http://localhost:5173` + `?testPdf=text-search-glyph-lab.pdf`. Node `calloutTextBoxResizeLeftovers.test.mjs` **3 / 3**.

IDs: `callout-1b82bf85-…` + `callout-8fae9bfe-…`. Handles present: `line1 line2 textBox text arrowTip knee textBox-tl/tr/bl/br`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Flip `tl` past `br` | **pass** | Left jumped Δx **0.196** (~old width 120/612); top Δy **0.040** (~old height). New origin at/after old opposite. Width ≥ 20. Knee stayed. |
| Resize-into-knee rollback | **pass** | Grew `tl` past the stored knee. Release restored width **0.196** / height **0.047** and origin + knee. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Pen armed | **pass** | Flip **no-op** (creation intercepts). |
| Nothing selected, empty-page drag | **pass** | Size + origin unchanged. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after flip | **pass** | Ctrl+Z restored pre-flip size + origin. |
| Zoom then flip | **pass** | `viewBox="0 0 612 792"`; screen-space opposite-handle drag still flipped. No JS zoom coord. |
| Second callout | **pass** | Flipping `lf-2` left `lf-1` size + origin + knee unchanged. |

No `file.id`. No error boundary. SVG default (not `?renderer=canvas`). No high-risk edit. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** T-02 callout text-box **flip past opposite** + **resize-into-knee rollback**.
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-callout-textbox-resize-leftovers.spec.mjs`
- `tests/calloutTextBoxResizeLeftovers.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
