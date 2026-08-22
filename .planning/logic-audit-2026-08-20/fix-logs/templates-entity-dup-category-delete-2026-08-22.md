# Templates New entity / entity Duplicate / entity Delete / category Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates template-list Duplicate, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate: Templates **New entity** (`addEntity` / `Entity N` — still cluster-only; U-03 create/rename/delete was the template list), **entity Duplicate** (`duplicateEntities` / `${role} copy`), **entity Delete** (`deleteEntities`), and **category Delete** (`deleteCategories`). FEATURE-MATRIX named New entity / entity Duplicate / entity Delete as the leftover; category Delete was the named sibling. Distinct from viewer every-swatch, leftover-18 export, and from already-proven template-list / module / category Duplicate. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create `Template 3`, rename+Save, blank-rename no-op, delete `Template 4`. New entity / entity Duplicate / entity Delete / category Delete never opened. |
| template-list Duplicate | List Select `{name} copy`. Roster and category trash never opened as the GAP. |
| New category / category Duplicate / module Delete | Category chrome Duplicate + Edit-modules trash. Category **Delete** and entity roster never opened as the GAP. |
| leftover-18 Space CSV / PDF Pages | Named leftover-18. That host stays parked. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Legal slice already in `leftover18-unblock-2026-08-21.md`. Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Template-list / module / category Duplicate | **Proven.** Distinct leftovers. |
| `New entity` / `addEntity` / `Entity N` | **GAP.** U-03 create was template-list only. |
| Entities Select `duplicateEntities` / `${role} copy` | **GAP.** |
| Entities Select `deleteEntities` / trash | **GAP.** Confirm dialog **absent** (immediate delete). Archive-confirm is checklist-usage only. |
| Categories Select `deleteCategories` / trash | **GAP.** Confirm dialog **absent**. Distinct from module Delete and survey-rail category Delete. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `addEntity`: unique `Entity N`, cycles `ENTITY_COLORS`, `mutateTpl` then `setOpenColor(id)`. Empty/whitespace `commitRequiredRow` + `ENTITY_BLANK_HINT` restore (model never accepts blank). Escape writes the old role back then blur-no-op. Dirty via `mutateTpl`. Cancel `reloadFromProps`.
- `duplicateEntities`: Select in the Entities rail; none-selected disabled; clone inserted after source as `${role} copy` with new `e` id + `seedClonedEntityStyles`. Dirty. Cancel discards. `setSelEntities(new Set())` after copy; dirty-bar Cancel does **not** exit Select (`Done` stays).
- `deleteEntities`: Entities Select trash. None-selected disabled. **No confirm** — `roster.filter` immediately. No last-entity guard. Dirty. Cancel restores. Archive-confirm modal is KAL-44 checklist usage only.
- `deleteCategories`: Categories Select trash. None-selected disabled. **No confirm** — `categories.filter` immediately. No last-category guard. `setOpenCat(-1)`. Dirty. Cancel restores.
- No history undo — Cancel is the revert. Ctrl+Z does not pop the working copy.
- 390: Entities dialog `New entity`; Select opens entity Duplicate + Delete; Categories Select opens category Delete.

## Product fix

None. Dirty-bar `passthroughSelector` / `data-entity-editor-actions` left untouched. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-entity-dup-category-delete.spec.mjs` **1 / 1 (4.3s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesEntityDupCategoryDelete.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_ENTITY_DUP_CATEGORY_DELETE_PROOF` `leftoverKind: "entity-dup-category-delete"`, `emptyNewEntity: 1`, `emptyNewEntityEnabled: false`, `emptyEntDup: 0`, `emptyEntDelete: 0`, `emptyCatDelete: 0`, `newEntityCancelRestored: true`, `newEntitySaved: true`, `newEntityIsolation: true`, `entityDupCancelRestored: true`, `entityDupSaved: true`, `entityDupIsolation: true`, `entityDeleteHasConfirm: false`, `entityDeleteImmediate: true`, `lastEntityAllowed: true`, `entityDeleteCancelRestored: true`, `entityDeleteSaved: true`, `entityDeleteIsolation: true`, `categoryDeleteHasConfirm: false`, `categoryDeleteImmediate: true`, `lastCategoryAllowed: true`, `categoryDeleteCancelRestored: true`, `categoryDeleteSaved: true`, `categoryDeleteIsolation: true`, `mobileNewEntity: 1`, `mobileAddedEntity: true`, `mobileEntDup: 1`, `mobileEntDelete: 1`, `mobileCatDelete: 1`, `mobileDeleteHasConfirm: false`.

### 1. New entity — **pass** (was cluster-only)

| Slice | Verdict | Evidence |
|---|---|---|
| Intended mint | **pass** | `New entity` → `Entity 1`; color panel opens; dirty bar. |
| Save persists | **pass** | Renamed `E2E Entity`; Save; Commissioning still 4; MEP→Security still `E2E Entity`. |
| Empty / Escape | **pass** | Whitespace snaps back to `Entity 1`; typed `gone` + Escape keeps `Entity 1`. |
| Cancel | **pass** | Dirty Cancel restores `['GC', 'Subcontractor', '100% Complete']`. |
| Ctrl+Z | **pass** | No history undo; Cancel is the revert. |
| Empty hub | **pass** | `/?hubPreview=1&empty=1&tab=templates` New entity **1** disabled; no `Entity 1` mint. |
| Isolation | **pass** | MEP stays `['MEP', 'Architect']`. |
| 390 | **pass** | New entity **1**; `Entity 1` minted. |

### 2. Duplicate — **entity** (not template-list / module / category) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Assert which | **pass** | Leftover is **entity Duplicate** (`duplicateEntities`). Template-list / module / category Duplicate are distinct leftovers. |
| None-selected | **pass** | Entities Duplicate disabled until GC is checked. |
| Intended copy | **pass** | `GC` → `GC copy`; Subcontractor stays. |
| Cancel | **pass** | Copy gone; `E2E Entity` stays. |
| Save persists | **pass** | After Save, Security has the copy; MEP still MEP+Architect. |
| Second copy | **pass** | Product rule `${role} copy` → `GC copy copy`; Cancel discarded that edge. |
| 390 | **pass** | Entities Select opens Duplicate **1**. |

### 3. Entity Delete — **pass** (no confirm dialog)

| Slice | Verdict | Evidence |
|---|---|---|
| Confirm? | **pass** | **Absent.** After trash: `archive-confirm-modal` **0**; no Are-you-sure; no Confirm / Delete-entity button. Immediate `roster.filter`. |
| None-selected | **pass** | Rail Delete disabled until an entity is checked. |
| Intended delete | **pass** | `GC copy` gone immediately. |
| Last remaining | **pass** | All + Delete emptied the roster (no last-entity guard); empty copy shown. |
| Cancel | **pass** | Dirty Cancel restores GC / GC copy / Subcontractor / 100% Complete / E2E Entity. |
| Save persists | **pass** | Delete `100% Complete` + Save; MEP still MEP+Architect. |
| Isolation | **pass** | MEP Architect unchanged. |
| 390 | **pass** | Entities Select opens Delete **1**; confirm still **false**. |

### 4. Category Delete — **pass** (no confirm dialog)

| Slice | Verdict | Evidence |
|---|---|---|
| Confirm? | **pass** | **Absent.** Immediate `categories.filter`. Distinct from module Delete and survey-rail category Delete. |
| None-selected | **pass** | Categories Delete disabled until Cameras is checked. |
| Intended delete | **pass** | Cameras gone immediately; Doors stays. |
| Last remaining | **pass** | Doors also deleted (no last-category guard); empty-module copy shown. |
| Cancel | **pass** | Dirty Cancel restores `['Cameras', 'Doors']`. |
| Save persists | **pass** | Delete Cameras + Save; Installation `['Doors']`; Commissioning Cameras still 1; MEP still AHU. |
| Isolation | **pass** | Commissioning / MEP unchanged. |
| 390 | **pass** | Categories Select opens Delete **1**; confirm still **false**. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates New entity + entity Duplicate + entity Delete + category Delete (desktop + 390). Actual: Entity N mint / empty-title restore / Cancel discard / Save persist; GC copy `${role} copy` / none-selected disabled / Cancel discard / Save persist; entity trash immediate (no confirm) / last-entity allowed / Cancel restore / Save persist; category trash immediate (no confirm) / last-category allowed / Cancel restore / Save persist. Isolation vs Commissioning / MEP.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** Templates Move/Copy mutators, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook, entity/category/module reorder as the GAP, Share.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **entity/category/module reorder** (`SortableRearrangeList`) and **Share** remain live chrome not proven as GAP. Move/Copy is a dead stub. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-entity-dup-category-delete.spec.mjs`
- `tests/templatesEntityDupCategoryDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
