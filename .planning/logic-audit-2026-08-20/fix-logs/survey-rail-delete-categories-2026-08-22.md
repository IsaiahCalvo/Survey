# Survey-rail Delete selected categories — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Rename, the named leftover is rail **Delete selected categories** (`aria-label="Delete selected categories"` + confirm → `deleteCategory` + marker wipe). Not item Delete selected. Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not Rename. Not U-01 Walls stamp-create. Category checkboxes (`Select Walls`), not item checkboxes. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Rename | `Rename ${name}` → `commitSurveyMarkerName`. Category trash unexecuted. |
| Rail Delete selected items | Item checkboxes + `handleDeleteSurveyMarkerItem`. Not category Select. |
| Overlay Delete Survey Marker | SVG chrome + Select Backspace/Delete. Not the category toolbar. |
| Counter-series Delete | Pin / series-list Delete **renumbers** counters. Not `deleteCategory`. |
| Survey module nav | Previous/Next module. Did not delete a category definition. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` category Select toolbar (`survey-marker-category-select-button`) + `PDFViewer.handleDeleteSurveyCategoryDefinition`.

| Candidate | Verdict |
|---|---|
| `aria-label="Delete selected categories"` | **GAP.** Desktop category Select toolbar. Confirm then wipe markers + `deleteCategory`. |
| Category checkbox | **`Select ${category.name}`** via `SurveyMarkerLeadingSelect` (`category`). Not item `Select ${marker}`. |
| None selected | **Disabled** (`!hasSelectedCategories`). Toast if the handler is reached empty. |
| Cancel confirm | **No-op.** `if (!confirmed) return;` before the wipe. |
| Pen-armed | **Still works.** Rail selection is independent of the drawing tool. |
| Last remaining | **Allowed.** No last-category guard; Existing’s only Walls row is removable. |
| Undo (before fix) | **Bug.** No checkpoint. Overlay also survived the store wipe via leftover `newSurveyMarkersByPage`. `survey-category:delete` was not legacy-eligible, so Cmd+Z hit Yjs. |
| 390 | **Absent.** Whole Select/Delete strip gated `mobileMode ? null`. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- Desktop `Select` → category leading checkboxes (`Select Walls` / `Deselect Walls`). Delete disabled at zero. `askConfirm({ title: Delete N category?, danger: true })`.
- On confirm the rail deleted matching `surveyMarkers` by `moduleId`+`categoryId`, then `deleteCategory(selectedModuleId, catId)`.
- Overlay is module-filtered: Walls and Doors are not in the same DOM. Other-module markers stay in the store.
- 390: no category Select / Delete selected categories strip.

## Product fix

1. **Pending-preview strip.** Category delete now clears `newSurveyMarkersByPage` for the wiped ids (same as `handleSurveyMarkerDeleted`). Live-before-fix: Walls row gone, overlay id stayed.
2. **Undo checkpoint.** `checkpointSurveyCategoryDelete` snapshots `surveyMarkers` plus a `surveyTemplate` slice (`surveyTemplateRestore: true`) so one undo restores definition + markers. Ordinary pen/shape checkpoints omit the template slice.
3. **Legacy-eligible reason.** `survey-marker:category-delete` (not `survey-category:delete`) so `isLegacyAnnotationHistoryMeta` accepts it. Live-before-fix Cmd+Z logged `yjs_undo_invoked` and left Walls gone.

Did not revert `survey-marker:rename`. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. Identity-only function compare on `rightRailApi` unchanged.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-delete-categories.spec.mjs` **1 / 1 (6.5s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailDeleteCategories.test.mjs` **3 / 3**.

IDs: markerWalls `surveyMarker-b622c544-…`, markerDoors `surveyMarker-8643f429-…`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Select Walls + confirm | **pass** | Walls marker gone; Walls row gone; Doors stayed on Other. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None selected | **pass** | Button **visible + disabled**; Walls marker stayed. |
| Cancel confirm | **pass** | Dialog `Delete 1 category?` → Cancel; Walls stayed. |
| Pen-armed | **pass** | After `p`, confirm still wiped Walls; Doors stayed; undo restored Walls. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Other category’s markers | **pass** | Doors (Other Survey Data) stayed through Walls wipe / undo / Pen wipe. |
| Last remaining category | **pass** | Walls is Existing’s only category; delete allowed (`categorySelectToggle` still present). |
| Undo | **pass** | After fix: Walls id + Walls row restored; Doors stayed. Live-before-fix: overlay leftover, then Yjs no-op. |
| 390 | **pass** (absent) | `deleteCategoriesCount: 0`, `categorySelectCount: 0`. Desktop-only admin chrome. |

No `file.id`. No error boundary. SVG default. Official `npm test` after PDFViewer: standing leftover `pageOperationsQueueMounted.test.mjs` (`Cannot find module '/tmp/utils/pageContextOps.js'`). Isolated `partialEraserComplexity` 8448 leftover not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail Delete selected categories + confirm + marker wipe + undo.
- **Product bugs fixed:** pending overlay leftover; missing undo checkpoint; undo reason not legacy-eligible.
- **Omitted (not invented):** Create category, entity dropdown, Jump/Set location, Copy-to-space, eraser-on-marker replay.
- **Next unique leftover (not this pass):** rail **Create category** (`aria-label="Create category"` → `addCategoryToCurrentTemplate` / `addCategoryAsNewTemplate`). Not this category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-delete-categories.spec.mjs`
- `tests/surveyRailDeleteCategories.test.mjs`
- `src/SurveySpacesRail.jsx` (checkpoint + pending-preview strip)
- `src/PDFViewer.jsx` (`checkpointSurveyCategoryDelete` + template restore)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
