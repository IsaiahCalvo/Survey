# Empty-module Create template start-adding — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After place-time Entity dialog, the named leftover is empty-module **`onRequestCreateTemplate` start-adding** (`No categories available for this space.` → CreateCategoryModal). Not heading-row plus Create category as the GAP. Not rail Entity picker. Not Jump / Set location. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not U-01 Walls stamp-create. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1` (Empty Module Template). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist Y/N/N-A / Copy-to-space. Did **not** invent `.env.local`. Did **not** replay leftover-18, place-time Entity dialog, rail Entity picker, Jump / Set location, Create category plus, category Delete, Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Create category | Heading-row plus → CreateCategoryModal on a module that already has Walls. Empty-state text button still called the removed template-editor path. |
| Place-time Entity dialog | Walls draw + entity pick. No empty-module start-adding. |
| Hub U-03 templates | `/?hubPreview=1` editor create. Not the viewer empty-module button. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` empty-state (`No categories available for this space.`) + `onRequestCreateTemplate({ mode: 'edit', startAddingCategory: true })` + AppShell `handleCreateTemplateRequest` → Dashboard `openEditTemplateModal` (KAL-82 entities-only stub). KAL-436 Existing/Other each have one category, so the fixture never starts empty.

| Candidate | Verdict |
|---|---|
| Empty-state text button | **GAP.** Called dead `onRequestCreateTemplate` start-adding after KAL-82. |
| Empty name / whitespace | **Blocked.** Confirm disabled (same modal as plus). |
| Cancel | **No-op.** Typed names discarded; empty-state stays. |
| Duplicate template name | **Blocked.** Save as new vs `Empty Module Template` / `KAL-436 Preservation Template`. |
| Duplicate category name | **N/A on empty.** No existing category names until the first create; empty-state button then goes away. |
| Save as new template | **Creates locally.** Heading + picker show the named template; category appears; empty-state gone. Cloud persist fails closed (`22P02` local id) — not invented. |
| Modify current | **Adds the category.** Empty-state goes away on the original Empty Module Template. |
| Pen-armed | **Still works.** Rail start-adding is independent of the drawing tool. |
| Undo | **No checkpoint.** Same as plus Create category; Ctrl+Z left `E2E-Cat`. |
| 390 | **Copy exists; button absent.** Start-adding + dialog gated `!mobileMode` (sibling of plus). |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist Y/N/N-A / Copy-to-space | Parked / compile-hidden / no enterable copy-mode (`setCopyModeActive(true)` has zero callers). Not invented. |

Real path to an empty module: local seed **Empty Module Template** / `Empty Survey Data` (`categories: []`). Did **not** delete the last KAL-436 category (that leftover stands) and did **not** invent cloud persist.

## Source (before live)

- Empty-state button called `onRequestCreateTemplate({ mode: 'edit', startAddingCategory: true })`.
- AppShell forwarded that to `dashboardRef.openEditTemplateModal`, which only reseeds entities (no modal, no category).
- Heading-row plus already opened `CreateCategoryModal` → `addCategoryToCurrentTemplate` / `addCategoryAsNewTemplate`.
- 390 plus + modal already desktop-only.

## Product fix

1. **Dead start-adding.** Empty-state button now calls `openCreateCategoryModal` (same modal as plus). Distinct `aria-label="Create category for empty module"` / class `survey-marker-empty-module-create-button` so the plus leftover is not replayed as the GAP.
2. **390.** Button gated `!mobileMode` so a tap cannot set modal-open with no dialog.
3. **Local empty-module seed.** `DevTestRoute` `surveyTransitionE2ETemplates` adds **Empty Module Template** with one empty module. Isolated from KAL-436 Existing/Other so module-nav stays two steps.

Did not add a create undo checkpoint (product omits the template slice on ordinary snapshots). Did not revert place-time Entity Esc-skip, rail Entity checkpoint, or Set-location arm/Esc. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched.

## Live-proved

Playwright `debug/scenarios/e2e-survey-empty-create-template.spec.mjs` **1 / 1 (10.1s)** on Vite `http://127.0.0.1:5194` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyEmptyCreateTemplate.test.mjs` **3 / 3**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty-state → Save as new template | **pass** | Heading `E2E Empty Template`; picker lists it (`1 module`); `E2E-First` row; empty-state gone. |
| Empty-state → modify current | **pass** | Original Empty Module Template still empty after the clone; `E2E-Cat` appeared; empty-state gone. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace | **pass** | Confirm **disabled**. |
| Duplicate template name | **pass** | `Empty Module Template` / `KAL-436 Preservation Template` inline already-exists; confirm **disabled**. |
| Cancel | **pass** | Typed names discarded; empty-state stayed. |
| Pen-armed | **pass** | After `p`, confirm still added `E2E-Pen`; empty-state gone. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo | **pass** | No create checkpoint; Ctrl+Z left `E2E-Cat`. |
| 390 | **pass** (absent) | Empty-state copy visible; `emptyCreateCount: 0`, `createDialogCount: 0`. |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened. Cloud persist of the local seed id fails closed (`invalid input syntax for type uuid: "kal436-empty-module-template"`) — expected, not invented.

## Classification after this pass

- **GAP found and proven:** empty-module start-adding via the empty-state button → CreateCategoryModal → save-as-new-template / modify-current.
- **Product bug fixed:** dead `onRequestCreateTemplate` start-adding now opens the live modal; 390 no longer offers a dead button.
- **Omitted (not invented):** Copy-to-space (copy mode never entered — `setCopyModeActive(true)` has zero callers), checklist Y/N/N-A (KAL-436 still has no checklist items), eraser-on-marker replay, category Move/Copy stub toast.
- **Next unique leftover (not this pass):** survey-rail **category reorder** (`SortableRearrangeList` → `handleReorderSurveyCategories`). Not Copy-to-space (no enterable copy mode). Not checklist Y/N/N-A (no fixture items). Not category Move/Copy stub. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/SurveySpacesRail.jsx` (empty-state → `openCreateCategoryModal`; desktop-only)
- `src/DevTestRoute.jsx` (local Empty Module Template seed)
- `src/components/CreateCategoryModal.jsx` (comment only)
- `debug/scenarios/e2e-survey-empty-create-template.spec.mjs`
- `tests/surveyEmptyCreateTemplate.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
