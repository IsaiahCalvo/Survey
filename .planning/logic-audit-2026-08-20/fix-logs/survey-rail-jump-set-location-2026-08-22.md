# Survey-rail Jump / Set location — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Create category, the named leftover is rail **Jump / Set location** (same search button: `aria-label="Jump to this Survey Marker"` when `bounds && pageNumber`, else `"Set location on PDF"` → `handleLocateItemOnPDF` / `setPendingLocationItem` + draw). Not Create category. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create as the GAP. Live-proved on `?testPdf=spike-120-pages.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, Create category, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Create category | Plus → modal → template append. Search button unexecuted. |
| Rail Delete selected categories | Category wipe. No locate / jump. |
| Placed handle drag | Body / 8 handles / `mtr`. Did not use the rail search button. |
| Thumbnail / page input | Page chrome. Not marker-owned Jump. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` per-row search button + mobile detail `aria-label="Jump to this Survey Marker"` + `PDFViewer.handleLocateItemOnPDF` / `pendingLocationItem` / `handleSurveyMarkerCreated` pending branch.

| Candidate | Verdict |
|---|---|
| `aria-label="Jump to this Survey Marker"` | **GAP.** Located marker. `goToPage` + center + select. |
| `aria-label="Set location on PDF"` | **GAP.** Same button when `!bounds \|\| !pageNumber`. Banner + draw assigns stored `pageNumber` / `bounds`. |
| Jump with no location | **This label.** Unlocated row is Set location, not a no-op Jump. |
| Esc / banner X | **Cancel.** Pending cleared; geometry unchanged. Esc was missing (sibling fix). |
| Pen-armed | **Still works.** Set location re-arms `survey-marker`; Jump still navigates. |
| None placed | **Absent.** No search buttons until a rail row exists. |
| Undo after Set location | **Restores unlocated.** `highlight:create` checkpoint. Placed A stays. |
| Jump after Set location on page 3 | **Works.** From page 1, Jump returns to page 3 and centers. |
| 390 | **Detail Jump.** Desktop row search is `!mobileMode`. Header label stays Jump even when unlocated. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

Unlocated items normally arrive from Excel (leftover-18). Playwright seeds one local marker via the DEV `__e2eSurveyMarkers` seam so Set location is reachable without a cloud sheet.

## Source (before live)

- Desktop search button: Jump if `surveyMarker.bounds && surveyMarker.pageNumber`, else Set location.
- Jump (`handleLocateItemOnPDF`): no-op without page+bounds (page-only falls through to `goToPage`); otherwise select + center, zoom to ≥1.5 if needed.
- Set location (`setPendingLocationItem`): banner “Draw a box on the PDF to locate…”. Next `survey-marker` draw writes `pageNumber` + `bounds` onto the pending id and checkpoints `highlight:create`.
- Banner X called `setPendingLocationItem(null)`. Esc did not.
- Set location did not arm `survey-marker`, so Pen/Select could not assign location.
- 390: list row is desktop-only; detail header always says Jump and still branches.

## Product fix

1. **Set location arms the draw tool.** `beginSetLocationOnPdf` sets pending, `activeTool='survey-marker'`, and the marker’s category. Pen-armed / post-Jump Select can still draw the locate box.
2. **Escape cancels pending locate.** Rail key listener clears the banner when Set location armed it. Banner X still works.
3. **DEV seam** `window.__e2eSurveyMarkers` `{ get, patch }` so tests can seed an unlocated row and assert stored geometry without Excel.

Did not revert CreateCategoryModal closed→open reset. Did not revert `survey-marker:category-delete`. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-jump-set-location.spec.mjs` **1 / 1 (8.0s)** on reused Vite `http://localhost:5173` + `?testPdf=spike-120-pages.pdf&surveyTransitionE2E=1`. Node `surveyRailJumpSetLocation.test.mjs` **3 / 3**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Place + Jump | **pass** | `jump-a` on page 1; from page 4 Jump returned to page 1 and centered. |
| Set location assigns geometry | **pass** | Pen-armed draw stored page **1** + bounds; button became Jump. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None placed | **pass** | Jump + Set location **count 0**. |
| Jump with no location | **pass** | Seeded row labeled **Set location on PDF**, not Jump. |
| Esc / X cancel | **pass** | Banner gone; still no bounds. |
| Pen-armed | **pass** | Set location still stored page-1 geometry; Jump from page 2 still left page 2. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo after Set location | **pass** | Ctrl+Z restored unlocated; placed A stayed. |
| Set location on page 3 + Jump | **pass** | Stored `pageNumber: 3`, bounds `x=171.360 y=237.600 w=146.880 h=142.560`. From page 1, Jump → page 3 + in view. |
| 390 | **pass** | Detail `Jump` **1**; desktop `Set location` **0**. Open row via arrow (Walls main dismisses the sheet). |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail Jump (page + center) + Set location (stored page-space bounds).
- **Product bugs fixed:** Set location now arms `survey-marker`; Escape cancels pending locate.
- **Omitted (not invented):** empty-module `onRequestCreateTemplate` start-adding, entity dropdown, Copy-to-space, eraser-on-marker replay.
- **Next unique leftover (not this pass):** rail **Entity** (`aria-label="Entity"` / `survey-marker-entity-trigger` → `applyEntitySelectionForMarker`). Not this Jump/Set location. Not Create category. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-jump-set-location.spec.mjs`
- `tests/surveyRailJumpSetLocation.test.mjs`
- `src/SurveySpacesRail.jsx` (locate-or-set helper, Esc cancel, DEV seam)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
