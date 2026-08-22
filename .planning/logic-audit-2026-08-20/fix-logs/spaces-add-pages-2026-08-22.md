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
| Create space / space-name rename / space-card Delete | Still cluster / contrast. Not this pass. |
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

Playwright `debug/scenarios/e2e-spaces-add-pages.spec.mjs` — pending this pass. Node `spacesAddPages.test.mjs` **3 / 3**. Official `npm test` after PDFViewer — pending. 8448 not loosened.

## Classification after this pass

- **GAP found:** Spaces Add pages (desktop + 390). Product: plus / Enter write region rows; empty / 99 / letters reject; already-assigned no-op; undo drops the row and keeps the card.
- **Next unique leftover (not this pass):** Spaces **space-name rename** (`aria-label={`Rename ${space.name}`}` / `commitSpaceName`). Distinct from region-row rename. Create space and space-card Delete stay cluster/contrast. leftover-18 Space CSV / PDF Pages stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked.
- **compile-hidden:** unchanged.

Goal stays open.
