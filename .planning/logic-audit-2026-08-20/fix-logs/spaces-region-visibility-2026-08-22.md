# Spaces region-row Hide/Show canvas annotations — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces region-row Click to rename, the named leftover is Spaces region-row **Hide/Show canvas annotations** (`aria-label="Hide canvas annotations"` / `region-visibility-button`). Distinct from overlay Hide/Show (`role="switch"` / `Hide overlay for this region`). Reused the draw path only as setup — did **not** replay overlay / last-space / rename asserts. Not leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not overlay Hide/Show)

| Prior claim | What was actually asserted |
|---|---|
| Edit region areas | Draw / Confirm / overlay Hide/Show / last space. Named next leftover: region-row Click to rename. |
| Region-row Click to rename | Stored + rail label. Named next leftover: Hide/Show canvas annotations. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Hide canvas annotations"` / `region-visibility-button` | **GAP.** Page-level canvas scope for the selected space. |
| Overlay Hide/Show switch | Already proven. Distinct control (`data-region-overlay-toggle`). |
| Toggle with no annotations / Pen-armed / no region | **GAP.** |
| Two-space isolation / undo / 390 | **GAP.** Product is page-level per selected space, not per-region. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Region-row light-bulb `className="region-visibility-button"` → `onToggleCanvasAnnotations(spaceId, pageId, !visibilityState)`.
- Disabled when `!isActive || activeSpaceId === null` (`Toggle is only available when a space is active`). 300ms same-button debounce.
- `getCanvasAnnotationVisibilityState` reads `getPageAnnotationVisibilityState(page).canvasVisible` (first region on the page; **all areas on the page share it**).
- `isAnnotationVisibleByPageControl` hides **canvas** scope only. Region-scoped / survey-region-scoped marks skip the light-bulb (overlay slider owns them).
- `shouldStampActiveRegionId` stamps `regionId` on marks drawn while the overlay is on.
- `handleToggleCanvasAnnotations` was `setSpaces`-only. No `addHistoryCheckpoint`. Ctrl+Z after Hide rewound the last `space:update` (drawn region).

## Product fix

`PDFViewer.jsx` (min-viable) — `handleToggleCanvasAnnotations` now pre-checks `getPageAnnotationVisibilityState(livePage).canvasVisible` against the requested value, then `addHistoryCheckpoint('space:update', { spaceId, pageId, updateKeys: ['assignedPages'] })` only on a real flip. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, `noteHasContent`, region-rename checkpoint, or survey undo-Esc.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-region-visibility.spec.mjs` **1 / 1 (12.4s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesRegionVisibility.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`) + isolated `partialEraserComplexity` **12279.95 > 8448** (not loosened).

Receipt log: `SPACES_REGION_VISIBILITY_PROOF` persist `null`, `hiddenKeptInStore: true`, `regionScopedStays: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Hide canvas-scoped rect | **pass** | Drawn before a space (`regionId: null`) disappears from `[data-svg-annotation-layer] > g[data-anno-id]`. Store keeps it. Overlay switch stays Hide. |
| Show restores | **pass** | Same SVG id returns. |
| Region-stamped stays | **pass** | Rect drawn after overlay stamps `regionId` and stays visible while canvas-scoped hides. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| No spaces | **pass** | Hide/Show count **0**. |
| No region / inactive | **pass** | After Add pages, disabled `Toggle is only available when a space is active`. Edit+Esc activates; Hide/Show still flips with no drawn region. |
| Pen-armed | **pass** | Hide/Show while Pen `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z after Hide restores the canvas rect + Hide label; overlay stays. Ctrl+Shift+Z hides again. Region row stays. |
| Two spaces | **pass** | Page-level per selected space, not per-region. Inactive row uses the disabled label. Hide on Space 1; Turn on Space 2 shows the canvas rect; Space 1 keeps its hidden flag (Show after re-activate). |
| 390 | **pass** | Create **1**; page-row count raced **0**; disabled **1**; Hide **1** after Edit+Cancel; DOM click toggled to Show. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces region-row Hide/Show canvas annotations (desktop + 390). Actual: hides **canvas-scoped** page annotations for the selected space; region-stamped marks stay.
- **Product bugs fixed:** visibility toggle had no undo checkpoint (sibling of region-rename).
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces region-row **Delete** (`aria-label="Delete"` / `onRemovePage` / `region-delete-button`). Distinct from last-space card delete. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleToggleCanvasAnnotations` checkpoint only)
- `debug/scenarios/e2e-spaces-region-visibility.spec.mjs`
- `tests/spacesRegionVisibility.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
