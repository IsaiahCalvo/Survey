# Keep active / Survey notes / page-context leftovers — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

The Previous/Next module hunt named these as the next unblocked leftovers: Keep active, Survey notes, and UL-32 execute (Mirror V / Reset / page Cut-Copy-Paste). Wave 6 only Mirror H. Thin leftovers only Duplicate execute. U-01 stamp clicked Walls. This pass executed those leftovers. Did **not** invent Extract (no handler). Did **not** invent `.env.local`. Did **not** replay Previous/Next as the GAP, leftover-18, thumbnail click, Fit height, Bookmarks, Eraser/Counter, F3, Search, keyboard, swatches, callout paste, PDF links, History, insert/rotate/move/Duplicate, flatten, U-01 Walls stamp, U-02 Spaces.

## Why these are GAPs

| Prior claim | What was actually asserted |
|---|---|
| U-01 Survey rail | KAL-436 → Walls **stamp**. Keep active never toggled. |
| Previous/Next module | Module step only. Hunt deferred Keep active + notes. |
| UL-32 Pages menu | Items + Duplicate execute. Wave 6 Mirror **H**. Mirror V / Reset / Cut / Copy / Paste unexecuted. |
| T-02 / thin leftovers | Callout create/clone. Not Survey Marker notes. |

## Source (before live)

| Control | Handler | Rule |
|---|---|---|
| Desktop Keep active | PDFViewer checkbox `surveyKeepCategoryActive` | After stamp, `if (!flag) setSelectedCategoryId(null)`. Desktop tool stays `survey-marker`. |
| 390 Keep active | `MobilePdfViewerChrome` role=checkbox | Same flag. After stamp off: also `setActiveTool('pan')`. Chrome only when tool is survey-marker / pan / select. |
| Next while Keep on | `selectSurveyModule` | Always `setSelectedCategoryId(null)`. Flag itself is untouched. |
| Survey notes | Desktop Note dialog (`setNoteDialogOpen`) + 390 in-sheet editor | Save writes `surveyMarkers[id].note`. Cancel drops the draft. Empty text stays “Add”. |
| Mirror V | `handleMirrorPage(page, 'vertical')` | Toggles `mirrorV` → thumb `scaleY(-1)`. |
| Reset | `handleResetPage` | Deletes that page’s transform. |
| Cut / Copy | `handleCutPage` / `handleCopyPage` | Clipboard only. Page stays until Paste. |
| Paste | `handlePastePage` | Copy inserts after target. Cut same-page clears clipboard. |
| Extract | **missing** | Not in `PagesPanel.jsx`. Not invented. |

`getPageTransform` in PDFViewer is unused. Mirror V/Reset are thumbnail (and print) presentation, not PDF-byte mutations.

## Live-proved

Playwright `debug/scenarios/e2e-survey-keep-notes-page-ctx.spec.mjs` **4 / 4 (14.6s)** on reused Vite `http://localhost:5173`. Node `surveyKeepActive.test.mjs` **4 / 4** + `pageContextOps.test.mjs` **3 / 3**.

### 1. Keep active — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Desktop intended ON | **pass** | Check Keep, Walls, stamp “Keep On 1”; chip stays `btn-active`; second stamp without re-click. |
| Desktop intended OFF | **pass** | Uncheck, Walls, stamp “Keep Off”; chip loses `btn-active`; Keep chrome stays (tool still survey-marker). |
| Break: toggle, no stamp | **pass** | Check/uncheck; marker count 0; Walls chip not armed. |
| Break: toggle while Pen | **pass** | Draw → Pen; Keep checkbox gone (`activeCategoryDropdown === 'draw'`). |
| Edge: Next while Keep on | **pass** | Flag stays checked; Doors not auto-active; Walls gone. Existing stamps filtered out of Other (not a wipe). |
| 390 toggle | **pass** | Dock Open survey → KAL-436. Role=checkbox button. DOM click on/off; no stamp. Sheet backdrop intercepts Playwright pointer events (documented). |
| 390 Pen hide | **pass** | Draw/Pen hide Keep; Survey category Walls brings it back, Walls `is-active`. |
| 390 after-place pan | **source + Node** | Harness cannot drag under the full-sheet backdrop. Product: `mobileMode && !keep → setActiveTool('pan')`. Desktop already live-proved after-place. |

### 2. Survey notes — **pass**

Desktop chrome exists (`Add item notes` → heading **Note**, placeholder “Enter your notes…”, Save / Cancel). 390 has a separate in-sheet editor; this pass used desktop after a stamp.

| Slice | Verdict | Evidence |
|---|---|---|
| Intended save / edit | **pass** | “Field note one” → Save → Edit shows it. |
| Break: Cancel | **pass** | “DRAFT-SHOULD-DIE” discarded. |
| Break: empty Save | **pass** | Stays **Add item notes** (no text). |
| Break: huge text | **pass** | 4000 `H` saved and reopened. |
| Edge: module switch | **pass** | “Field note survives” after Next → Previous. Product keeps `surveyMarkers` by id. |

### 3. Pages context leftovers — **pass** / Extract **missing-handler**

`?testPdf=text-search-glyph-lab.pdf` (3 pages).

| Slice | Verdict | Evidence |
|---|---|---|
| Mirror V intended | **pass** | Thumb transform matches `scaleY` / matrix (not wave-6 `scaleX`). |
| Reset intended | **pass** | Transform back to none / identity. |
| Reset break (already clear) | **pass** | Second Reset no-op. |
| Paste empty | **pass** | Paste disabled. |
| Copy → Paste | **pass** | Copy page 1, Paste on 3 → **4** pages. |
| Cut same-page | **pass** | Cut 2, Paste 2 → still 4; Paste disabled after. |
| Edge: Pen armed | **pass** | Copy page 4, Paste on 1 → **5** pages. |
| Extract | **missing-handler** | No menu item. Do not invent. |

No product bug. No high-risk edit (`usePageOperations.js` + new utils only). Cap **8448** / **75/250** not loosened. Official `npm test` leftover not replayed.

## Classification after this pass

- **GAP found and proven:** Keep active (desktop + 390 chrome), Survey notes (desktop dialog), UL-32 Mirror V / Reset / Cut / Copy / Paste execute.
- **missing-handler:** Pages **Extract**.
- **Do not re-claim unblocked GAP = 0.**
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).
- **Callout knee/leader drag:** still a distinct unblocked GAP if the next hunt wants canvas handles. Not this pass.

## Files

- `src/utils/surveyKeepActive.js`
- `src/utils/pageContextOps.js`
- `src/hooks/usePageOperations.js` (Mirror / Reset / Paste use the helpers)
- `tests/surveyKeepActive.test.mjs`
- `tests/pageContextOps.test.mjs`
- `debug/scenarios/e2e-survey-keep-notes-page-ctx.spec.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
