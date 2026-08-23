# Official exclusive-layer pointerdown contract — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `7a1f2b56` Select caret create-tool dismiss.  
**This-pass SHA:** `cfde5d64` (official contract → `pointerdown`).  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Select caret create-tool dismiss (`37397a53` / `7a1f2b56`). Dismiss-family product SHAs already switched the exclusive Style / Width layer to capture `pointerdown`. Official `tests/annotationFormattingPopoverContract.test.mjs` still required `document.addEventListener('mousedown', onDown, true)` in that slice — official fail **1 / 2** (`ERR_ASSERTION` “dismissal must run in capture phase before toolbar triggers stop propagation”). Distinct from leftover-18 / X-01 / remapped-after-CW / Fit/Style/Width/Pages/Survey/Spaces/Select dismiss replay / Home tab / Close tab.

**Product:** none. Exclusive layer already capture `pointerdown` + page-surface consume. Official contract now matches the live listener. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay dismiss-family menus.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Remaining `addEventListener('mousedown'` | **Not a live create-tool dismiss leftover.** Font color picker is rich-text-only (exclusive layer already closes it on `pointerdown`). Counter/highlighter/eraser/underline/strike carets compile-hidden or **0**. Export menu flavors **0**. TextEditOverlay mousedown is T-01 commit. PageAnnotationLayer is legacy canvas. |
| Select caret / Survey / Spaces / Pages / Style / Width / Fit dismiss | **Exhausted / do not replay.** |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Text formatting / color pickers without rotate | T-03…T-07 / callout-formatting / pickers-every-swatch already dedicated. |
| Multi-select | V-02 dedicated. |
| Toolbar Zoom ± | Replay-adjacent after V-04 keyboard (`zoomIn`/`zoomOut`). |
| Hub preview chrome | Documents / Projects / Templates / Archive already dedicated or leftover-18. Draw / Select caret **0**. |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| kal441 Forms create / sticky-note Note | **0** (do not invent). |
| **Official exclusive-layer mousedown contract** | **This pass.** Official still required swallowed `mousedown` after the product SHA. |

## Live-proved

Focused Node `annotationFormattingPopoverContract` + `annotationFormattingPopoverAlign` + leftover18 **16 / 16**. Playwright hunt `debug/scenarios/e2e-after-select-caret-independent-hunt.spec.mjs` **1 / 1 (7.2s)** on Playwright Vite `http://127.0.0.1:5173`.

| Slice | Intended / break / edge |
|---|---|
| Intended official | Exclusive-layer slice matches capture `pointerdown` add/remove. |
| Break official | Slice does **not** match `mousedown` add. Old “toolbar stop propagation” message gone. |
| Edge official | Context-tool peer dismiss still matches. leftover-18 **12 / 12**. Isolated 8448 standing. |
| Intended hunt | `?testPdf=clickable-link-test.pdf` 1400×900. viewBox **`0 0 612 792`**. `file.id` null. Hidden tools **0**. Highlighter / Underline / Strike caret **0**. |
| Break hunt | Search Match case / Whole word **0**. kal441 Forms create **0**. sticky-note Note **0**. hubPreview Draw **0**. |
| Edge hunt | 390 Document tools. Search Next/Previous live if field opens. Collapse sidebar counted, not replayed. |

Product edit: none. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass (no high-risk product edit). Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI checked.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `tests/annotationFormattingPopoverContract.test.mjs` (official exclusive layer → `pointerdown`)
- `tests/annotationFormattingPopoverAlign.test.mjs`
- `debug/scenarios/e2e-after-select-caret-independent-hunt.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
