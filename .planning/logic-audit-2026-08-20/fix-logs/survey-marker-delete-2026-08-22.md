# Survey-marker delete chrome — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After placed-marker handle drag, the named leftover is overlay **Delete Survey Marker** + Select-mode Backspace/Delete on a *placed* marker. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create. Not handle drag. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, handle drag, U-01 Walls create, Keep active, Survey notes (as the GAP), Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| E-04 Delete | After-blur Backspace on a **user rect**. Not a survey marker. |
| Counter-series Delete | Pin / series-list Delete **renumbers** counters. Not `surveyMarkers`. |
| e2e-survey-marker | Place / persist / export-exclude / undo second. No overlay Delete. |
| Handle drag | Body / 8 resize / `mtr`. Delete chrome unexecuted. |
| Survey notes | Save/Cancel on the Note dialog. Did not press Delete while the field was focused. |

## Hunt (independent catalog)

Inspected first: `SVGAnnotationLayer` overlay Delete + Select-mode keydown, `PDFViewer.handleDeleteSurveyMarker`.

| Candidate | Verdict |
|---|---|
| `aria-label="Delete Survey Marker"` | **GAP.** Select-only SVG `<g role="button">`. `onPointerUp` → `deleteSelectedSurveyMarker`. |
| Select-mode Backspace / Delete | **GAP.** Window capture keydown when `isSelectTool && selectedSurveyMarkerId`. |
| None selected | **Hidden.** Render gated on `selectedSurveyMarkerDeleteBounds`. Keys no-op. |
| Pen-armed | **Hidden.** Leaving Select clears `selectedSurveyMarkerId`. |
| Notes dialog focused | **Focus guard.** INPUT / TEXTAREA / contentEditable return before delete. |
| Rail `Delete selected items` | **Omitted this pass.** Confirm + `handleDeleteSurveyMarkerItem`. Next leftover. |
| 390 overlay | Same SVG chrome. Sheet backdrop can eat Playwright place (same as handle-drag). |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- `SVGAnnotationLayer`: overlay Delete renders only when `isSelectTool && selectedSurveyMarkerDeleteBounds && onDeleteSurveyMarker`. Keyboard listener is Select + selected-id only; focus guard skips INPUT/TEXTAREA/contentEditable. Bounds sit at preferredX/Y in viewBox space (`76 * inverseScale` × `48 * inverseScale`).
- `PDFViewer.handleDeleteSurveyMarker` → `handleSurveyMarkerDeleted` → `addHistoryCheckpoint('highlight:delete')` + `canCommitSurveyMarkerErase`. `?testPdf=` mock user `dev-test-user` is local-only owner, so the gate permits.
- 390: no distinct mobile Delete strip. Same overlay. Place via Playwright mouse/dispatch often fails under the sheet backdrop.

## Product fix

None. Overlay delete, keys, focus guard, and undo already matched the intended contract. Playwright treats the SVG `<g>` as CSS-hidden; the painted rect is still hittable. Not a product bug. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, or the rotation-stem hit gap.

## Live-proved

Playwright `debug/scenarios/e2e-survey-marker-delete.spec.mjs` **1 / 1 (6.2s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyMarkerDeleteChrome.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-15eb849c-…`, markerB `surveyMarker-2f582589-…`. `viewBox="0 0 612 792"`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Click Delete Survey Marker | **pass** | A gone; B stayed; chrome count 0 after. |
| Select-mode Backspace | **pass** | A gone; B stayed; Ctrl+Z restored A. |
| Select-mode Delete | **pass** | A gone; B stayed; Ctrl+Z restored A. |
| Undo after chrome-delete | **pass** | Ctrl+Z restored A before the key slices. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None selected | **pass** | Delete chrome count **0**; Backspace/Delete left count **2**. |
| Pen-armed | **pass** | After `p`, chrome count **0**; A and B still present. |
| Notes dialog focused | **pass** | Typed `HELLO`, Backspace → `HELL`; Delete left `HELL`; A and B stayed. Cancel dropped the draft. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Delete one of two | **pass** | Chrome / Backspace / Delete each removed only A. |
| Zoom then delete | **pass** | `viewBox="0 0 612 792"`; chrome-delete removed B; A stayed; undo restored B. |
| 390 | **pass** (chrome identity) | Same overlay in source. Playwright place did not land (sheet backdrop — same as handle-drag 390). Desktop already clicked Delete + both keys. |

No `file.id`. No error boundary. SVG default. Cap **8448** not loosened (no high-risk edit). Official `npm test` not replayed.

## Classification after this pass

- **GAP found and proven:** placed survey-marker overlay Delete + Select-mode Backspace/Delete + undo.
- **Product bug:** none.
- **Omitted (not invented):** rail `Delete selected items` confirm, rename field, eraser-on-marker replay.
- **Next unique leftover (not this pass):** survey-rail **Delete selected items** (`aria-label="Delete selected items"` + confirm → `handleDeleteSurveyMarkerItem`). Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-marker-delete.spec.mjs`
- `tests/surveyMarkerDeleteChrome.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
