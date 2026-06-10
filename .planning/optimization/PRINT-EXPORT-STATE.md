# Print + Export — State of the World (BL-21, step 1)

_2026-06-10, overnight loop. Audit-only: no code changed. Baseline: KAL-8 (print/export
surface audit, Done 2026-05-22) under the GOVERNING KAL-7 decision (normal PDF export =
regular viewer annotations ONLY; survey/region/space overlays excluded unless an explicit
separate option). Codex adversarial fact-check applied. This report is the "what exists
vs what KAL-8 recommended" deliverable; the finalization slices at the end are BL-21's
build half._

## Executive summary

The two headline surprises: **the custom print panel already exists and is feature-rich
and mostly built (~1,810 lines, `src/components/PrintPanel.jsx` — one stubbed option,
see G6) but is switched OFF by a single flag** (`PRINT_PANEL_ENABLED = false`, `src/PDFViewer.jsx:25221`) pending two decisions —
shipping timing and an unresolved J-vs-K layout variant (`PrintPanel.jsx:1485` "TEMP —
remove once a winner is chosen"); and **the native/editable PDF export shipped by KAL-52
is fully implemented but UI-dark** — `bakeAnnotationsIntoPdf` is real, tested, and called
by nothing outside tests. KAL-7 compliance is enforced and well-tested on every live
export path. Several KAL-8 snapshot facts are now stale (documented below so nobody
trusts the old audit).

## 1. Export entry points TODAY (labels verbatim)

| UI label | Where | Handler | Notes |
|---|---|---|---|
| **"Export Annotated PDF…"** (⌘⇧E) | Electron File menu `src/electron-main.js:538` → IPC `menu:export-annotated-pdf` | `handleExportAnnotatedPDF` `PDFViewer.jsx:18215` → `savePDFWithAnnotationsPdfLib` | KAL-7 filter via `buildPdfExportAnnotationPlan` |
| **"Print PDF…"** (⌘P) | File menu `:559` → `menu:print-pdf` | `openPanel(...)` `PDFViewer.jsx:25378` → panel DISABLED → `printPdfBlob` iframe + OS print dialog | base PDF only, no app annotations |
| **"Print PDF with Annotations…"** (⌘⇧P) | File menu `:570` → `menu:print-pdf-markup` | `openPanel(..., { withMarkup: true })` `:25381` → flattened temp PDF (`buildPrintableRegularAnnotationPayload` + `savePDFWithFlattenedRegularAnnotationsForPrint`) → iframe print | KAL-7 filter applied |
| **"EXPORT"** (Survey panel; "EXPORTING..." in flight) | `src/SurveySpacesRail.jsx:2747-2807` (split button when a linked Excel exists) | `handleExportSurveyToExcel` `PDFViewer.jsx:11934` | ExcelJS workbook + hidden metadata sheet; local save or OneDrive |
| **"CSV"** (Spaces per-space Export menu) | `src/sidebar/SpacesPanel.jsx:504` | `handleExportSpaceToCSV` `PDFViewer.jsx:16720` | pro-gated |
| **"PDF Pages"** (Spaces) | `SpacesPanel.jsx:525`; tooltip verbatim: "Exports base PDF pages only; app annotations are not embedded." (`:511`) | `handleExportSpaceToPDF` `PDFViewer.jsx:16850` | pro-gated; tooltip is test-pinned |
| **"Open Excel" / "Push to Excel" / "Pull from Excel"** (Survey panel split-button dropdown, linked workbook only) | `src/SurveySpacesRail.jsx:3063-3109` | linked-workbook open/push/pull flows | sibling rows of the EXPORT button — listed for completeness; the Excel sync pipeline itself is governed by the Excel-sync contract, not this audit |
| _(none)_ — native/editable export | — | `bakeAnnotationsIntoPdf` `src/utils/pdfNativeExport/index.js:78` | IMPLEMENTED (11 subtypes: Square, Circle, Line, FreeText, Polygon, PolyLine, Ink, Highlight, Underline, Squiggly, StrikeOut) but **no menu item, button, or IPC reaches it** |

No other PRODUCT export surfaces found. Out of scope by design: diagnostic
download/share paths (File-menu "Save Log" + its mobile tile, GitHub/share/
clipboard/snapshot flows, `shapeBleedDiagnostics` JSON/SVG/PNG dumps, Save Log
PNG screenshots) — developer/diagnostic outputs, not user exports.

## 2. Print: what actually exists

- **`src/components/PrintPanel.jsx` (~1,810 lines), complete:** page-range input with All/Current-view/Clear pills (`:1507-1537`), thumbnail strip with alt-click exclusion, page size (Auto/Letter/Legal/Tabloid/A4/A3/Arch D/Arch E/Match-another-page; "Custom W×H…" appears in the dropdown but is a STUB with no dimension inputs — see G6) with Proportional/Stretch, orientation + CCW/CW rotate + mirror H/V, Output (Markups on/off, Color/BW), copies stepper + collate + duplex, destination dropdown (system printers via `print:list-printers` IPC `electron-main.js:1166` + "Save as PDF…"), live preview + pop-out with pinch-zoom, pager strip, keyboard (←/→, Esc, ⌘Enter).
- **Two layout variants ship side-by-side** behind a temp toggle labeled "variant J" / "variant K" (`:1486`); J = per-section scope pills, K = single scope tab rail. The winner was never chosen.
- **Pipeline when enabled:** `handlePrintPanelPrint` (`PDFViewer.jsx:25617`) renders pages via pdf.js (2000px in panel mode), composes an HTML print doc with per-page `@page` rules, routes to `print:html-silent` (`electron-main.js:1221`) / `print:html-to-pdf` (`:1274`) / iframe per destination.
- **Today's reality:** `PRINT_PANEL_ENABLED = false` (`PDFViewer.jsx:25221`, comment `:25214-25220` calls it temporary) — both menu items and both shortcuts bypass the panel to the OS dialog. Legacy `window.print()` fallback in `SyncfusionPDFContainer.jsx:1724-1725` is unreachable via current wiring.

## 3. KAL-7 compliance (enforced + tested)

- Export path filter: `buildPdfExportAnnotationPlan` (`pdfAnnotationsPdfLib.js:314-455`) — `survey-marker` skip (`:335`), non-CANVAS scope skip (`:337`); the returned contract names `includedScopes:['canvas']`, `excludedScopes:['survey','region','survey-region']` (`:440-454`).
- Print-with-annotations filter: `buildPrintableRegularAnnotationPayload` (`:117-204`) — survey-marker objects, imported-native copies, non-canvas scopes, scoped callouts all excluded; `surveyMarkers: {}` returned (`:199`).
- The KAL-52 bake is scope-agnostic BY DESIGN (header `pdfNativeExport/index.js:5-8`: caller chooses) — scope filtering must stay upstream; `tests/pdfNativeExport.contract.test.mjs:29` pins exactly that wiring.
- `tests/pdfSaveExportContract.test.mjs` pins: the contract scopes, every printable-filter exclusion class (with per-scope diagnostic counts), end-to-end "only ['Square'] in output bytes", the flattened-print path, the export IPC channel + ⌘⇧E accelerator, the print menu LABELS, the absence of the bare "Export" label and the old "Print with Markup" (KAL-51), and the Spaces tooltip text. (NOT pinned: the export label's exact ellipsis form, the print accelerators.)

## 4. Stale facts from the KAL-8 snapshot (do not trust the old audit on these)

- "`pdfNativeExport.bakeAnnotationsIntoPdf()` throws not-implemented" — STALE: fully implemented (KAL-52, Done 2026-05-22), just UI-dark.
- "`src/utils/saveAnnotatedPDFFile.js`" — file no longer exists; functionality merged into `pdfAnnotationsPdfLib.js` (`savePDFWithAnnotationsPdfLib`).
- "`handleExportSurveyToExcel` in `src/App.jsx`" — App.jsx was split; it lives at `PDFViewer.jsx:11934`.
- Ambiguous menu labels — fixed by KAL-51; current labels above, with the label contract test-pinned as described in section 3.

## 5. Gaps / unfinished

- **G1** Print panel disabled (`PRINT_PANEL_ENABLED=false`) — the whole feature is one flag away, blocked on G2 + a ship decision.
- **G2** J/K variant decision unresolved (both render in production code; the loser + toggle should come out — `PrintPanel.jsx:13,1485-1486`).
- **G3** Native/editable export UI-dark — needs a deliberate entry point (label + placement = product call; KAL-8's old "don't show it until implemented" guard no longer applies).
- **G4** Export error feedback is `alert()`-based: `handleExportAnnotatedPDF` guards/failures (`PDFViewer.jsx:18217,18218,18265,18278`), Spaces CSV (`:16722`) and PDF (`:16852`) — overlaps KAL-57's alert sweep (the success path is alert-free and test-pinned).
- **G5** Survey panel "EXPORT" gives no hint it produces an Excel file (all-caps label, no tooltip) — small copy/tooltip slice; visual call.
- **G6** `PAPER_DIM_INCHES` (`PDFViewer.jsx:25607-25616`) covers all named sizes incl. archD/archE. "Match another page…" IS handled (`:25680`, falls back to Letter only when the matched page's dims are missing). "Custom W×H…" DOES fall through `|| [8.5, 11]` to Letter (`:25699`) — and worse, the panel option is a STUB: it renders in the size dropdown but has no width/height inputs or state behind it. Either build the inputs or drop the option before enabling the panel.

## Finalization slice plan (BL-21's build half — each gated on `npx vite build` + `npm test`)

1. **P1 (decision, Isaiah):** pick variant J or K → delete the loser + the temp toggle. Risk LOW (component-local).
2. **P2:** flip `PRINT_PANEL_ENABLED=true` + live print verification (needs a human with a printer/PDF destination; also resolve G6's custom-size fallback). Risk MED (host file is high-risk; the flip itself is one line).
3. **P3 (decision, Isaiah):** surface the editable export — proposed: File menu "Export Editable PDF…" beside "Export Annotated PDF…", routed through `buildPdfExportAnnotationPlan` → `bakeAnnotationsIntoPdf` (the test-pinned wiring). Risk MED (new IPC + menu + handler; the engine itself is tested).
4. **P4:** Survey "EXPORT" tooltip/copy (G5) — one-liner once Isaiah picks wording.
5. **P5:** fold G4's alerts into KAL-57's banner/toast sweep rather than fixing here.

## Open decisions for Isaiah
- J or K print-panel layout (gates P1→P2).
- When to flip the panel on (it replaces the OS print dialog for ⌘P).
- Editable-export entry point label + placement (gates P3); suggested copy above.
- G5 wording.
