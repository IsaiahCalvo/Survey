# Survey-rail Excel actions fail-closed — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After item Copy → space, the named leftover is rail **Excel actions chevron** (`aria-label="Excel actions"` → Open linked / Update existing fail-closed when no `linkedExcelPath`). Distinct from leftover-18 X-06 writeback and from the already-proven EXPORT download. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (KAL-436 Walls). Did **not** invent a linked workbook or apply writeback. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-Spaces. Did **not** invent `.env.local`. Did **not** replay leftover-18, item Copy → space, item reorder, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP (and not leftover-18 X-06)

| Prior claim | What was actually asserted |
|---|---|
| X-06 Excel **pass** (live export) | EXPORT downloaded `KAL-436_Preservation_Template_export.xlsx`. Chevron was optional (`if (excelMenu.count())`). |
| leftover-18 X-06 writeback | Automatic silent writeback stays `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false`. Not this slice. |
| helper-only "no linked workbook → Microsoft 365 push is not offered as enabled" | Soft check. Did not open Open linked / Update existing or assert toast / no-write. |

## Hunt (independent catalog)

Inspected first: desktop compact EXPORT cluster in `SurveySpacesRail.jsx`. Visible labels are **Open Excel** / **Push to Excel**. Leftover informal names **Open linked** / **Update existing** are the same items (`aria-label`).

| Candidate | Verdict |
|---|---|
| Desktop `aria-label="Excel actions"` | **GAP / live.** Was hidden when `!linkedExcelPath \|\| linkedExcelExists !== true`. |
| Open Excel / Open linked | **Fail-closed.** Toast `No Excel file is linked to this survey.` No `openPath`. |
| Push to Excel / Update existing | **Hole before fix.** Unguarded `handleExportSurveyToExcel(linkedExcelPath)` — `null` path downloads a **new** workbook (a write). |
| EXPORT (no-arg) | **Already proven.** Smoke-clicked only this pass. |
| Pull / Live Sync / Verify | **OneDrive-only.** Hidden on `?testPdf=` KAL-436. Not invented. |
| Mobile `Export survey data` / Sync Microsoft 365 | **390.** Desktop chevron absent (`mobileMode ? null`). Sync already `disabled` without a path. |
| leftover-18 X-06 writeback / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a linked workbook. Cloud persist of `?testPdf=` fails closed — not invented.

## Source (before live)

- Chevron + menu only rendered when `linkedExcelPath && linkedExcelExists === true`.
- Open Excel already toasted if `!excelPath`, but the menu was unreachable without a path.
- Push to Excel called `handleExportSurveyToExcel(selectedTemplate.linkedExcelPath)` with no guard. A null path is treated as a new EXPORT download.
- Desktop only (`mobileMode ? null`). 390 uses `aria-label="Export survey data"`.
- `handleOpenExcel` in PDFViewer toasts if no path; the rail menu does not call it.

## Product fix

Min-viable `SurveySpacesRail.jsx` export cluster only:

1. Always render EXPORT + `aria-label="Excel actions"` chevron (still desktop-only).
2. `linkedExcelReady = Boolean(linkedExcelPath) && linkedExcelExists === true`.
3. Open linked / Update existing: `aria-disabled={!linkedExcelReady}`, muted cursor, toast + return when not ready. Push never calls `handleExportSurveyToExcel(path)` without a path.
4. Visible text stays Open Excel / Push to Excel. `role="menu"` / `menuitem` + leftover `aria-label`s for inspectability.

Did not invent a workbook path. Did not flip leftover-18 `EXCEL_AUTOMATIC_WRITEBACK_ENABLED`. Did not touch `PDFViewer.jsx`, `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-survey-excel-actions-failclosed.spec.mjs` **1 / 1 (6.0s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyExcelActionsFailClosed.test.mjs` **3 / 3**. Did **not** run official `npm test` (no high-risk file). 8448 not loosened.

Receipt log: `SURVEY_EXCEL_ACTIONS_FAILCLOSED_PROOF` persist `null`, exportFilename `KAL-436_Preservation_Template_export.xlsx`, 390 `{ excelActions: 0, exportSurvey: 1 }`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Open chevron; Open linked / Update existing fail-closed | **pass** | Chevron visible. Items `aria-disabled="true"`. Visible Open Excel / Push to Excel. Pull / Live Sync absent. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Click Open linked / Update existing anyway | **pass** | Toast `No Excel file is linked`; no `.xlsx` download. |
| Menu with no survey data | **pass** | 0 `[data-survey-marker-id]`; Update existing still toast / no write. |
| Pen-armed | **pass** | After `p`, Open linked still `aria-disabled` + toast / no write. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| EXPORT smoke | **pass** | `KAL-436_Preservation_Template_export.xlsx` (not leftover-18 replay). |
| 390 | **pass** (desktop chevron absent) | `excelActions: 0`. Mobile `Export survey data` present; Sync Microsoft 365 **disabled**; Export Excel enabled. |

No `file.id` (`persist: null`). No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** desktop Excel actions chevron → Open linked / Update existing fail-closed without `linkedExcelPath`.
- **Product bugs fixed:** chevron was hidden (items uninspectable); Push-without-a-path would download a new workbook.
- **Omitted (not invented):** linked workbook, leftover-18 X-06 writeback, Pull / Live Sync / Verify, checklist Y/N/N-A, category Move/Copy stub, copy-mode toolbar.
- **Next unique leftover (not this pass):** survey-rail **Choose survey template** re-pick after already in a template (`aria-label="Choose survey template"`). Distinct from first-entry KAL-436 pick. Not checklist Y/N/N-A. Not category Move/Copy stub. Not leftover-18 unplaced-rows (needs Excel import). UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/SurveySpacesRail.jsx` (always-show Excel actions chevron; Open linked / Update existing fail-closed)
- `debug/scenarios/e2e-survey-excel-actions-failclosed.spec.mjs`
- `tests/surveyExcelActionsFailClosed.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
