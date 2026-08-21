# E2E wave remaining — live `?testPdf=` proof

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, not killed)  
**Harness:** `debug/scenarios/e2e-wave-remaining.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Result:** 8 / 8 passed. Did not stamp `file.id`. Did not invent Capacitor / Stripe / MSAL / applied-migration passes.

## Product fix (min-diff)

**E2E-W5-01 — local History delete/restore never recorded on `?testPdf=`**

- Backspace did delete the selected rect from the canvas.
- `emitBulkTrashRows` in `PDFViewer.jsx` required `pdfFile?.id`. DEV fixtures only set `__localHistoryDocumentId`.
- History listed create/undo/redo, never “deleted…”, so Restore never appeared.
- **Fix:** `const documentId = getHistoryDocumentId(pdfFile);` — same helper W4-03 uses for the History button. Still does not set `file.id`.
- **Proof:** live Backspace → “deleted” row + Restore → rect id returns.

`node scripts/run-node-tests.mjs` exited 0 after the PDFViewer edit.

## Live rows newly proven

| ID | Proof |
|---|---|
| A-07 empty / after-edit | History empty copy, then pen/rect events |
| A-07 jump-to-page | `spike-120-pages.pdf` draw on page 3, go to 1, click event → page 3 |
| A-07 delete-restore | W5-01 fix + Restore |
| D-02 highlighter | freehand stroke commit |
| S-01…S-04 | rect / ellipse / line / arrow drags |
| S-01 cloud | Style → Cloud option, then rect |
| S-05 counter | `[data-counter-overlay]` drag-to-place |
| T-01 textbox | `[data-text-overlay]` drag, type, click-out commit (Escape discards) |
| C-03 / C-05 | Opacity % field 55; fill swatch `#FF0000`; stroke `#0000FF` |
| V-04 buttons | Zoom in/out + Fit page + Fit width (not pinch; that is W4-02) |
| E-05 cross-tool | Pen then rect; Undo twice; Redo twice |
| X-02 | Export annotated PDF download `.pdf` |
| X-03 | Cmd+P logs `[PrintPanel] OPEN` (custom panel is **disabled**, KAL-295/315; blob-iframe path) |
| X-04 | `kal412-mixed-import-e2e.pdf` imported ≥1 `isPdfImported` |
| U-01 | `?surveyTransitionE2E=1` template → Walls stamp → `[data-survey-marker-id]` |
| U-02 | Spaces tab visible on testPdf (Create space not clicked this pass) |

## Not first-class toolbar tools (do not invent)

- Stamp, measure, link — no buttons
- Text highlight / underline / strike / squiggly — hidden (KAL-240)
- Forms category — `{false &&` in AppShell
- Custom Print panel — `PRINT_PANEL_ENABLED = false`

## Still blocked / leftover

- Named cloud revisions / Restore version (needs real `file.id`)
- Native Capacitor, live Stripe, live MSAL, applied migrations
- X-05: `kal441-form-fields.pdf` had **0** `.annotationLayer` widgets
- X-01 identity-churn, A-01 captcha login, P-01 native sheets, P-03 OS print dialogs
- 1-dot pen tap was attempted with a soft catch — not claimed
- Spaces **create** / last-space stamp / Templates editor / checklist archive-with-markers
