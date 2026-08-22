# Survey-rail Entity picker — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Jump / Set location, the named leftover is rail **Entity** (`survey-marker-entity-trigger` / listbox `aria-label="Entity"` → `applyEntitySelectionForMarker`). Not Jump / Set location. Not Create category. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not U-01 Walls stamp-create as the GAP. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (pick) and `?testPdf=text-search-glyph-lab.pdf&surveyTransitionE2E=1` (empty list). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** invent a `__e2eSurveyEntities` persist seam. Did **not** replay leftover-18, Jump / Set location, Create category, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Jump / Set location | Search button locate / draw. Entity trigger unexecuted. |
| Rail Create category | Plus → modal → template append. No entity write. |
| Rail Rename | Name field. No `entityId`. |
| Keep active / notes | After-place arm + Note dialog. Picker unopened. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` desktop `survey-marker-entity-trigger` + listbox `aria-label="Entity"` + shared `applyEntitySelectionForMarker`. Mobile detail `aria-label="Choose Survey Marker entity"`.

| Candidate | Verdict |
|---|---|
| `survey-marker-entity-trigger` / `aria-label="Entity"` | **GAP.** Single-select list of `selectedTemplate.entities` plus **None** clear. |
| Multi-select | **No.** One `entityId`. Pick closes the listbox. |
| Open / close without pick | **No-op.** Esc / outside mousedown closes. Stored id unchanged. |
| Pick None when already None | **No-op.** Same-id return; no checkpoint. |
| None placed / none expanded | **Absent.** Trigger is `isSurveyMarkerExpanded` only. |
| Pen-armed | **Still picks.** |
| Empty entity list | **None only.** KAL-436 fixture has no `entities`. |
| Change / clear | **Works.** GC → Subcontractor → None. |
| Undo (before fix) | **Bug.** No checkpoint. Ctrl+Z would pop `highlight:create`. |
| 390 | **Detail swatch.** Desktop trigger `!mobileMode`. `Choose Survey Marker entity` + same helper. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

KAL-436 has **no** `entities` so place skips the desktop Entity dialog (existing marker E2E depend on that). No `__e2eSurveyEntities` seam exists. Added a second **local** `Survey Entities Template` (GC / Subcontractor / 100% Complete) — not cloud persist.

## Source (before live)

- Desktop trigger gated `!mobileMode && isSurveyMarkerExpanded`. Options = `[{ id:'', name:'None' }, ...entities]`.
- `applyEntitySelectionForMarker`: writes `surveyMarkers[id].entityId/Name/Color` and mirrors onto the linked item + same-space annotations. `entityId` `''` / null clears.
- Place-time `pendingEntitySelection` (PDFViewer) is a **different** dialog — dismissed here so the rail picker is the first stored write.
- 390: list row is `Open ${name}`; detail swatch toggles `mobileDetailDropdown === 'entity'`.

## Product fix

`applyEntitySelectionForMarker` now no-ops when the id is unchanged, then calls `addHistoryCheckpoint('survey-marker:entity', { annotationId })` before the store write. Sibling of `survey-marker:rename`. Live: Ctrl+Z restores None; both placed markers stay.

Did not revert Set-location arm / `survey-marker` / Esc-clear-banner. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-entity.spec.mjs` **1 / 1 (12.6s)** on reused Vite `http://localhost:5173`. Node `surveyRailEntity.test.mjs` **3 / 3**.

IDs: markerA `surveyMarker-76e2af0e-…`, markerB `surveyMarker-3a33564a-…`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Pick GC | **pass** | Trigger label **GC**; stored `entityId=kal436-entity-gc` + name + color. B stayed empty. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| None placed / none expanded | **pass** | Trigger **count 0** until Expand marker details. |
| Open / close without pick | **pass** | Esc; still None; no `entityId`. |
| Pick None when already None | **pass** | Still empty. |
| Pen-armed | **pass** | Stored `kal436-entity-complete`. |
| Empty entity list | **pass** | KAL-436 on `text-search-glyph-lab.pdf`: options **`["None"]`**. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Change entity | **pass** | GC → `kal436-entity-sub` (Subcontractor). |
| Clear | **pass** | None; `entityId` null. |
| Undo | **pass** | After GC, Ctrl+Z restored None; A + B stayed. |
| 390 | **pass** | Desktop trigger **0**; detail `Choose Survey Marker entity` **1**; pick GC stored `kal436-entity-gc`; caption **Entity: GC**. Seed via existing `__e2eSurveyMarkers` (not a new persist seam). |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail Entity single-select + None clear + stored id / trigger label.
- **Product bugs fixed:** entity pick now checkpoints `survey-marker:entity` so undo does not pop the place.
- **Omitted (not invented):** empty-module `onRequestCreateTemplate` start-adding, place-time Entity dialog (`pendingEntitySelection`), Copy-to-space, eraser-on-marker replay, checklist Y/N/N-A (KAL-436 still has no checklist items).
- **Next unique leftover (not this pass):** place-time **Entity dialog** (`pendingEntitySelection` after a Walls draw when `template.entities.length > 0`) — not this rail trigger. Not checklist Y/N/N-A (no fixture items). Not Copy-to-space. Not Jump / Set location. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-entity.spec.mjs`
- `tests/surveyRailEntity.test.mjs`
- `src/SurveySpacesRail.jsx` (entity checkpoint + same-id no-op)
- `src/DevTestRoute.jsx` (local Survey Entities Template; KAL-436 stays empty)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
