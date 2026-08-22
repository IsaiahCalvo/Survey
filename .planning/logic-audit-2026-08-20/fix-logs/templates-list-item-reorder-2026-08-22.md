# Templates template-list reorder + checklist item reorder — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates entity / category / module reorder + Share, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share: Templates **template-list reorder** (`reorderTemplates` / `saveTemplateOrderPreference`) and **checklist item reorder** (`reorderItems` / `SortableRearrangeList` inside an expanded category). FEATURE-MATRIX named these as the leftover. Distinct from entity/category/module reorder, from survey-rail item reorder, and from leftover-18 A-03. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create/rename/delete on the template list. List drag + checklist item drag never opened as the GAP. |
| Entity / category / module reorder + Share | Roster / category / module tabs. Template-list order and checklist item order never opened as the GAP. |
| Survey-rail item reorder | Marker rows in an expanded survey category. TemplatesEditor `reorderItems` is a different mutator. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Template-list reorder (`reorderTemplates`) | **GAP.** Preference persist; not `mutateTpl`. |
| Checklist item reorder (`reorderItems`) | **GAP.** Dirty via `mutateTpl`. |
| Templates list Search (`Search templates...` / `templateMatchesSearch`) | **Next leftover.** Distinct from PDF find. Not this GAP. |
| Mobile content Search / Edit-modules `Search modules...` | Same search family. Not this GAP. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `reorderTemplates`: `moveItemById` on `rich`; `activeId === overId` no-op; `saveTemplateOrderPreference` writes `surveyHub.templateOrder:<user>` to localStorage. Does **not** call `mutateTpl` / `markEdited`. Reload / Cancel of a later content edit re-applies the preference via `applyTemplateOrderPreference`.
- `reorderItems` / `reorderItemsInModule`: `moveItemById` on **active** items only; archived items stay at the tail. Dirty via `mutateCategoryInModule` → `mutateTpl`. Cancel `reloadFromProps`.
- Seed Cameras: `Is the camera cable pulled?` / `Is the camera installed?`. Doors / Commissioning / MEP isolated.
- Move/Copy modal Copy/Move still only `closeMoveModal`.
- 390: list handles on `.templates-mobile-browser`; item handles after Expand Cameras. Space on a list row opens the template (`role="button"`); list reorder is pointer-only. Nested category+item `DndContext`s self-drop Space/ArrowDown on the same item id — pointer is the live 390 item path.

## Product fix

None this pass. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened. Dirty-bar `passthroughSelector` and `mutateTpl` no-op-dirty left as-is.

## Live-proved

Playwright `debug/scenarios/e2e-templates-list-item-reorder.spec.mjs` **1 / 1 (29.4s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesListItemReorder.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only; no product edit).

Receipt log: `TEMPLATES_LIST_ITEM_REORDER_PROOF` `leftoverKind: "template-list-and-checklist-item-reorder"`, `emptyListHandles: 0`, `emptyItemHandles: 0`, `listReordered: ["MEP As-Built Markup","Security Walk-Through"]`, `listReloadPersisted: true`, `listNoDirty: true`, `listIsolation: true`, `itemReordered` / `itemSavedOrder: ["Is the camera installed?","Is the camera cable pulled?"]`, `itemCancelRestored: true`, `itemSaved: true`, `itemDoorsIsolated: true`, `itemCommissioningIsolated: true`, `itemMepIsolated: true`, `commissioningHandles: 1`, `mobileListHandles: 2`, `mobileListReordered: true`, `mobileItemHandles: 2`, `mobileItemReordered: true`.

### 1. Template-list reorder — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | List handles **0**. |
| Escape mid-drag | **pass** | Seed `['Security Walk-Through', 'MEP As-Built Markup']` kept; no dirty. |
| Self-target | **pass** | `active === over` no-op; no dirty. |
| Intended move | **pass** | Security dropped over MEP → `['MEP As-Built Markup', 'Security Walk-Through']`. **No dirty bar** (preference, not `mutateTpl`). |
| Reload persist | **pass** | `page.reload` keeps MEP first (`localStorage` `surveyHub.templateOrder:dev-hubpreview-user`). |
| Isolation | **pass** | Security still Cameras+Doors items; MEP still `Tags updated?`. |
| Content Cancel | **pass** | Later item-reorder Cancel does **not** rewind the list preference. |
| 390 | **pass** | List handles **2**; pointer `mobileListReordered: true`. |

### 2. Checklist item reorder — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Item fields **0**. |
| Escape mid-drag | **pass** | Cameras seed kept; no dirty. |
| Self-target | **pass** | No-op; no dirty. |
| Intended move | **pass** | `['Is the camera installed?', 'Is the camera cable pulled?']`; dirty bar. |
| Cancel | **pass** | Dirty Cancel restores seed. Ctrl+Z is not history undo. |
| Save persists | **pass** | Saved order survives Commissioning tab + MEP isolation. |
| Isolation | **pass** | Doors stays seed; Commissioning `['Camera tested and online?']` (1 handle); MEP `['Tags updated?']`. |
| 390 | **pass** | Item handles **2**; pointer `mobileItemReordered: true`. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates template-list reorder + checklist item reorder (desktop + 390 chrome). Actual: list preference Cancel-of-content does not rewind / reload persist; Cameras item order Cancel discard / Save persist / isolation vs Doors + Commissioning + MEP.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** Templates Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, Templates Search as the GAP.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **list Search** (`Search templates...` / `templateMatchesSearch`) and the sibling mobile content / Edit-modules search remain live chrome not proven as GAP. Move/Copy is a dead stub. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-list-item-reorder.spec.mjs`
- `tests/templatesListItemReorder.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
