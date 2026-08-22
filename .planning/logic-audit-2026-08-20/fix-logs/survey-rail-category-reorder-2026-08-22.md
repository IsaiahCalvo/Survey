# Survey-rail category reorder — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After empty-module Create template, the named leftover is survey-rail **category reorder** (`SortableRearrangeList` → `handleReorderSurveyCategories`). Not heading-row plus Create category. Not empty-module start-adding. Not category Delete as the GAP (compose-edge only). Not item reorder (`reorderSurveyMarkersInCategory`). Not Move/Copy stub. Not checklist Y/N/N-A. Not Copy-to-space. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (Two Category Template). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-space. Did **not** invent `.env.local`. Did **not** replay leftover-18, empty-module Create template, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete as the GAP, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Empty-module Create template | Empty-state start-adding on a 0-category module. No drag-reorder. |
| Rail Create category | Plus → modal adds a row. Order of existing rows unproven. |
| Rail Delete selected categories | Wipe by id after Select. Not `moveItemById` on the category list. |
| V-07 Bookmarks dnd-kit | Bookmarks tree, not survey categories. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` category `SortableRearrangeList` + desktop `DragRearrangeHandle` (`title="Drag category to rearrange"`) → `handleReorderSurveyCategories` → `moveItemById`. KAL-436 Existing/Other each have **one** category, so the fixture never starts with ≥2 rows. No Move up / Move down on the category list (desktop or 390).

| Candidate | Verdict |
|---|---|
| Desktop drag handle (≥2 cats) | **GAP.** Grip handle; drop updates stored `selectedTemplate.modules[].categories` + rail order. |
| Keyboard Space / Arrow | Wired `KeyboardSensor`. Playwright click+Space did not start a drag; pointer path did. Not claimed as a second product control. |
| Single-category list | **Handle present, no-op.** Self-drop / `activeId === overId` returns the same array. |
| Cancel mid-drag | **No-op.** Escape while `drag-rearrange-dragging` leaves Walls first. |
| Pen-armed | **Still works.** Rail handle is independent of the drawing tool. |
| Undo | **No checkpoint.** Same as Create category; Ctrl+Z left `[Windows, Walls]`. |
| Delete selected after reorder | **Id targeting.** After Walls-first restore, Delete Windows wiped `kal436-two-cat-windows`; Walls `kal436-two-cat-walls` stayed. |
| 390 | **Absent.** `mobileMode ? null` — no handle, no up-down. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / Copy-to-space | Parked / compile-hidden / no enterable copy-mode (`setCopyModeActive(true)` has zero callers). Not invented. |

Real path to ≥2 categories: local seed **Two Category Template** / `Two Category Survey` (`Walls` then `Windows`). Did **not** replay Create category as the GAP. Cloud persist of the local seed id fails closed — not invented.

## Source (before live)

- `SortableRearrangeList` `onReorder` calls `handleReorderSurveyCategories(selectedModuleId, activeId, overId)`.
- Handler `moveItemById`s the module categories, writes `setSelectedTemplate` + `handleTemplatesChange`, optional Supabase config persist.
- No `addHistoryCheckpoint` (template slice omitted on ordinary snapshots).
- Desktop handle only; 390 comment: reorder stays a desktop affordance. No up-down buttons.

## Product fix

None. Pointer handle reorder already stored the new order. Did not invent a reorder undo checkpoint. Did not hide the single-category handle (self-drop is the product no-op). Did not revert empty-state CreateCategoryModal wiring, place-time Entity Esc-skip, rail Entity checkpoint, or Set-location arm/Esc. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-category-reorder.spec.mjs` **1 / 1 (23.5s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailCategoryReorder.test.mjs` **3 / 3**. Pointer method (keyboard Space/Arrow did not activate in Playwright; pointer fallback did).

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Walls no longer first | **pass** | Rail + stored `['Windows', 'Walls']`; ids `kal436-two-cat-windows` then `kal436-two-cat-walls`. |
| Pen-armed second swap | **pass** | After `p`, Windows dragged back under Walls → `['Walls', 'Windows']`. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel mid-drag | **pass** | Escape while dragging left `['Walls', 'Windows']`. |
| Single-category list | **pass** | After Delete Windows, Walls handle still shown; self-drag left `['Walls']` / `kal436-two-cat-walls`. |
| Pen-armed | **pass** | See intended second swap. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** | No reorder checkpoint; Ctrl+Z left `['Windows', 'Walls']`. |
| Delete selected after reorder | **pass** | Select Windows + confirm wiped Windows; Walls stayed. |
| 390 | **pass** (absent) | `handleCount: 0`, `upDownCount: 0`. |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened. Cloud persist of the local seed id fails closed — expected, not invented.

## Classification after this pass

- **GAP found and proven:** survey-rail category reorder via desktop `DragRearrangeHandle` → `handleReorderSurveyCategories` → stored + rail order.
- **Product bug fixed:** none.
- **Omitted (not invented):** Copy-to-space (copy mode never entered — `setCopyModeActive(true)` has zero callers), checklist Y/N/N-A (KAL-436 still has no checklist items), category Move/Copy stub toast, item reorder.
- **Next unique leftover (not this pass):** survey-rail **item reorder** (`SortableRearrangeList` inside an expanded category → `reorderSurveyMarkersInCategory`). Not Copy-to-space. Not checklist Y/N/N-A. Not category Move/Copy stub. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/DevTestRoute.jsx` (local Two Category Template seed)
- `src/SurveySpacesRail.jsx` (DEV `__e2eSurveyCategoryOrder` read seam)
- `debug/scenarios/e2e-survey-rail-category-reorder.spec.mjs`
- `tests/surveyRailCategoryReorder.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
