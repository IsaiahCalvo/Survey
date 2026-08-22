# Survey-rail item reorder — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After category reorder, the named leftover is survey-rail **item reorder** (`SortableRearrangeList` inside an expanded category → `reorderSurveyMarkersInCategory`). Not category reorder. Not heading-row plus Create category. Not empty-module start-adding. Not category Delete. Not item Delete as the GAP (compose-edge only). Not Rename. Not overlay Delete. Not Move/Copy stub. Not checklist Y/N/N-A. Not Copy-to-space. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (KAL-436 Walls). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-space. Did **not** invent `.env.local`. Did **not** replay leftover-18, category reorder, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete as the GAP, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Category reorder | Module category list `handleReorderSurveyCategories`. Not items inside a category. |
| Rail Delete selected items | Wipe by id after Select. Not `moveItemById` on `categorySurveyMarkers`. |
| Rail Rename | Name field. Order unproven. |
| V-07 Bookmarks dnd-kit | Bookmarks tree, not survey items. |

## Hunt (independent catalog)

Inspected first: expanded-category `SortableRearrangeList` + desktop `DragRearrangeHandle` (`title="Drag to rearrange"`) → `reorderSurveyMarkersInCategory` → `moveItemById` + `surveyMarkerOrder` 1-based write. KAL-436 Walls starts empty; place ≥2 markers, expand, drag. No Move up / Move down on the item list (desktop or 390).

| Candidate | Verdict |
|---|---|
| Desktop drag handle (≥2 items) | **GAP.** Grip handle; drop updates stored `surveyMarkerOrder` + rail order. |
| Keyboard Space / Arrow | Wired `KeyboardSensor`. Playwright click+Space did not start a drag; pointer path did. Not claimed as a second product control. |
| Single-item list | **Handle present, no-op.** Self-drop / `activeId === overId` returns early. |
| Cancel mid-drag | **No-op.** Escape while `drag-rearrange-dragging` leaves the first item first. |
| Pen-armed | **Still works.** Rail handle is independent of the drawing tool. |
| Undo | **Product checkpoint added.** Live-before-fix: no `addHistoryCheckpoint`; Ctrl+Z would pop the last place. Sibling of `survey-marker:rename` / `:entity`. After `survey-marker:reorder`, Ctrl+Z restores prior order; both ids stay. |
| Delete selected after reorder | **Id targeting.** After `item-b` first, Delete `item-b` wiped that id; `item-a` stayed. |
| 390 | **Absent.** `mobileMode ? null` — no handle, no up-down. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / Copy-to-space | Parked / compile-hidden / no enterable copy-mode (`setCopyModeActive(true)` has zero callers). Item toolbar Copy opens `setShowSpaceSelection` — not invented this pass. |

Did **not** invent a Two Category seed for this leftover. Cloud persist of `?testPdf=` fails closed — not invented.

## Source (before live)

- Inner `SortableRearrangeList` `onReorder` calls `reorderSurveyMarkersInCategory(categorySurveyMarkers, activeId, overId)`.
- Handler `moveItemById`s the category items, writes `surveyMarkerOrder: index + 1` via `setSurveyMarkers`.
- Live-before-fix: no `addHistoryCheckpoint` (last place would undo).
- Desktop handle only; 390 item rows are tap rows. No up-down buttons.

## Product fix

`survey-marker:reorder` checkpoint before the order write — sibling of rename/entity so Ctrl+Z restores prior rail order instead of popping the last place. Same-id / self-drop still returns before the checkpoint. Did not hide the single-item handle (self-drop is the product no-op). Did not revert empty-state CreateCategoryModal wiring, place-time Entity Esc-skip, rail Entity checkpoint, or Set-location arm/Esc. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched. `SurveySpacesRail.jsx` only.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-item-reorder.spec.mjs` **1 / 1 (25.6s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailItemReorder.test.mjs` **3 / 3**. Pointer method (keyboard Space/Arrow did not activate in Playwright; pointer fallback did).

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| First no longer first | **pass** | Rail + stored `['item-b', 'item-a']`; `surveyMarkerOrder` `[1, 2]`. |
| Pen-armed second swap | **pass** | After undo restored `['item-a', 'item-b']`, `p` then pointer swap → `['item-b', 'item-a']`. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel mid-drag | **pass** | Escape while dragging left `['item-a', 'item-b']`. |
| Single-item list | **pass** | After Delete item-b, item-a handle still shown; self-drag left `['item-a']`. |
| Pen-armed | **pass** | See intended second swap. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** | After checkpoint, Ctrl+Z restored `['item-a', 'item-b']`; both ids stayed. |
| Delete selected after reorder | **pass** | Select item-b + confirm wiped item-b; item-a stayed. |
| 390 | **pass** (absent) | `handleCount: 0`, `upDownCount: 0`. |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail item reorder via desktop `DragRearrangeHandle` → `reorderSurveyMarkersInCategory` → stored `surveyMarkerOrder` + rail order.
- **Product bug fixed:** missing undo checkpoint (`survey-marker:reorder`).
- **Omitted (not invented):** Copy-to-space (copy mode never entered — `setCopyModeActive(true)` has zero callers; item toolbar Copy → `setShowSpaceSelection` not hunted), checklist Y/N/N-A (KAL-436 still has no checklist items), category Move/Copy stub toast.
- **Next unique leftover (not this pass):** rail item **Copy → space selection** (`setShowSpaceSelection`). Not invented this pass (Copy-to-space / Move-Copy stub stay parked). Checklist Y/N/N-A still parked. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/SurveySpacesRail.jsx` (`survey-marker:reorder` + DEV `__e2eSurveyItemOrder`)
- `debug/scenarios/e2e-survey-rail-item-reorder.spec.mjs`
- `tests/surveyRailItemReorder.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
