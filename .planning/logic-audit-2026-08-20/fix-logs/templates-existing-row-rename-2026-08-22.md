# Templates existing-row rename (module / category / entity / item) — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates list Search + mobile content Search + Edit-modules Search modules, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules: Templates **existing-row rename** (`renameModule` / `renameCategory` / `renameEntity` / `renameItem` on seed Cameras / Installation Phase / GC / item text). Create flows only minted new names. Distinct from leftover-18. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, PDF Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share, template-list reorder, checklist item reorder, list/content/module Search. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Template-list create/rename/delete. Seed Cameras / Installation Phase / GC / item text never opened as the GAP. |
| Add module / Add checklist item / New category / New entity | Minted **new** names (`Module 1` / `Category 1` / `Entity 1` / empty item). Not rename of existing seed rows. |
| Catalog completeness | Never opened existing-row rename as the GAP. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| U-04 archive-with-markers | **Proven** hubPreview (`e2e-u04-archive.spec.mjs`). Cloud usage stays leftover-18. |
| Existing-row rename (`renameModule` / `renameCategory` / `renameEntity` / `renameItem`) | **GAP this pass.** Seed Installation Phase / Cameras / GC / `Is the camera installed?`. |
| Template / entity More menu | **Next leftover.** Sibling overflow chrome. Copy/Share/Delete already proven via Select. Entity More `Rename` only `setOpenColor(null)` — does not focus the field. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `renameModule(id, name)`: trim; empty/whitespace closes rename mode and returns; missing id is a no-op. Tab double-click enters rename; Edit-modules blurs the same mutator.
- `renameCategory` / `resolveTitleCommit`: empty/whitespace restore; unchanged is `noop`; else trimmed commit.
- `renameEntity`: trim; empty via `commitRequiredRow` restores; same role returns `t`.
- `renameItem`: `commitRequiredRow` refuses blank on an existing row (quiet restore, not delete). Escape restores.
- Isolation is per-template / per-module / per-category. Commissioning also has a Cameras row (`c3`); MEP is a second template.
- Move/Copy modal Copy/Move still only `closeMoveModal`.
- 390: same mutators on mobile tabs / Edit-modules / category + item rows / Entities dialog.

## Product fixes

1. **`renameModule` / `renameItem` / `mutateModuleAt` / `mutateCategoryInModule` return the same reference when the label is unchanged.** Same contract as `renameEntity` + `mutateTpl`. An Edit-modules same-name blur used to dirty.
2. **Module-tab Escape restores the name before unmount** so blur-on-cancel cannot commit a typed label.
3. **Edit-modules empty/unchanged blur goes through `resolveTitleCommit`** and snaps the field back (tab unmount already did this).
4. **`mutateTpl` `flushSync`s the `setRich` updater** before reading `changed`. Blur-path rename updated the label and left the Save bar hidden — click-path mint (Add module) already dirtied, so create-flow tests never saw this.
5. **Checklist item inputs now key `id:text`** (desktop + 390). Cancel restored the model and left the discarded text on the uncontrolled field; the next blur would write it back.

Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened. Dirty-bar `passthroughSelector` left as-is.

## Live-proved

Playwright `debug/scenarios/e2e-templates-existing-row-rename.spec.mjs` **1 / 1 (6.2s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesExistingRowRename.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only).

Receipt log: `TEMPLATES_EXISTING_ROW_RENAME_PROOF` `leftoverKind: "templates-existing-row-rename"`, empty chrome **0**, `moduleSaved` / `moduleIsolation` / `moduleModalRename`, `categorySaved` / `categoryIsolation`, `entitySaved` / `entityIsolation`, `itemSaved` / `itemIsolation`, 390 category / item / module / entity **true**, `noDirtyNoops: true`.

### 1. Module (`Installation Phase` / `renameModule`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Installation Phase tabs **0**. |
| Empty / whitespace | **pass** | Seed tabs stay. No dirty. |
| Escape after typed change | **pass** | `gone-module` → Installation Phase. No dirty. |
| Unchanged / padded same | **pass** | No dirty. |
| Cancel vs Save | **pass** | `Install Phase` Cancel restores; `E2E Install` then Edit-modules `E2E Install Phase` Save survives MEP. |
| Isolation | **pass** | Commissioning Phase unchanged. MEP `Equipment`. |
| 390 | **pass** | Edit-modules empty snap-back; `E2E Mobile Install` Save. |

### 2. Category (`Cameras` / `renameCategory`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace / Escape / unchanged | **pass** | Seed Cameras+Doors. No dirty. |
| Cancel vs Save | **pass** | `Cams` Cancel; `E2E Cameras` Save. |
| Isolation | **pass** | Doors stays; Commissioning Cameras stays; MEP AHU Equipment. |
| 390 | **pass** | Empty restore; `E2E Mobile Cameras` Save. |

### 3. Entity (`GC` / `renameEntity`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace / Escape / unchanged | **pass** | Seed GC+Subcontractor+100% Complete. No dirty. |
| Cancel vs Save | **pass** | `General` Cancel; `E2E GC` Save survives MEP. |
| Isolation | **pass** | Subcontractor stays; MEP `['MEP','Architect']`. |
| 390 | **pass** | Entities dialog empty blur restore; `E2E Mobile GC` Save. |

### 4. Item (`Is the camera installed?` / `renameItem`) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace / Escape / unchanged | **pass** | Quiet restore. No dirty. Not a back-door delete. |
| Cancel vs Save | **pass** | `Camera installed now?` Cancel remounts seed text; `E2E camera installed?` Save. |
| Isolation | **pass** | Cable item + Doors seed; Commissioning `Camera tested and online?`; MEP `Tags updated?`. |
| 390 | **pass** | Empty restore; `E2E mobile installed?` Save. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates existing-row rename of seed Installation Phase / Cameras / GC / item text (desktop + 390 chrome). Actual: empty/whitespace/Escape/unchanged no-op; Cancel vs Save; isolation across modules/categories/templates.
- **Product bugs fixed:** 5 (same-reference no-ops; tab Escape restore; Edit-modules title snap-back; blur-path dirty via `flushSync`; item field remount on Cancel).
- **Omitted (not invented):** Templates Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, More menu as the GAP.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **More menu** overflow (template-row Copy/Rename/Share/Delete + entity Duplicate/Move/Copy/Share/Rename/Delete portal) remains live chrome not proven as GAP. Copy/Share/Delete already proven via Select. Entity More Rename only `setOpenColor(null)`. Move/Copy is a dead stub. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx` (rename no-ops + flushSync + item keys)
- `debug/scenarios/e2e-templates-existing-row-rename.spec.mjs`
- `tests/templatesExistingRowRename.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
