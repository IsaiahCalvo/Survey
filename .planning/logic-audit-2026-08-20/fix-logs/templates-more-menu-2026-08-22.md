# Templates More menu overflow — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates existing-row rename, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename: Templates **More menu** overflow (template-row Copy / Rename / Share / Delete + entity Duplicate / Move/Copy / Share / Rename / Delete). Copy / Share / Delete were already proven via **Select** chrome — this slice is the **More portal**. Distinct from leftover-18. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, PDF Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share Select chrome, template-list reorder, checklist item reorder, list/content/module Search, existing-row rename. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Template-list create/rename/delete. More overflow never opened. |
| Select Duplicate / Share / Delete | List / entity Select chrome. Not the per-row More portal. |
| Existing-row rename | Seed Cameras / Installation Phase / GC / item text via click/dblclick. More → Rename was omitted. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share Select / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates category+module Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. Entity More Move/Copy proved fail-closed this pass. |
| U-04 archive-with-markers | **Proven** hubPreview (`e2e-u04-archive.spec.mjs`). Cloud usage stays leftover-18. |
| Template / entity More menu | **GAP this pass.** Template-row Copy/Rename/Share/Delete + entity Duplicate/Move/Copy/Share/Rename/Delete. |
| Checklist item Delete (`deleteItem` / `aria-label="Delete item"`) | **Next leftover.** Add item + item rename + item reorder already proven. Permanent-delete of archived items is a sibling. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Template More (desktop list + 390 row): Copy → `duplicateTemplates`; Rename → `setSelected` + `setTplEdit(false)` (no focus); Share → `onShare(t)`; Delete → `deleteTemplates`.
- Entity More (desktop rail + 390 Entities dialog): Duplicate → `duplicateEntities`; Move/Copy → `setMoveModal({ count: 1, kind: 'entity' })`; Share → `onShare(tpl)`; Rename → `setOpenColor(null)` only; Delete → `deleteEntities` (no confirm).
- MoreMenu portals to `document.body`; DismissBarrier owns Escape + outside first-gesture consume. Opening a second More consumes the first click (closes, does not open).
- Move/Copy modal Copy/Move/Cancel all `closeMoveModal`. No `mutateTpl`.
- hubPreview Share is fail-closed (`Sharing needs a signed-in cloud account.`). No `onArchiveTemplates` — More Delete uses the local bundle-save fallback.

## Product fixes

1. **`beginTemplateRename`** selects the template, exits list Select, opens 390 detail, and focuses/selects `input[data-template-title]`.
2. **`beginEntityRename`** closes the color picker and focuses/selects `input[placeholder="Entity name"][data-entity-id=…]`. Live-confirmed before the fix: focus stayed on `BODY`.
3. Desktop + mobile title/entity fields gained `data-template-title` / `data-entity-id`. 390 entity More gained `aria-label="More"`.

Move/Copy stays a dead stub. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-more-menu.spec.mjs` **1 / 1 (4.7s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesMoreMenu.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only).

Receipt log: `TEMPLATES_MORE_MENU_PROOF` `leftoverKind: "templates-more-menu"`, empty More **0**, Escape/outside/one-menu **true**, template Copy isolation / Rename Save / Share fail-closed / Delete isolation **true**, entity Dup isolation / Move stub no-op / Share fail-closed / Rename Save+isolation / Delete isolation **true**, 390 template More **1** `mobileCopied: true` `mobileTplRenameFocus: true`, 390 entity More **1** `mobileEntRenameFocus: true` `mobileMoveStub: true` `mobileShareFailClosed: true`.

### 1. Template-row More (Copy / Rename / Share / Delete) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Template More **0**. |
| Escape / outside / one menu | **pass** | Escape + click(16,16) close. Second More first-click dismisses. |
| Copy | **pass** | `Security Walk-Through copy` via More (not Select). Auto-persist. MEP isolated. |
| Rename | **pass** | Focuses title. Escape `gone-tpl` restores. `MEP Hunt` Cancel; `E2E MEP` Save. Security stays. |
| Share | **pass** | More → ShareModal. Copy link fail-closed. |
| Delete | **pass** | More deletes the copy. Security + E2E MEP stay. |
| 390 | **pass** | More **1**. Copy mints. Rename opens detail + focuses title. |

### 2. Entity More (Duplicate / Move/Copy / Share / Rename / Delete) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Entity More **0**. |
| Duplicate | **pass** | More → `GC copy`. Cancel restores; Save survives MEP. |
| Move/Copy | **pass** | Modal Copy / Move / Cancel are no-ops. No `GC copy` from stub. MEP isolated. |
| Share | **pass** | More → same ShareModal. Copy link fail-closed. |
| Rename | **pass** | Focuses GC (was BODY). Escape restores. `General` Cancel; `E2E More GC` Save. MEP isolated. |
| Delete | **pass** | More deletes `GC copy`. No confirm. MEP isolated. |
| 390 | **pass** | Entities dialog More **1**. Rename focuses GC. Move/Copy stub. Share fail-closed. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates More overflow (template-row + entity) on desktop + 390. Actual: Copy/Duplicate/Rename/Share/Delete via the portal; Move/Copy fail-closed; Escape/outside dismiss.
- **Product bugs fixed:** 2 (template More Rename now focuses the title + opens 390 detail; entity More Rename now focuses the field).
- **Omitted (not invented):** category/module Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, checklist item Delete as the GAP.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **checklist item Delete** (`deleteItem` / `aria-label="Delete item"` + archive-confirm when usage > 0) remains live chrome not proven as GAP. Add item / item rename / item reorder already proven. Category/module Move/Copy stay dead stubs. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx` (beginTemplateRename / beginEntityRename)
- `debug/scenarios/e2e-templates-more-menu.spec.mjs`
- `tests/templatesMoreMenu.test.mjs`
- `tests/templatesExistingRowRename.test.mjs` (More Rename assertions)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
