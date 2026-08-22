# Callout knee / leader / arrowTip handle drag — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Keep-active / notes / page-ctx named this as the next unblocked leftover: canvas **handles**, not clipboard paste. T-02 + `e2e-callout-paste.spec.mjs` already prove create/clone / last-writer. This pass dragged the SVG handles. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group. Did **not** invent `.env.local`. Did **not** replay Keep active, Survey notes, Mirror V, Reset, page Cut/Copy/Paste, module Next/Prev, thumbnail, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, callout clipboard paste, thin leftovers, PDF links, History, pages insert/rotate/move/Duplicate, flatten, mobile chrome.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| T-02 Callout create/edit | Q-drag + text edit + style. Handles never grabbed. |
| Wave 5 callout + rotate | Companion **rect** used mtr; callouts “use knee/arrow handles, not mtr” — contract only. |
| Thin leftovers + T-02 paste | Clone via context-menu Paste. Last-writer. **Not** knee drag. |

## Source (before live)

| Handle | `data-callout-part` | Product rule |
|---|---|---|
| Knee | `knee` | Moves stored `knee` only. Text box + arrowTip stay. |
| Arrow tip | `arrowTip` | Moves `arrowTip` only. Text box stays. |
| Leader | `line1` / `line2` | Normalized to **`whole`** — knee + tip + box translate together. |
| Text box | `textBox` (`text` aliases) | Moves `textBoxPosition`. Release may auto-route knee. |
| Corners | `textBox-tl/tr/bl/br` | `textBoxResize` (not this hunt’s primary). |

Visible chrome only when selected + solo + not editing. Transparent hit circles stay mounted. Pen / shape creation returns **before** `handleSvgPointerDown`, so an armed Pen starts ink and does not drag the callout. Esc cancels **marquee only**, not `callout-part`. Off-page: callout-part applies raw normalized delta (no `constrainToPage`). Zoom: `viewBox={0 0 width height}`; `dxNorm = dxPage / W`. Invalid drop rolls back to the pre-drag snapshot.

`__phase35GetAnnotationById` matches `obj.id`. Callouts live on `data.id`. Live geom is read from SVG handle attrs / viewBox (not a PDFViewer seam patch).

## Live-proved

Playwright `debug/scenarios/e2e-callout-knee-drag.spec.mjs` **1 / 1 (6.9s)** on reused Vite `http://localhost:5173` + `?testPdf=text-search-glyph-lab.pdf`. Node `calloutKneeDrag.test.mjs` **2 / 2**.

IDs: `callout-2d53ab09-…` + `callout-e6ca34ca-…`. Handles present: `line1 line2 textBox text arrowTip knee textBox-tl/tr/bl/br`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Knee drag | **pass** | Knee Δ **0.061**. Text box stayed. ArrowTip stayed. |
| ArrowTip drag | **pass** | Tip Δ **0.069**. Text box stayed. |
| Leader (`line2` = whole) | **pass** | Text box followed (Δ **0.072**); knee + tip translated with it. |
| Text-box drag | **pass** | Box Δ **0.064**. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Nothing selected, empty-page drag | **pass** | Knee / tip / box unchanged. |
| Pen armed | **pass** | **no-op** on the callout (creation intercepts). |
| Esc mid-knee-drag | **pass** | **no-op (marquee only)** — geometry followed the pointer. |
| Off-page arrowTip | **pass** | **allow-outside** (no page clamp). |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after knee | **pass** | Ctrl+Z restored the pre-drag knee. |
| Zoom then drag | **pass** | `viewBox="0 0 612 792"`; knee still moved (Δ **0.026**). No JS zoom coord. |
| Second callout | **pass** | Dragging `kd-2` knee left `kd-1` knee/tip unchanged. |
| Rotate then drag | **asserted** | Pages **Rotate** ran. Small arrowTip nudge after rotate did **not** persist (`rotate-drag-no-move`) — distance-rule rollback or miss, not isolated as a product bug. |

No `file.id`. No error boundary. SVG default (not `?renderer=canvas`). No high-risk edit. Cap **8448** not loosened.

## Classification after this pass

- **GAP found and proven:** T-02 callout **knee / leader / arrowTip / text-box handle drag**.
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-callout-knee-drag.spec.mjs`
- `tests/calloutKneeDrag.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
