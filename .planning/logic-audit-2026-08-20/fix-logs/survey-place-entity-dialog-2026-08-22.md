# Place-time Entity dialog — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Entity picker, the named leftover is place-time **Entity dialog** (`pendingEntitySelection` after a Walls draw when `template.entities.length > 0`). Not rail `survey-marker-entity-trigger`. Not Jump / Set location. Not Create category. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create as the GAP. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (Survey Entities Template) and `?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1` (KAL-436, zero entities). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-space. Did **not** invent `.env.local`. Did **not** replay leftover-18, rail Entity picker, Jump / Set location, Create category, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active as the GAP, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Entity picker | Expanded-row `survey-marker-entity-trigger` after place. Place-time dialog dismissed so the rail write was first. |
| Rail Jump / Set location | Search button locate / draw. No entity write at place. |
| Keep active / notes | After-place arm + Note dialog. Entity dialog unopened as the GAP. |

## Hunt (independent catalog)

Inspected first: `PDFViewer` `{/* Entity Selection Dialog */}` gated on `pendingEntitySelection && selectedTemplate && selectedModuleId`. Set after `handleSurveyMarkerCreated` when a category is armed and `entities.length > 0`.

| Candidate | Verdict |
|---|---|
| Place on Survey Entities Template | **GAP.** Dialog heading **Entity** + “Select the entity responsible…”. Options are template entities only (no None). |
| Pick entity | **Stores** `entityId` / `entityName` / `entityColor` on that marker, then name prompt. |
| Place another + pick different | **Works.** Keep active ON shows the dialog each time. |
| Dismiss X / overlay | **Skip, not required.** Proceeds to name; stored entity empty (None). |
| Esc (before fix) | **No-op.** Dialog stayed. Sibling of Set-location Esc. |
| Zero entities (KAL-436) | **Must not appear.** Goes straight to name prompt. |
| Pen-armed after dismiss | **Marker stays.** No extra survey-marker. |
| Keep active ON | **Dialog each place.** Category stays armed. |
| Undo after pick | **Pops `highlight:create`.** Last placed marker gone; earlier picked marker + entity stay. |
| 390 | **Absent.** `mobileMode` uses `commitMobileSurveyMarker` / detail sheet, never the desktop modal. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / Copy-to-space | Parked / compile-hidden / no control. Not invented. |

KAL-436 has **no** `entities` so existing marker E2E skip this dialog. Survey Entities Template (GC / Subcontractor / 100% Complete) is the local seed from the rail-Entity pass — not a new persist seam.

## Source (before live)

- `handleSurveyMarkerCreated`: if `selectedCategoryId` and `entities.length > 0` and not mobile → `setPendingEntitySelection`. Else name prompt.
- Overlay click + X: `setPendingSurveyMarkerName` with the pending marker (no entity) then clear pending entity.
- Pick: writes entity onto `surveyMarkers` + preview color, then name prompt.
- Name Save spreads `pendingSurveyMarkerName.surveyMarker` (entity fields if picked).
- 390: `commitMobileSurveyMarker` — desktop dialog never mounts.

## Product fix

Escape now skips the same way as X / overlay (name prompt, no entity). Capture listener; sibling of Set-location Esc. Did not revert rail Entity same-id no-op / `survey-marker:entity` checkpoint or Set-location arm/Esc. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-survey-place-entity-dialog.spec.mjs` **1 / 1 (9.5s)** on Vite `http://127.0.0.1:5193`. Node `surveyPlaceEntityDialog.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-2a66ec1a-…`, markerB `surveyMarker-636f64e6-…`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Place → dialog → pick GC | **pass** | Stored `entityId=kal436-entity-gc` + name GC + color. |
| Place another → pick Subcontractor | **pass** | Stored `kal436-entity-sub`. A stayed GC. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| X without pick | **pass** | Skip, not required. Name saved; `entityId` empty. |
| Overlay without pick | **pass** | Same skip / None. |
| Esc without pick | **pass** | After fix, dismisses; stored entity empty. Live-before-fix: Esc no-op (`escDismissed: false`). |
| Zero-entity template | **pass** | KAL-436: Entity heading **0**; name prompt only. |
| Pen-armed after dismiss | **pass** | Marker ids unchanged; dismissed marker stayed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Keep active ON | **pass** | Second Walls place showed the dialog again. |
| Undo after pick | **pass** | Ctrl+Z removed B; A + GC stayed. |
| 390 | **pass** | Desktop dialog heading / hint / copy **0**. |

No `file.id` (`persist: null`). No error boundary. SVG default. Official `npm test` after PDFViewer: standing leftover `pageOperationsQueueMounted.test.mjs` (`Cannot find module '/tmp/utils/pageContextOps.js'`). Isolated `partialEraserComplexity` 8448 leftover not reached / not loosened. Related survey contracts **24 / 24**.

## Classification after this pass

- **GAP found and proven:** place-time Entity dialog after Walls draw when the template has entities; pick stores on that marker; skip is None (not required).
- **Product bugs fixed:** Escape now skips like X / overlay (sibling of Set-location Esc).
- **Omitted (not invented):** empty-module `onRequestCreateTemplate` start-adding, Copy-to-space (no control in `src/`), checklist Y/N/N-A (KAL-436 still has no checklist items), eraser-on-marker replay.
- **Next unique leftover (not this pass):** empty-module **`onRequestCreateTemplate` start-adding** (`No categories available for this space.` → edit-mode start-adding). Not checklist Y/N/N-A (no fixture items). Not Copy-to-space (no control). Not rail Entity picker. Not Jump / Set location. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-place-entity-dialog.spec.mjs`
- `tests/surveyPlaceEntityDialog.test.mjs`
- `src/PDFViewer.jsx` (Escape skip only; overlay / X unchanged)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
