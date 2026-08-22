# Templates checklist item Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates More menu overflow, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename / More menu: Templates **checklist item Delete** (`deleteItem` / `aria-label="Delete item"` + archive-confirm when usage > 0). Add item / item rename / item reorder already proven. Distinct from leftover-18 U-04 cloud usage (hubPreview archive-with-markers was a thin seed proof, not this intended+break+edge slice). Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, PDF Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share Select chrome, template-list reorder, checklist item reorder, list/content/module Search, existing-row rename, More overflow. UL-31 Continue pin stays parked. Permanent-delete of archived items is a sibling leftover, not this GAP.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Template-list create/rename/delete. Item × never opened as the GAP. |
| Add checklist item | Create path. Delete was only Escape-on-blank-new-row. |
| Item rename / item reorder | Text + drag. × unused. |
| U-04 archive-with-markers | Thin seed: used i1 opens modal; Cancel; Archive; unused i2 hard-deletes. No Escape / outside / dirty-bar / last-item / isolation / 390. Cloud usage stays leftover-18. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites / U-04 cloud usage | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share Select / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename / More menu | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates category+module Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Checklist item Delete (`deleteItem` / `aria-label="Delete item"`) | **GAP this pass.** Unused hard-delete + usage>0 archive-confirm. |
| Permanent-delete of archived items | **Next leftover.** Desktop `aria-label="Permanently delete (orphans historical responses)"` + 390 `aria-label="Permanently delete"` call `hardDeleteItem`. Sibling of this Delete slice. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `deleteItemInModule` probes `getChecklistItemUsageCount(itemId)`. usage 0 (or already archived) → `hardDeleteItemInModule`. usage > 0 && !archived → `setArchiveConfirm`.
- hubPreview seeds `MOCK_CHECKLIST_ITEM_USAGE.i1 = 3` (Cameras “Is the camera cable pulled?”). i2–i6 stay 0.
- Unused × is immediate. No last-item gate.
- Archive modal: Cancel / backdrop / Archive. **Escape was missing** (no `useModalFocusTrap`).
- Archive dirties via `mutateTpl`. Dirty Cancel restores the active item. Save persists.
- 390 uses the same `deleteItem` on `.templates-mobile-item-row`.

## Product fixes

1. **Archive-confirm Escape.** Live-before-fix: Escape left `archive-confirm-modal` open (30s timeout). Wired `useModalFocusTrap` + `closeArchiveConfirm` (Cancel / backdrop / Escape). Dialog now `role="dialog"` `aria-modal="true"`.

Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-checklist-item-delete.spec.mjs` **1 / 1 (3.4s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesChecklistItemDelete.test.mjs` **3 / 3**. High-risk files: none (TemplatesEditor only).

Receipt log: `TEMPLATES_CHECKLIST_ITEM_DELETE_PROOF` `leftoverKind: "templates-checklist-item-delete"`, empty Delete **0**, unused hard-delete + isolation **true**, used usage **3**, Cancel left item, Escape/outside **true**, archive isolation **true**, last-item allowed **true**, 390 Delete **2** `mobileUnusedHardDeleted: true` `mobileArchived: true`.

### 1. Unused hard-delete — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Delete item **0**. |
| Unused × | **pass** | `Is the camera installed?` gone. No modal. Dirty. |
| Cancel | **pass** | Restores both Cameras items. |
| Save + isolation | **pass** | Doors `i3`/`i4`, Commissioning `Camera tested and online?`, MEP `Tags updated?` stay. |

### 2. Used archive-confirm — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Open | **pass** | Heading + **3** + “survey markers have” + used label. No dirty until Archive. |
| Cancel | **pass** | Item stays active. Archived **0**. |
| Escape | **pass** | After trap: modal **0**, item stays. Live-before-fix: Escape no-op. |
| Outside | **pass** | Backdrop click closes. Item stays. |
| Archive + Cancel | **pass** | Moves to `archived-items-c1`. Dirty Cancel restores active. |
| Archive + Save | **pass** | Archived label persists. Doors + MEP isolated. |

### 3. Last-item + 390 — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Last-item | **pass** | Commissioning Cameras only item hard-deletes. Empty copy. Cancel restores. Save leaves **[]**. |
| 390 unused | **pass** | Delete **2**. Unused hard-deletes. |
| 390 used | **pass** | Modal **3**. Cancel leaves. Archive → `[data-archived-item-id="i1"]`. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates checklist item Delete on desktop + 390. Actual: unused hard-delete; usage>0 archive-confirm Cancel / Escape / outside / Archive; dirty-bar Cancel vs Save; last-item allowed; isolation across categories / modules / templates.
- **Product bugs fixed:** 1 (archive-confirm Escape now dismisses via `useModalFocusTrap`).
- **Omitted (not invented):** category/module Move/Copy mutators, leftover-18 unplaced-rows, linked workbook, permanent-delete of archived items as the GAP.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **permanent-delete of archived items** (`hardDeleteItem` / `aria-label="Permanently delete…"`) remains live chrome not proven as GAP. Category/module Move/Copy stay dead stubs. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/home/TemplatesEditor.jsx` (archive-confirm Escape trap)
- `debug/scenarios/e2e-templates-checklist-item-delete.spec.mjs`
- `tests/templatesChecklistItemDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
