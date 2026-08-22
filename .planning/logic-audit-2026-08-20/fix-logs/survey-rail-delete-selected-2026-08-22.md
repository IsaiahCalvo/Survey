# Survey-rail Delete selected items — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After overlay Delete Survey Marker + Select Backspace/Delete, the named leftover is rail **Delete selected items** (`aria-label="Delete selected items"` + confirm → `handleDeleteSurveyMarkerItem`). Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create. Not handle drag. Not Keep active / Survey notes / module nav as the GAP. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes (as the GAP), Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Overlay Delete Survey Marker | SVG chrome + Select Backspace/Delete. Not the rail list. |
| E-04 Delete | After-blur Backspace on a **user rect**. Not a survey-rail row. |
| Counter-series Delete | Pin / series-list Delete **renumbers** counters. Not `surveyMarkers`. |
| e2e-survey-marker | Place / persist / export-exclude / undo second. No rail Select + confirm. |
| Handle drag | Body / 8 resize / `mtr`. Rail delete unexecuted. |
| Survey notes | Save/Cancel on the Note dialog. Did not press rail Delete while notes was open. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` item Select toolbar + `PDFViewer.handleDeleteSurveyMarkerItem`.

| Candidate | Verdict |
|---|---|
| `aria-label="Delete selected items"` | **GAP.** Desktop item Select toolbar. Confirm then `handleDeleteSurveyMarkerItem`. |
| None selected | **Disabled** (`itemSelectedCount === 0`). Not hidden. Toast if the handler is reached empty. |
| Cancel confirm | **No-op.** `if (!confirmed) return;` before the delete loop. |
| Pen-armed | **Still works.** Rail selection is independent of the drawing tool. |
| Notes dialog open | **Hittable.** `#chrome-right-host` z 5600 stays above the viewer notes overlay; confirm still deletes. |
| Multi-select | **All** selects every category marker; confirm label is `Delete N items`. |
| 390 | **Absent.** Toolbar gated `!copyModeActive && !mobileMode`. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- `SurveySpacesRail`: category expand → **Select** → leading checkboxes (`Select` / `Deselect ${name}`). Delete is disabled at zero. `askConfirm({ title: Delete N item(s)?, danger: true })`. On confirm, `selectedItemIds.forEach(handleDeleteSurveyMarkerItem)`.
- `PDFViewer.handleDeleteSurveyMarkerItem` → `handleSurveyMarkerDeleted` → `addHistoryCheckpoint('highlight:delete')` + `canCommitSurveyMarkerErase`. `?testPdf=` mock user `dev-test-user` is local-only owner, so the gate permits. Undo restores.
- 390: no item Select / Delete selected items strip. Same mobile sheet as prior 390 hunts.

## Product fix

None. Disabled-none, cancel, confirm-one, confirm-both, Pen-armed, notes-open, and undo already matched the intended contract. 390 absence is the `!mobileMode` demo-parity gate, not a miss. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, or the rotation-stem hit gap.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-delete-selected.spec.mjs` **1 / 1 (6.6s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailDeleteSelected.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-57b4f66f-…`, markerB `surveyMarker-f74a4490-…`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Select one + confirm | **pass** | A gone; B stayed. |
| Undo after rail-delete | **pass** | Ctrl+Z restored A. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None selected | **pass** | Button **visible + disabled**; count stayed **2**. |
| Cancel confirm | **pass** | Dialog `Delete 1 item?` → Cancel; A and B stayed. |
| Pen-armed | **pass** | After `p`, button stayed enabled; confirm still removed A; B stayed; undo restored A. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Multi-select All | **pass** | `Delete 2 items?` wiped both; undo restored A and B. |
| Notes dialog open | **pass** | Rail Delete stayed hittable (`notesHit.hittable: true`); confirm removed A; B stayed. |
| 390 | **pass** (absent) | `deleteSelectedCount: 0`, `selectToolbarCount: 0`. Desktop-only admin chrome. |

No `file.id`. No error boundary. SVG default. Cap **8448** not loosened (no high-risk edit). Official `npm test` not replayed.

## Classification after this pass

- **GAP found and proven:** survey-rail Delete selected items + confirm + undo.
- **Product bug:** none.
- **Omitted (not invented):** rail rename field, Delete selected categories, Copy-to-space, eraser-on-marker replay.
- **Next unique leftover (not this pass):** rail **Rename** field (`aria-label={`Rename ${name}`}` → `commitSurveyMarkerName`). Not overlay Delete. Not this rail Delete. Not E-04 rect Backspace. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-delete-selected.spec.mjs`
- `tests/surveyRailDeleteSelected.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
