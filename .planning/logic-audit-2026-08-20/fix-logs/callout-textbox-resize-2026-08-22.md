# Callout text-box corner resize — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Knee / leader / arrowTip / text-box **move** named this as the next unblocked leftover: `textBox-tl/tr/bl/br` → `textBoxResize` was present, never live-dragged. T-02 create/clone + clipboard last-writer + handle **move** already proven. This pass resized the four corners. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group. Did **not** invent `.env.local`. Did **not** replay Keep active, Survey notes, Mirror V, Reset, page Cut/Copy/Paste, module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers, PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile chrome.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| T-02 Callout create/edit | Q-drag + text edit + style. Handles never grabbed. |
| Knee / leader / arrowTip / box move | `e2e-callout-knee-drag.spec.mjs` dragged `knee` / `arrowTip` / `line2` / `textBox`. Receipt said corners were `textBoxResize` **not this hunt’s primary**. |
| E-01 Resize | Shape `br/tl/tr/bl/mr/ml/mb`. Not callout `textBox-*`. |
| Pickers every-swatch handles | Per-type shape handles. No `textBox-br`. |
| agent-cli mobile advanced | `textBox-br` only, Capacitor path, not this desktop audit spec. |

## Source (before live)

`useSVGInteraction.js`: `textBox-tl/tr/bl/br` normalize to `textBoxResize` with `textBoxCorner`. Fixed-anchor math — opposite corner stays; grabbed corner follows the pointer. Floor **20 page-px** on each axis (`minW = 20 / W`, `minH = 20 / H`). Invalid drop rolls width/height back with the pre-drag snapshot. Pen / shape creation returns **before** `handleSvgPointerDown`. Zoom: `viewBox={0 0 width height}`; `dxNorm = dxPage / W`. Chrome only when selected + solo + not editing.

Default create box is 120×32. Knee sits 40 page-px from the arrow toward the box center.

## Live-proved

Playwright `debug/scenarios/e2e-callout-textbox-resize.spec.mjs` **1 / 1 (5.7s)** on reused Vite `http://localhost:5173` + `?testPdf=text-search-glyph-lab.pdf`. Node `calloutTextBoxResize.test.mjs` **2 / 2**.

IDs: `callout-5330470d-…` + `callout-78327814-…`. Handles present: `line1 line2 textBox text arrowTip knee textBox-tl/tr/bl/br`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| `textBox-br` grow | **pass** | Δw **0.052** Δh **0.035**. Opposite (tl) stayed. |
| `textBox-tr` grow | **pass** | Δw **0.052** Δh **0.035**. Opposite (bl) stayed. |
| `textBox-bl` grow | **pass** | Δw **0.052** Δh **0.035**. Opposite (tr) stayed. |
| `textBox-tl` grow | **pass** | Δw **0.052** Δh **0.035**. Opposite (br) stayed. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Pen armed | **pass** | **no-op** on the box (creation intercepts). |
| Nothing selected, empty-page drag | **pass** | Width / height unchanged. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Min-size clamp | **pass** | Inward `br` past leftover-8px. SVG width **20.0** (exact 20px floor). Height **24.9** — not below 20; leftover is content/descender after commit, not a hole under the floor. |
| Undo after grow | **pass** | Ctrl+Z restored the pre-drag size. |
| Zoom then resize | **pass** | `viewBox="0 0 612 792"`; br still grew (Δw **0.029** Δh **0.016**). No JS zoom coord. |
| Second callout | **pass** | Resizing `cr-2` left `cr-1` size + knee unchanged. |

No `file.id`. No error boundary. SVG default (not `?renderer=canvas`). No high-risk edit. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** T-02 callout text-box **corner resize** (`textBox-tl/tr/bl/br`).
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).
- **Not this hunt:** resize-into-knee invalid-drop rollback; live flip past the opposite corner (Node-only).

## Files

- `debug/scenarios/e2e-callout-textbox-resize.spec.mjs`
- `tests/calloutTextBoxResize.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
