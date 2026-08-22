# Templates permanent-delete of archived items — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates checklist item Delete (unused hard-delete + usage>0 archive-confirm), leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** U-03 template create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename / More menu / checklist item Delete: Templates **permanent-delete of archived items** (`hardDeleteItem` / `aria-label="Permanently delete (orphans historical responses)"` + 390 `aria-label="Permanently delete"`). Archive-confirm is setup only — unused × / Cancel / Escape / outside / Archive were already proven. Distinct from leftover-18 U-04 cloud usage. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, PDF Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete, template-list Duplicate, New entity / entity Duplicate / entity Delete / category Delete, entity/category/module reorder, Share Select chrome, template-list reorder, checklist item reorder, list/content/module Search, existing-row rename, More overflow, unused hard-delete, archive-confirm. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| Checklist item Delete **pass** | Unused × + usage>0 archive-confirm. Archived-row × never opened as the GAP. |
| U-04 archive-with-markers | Thin seed: used i1 opens modal; Cancel; Archive. No permanent-delete of the archived row. Cloud usage stays leftover-18. |
| Archive modal “Permanently delete” path | Comment-only / unused. Modal still offers Cancel / Archive only. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages / A-03 live invites / U-04 cloud usage | **Parked.** Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search (PDF) / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete / template-list Duplicate / New entity / entity Duplicate / entity Delete / category Delete / entity/category/module reorder / Share Select / template-list reorder / checklist item reorder / list Search / mobile content Search / Edit-modules Search modules / existing-row rename / More menu / unused hard-delete / archive-confirm | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates category+module+entity Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Permanent-delete of archived items (`hardDeleteItem`) | **GAP this pass.** Desktop orphan-copy × + 390 Permanently delete on already-archived rows. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `hardDeleteItemInModule` filters `c.items` by id. No usage probe. No confirm. No last-item gate.
- Desktop archived row: `aria-label="Permanently delete (orphans historical responses)"` → `hardDeleteItem(i, it.id)`.
- 390 archived row: `aria-label="Permanently delete"` → `hardDeleteItem(ci, it.id)`.
- Archived section (`archived-items-${c.id}` / `mobile-archived-items-${c.id}`) renders only when `archivedItems.length > 0`.
- Label title includes `historical responses preserved`. Archive-confirm copy mentions permanently deleting later from the Archived section.
- hubPreview seeds `MOCK_CHECKLIST_ITEM_USAGE.i1 = 3`. No seed `archived: true` — archive is setup, then this slice deletes the archived row.
- Dirty via `mutateTpl`. Cancel restores the last saved archived row (not the active item). Save persists the strip.

## Product fixes

None. Live-before and live-after match: permanent-delete is immediate (no confirm). Escape after the click leaves the row gone and the dirty bar up. Do not invent a confirm.

Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-archived-hard-delete.spec.mjs` **1 / 1 (3.2s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesArchivedHardDelete.test.mjs` **3 / 3**. High-risk files: none.

Receipt log: `TEMPLATES_ARCHIVED_HARD_DELETE_PROOF` `leftoverKind: "templates-archived-hard-delete"`, empty Permanently delete **0** / **0**, seed archived **0**, orphan copy **true**, no confirm **true**, empty after last **true**, isolation **true**, 390 seed Permanently delete **0**, `mobileHardDeleted: true`.

### 1. Empty / seed / orphan copy — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty hub | **pass** | Desktop + 390 Permanently delete **0**. |
| Seed Cameras | **pass** | Archived section **0**. Permanently delete **0**. Both active items present. |
| Archive setup + Save | **pass** | Setup only. `archived-items-c1` + `i1` label. Unused stays active. |
| Orphan copy | **pass** | Desktop title/aria-label `Permanently delete (orphans historical responses)`. Label title `historical responses preserved`. |

### 2. Immediate delete + dirty-bar — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Click × | **pass** | No `archive-confirm-modal`. Archived section gone. Unused stays. Dirty. |
| Escape / outside | **pass** | No confirm exists. Escape after delete leaves the row gone + dirty. |
| Cancel | **pass** | Restores archived `i1` (not the active item). Unused still only active. |
| Save + empty list | **pass** | Archived section **0**. Permanently delete **0**. Unused stays. |

### 3. Isolation + 390 — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Doors / Commissioning / MEP | **pass** | `i3`/`i4`, `Camera tested and online?`, `Tags updated?` stay. No archived tails there. |
| Persist | **pass** | After Save, Security Cameras still has unused only. |
| 390 unused stays | **pass** | Seed Permanently delete **0**. After archive+Save, `Permanently delete` × strips `i1`. Cancel restores archived. Save empties `mobile-archived-items-c1`. Unused stays. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates permanent-delete of already-archived items on desktop + 390. Actual: immediate `hardDeleteItem` (no confirm); orphan-historical-responses copy; dirty-bar Cancel restores archived; Save empties the Archived section; isolation across categories / modules / templates.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** category/module/entity Move/Copy mutators, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **Move/Copy** stays a dead stub (Copy/Move only `closeMoveModal`). Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Templates family is exhausted except that stub. Hub Documents / Projects / Archive empty chrome already have catalog-completeness slices — do **not** replay those as the GAP. Archive restore stays host-blocked. Do **not** re-claim unblocked GAP = 0 without a real falsify hunt of remaining reachable chrome (entity opacity/border tabs vs fill-only entity color; Documents Lock persist).
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-archived-hard-delete.spec.mjs`
- `tests/templatesArchivedHardDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
