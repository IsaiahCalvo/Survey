# Thumbnail click vs page input — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

The Fit height pass listed thumbnail click as a hinted candidate. This hunt took it as the first unique unblocked control that prior catalogs marked proven only at **cluster** level. V-06 “jump page 3” and UL-07 used `commitPageInput` (rail **Edit page number**). Other specs right-click thumbs (Duplicate / Rotate / Mirror) or `thumb.click()` then `scrollIntoViewIfNeeded` on the PDF page — they never asserted that left-click alone changed the rail page number.

Did **not** invent `.env.local`. Did **not** replay Fit height, 390 Bookmarks, leftover-18. Did **not** invent Print / stamp / measure / Group / Extract / Note / Link create / Actual size / rotate-view / two-page. No 768 tablet pass (`isNarrowShell` is `max-width: 720px` only).

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| V-06 Pages panel | “jump page 3” via `e2e-wave-remaining` `goToPage` helper = **page-number input** |
| UL-07 Page number edit | Type 0/99/3. Not a thumb. |
| V-05 Page nav | Keyboard ←/→ Home/End. Thumbnails listed in the matrix, not clicked. |
| chromeE2EContracts V-06 | Node `resolvePageThumbnailClick({ pageNumber: 3 })` → `navigate`. No window. |
| pages-move-up-down / thin leftovers / callout paste | `thumb.click()` then **scroll the PDF page into view** |
| wave 3/6/8 thumbs | **Right-click** Duplicate / Rotate / Mirror |

Product path is distinct: `PagesPanel` `onClick` → `resolvePageThumbnailClick` → `onNavigateToPage` / `goToPage`. Page input uses `commitPageInput` (`value >= 1 && value <= numPages`, else reset). Same destination page, two controls.

## Hunt (candidate order)

| Candidate | Verdict |
|---|---|
| Zoom % stepper / custom % / 100% | **Not this pass.** Stepper is V-04 Zoom in/out (`TOOLBAR_ZOOM_STEP_FACTOR` 1.25). Custom % is UL-06 (200 / 0→min / 9999→4000 / 50→min). No discrete catalog. 100% appeared as clamp result. `resetZoom` / Actual size is Electron `pdf-zoom` `reset` — do not invent. |
| Two-page / spread | **Not compiled-in.** `scrollMode` is forced `continuous` (`if (scrollMode !== 'continuous') setScrollMode('continuous')`). No user control. |
| **Thumbnail click vs page input** | **This pass.** |
| Spaces / Survey beyond dock | U-01 stamp + U-02 create/rename/pages already live. Notes / Previous-Next module / keep-category not first. Cloud persist leftover-18. |
| Callout knee / leader | Canvas drag handle, not this chrome GAP. T-02 + paste cover create/clone. |
| Opacity C-03 | Live 55% + slider 40 + Transparent. Continuous, not a discrete catalog. |
| Right-rail comments | No Comments panel in AppShell / PDFSidebar / SurveySpacesRail. |
| Other ZOOM_MODES | Only `FIT_PAGE` / `FIT_WIDTH` / `FIT_HEIGHT` / `MANUAL`. Fits proven 2026-08-22. MANUAL is UL-06. |

## Live-proved

Playwright `debug/scenarios/e2e-thumbnail-click.spec.mjs` **1 / 1 (7.1s)** on reused Vite `http://localhost:5173`. Node `tests/thumbnailClickNavigate.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Intended desktop | `?testPdf=spike-120-pages.pdf` at 1400×900. Pages rail thumb **3** left-click → rail page **3**, `.survey-pdfjs-page-div[data-page-number="3"]` visible **without** harness `scrollIntoView` on the PDF. Selected thumb border `#d8a84e`. |
| Break re-click | Second thumb 3 stays 3. |
| Break absent | No thumb **121**. Type **121** in page input reverts to 3. |
| Contrast input | Type **8** (UL-07 path) shows page 8; thumb **3** returns to 3. |
| Edge 1-page | `clickable-link-test.pdf` thumb 1 stays 1. No thumb 2. Type 0 stays 1. |
| Edge armed | Pen/Draw armed. Thumb **5** jumps; user-mark count unchanged. |

No product bug. No high-risk edit. Cap **8448 MiB / 75/250** not loosened. Official `npm test` leftover not replayed.

## Classification after this pass

- **GAP found and proven:** desktop thumbnail left-click navigate (was cluster-classified under V-06 / UL-07).
- **Do not re-claim unblocked GAP = 0.** Fit-height receipt already forbade a new zero. This file does not stamp one either.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `tests/thumbnailClickNavigate.test.mjs`
- `debug/scenarios/e2e-thumbnail-click.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
