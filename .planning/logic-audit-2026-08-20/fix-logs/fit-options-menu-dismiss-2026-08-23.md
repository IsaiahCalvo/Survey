# Fit options menu dismiss — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `3431364f` Home-tab click.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Home-tab click (`3431364f`). Menu Fit height / Fit page / Fit width **apply** modes already dedicated. Ctrl+2 / Ctrl+M / Ctrl+0 / Ctrl+1 apply modes. V-09 is the shortcuts overlay Esc. This leftover is the Fit options **popup dismiss** (open / Escape / click-outside / Enter). Overlay lists Esc as Close dialogs/cancel.

**Product:**
1. Desktop Fit options advertised `aria-haspopup="listbox"` but the popup was a plain div of buttons (no `role="listbox"` / `option`, no Arrow keys). 390 already uses a real listbox. Trigger + items now `type="button"`; `aria-haspopup="true"` so the control does not lie. Items stay buttons so existing apply-mode specs keep `getByRole('button', { name: 'Fit height' })`.
2. Click-outside never closed the menu: PDFViewer listened for bubbling `mousedown`, but the page layer `preventDefault`s `pointerdown` and suppresses that mousedown. Listener is now capture `pointerdown`. Space stays the global temporary-pan chord (`isEditableTarget` is input/textarea/select only).

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay remapped-after-CW, Ctrl+2 / Ctrl+M, menu Fit height / Ctrl+0 / Ctrl+1, rail Previous/Next, keyboard letters, toolbar click-to-arm, or Home/Close tab.

## Hunt (why this leftover)

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Remapped-after-CW catalog | **Exhausted / do not replay.** |
| Ctrl+2 / Ctrl+M / menu Fit height / Ctrl+0 / Ctrl+1 | **Already proved** (apply modes, not dismiss). |
| Rail Previous / Next / P-04 letters / toolbar arm / Home tab | **Already proved.** |
| Rectangle/Ellipse create-path | **Already proved** (`e2e-shape-live-create`). |
| Context-menu / page Insert-Delete-Reorder / History Restore / bookmark group-rename | **Already dedicated.** |
| Text B/I/U/S / pickers / Select All / Undo-Redo / Delete | **Already dedicated.** |
| File → Open / Export | Open leftover-18 UL-03. Export replay-adjacent after-CW / leftover-18. |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0.** |
| Official stale contracts | leftover-18 Node **12 / 12**. Isolated 8448 standing. No new stale official contract. |
| PDF tab `role="tab"` | **Tab chrome — skipped.** Hunt harder than Home/Close. |
| **Fit options popup dismiss** | **This pass.** Distinct from apply-mode clicks and zoom chords. |

## Live-proved

Playwright `debug/scenarios/e2e-fit-options-menu-dismiss.spec.mjs` **2 / 2 (8.7s)** on Playwright Vite `http://127.0.0.1:5359`. Focused Node `fitOptionsMenuDismiss` + leftover18 **14 / 14**.

| Slice | Intended / break / edge |
|---|---|
| Intended open + Escape | `?testPdf=clickable-link-test.pdf` 1400×900. Fit options opens Fit page / width / height. Actual size / Manual **0**. Escape closes; zoom % held; viewBox **`0 0 612 792`**. |
| Intended click-outside | Page click closes. Second Escape invents **0**. Draw stays. |
| Break keyboard | Focused Fit options Enter opens. Space stays pan (`dataset.spacePan` armed); menu stays closed. |
| Break invent / hub | hubPreview Fit options / Draw **0**. |
| Edge search fixture | `text-search-glyph-lab.pdf` Escape closes; `file.id` null; viewBox **`0 0 612 792`**. |
| Edge 390 | Desktop Fit options **0**. Zoom and fit options Escape closes the listbox. viewBox **`0 0 612 792`**. `file.id` null. |

Hunt live counts: Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments **0**. `file.id` null.

Product edits: `src/AppShell.jsx` Fit options trigger + menu items (`type="button"` / `aria-haspopup="true"`). `src/PDFViewer.jsx` zoom-menu dismiss only — capture `pointerdown` (high-risk min-viable-diff). Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. Official `npm test` after PDFViewer: main files + isolated `annotationDocConcurrency` **103 / 103** + `partialEraseCurveLocality` **15 / 15** **0 fail**; isolated `partialEraserComplexity` **9 / 10** — only leftover `500 crossing cuts` **11961.37 MiB > 8448.00 MiB**. Cap **8448** / 75/250 not loosened. Isolated 8448 standing.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `src/AppShell.jsx` (Fit options `type="button"` + `aria-haspopup="true"`; items `type="button"`)
- `debug/scenarios/e2e-fit-options-menu-dismiss.spec.mjs`
- `debug/scenarios/e2e-after-home-tab-independent-hunt.spec.mjs` (hunt inventory)
- `tests/fitOptionsMenuDismiss.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
