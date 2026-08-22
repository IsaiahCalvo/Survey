# Templates New category / category Duplicate / module Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates Add module / module Duplicate / Add checklist item, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 create/rename/delete / entity color / Add module / module Duplicate / Add checklist item: Templates editor **New category** (`New category` / `addCategory` / `Category N`), **category Duplicate** (`duplicateCategories` / `${name} copy` — not template-list Duplicate), and **module Delete** (`deleteModules` / Edit modules trash). FEATURE-MATRIX named these three as the leftover. Add module never opened New category or the category Select strip. Distinct from viewer every-swatch, leftover-18 export, and from already-proven template create/rename/delete. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create `Template 3`, rename+Save, blank-rename no-op, delete `Template 4`. New category / category Duplicate / module Delete never opened. |
| Add module / module Duplicate / Add checklist item | Module tabs + Cameras item create. Category chrome and Edit-modules trash never opened as the GAP. |
| Entity color | Fill/Cancel/Save on the roster picker. Category list never mutated. |
| leftover-18 Space CSV / PDF Pages | Named leftover-18. That host stays parked. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Legal slice already in `leftover18-unblock-2026-08-21.md`. Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Template-list Duplicate (`duplicateTemplates` → `{name} copy`) | Distinct list action (sibling of already-proven New template / Delete). **Not this leftover.** Asserted: leftover is **category Duplicate** + **module Delete**. |
| `New category` / `addCategory` / `Category N` | **GAP.** |
| Categories Select `duplicateCategories` / `${name} copy` | **GAP.** |
| Edit modules `deleteModules` / trash `aria-label="Delete"` | **GAP.** Confirm dialog **absent** (immediate delete). Archive-confirm is checklist-usage only. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `addCategory` / `addCategoryToModule`: unique `Category N`, empty `items`, opens the new row. Empty/whitespace title `resolveTitleCommit` **restore** (model never accepts blank). Escape writes the old name back then blur-no-op. Dirty via `mutateTpl`. Cancel `reloadFromProps`.
- `duplicateCategories`: Select in the Categories chrome; none-selected disabled; copy inserted after source as `${name} copy` with new ids. Dirty. Cancel discards. `setSelCats(new Set())` after copy; dirty-bar Cancel does **not** exit Select (`Done` stays).
- `deleteModules`: Edit modules trash. None-selected disabled. **No confirm** — `removeByIds` immediately. No last-module guard. Dirty. Cancel restores. Archive-confirm modal is KAL-44 checklist usage only.
- No history undo — Cancel is the revert. Ctrl+Z does not pop the working copy.
- 390: `New category` in the categories section; Select opens category Duplicate; module Select opens the same Edit modules modal (Delete present).

## Product fix

None. Dirty-bar `passthroughSelector` / `data-entity-editor-actions` left untouched. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-category-module-delete.spec.mjs` **1 / 1 (3.9s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesCategoryModuleDelete.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_CATEGORY_MODULE_DELETE_PROOF` `leftoverKind: "category-module-delete"`, `emptyNewCategory: 0`, `emptyCatDup: 0`, `emptyModDelete: 0`, `newCategoryCancelRestored: true`, `newCategorySaved: true`, `newCategoryIsolation: true`, `categoryDupCancelRestored: true`, `categoryDupSaved: true`, `categoryDupIsolation: true`, `moduleDeleteHasConfirm: false`, `moduleDeleteImmediate: true`, `lastModuleAllowed: true`, `moduleDeleteCancelRestored: true`, `moduleDeleteSaved: true`, `moduleDeleteIsolation: true`, `mobileNewCategory: 1`, `mobileAddedCategory: true`, `mobileCatDup: 1`, `mobileModDelete: 1`, `mobileDeleteHasConfirm: false`.

### 1. New category — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Intended mint | **pass** | `New category` → `Category 1` (0 items); dirty bar. |
| Save persists | **pass** | Renamed `E2E Category`; Save; Commissioning stays `['Cameras']`; MEP→Security still 3. |
| Empty / Escape | **pass** | Whitespace snaps back to `Category 1`; typed `gone` + Escape keeps `Category 1`. |
| Cancel | **pass** | Dirty Cancel restores `['Cameras', 'Doors']`. |
| Ctrl+Z | **pass** | No history undo; Cancel is the revert. |
| Empty hub | **pass** | `/?hubPreview=1&empty=1&tab=templates` New category **0**. |
| Isolation | **pass** | Commissioning Cameras unchanged; MEP stays AHU Equipment. |
| 390 | **pass** | New category **1**; `Category 1` minted. |

### 2. Duplicate — **category** (not template-list) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Assert which | **pass** | Leftover is **category Duplicate** (`duplicateCategories`). Template-list Duplicate is a distinct list action. |
| None-selected | **pass** | Categories Duplicate disabled until Cameras is checked. |
| Intended copy | **pass** | `Cameras` → `Cameras copy` (2 items); Doors stays 2. |
| Cancel | **pass** | Copy gone; `E2E Category` stays. |
| Save persists | **pass** | After Save, Installation has the copy; Commissioning Cameras still 1; MEP still AHU. |
| 390 | **pass** | Categories Select opens Duplicate **1**. |

### 3. Module Delete — **pass** (no confirm dialog)

| Slice | Verdict | Evidence |
|---|---|---|
| Confirm? | **pass** | **Absent.** After trash: `archive-confirm-modal` **0**; no Are-you-sure; no Confirm / Delete-module button. Immediate `removeByIds`. |
| None-selected | **pass** | Modal Delete disabled until a module is checked. |
| Intended delete | **pass** | Commissioning Phase row gone immediately. |
| Last remaining | **pass** | Installation Phase also deleted (no last-module guard); tabs `[]`. |
| Cancel | **pass** | Dirty Cancel restores `['Installation Phase', 'Commissioning Phase']` + Cameras copy. |
| Save persists | **pass** | Delete Commissioning + Save; tabs `['Installation Phase']`; MEP still Equipment. |
| Isolation | **pass** | MEP Equipment / AHU unchanged. |
| 390 | **pass** | Module Select opens Edit modules; Delete **1**; confirm still **false**. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates New category + category Duplicate + module Delete (desktop + 390). Actual: Category N mint / empty-title restore / Cancel discard / Save persist; Cameras copy `${name} copy` / none-selected disabled / Cancel discard / Save persist; module trash immediate (no confirm) / last-module allowed / Cancel restore / Save persist. Isolation vs Commissioning / MEP.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** template-list Duplicate as the GAP, category Move/Copy stub, Templates Move/Copy mutators, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **template-list Duplicate** (`duplicateTemplates` / `{name} copy` on the list Select) remains the named sibling. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-category-module-delete.spec.mjs`
- `tests/templatesCategoryModuleDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
