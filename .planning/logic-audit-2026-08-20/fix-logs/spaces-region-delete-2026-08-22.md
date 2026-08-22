# Spaces region-row Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces region-row Hide/Show canvas annotations, the named leftover is Spaces region-row **Delete** (`aria-label="Delete"` / `onRemovePage` / `region-delete-button`). Distinct from last-space card delete (`space-card-delete-button` + `window.confirm('Delete this space?…')`). Reused the draw path only as setup — did **not** replay overlay / last-space card delete / Hide/Show / rename asserts. Not leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf` + `spike-120-pages.pdf` for two-region isolation. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / Hide/Show. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not last-space card delete)

| Prior claim | What was actually asserted |
|---|---|
| Edit region areas | Draw / Confirm / overlay Hide/Show / last **space card** delete. Named next leftover: region-row Click to rename. |
| Region-row Click to rename | Stored + rail label. Named next leftover: Hide/Show canvas annotations. |
| Region-row Hide/Show | Canvas-scoped hide/show. Named next leftover: region-row Delete. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Delete"` / `region-delete-button` / `onRemovePage` | **GAP.** Removes one assigned page/region from the space. |
| `space-card-delete-button` + `Delete this space?` | Already proven (last-space card delete). Distinct control. |
| Cancel confirm / Delete with no region / Pen-armed | **GAP.** Product has **no** region-row confirm. |
| Two regions / undo / last-region / 390 | **GAP.** |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Region-row trash `className="region-delete-button"` → `onRemovePage(space.id, page.pageId)` immediately. No `window.confirm`.
- Space-card trash is a different button (`space-card-delete-button`) and **does** confirm.
- `handleRemovePage` → `onSpaceRemovePage` after `requireSpaceManagement()`.
- `handleSpaceRemovePage` cascade-deletes scoped app state, journals `region_deleted` only when `pdfFile?.id` exists (not on `?testPdf=`), then `setSpaces` filters the page. Last remaining page on the active space calls `setActiveSpaceId(null)`.
- `handleSpaceRemovePage` was `setSpaces`-only. No `addHistoryCheckpoint`. Ctrl+Z after Delete rewound the last `space:update` (drawn region).

## Product fix

`PDFViewer.jsx` (min-viable) — `handleSpaceRemovePage` now looks up the live page, no-ops when it is missing, then `addHistoryCheckpoint('space:update', { spaceId, pageId, updateKeys: ['assignedPages'] })` before cascade + `setSpaces`. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, `noteHasContent`, region-rename checkpoint, visibility checkpoint, or survey undo-Esc.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-region-delete.spec.mjs` **1 / 1 (13.2s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf` (two-region slice on `spike-120-pages.pdf`). Node `spacesRegionDelete.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). 8448 not loosened.

Receipt log: `SPACES_REGION_DELETE_PROOF` persist `null`, `noConfirm: true`, dialogs only `beforeunload` (accepted so the next fixture can load), `twoRegionIsolation: true`, 390 `mobileCreate: 1` / `mobilePageRows: 1` / `mobileDelete: 1` / `mobileDeleted: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Delete drawn region | **pass** | Region row gone; overlay `[data-space-region-overlay-root="1"]` gone; space card stays. |
| Overlay / rail update | **pass** | Overlay count 0 after Delete; space list still has the card. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Cancel confirm | **pass** | No region-row confirm. Only `beforeunload` fired on fixture change (accepted). Space-card `Delete this space?` not opened. |
| Delete with no region | **pass** | No spaces / Create-without-Add-pages: region-delete count **0**. |
| Pen-armed | **pass** | Delete while Pen `btn-active`; Pen stays armed. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z after Delete restores the page row (and overlay after Turn on when last-region deactivated the space). Ctrl+Shift+Z removes it again. |
| Two regions | **pass** | `spike-120-pages.pdf` Add `1,2`. Delete Region 1; Region 2 stays. Undo restores both + page-1 overlay. |
| Last-region delete | **pass** | Only page removed; space card stays (`0 regions` / No pages added yet). Distinct from last-space card delete. |
| 390 | **pass** | Create **1**; page-row **1**; Delete **1**; DOM click removed the row. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces region-row Delete (desktop + 390). Actual: removes that assigned page/region from the space immediately (no confirm); overlay/rail update; last-region deactivates the space but keeps the card.
- **Product bugs fixed:** region-row Delete had no undo checkpoint (sibling of region-rename / visibility).
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces **space-card reorder** (`aria-label="Drag to rearrange"` / `onReorderSpaces` / `SortableRearrangeList`). Distinct from survey-rail category/item reorder and from region-row Delete. Hide/Show survey annotations is survey-context only (sibling of already-proven canvas Hide/Show). Space CSV / PDF Pages stay leftover-18. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleSpaceRemovePage` checkpoint + missing-page no-op only)
- `debug/scenarios/e2e-spaces-region-delete.spec.mjs`
- `tests/spacesRegionDelete.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
