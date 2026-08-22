# Templates entity / category / module reorder + Share — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates New entity / entity Duplicate / entity Delete / category Delete, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete: Templates **entity reorder** (`reorderEntities` / `SortableRearrangeList`), **category reorder** (`reorderCategories`), **module reorder** (`reorderMods` via SortableModuleTabs + Edit-modules `SortableRearrangeList`), and **Share** (`onShare` → `shareTemplate` → `ShareModal` kind=template). FEATURE-MATRIX named entity/category/module reorder and Share as the leftover. Distinct from leftover-18 A-03 live invites and from already-proven create/dup/delete chrome. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create/rename/delete on the template list. Reorder + Share never opened. |
| New entity / entity Duplicate / entity Delete / category Delete | Roster and category trash. Drag handles and Share never opened as the GAP. |
| leftover-18 A-03 Share invites | Named leftover-18. Live cloud invites stay parked. hubPreview Share is fail-closed UI. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Entity / category / module reorder | **GAP.** `SortableRearrangeList` + `reorderMods`. |
| Share (`aria-label="Share"` / `shareTemplate`) | **GAP.** hubPreview opens `ShareModal`; Copy link / Send invite fail-closed (`isSupabaseAvailable: false`). |
| Template-list reorder (`reorderTemplates`) | **Next leftover.** Distinct from entity/category/module. |
| Checklist item reorder (`reorderItems`) | **Next leftover.** Distinct from survey-rail item reorder. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `reorderEntities`: `moveItemById` on `tpl.roster`; `activeId === overId` no-op; dirty via `mutateTpl`. Cancel `reloadFromProps`.
- `reorderCategories`: `moveItemById` on the open module's categories; open-cat index follows the move.
- `reorderMods`: splice `from → to`; open module index follows. Tabs (`SortableModuleTabs`, horizontal) and Edit-modules list (`SortableRearrangeList`) share this mutator.
- Share: list / entity / category / module Select `onShare(template)` → `shareTemplate` → `ShareModal` `kind: 'template'`, `manage: false`. hubPreview AuthContext `isSupabaseAvailable: false` so Copy link / Send invite set `Sharing needs a signed-in cloud account.` Invalid email: `Enter at least one valid email.`
- Move/Copy modal Copy/Move still only `closeMoveModal`.
- No history undo — Cancel is the revert.
- 390: entity handles in Entities dialog; category handles in the mobile categories section; module tabs in the mobile modules section; list Select Share.

## Product fix

`mutateTpl` no longer `markEdited()` when `fn` returns the same template reference. `renameEntity` returns the same template when the role is unchanged. Save/Cancel click can blur an unchanged field; the old always-dirty path bumped `editRevision` so an in-flight Save `then()` refused to clear the bar. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened. Dirty-bar `passthroughSelector` left as-is.

## Live-proved

Playwright `debug/scenarios/e2e-templates-reorder-share.spec.mjs` **1 / 1 (31.7s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesReorderShare.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only).

Receipt log: `TEMPLATES_REORDER_SHARE_PROOF` `leftoverKind: "entity-category-module-reorder-share"`, `emptyEntityHandles: 0`, `emptyCatHandles: 0`, `emptyModuleTabs: 0`, `emptyShare: 0`, `entityReordered: ["Subcontractor","100% Complete","GC"]`, `entitySavedOrder` same, `entityEscapeKept: true`, `entitySelfNoDirty: true`, `entityCancelRestored: true`, `entitySaved: true`, `entityIsolation: true`, `catReordered: ["Doors","Cameras"]`, `catCancelRestored: true`, `catSaved: true`, `catIsolation: true`, `modTabMoved: true`, `modTabReordered: ["Commissioning Phase","Installation Phase"]`, `modCancelRestored: true`, `modSaved: true`, `modIsolation: true`, `shareNoneDisabled: true`, `shareOpened: true`, `shareRoleEditor: true`, `shareCopyFailClosed: true`, `shareInvalidEmail: true`, `shareSendFailClosed: true`, `shareEntitySameModal: true`, `mobileListShare: 1`, `mobileShareOpened: true`, `mobileShareFailClosed: true`, `mobileEntityHandles: 3`, `mobileCatHandles: 2`, `mobileModuleTabs: 2`.

### 1. Entity reorder — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Entity handles **0**. |
| Escape mid-drag | **pass** | Seed `['GC', 'Subcontractor', '100% Complete']` kept; no dirty. |
| Self-target | **pass** | `active === over` no-op; no dirty. |
| Intended move | **pass** | GC dropped over `100% Complete` → `['Subcontractor', '100% Complete', 'GC']`; dirty bar. |
| Cancel | **pass** | Dirty Cancel restores seed. Ctrl+Z is not history undo. |
| Save persists | **pass** | Saved order survives Commissioning tab + MEP isolation. |
| Isolation | **pass** | MEP stays `['MEP', 'Architect']`. |
| 390 | **pass** | Entities dialog handles **3**. |

### 2. Category reorder — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Category handles **0**. |
| Escape mid-drag | **pass** | `['Cameras', 'Doors']` kept. |
| Intended move | **pass** | `['Doors', 'Cameras']`; dirty bar. |
| Cancel | **pass** | Restores Cameras+Doors. |
| Save persists | **pass** | Installation stays Doors+Cameras; Commissioning still `['Cameras']`. |
| Isolation | **pass** | MEP still `['AHU Equipment']`. |
| 390 | **pass** | Category handles **2**. |

### 3. Module reorder — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Module tabs **0**. |
| Tab drag | **pass** | `['Commissioning Phase', 'Installation Phase']`. |
| Edit-modules list | **pass** | Same `reorderMods` via `SortableRearrangeList`. |
| Cancel | **pass** | Restores Installation+Commissioning. |
| Save persists | **pass** | Tab order survives MEP isolation (`['Equipment']`). |
| 390 | **pass** | Module tabs **2**. |

### 4. Share — **pass** (fail-closed on hubPreview)

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / none-selected | **pass** | Share **0** on empty hub; list Share disabled until a row is checked. |
| Intended open | **pass** | `Share template` / `Security Walk-Through`; default Viewer. |
| Role selector | **pass** | Editor updates the invite sentence. |
| Copy link | **pass** | Fail-closed: `Sharing needs a signed-in cloud account.` No fake URL. |
| Invalid email | **pass** | `Enter at least one valid email.` |
| Send invite | **pass** | Same cloud-account fail-closed. Did not invent a backend. |
| Entity Select Share | **pass** | Same template modal (not a per-entity persist). |
| 390 | **pass** | List Share **1**; modal opened; Copy link fail-closed. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates entity / category / module reorder + Share (desktop + 390 chrome). Actual: roster/category/module order Cancel discard / Save persist / isolation vs MEP; ShareModal fail-closed without Supabase.
- **Product bugs fixed:** 1 (`mutateTpl` no-op no longer dirties).
- **Omitted (not invented):** Templates Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, template-list reorder as the GAP, checklist item reorder.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **template-list reorder** (`reorderTemplates`) and **checklist item reorder** (`reorderItems`) remain live chrome not proven as GAP. Move/Copy is a dead stub. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx`
- `debug/scenarios/e2e-templates-reorder-share.spec.mjs`
- `tests/templatesReorderShare.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
