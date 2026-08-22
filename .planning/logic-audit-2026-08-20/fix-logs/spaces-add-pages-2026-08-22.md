# Spaces Add pages — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces card Turn on/off, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18: Spaces **Add pages** (`aria-label="Add pages"` / `handleAssignPages` / `handleSpaceAssignPages`). Catalog completeness only clicked page `1` / rejected `99`. Later Spaces passes reused Add pages as setup only. Distinct from Create space, space-name rename (`Rename ${space.name}`), space-card Delete, and leftover-18 `onExportSpaceCSV` / `onExportSpacePDF`. Live-proved on `?testPdf=clickable-link-test.pdf` + `spike-120-pages.pdf` for range + two-space isolation. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, Turn on/off, Expand/Collapse, Go to page, Hide/Show survey or canvas, space-card reorder, region Delete/rename, Edit region, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, survey-rail family, callout/line/poly handles, nubbin, Fit height, thumbnails, Search, keyboard, every-swatch, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not leftover-18 export)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + rename + pages) | Cluster: Create Space 1/2 + Hunt Space + page `99` reject / page `1` add. Range / Enter / already-assigned / undo / Pen / 390 / two-space isolation never owned. |
| Turn on/off | Named leftover-18 export next. Add pages was setup only. |
| Space CSV / PDF Pages | Leftover-18 header export. Not Add pages. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Add pages"` / `space-add-pages-input` / `handleAssignPages` / `handleSpaceAssignPages` | **GAP.** Cluster-only. `setSpaces`-only — no checkpoint. |
| Create space | Cluster (Space 1/2 + mint fix). Not this pass. |
| space-name rename (`Rename ${space.name}` / `commitSpaceName`) | Cluster (Hunt Space). Distinct leftover. |
| space-card Delete (`space-card-delete-button` + confirm) | Last-space contrast only. Distinct leftover. |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Plus `aria-label="Add pages"` and Enter both call `onAssignPages(space.id)`.
- `handleAssignPages` parses via `parsePageRangeInput` (`min: 1`, `max: numPages`). Errors stay local (`No page numbers provided.` / out of range). Empty/invalid never call `onSpaceAssignPages`.
- `handleSpaceAssignPages` merged new integer pageIds into `assignedPages` as `Region ${pageNumber}` and `setSpaces` only. No `addHistoryCheckpoint`. Ctrl+Z after Add pages rewound `space:create` (the whole card).
- Already-assigned pages were a silent `setSpaces` identity churn.

## Product fix

`PDFViewer.jsx` (min-viable) — `handleSpaceAssignPages` now looks up the live space, no-ops when the space is missing or every page is already assigned, then `addHistoryCheckpoint('space:update', { spaceId, pageIds, updateKeys: ['assignedPages'] })` before `setSpaces`. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-add-pages.spec.mjs` **1 / 1 (13.4s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf` (range on `spike-120-pages.pdf`). Node `spacesAddPages.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). Isolated complexity not reached (runner breaks on first file fail). 8448 not loosened.

Receipt log: `SPACES_ADD_PAGES_PROOF` persist `null`, `rangePages: ["3","6","7","8","9","12"]`, `twoSpaceIsolation: true`, `undoDropsRowKeepsCard: true`, 390 `mobileCreate: 1` / `mobileAddPages: 1` / `mobileAdded: false`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Plus adds page 1 | **pass** | Region row **1**; `Go to page 1`; label `Region 1`; input clears. |
| Enter adds | **pass** | Space 2 Enter `1` → Region 1. Space 1 stays 1. |
| Range | **pass** | spike-120 `3,6-9,12` → pills `3 6 7 8 9 12`. |
| Scope | **pass** | `handleAssignPages` / `onSpaceAssignPages`. Not `onExportSpaceCSV` / `onExportSpacePDF`. Not Create / rename / card Delete. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Add pages button + input **0**. |
| Create without Add pages | **pass** | Region rows **0**. |
| Empty / letters | **pass** | `No page numbers provided.`; rows stay **0**. Letters sanitize to empty. |
| Page 99 on 1-page | **pass** | `out of the valid range`; rows stay **0**. |
| Pen-armed | **pass** | Already-assigned re-click keeps 1 row; Pen `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Already-assigned no-op | **pass** | Re-add page 1 stays 1 row. One Undo drops the row (no extra checkpoint). |
| Undo / redo | **pass** | Undo drops the page row and keeps the card (`space:update`, not `space:create`). Redo restores the row. |
| Two spaces | **pass** | Space 2 Add `1`; Space 1 range stays 6. Undo Space 2 drops its row only. |
| 390 | **pass** | Create **1**; Add pages **1**. Page-row raced **0** this session (sheet). Control exists. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces Add pages (desktop + 390). Actual: plus / Enter write region rows; empty / 99 / letters reject; already-assigned no-op; range `3,6-9,12`; undo drops the row and keeps the card.
- **Product bugs fixed:** Add pages had no undo checkpoint (sibling of region-rename / visibility / Delete / reorder). Already-assigned no longer `setSpaces`-churns.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces **space-name rename** (`aria-label={`Rename ${space.name}`}` / `commitSpaceName`). Distinct from region-row rename. Create space and space-card Delete stay cluster/contrast. leftover-18 Space CSV / PDF Pages stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleSpaceAssignPages` checkpoint + already-assigned no-op only)
- `debug/scenarios/e2e-spaces-add-pages.spec.mjs`
- `tests/spacesAddPages.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
