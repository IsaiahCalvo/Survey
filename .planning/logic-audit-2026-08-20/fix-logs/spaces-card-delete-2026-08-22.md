# Spaces space-card Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces Create space, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18: Spaces **space-card Delete** (`space-card-delete-button` + `window.confirm('Delete this space?…')` / `handleDelete` / `onSpaceDelete` / `handleSpaceDelete`). Cluster / Edit-region last-space delete was contrast only. Distinct from region-row Delete (`region-delete-button` / no confirm), leftover-18 `onExportSpaceCSV` / `onExportSpacePDF`, and from already-proven Create space. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, space-name rename, Add pages, Turn on/off, Expand/Collapse, Go to page, Hide/Show survey or canvas, space-card reorder, region Delete/rename, Edit region areas, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, survey-rail family, Create-space burst as the GAP. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not Create space)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + last space) | Edit-region last-space delete as overlay teardown. Cancel / no-spaces / Pen / two-card / undo never owned. |
| Create space | Named space-card Delete as the next leftover. Burst + unique `Space N` only. |
| Region-row Delete | Distinct control (`region-delete-button`, no confirm). Named next leftover: space-card reorder. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `space-card-delete-button` + confirm / `handleDelete` / `onSpaceDelete` | **GAP.** Cluster last-space contrast only. |
| Cancel confirm / Delete with no spaces / Pen-armed | **GAP.** |
| Undo `space:delete` / last-space / two cards / 390 | **GAP.** |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Card trash `className="space-card-delete-button"` / `aria-label="Delete"` calls `onDelete(space.id)`.
- `handleDelete` requires space management, then `window.confirm('Delete this space? This will not delete the pages, only the space assignment.')`, then `onSpaceDelete(spaceId)`.
- `handleSpaceDelete` already checkpoints `space:delete` before `cascadeDeleteScopedAppState` + `setSpaces` filter, and clears `activeSpaceId` / `selectedSpaceId` when they match. Journal `space_deleted` only when `pdfFile?.id` exists (not on `?testPdf=`).
- Region-row trash is a different button and has **no** confirm.
- leftover-18 Export menu (`CSV` / `PDF Pages`) is header chrome, not this path.

## Product fix

None. Confirm-cancel keeps the card; confirm removes it; `space:delete` undo restores it. Did not revert Create-space 320ms debounce, space-name rename pre-check, Add-pages `space:update`, overlay `role=switch`, or survey undo-Esc siblings. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, or canvas sizing.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-card-delete.spec.mjs` **1 / 1 (6.6s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesCardDelete.test.mjs` **3 / 3**. No high-risk file; 8448 not loosened.

Receipt log: `SPACES_CARD_DELETE_PROOF` persist `null`, `noSpacesZero: true`, `cancelKeptCard: true`, `lastSpaceDeleted: true`, `undoRestored: true`, `twoCardIsolation: true`, `penArmed: true`, `confirms: 5` (all `Delete this space? This will not delete the pages, only the space assignment.`), 390 `mobileCreate: 1` / `mobileDelete: 2` / `mobileBeforeDelete: 2` / `mobileAfterDelete: 1` / `mobileDeleted: true` / `mobileConfirm: 1`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Create + Delete confirm | **pass** | Space 1 card gone; `No spaces yet`. |
| Remaining spaces stay | **pass** | Two-card: delete Space 1; Space 2 stays. |
| Scope | **pass** | `handleDelete` / `onSpaceDelete` / `handleSpaceDelete`. Not region-row Delete. Not leftover-18 export. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel confirm | **pass** | Dismiss keeps Space 1. Confirm string fired. |
| Delete with no spaces | **pass** | Empty list: card trash **0**. |
| Pen-armed | **pass** | Delete Space 2 while Pen `btn-active`; Space 1 stays; Pen stays armed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Undo restores Space 1 after last-space delete (`space:delete`); Redo removes it; Undo again restores. Two-card undo restores Space 1 beside Space 2. |
| Last-space delete | **pass** | Only card gone; empty list; no leftover trash. |
| Two cards | **pass** | Delete Space 1; Space 2 stays. |
| 390 | **pass** | Create **1**. Same-fixture reload kept desktop Space 1 (`mobileDelete: 2` / before **2**). Confirm removed one card (after **1**). |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces space-card Delete (desktop + 390). Actual: confirm removes the card; cancel keeps it; remaining cards stay; undo pops `space:delete`.
- **Product bugs fixed:** none.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** leftover-18 **Space CSV / PDF Pages** (`onExportSpaceCSV` / `onExportSpacePDF`) stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `debug/scenarios/e2e-spaces-card-delete.spec.mjs`
- `tests/spacesCardDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
