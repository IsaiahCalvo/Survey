# Survey-rail Create category — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After rail Delete selected categories, the named leftover is rail **Create category** (`aria-label="Create category"` → `CreateCategoryModal` → `addCategoryToCurrentTemplate` / `addCategoryAsNewTemplate`). Not item Delete selected. Not overlay Delete. Not E-04 rect Backspace. Not counter-series Delete. Not Rename. Not category Delete as the GAP (compose-edge only). Not U-01 Walls stamp-create. Live-proved on `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick. Did **not** invent `.env.local`. Did **not** replay leftover-18, category Delete (except create-then-delete compose), Rename, item Delete, overlay delete, handle drag, U-01 Walls create, Keep active, Survey notes, Survey module, nubbin, bbox edit, vertex-N, line handles, callout family, page ctx, thumbnail, Fit height, Bookmarks, Eraser/Counter catalogs, F3, counter-series Delete, Cloud bump, Search, keyboard, every-swatch, thin leftovers, PDF links, History, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is a GAP

| Prior claim | What was actually asserted |
|---|---|
| Rail Delete selected categories | Category checkbox + `deleteCategory` + marker wipe. Plus button unexecuted. |
| Rail Rename | `Rename ${name}` → `commitSurveyMarkerName`. No template append. |
| Rail Delete selected items | Item checkboxes + `handleDeleteSurveyMarkerItem`. Not CreateCategoryModal. |
| Survey module nav | Previous/Next module. Did not add a category definition. |

## Hunt (independent catalog)

Inspected first: `SurveySpacesRail` heading-row plus (`survey-marker-category-create-button`) + `CreateCategoryModal` + `PDFViewer.handleAddCategoryToCurrentTemplate` / `handleAddCategoryAsNewTemplate`.

| Candidate | Verdict |
|---|---|
| `aria-label="Create category"` | **GAP.** Desktop Categories heading plus. Opens the modal. |
| Category name | **Required + trimmed.** Confirm disabled while empty / whitespace. |
| Duplicate name | **Blocked.** Case-insensitive vs the selected module’s existing names. |
| Cancel | **No-op.** `onClose` / overlay / Escape. Typed name discarded. |
| Template vs new-template | **Choice required.** Modify current (this pass’s confirm) or Save as new template (name field appears). |
| Pen-armed | **Still works.** Rail create is independent of the drawing tool. |
| Undo | **No checkpoint.** Product comment: ordinary snapshots omit the template slice so pen/shape undo does not rewind Create category. Live: Ctrl+Z left `E2E-Cat` in the rail. |
| Create then Delete selected categories | **Still works.** Select `E2E-Cat` + confirm wiped that row; Walls stayed; undo restored `E2E-Cat`. |
| 390 | **Absent.** Plus + modal gated `!mobileMode`. |
| Empty-module text button | **Different path.** `onRequestCreateTemplate({ startAddingCategory: true })` — not this plus/modal GAP. |
| leftover-18 / Print / Forms / Note create / Group / stamp / measure / Extract / Link create | Parked / compile-hidden. Not invented. |

## Source (before live)

- Desktop plus in the Categories heading opens `CreateCategoryModal`. Name + save option required. Confirm calls `addCategoryToCurrentTemplate` (append `{ id, name, checklist: [] }` on the current module) or `addCategoryAsNewTemplate`.
- New row is not auto-armed. Clicking `.survey-marker-category-main` sets `selectedCategoryId` and `survey-marker`.
- 390: no plus, no modal.
- Empty-module fallback still routes to the removed template-editor start-adding path (omitted).

## Product fix

1. **Open-reset race.** `CreateCategoryModal` reset lived in `useEffect([isOpen, templateName, templateId])`. A fill immediately after open was wiped on the next paint (confirm stayed disabled). Live-before-fix: cancel path (slow) enabled confirm; reopen + immediate `E2E-Cat` left the button disabled and the name field empty. Reset now runs on the closed→open edge **during render** so a post-paint effect cannot rewind a typed name. `templateName` / `templateId` flicker no longer clears an in-progress create. Usage check stays in an effect.

Did not add a create undo checkpoint (product omits the template slice on ordinary snapshots). Did not revert `survey-marker:category-delete`. Did not touch `data-handle={vertex-N}`, `data-counter-nubbin-handle`, `zoomGeneration`, SVG viewBox zoom, or canvas sizing. High-risk files untouched.

## Live-proved

Playwright `debug/scenarios/e2e-survey-rail-create-category.spec.mjs` **1 / 1 (6.6s)** on reused Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1`. Node `surveyRailCreateCategory.test.mjs` **3 / 3**.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Plus → modal → modify current | **pass** | `E2E-Cat` row appeared; Walls stayed. |
| Click to arm | **pass** | Sub-toolbar `E2E-Cat` `btn-active`. |

### Break — **pass** (asserted product)

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace | **pass** | Confirm **disabled**. |
| Duplicate Walls / walls | **pass** | Inline already-exists error; confirm **disabled**. |
| Cancel | **pass** | Typed `E2E-Cat` discarded; Walls stayed. |
| Pen-armed | **pass** | After `p`, confirm still added `E2E-Pen`; `E2E-Cat` + Walls stayed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Save-as-new-template field | **pass** | Option shows name default `KAL-436 Preservation Template (Updated)`. Not confirmed. |
| Undo | **pass** | No create checkpoint; Ctrl+Z left `E2E-Cat`. |
| Create then Delete selected categories | **pass** | Select `E2E-Cat` + confirm wiped that row; Walls stayed; undo restored `E2E-Cat`. |
| 390 | **pass** (absent) | `createCategoryCount: 0`, `createDialogCount: 0`. Desktop-only admin chrome. |

No `file.id` (`persist: null`). No error boundary. SVG default. High-risk files untouched; official `npm test` / 8448 leftover not re-run and not loosened.

## Classification after this pass

- **GAP found and proven:** survey-rail Create category + modal name/option + current-template append + arm-on-click.
- **Product bug fixed:** open-reset `useEffect` raced the name field.
- **Omitted (not invented):** empty-module `onRequestCreateTemplate` start-adding, entity dropdown, Jump/Set location, Copy-to-space, eraser-on-marker replay.
- **Next unique leftover (not this pass):** rail **Jump/Set location** (`aria-label="Jump to this Survey Marker"` / `"Set location on PDF"`). Not this Create category. Not category Delete. Not item Delete. Not Rename. Not overlay Delete. Not E-04. Not counter-series Delete. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-survey-rail-create-category.spec.mjs`
- `tests/surveyRailCreateCategory.test.mjs`
- `src/components/CreateCategoryModal.jsx` (closed→open reset during render)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
