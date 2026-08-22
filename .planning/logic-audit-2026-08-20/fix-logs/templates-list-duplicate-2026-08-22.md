# Templates template-list Duplicate — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates New category / category Duplicate / module Delete, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18 and **not** U-03 create/rename/delete / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete: Templates **template-list Duplicate** (`duplicateTemplates` / `{name} copy` on the list Select). FEATURE-MATRIX named this as the leftover. Distinct from **module** Duplicate (`duplicateModules`) and **category** Duplicate (`duplicateCategories`). Distinct from viewer every-swatch, leftover-18 export, and from already-proven template create/rename/delete. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color, Add module / module Duplicate / Add checklist item, New category / category Duplicate / module Delete. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create `Template 3`, rename+Save, blank-rename no-op, delete `Template 4`. List Duplicate never opened. |
| New category / category Duplicate / module Delete | Category chrome + Edit-modules trash. List Select Duplicate was named as the sibling leftover. |
| Add module / module Duplicate / Add checklist item | Module tabs + Cameras item create. Duplicate leftover was **module**. |
| leftover-18 Space CSV / PDF Pages | Named leftover-18. That host stays parked. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Legal slice already in `leftover18-unblock-2026-08-21.md`. Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color / Add module / module Duplicate / Add checklist item / New category / category Duplicate / module Delete | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Module Duplicate (`duplicateModules`) / category Duplicate (`duplicateCategories`) | **Proven.** Distinct leftovers. |
| Template-list Duplicate (`duplicateTemplates` → `{name} copy`) | **GAP.** |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `duplicateTemplates(ids)`: for each selected id, insert after the source a clone named `${t.name} copy` with new `t`/`m`/`c`/`i`/`e` ids; `liveEntityStyle` + `seedClonedEntityStyles` copy fill/border. Product rule is always `${name} copy` (second pass → `copy copy`). Names are **not** uniquified.
- List Select: none-selected `disabled={!visibleSelCount}`; click runs `duplicateTemplates(visibleSelectedIds)` then `setSelTpls(new Set())`. More-menu **Copy** is the same mutator (not this leftover).
- Persistence: `markEdited()` then `dispatchTemplatesSave` when `onSaveTemplates` is wired (hubPreview `setTemplates`). Dirty clears on success — Duplicate **auto-persists**. Cancel after Duplicate is N/A once dirty has cleared. Dirty-bar Cancel still discards a later working-copy edit (New category) without removing the already-persisted copy.
- Pen N/A on hub (no Draw chrome).
- 390: mobile header Select opens `.templates-mobile-select-actions` Duplicate.

## Product fix

None. Dirty-bar `passthroughSelector` / `data-entity-editor-actions` left untouched. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-list-duplicate.spec.mjs` **1 / 1 (3.2s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesListDuplicate.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_LIST_DUPLICATE_PROOF` `leftoverKind: "template-list-duplicate"`, `emptyListDup: 0`, `penOnHub: 0`, `noneSelectedDisabled: true`, `intendedCopy: true`, `copyModules: ["Installation Phase","Commissioning Phase"]`, `copyCategories: ["Cameras","Doors"]`, `cancelIfDirtyRestored: true`, `persistImmediate: true`, `isolation: true`, `secondCopy: "Security Walk-Through copy copy"`, `copiesDeleted: true`, `mobileListDup: 1`, `mobileCopied: true`.

### Template-list Duplicate — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Assert which | **pass** | Leftover is **list** Duplicate (`duplicateTemplates`). Module / category Duplicate are distinct leftovers. |
| Empty hub | **pass** | `/?hubPreview=1&empty=1&tab=templates` list Duplicate **0**. |
| None-selected | **pass** | List Duplicate disabled until Security is selected. |
| Intended copy | **pass** | `Security Walk-Through` → `Security Walk-Through copy` with Installation + Commissioning / Cameras + Doors. |
| Cancel if dirty | **pass** | New category dirties; Cancel restores Cameras+Doors; already-persisted copy stays. |
| Persist | **pass** | Duplicate auto-saves (`persistImmediate: true`); dirty bar not left open. |
| Isolation | **pass** | MEP stays Equipment / AHU; no `MEP As-Built Markup copy`. |
| Duplicate twice | **pass** | Product rule `${name} copy` → `Security Walk-Through copy copy` with the same modules/categories. |
| Delete the copies | **pass** | Already-proven list Delete removes both copies; Security + MEP remain. |
| Pen | **pass** | Hub Pen **0** (N/A). |
| 390 | **pass** | Mobile Select Duplicate **1**; `Security Walk-Through copy` minted. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates template-list Duplicate (desktop + 390). Actual: `${name} copy` with cloned modules/categories; none-selected disabled; auto-persist; dirty Cancel discards a later New-category edit; second Duplicate → `copy copy`; Delete removes copies; MEP isolated.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** More-menu Copy as a second leftover (same mutator), category Delete, New entity / entity Duplicate / entity Delete, category Move/Copy stub, Templates Move/Copy mutators, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **New entity** (`addEntity` / `Entity N`), **entity Duplicate** (`duplicateEntities` / `${role} copy`), and **entity Delete** (`deleteEntities`) remain the named sibling cluster. Category Delete (`deleteCategories`) is another sibling. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-list-duplicate.spec.mjs`
- `tests/templatesListDuplicate.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
