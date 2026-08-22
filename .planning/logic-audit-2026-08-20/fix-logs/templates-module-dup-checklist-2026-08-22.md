# Templates Add module / module Duplicate / Add checklist item — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Templates entity color, leftover-18 Space CSV / PDF Pages stay parked. Unique leftovers that are **not** leftover-18 and **not** U-03 create/rename/delete / entity color: Templates editor **Add module** (`title="New module"` / `addModule`), **module Duplicate** (`duplicateModules` / Edit modules modal → `${name} copy`), and **Add checklist item** (`addItem` / TemplatesEditor create). FEATURE-MATRIX named these three as the leftover. Entity color never opened module Select or Add item. Distinct from viewer every-swatch, leftover-18 export, and from already-proven template create/rename/delete. Live-proved on `/?hubPreview=1&tab=templates`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, the Spaces family, survey-rail family, callout/line/poly handles, nubbin, survey-marker handles/delete, Search, keyboard, every-swatch, Fit height, thumbnails, pages structure, flatten, mobile chrome, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, entity color. UL-31 Continue pin stays parked.

## Why these are the next GAP (and not leftover-18 Space export)

| Prior claim | What was actually asserted |
|---|---|
| U-03 **pass** (hubPreview editor) | Create `Template 3`, rename+Save, blank-rename no-op, delete `Template 4`. Add module / Duplicate / Add item never opened. |
| Entity color | Fill/Cancel/Save on the roster picker. Module tabs and checklist create never opened. |
| Viewer every-swatch | Fill/border/pen/counter/font sites on `?testPdf=`. Not the Templates editor. |
| leftover-18 Space CSV / PDF Pages | Named leftover-18. That host stays parked. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| leftover-18 Space CSV / PDF Pages | **Parked.** Legal slice already in `leftover18-unblock-2026-08-21.md`. Do not invent `.env.local`. |
| Spaces / survey-rail / callout handles / nubbin / marker / Search / keyboard / swatches / Fit height / thumbs / pages / flatten / mobile chrome / Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space / entity color | **Proven.** Do not replay. |
| UL-31 Continue pin / Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces | **Parked / compile-hidden / do not invent.** |
| Survey category Move/Copy toast / `copyModeActive` Copy-to-Spaces / Templates Move/Copy modal | **Dead stubs.** Copy/Move buttons only `closeMoveModal`. Not invented. |
| Template-list Duplicate (`duplicateTemplates` → `{name} copy`) | Distinct list action (sibling of already-proven New template / Delete). **Not this leftover.** Asserted: leftover is **module Duplicate**. |
| `title="New module"` / `addModule` | **GAP.** |
| Edit modules `duplicateModules` / `${name} copy` | **GAP.** |
| `+ Add checklist item` / `addItem` | **GAP.** TemplatesEditor create, not a survey fixture seed. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- `addModule`: unique `Module N`, empty `categories`, `setModRename(id)`. Empty/whitespace rename exits rename and keeps `Module N`. Escape `onCancelRename`. Dirty via `mutateTpl`. Cancel `reloadFromProps`.
- `duplicateModules`: Select in Edit modules modal; none-selected disabled; copy inserted after source as `${name} copy` with new ids. Dirty. Cancel discards.
- `addItem`: appends `{ id, text: '' }`. Fresh blank blur `flagRequiredInput` (hint, row stays). Escape on fresh blank `deleteItem`. Existing blank restores. 100-char cap. Dirty. Cancel discards.
- No history undo — Cancel is the revert. Ctrl+Z does not pop the working copy.
- 390: `New module`, `.templates-mobile-add-line`, module Select opens the same Edit modules modal.

## Product fix

None. Dirty-bar `passthroughSelector` / `data-entity-editor-actions` left untouched. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing. 8448 not loosened.

## Live-proved

Playwright `debug/scenarios/e2e-templates-module-dup-checklist.spec.mjs` **1 / 1 (4.4s)** on Vite `http://localhost:5173` + `/?hubPreview=1&tab=templates`. Node `templatesModuleDupChecklist.test.mjs` **3 / 3**. No high-risk file.

Receipt log: `TEMPLATES_MODULE_DUP_CHECKLIST_PROOF` `leftoverKind: "module-duplicate"`, `emptyAddModule: 0`, `emptyAddItem: 0`, `addModuleCancelRestored: true`, `addModuleSaved: true`, `moduleDupCancelRestored: true`, `moduleDupSaved: true`, `isolation: true`, `checklistEmptyRefused: true`, `checklistEscRemoved: true`, `checklistSaved: true`, `doorsIsolated: true`, `mobileNewModule: 1`, `mobileAddedModule: true`, `mobileAddItem: 1`, `mobileAddedItem: true`, `mobileModuleDup: 1`.

### 1. Add module — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Intended mint | **pass** | `+` `title="New module"` → `Module 1`; dirty bar. |
| Save persists | **pass** | Renamed `E2E Module`; Save; MEP→Security still 3 tabs. |
| Empty / Escape | **pass** | Whitespace + Escape keep `Module 1`. |
| Cancel | **pass** | Dirty Cancel restores `['Installation Phase', 'Commissioning Phase']`. |
| Ctrl+Z | **pass** | No history undo; Cancel is the revert. |
| Empty hub | **pass** | `/?hubPreview=1&empty=1&tab=templates` New module **0**. |
| Isolation | **pass** | MEP stays `['Equipment']`. |
| 390 | **pass** | New module **1**; `Module 1` minted. |

### 2. Duplicate — **module** (not template) — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Assert which | **pass** | Leftover is **module Duplicate** (`duplicateModules` / Edit modules). Template-list Duplicate is a distinct list action. |
| None-selected | **pass** | Modal Duplicate disabled until a module is checked. |
| Intended copy | **pass** | `Installation Phase` → `Installation Phase copy` (4 rows). |
| Cancel | **pass** | Copy gone; `E2E Module` stays. |
| Save persists | **pass** | After Save, tabs include the copy; MEP still Equipment. |
| 390 | **pass** | Module Select opens Edit modules; Duplicate **1**. |

### 3. Add checklist item — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Intended create | **pass** | Cameras 2 → 3; empty placeholder row. |
| Empty name | **pass** | Blur keeps the row; hint `Can't be empty — type something or hit Esc to cancel.` |
| Escape | **pass** | Fresh blank Esc → back to 2. |
| Cancel | **pass** | Typed `E2E discarded item` then Cancel; Cameras 2. |
| Save persists | **pass** | `E2E cable labeled?` survives MEP→Security. |
| Isolation | **pass** | Doors stays 2; MEP AHU `Tags updated?` unchanged. |
| Empty hub | **pass** | Add checklist item **0**. |
| 390 | **pass** | `+ Add checklist item` **1**; row minted. Proved before Add module so Cameras stays mounted. |

No error boundary.

## Classification after this pass

- **GAP found and proven:** Templates Add module + module Duplicate + Add checklist item (desktop + 390). Actual: Module N mint / empty-rename keep / Cancel discard / Save persist; module copy `${name} copy` / none-selected disabled / Cancel discard / Save persist; checklist empty refuse + Esc remove / Cancel discard / Save persist. Isolation vs MEP / Doors.
- **Product bugs fixed:** 0.
- **Omitted (not invented):** template-list Duplicate as the GAP, category Duplicate / New category / module Delete, category Move/Copy stub, Templates Move/Copy mutators, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** stay **parked**. Templates **New category** / category Duplicate / module Delete remain siblings. Do not invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-templates-module-dup-checklist.spec.mjs`
- `tests/templatesModuleDupChecklist.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
