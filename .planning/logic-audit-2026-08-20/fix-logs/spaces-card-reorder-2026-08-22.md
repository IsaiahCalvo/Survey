# Spaces space-card reorder — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces region-row Delete, the named leftover is Spaces **space-card reorder** (`aria-label="Drag to rearrange"` / `onReorderSpaces` / `SortableRearrangeList`). Distinct from survey-rail category/item reorder and from region-row Delete. Hide/Show survey annotations is survey-context only (sibling of already-proven canvas Hide/Show) — not this pass. Space CSV / PDF Pages stay leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages / region-row rename / Hide/Show / Delete. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not region-row Delete)

| Prior claim | What was actually asserted |
|---|---|
| Region-row Delete | Immediate page-row remove. Named next leftover: space-card reorder. |
| Survey-rail category/item reorder | Different list (`handleReorderSurveyCategories` / `reorderSurveyMarkersInCategory`). |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Drag to rearrange"` / `data-space-drag-handle` / `onReorderSpaces` | **GAP.** ≥2 spaces; drop so Space 1 is no longer first. Stored + rail order update. |
| Single space / cancel mid-drag / Pen-armed | **GAP.** Handle stays; self-drag no-op; Escape keeps Space 1 first; Pen still reorders. |
| Undo / 390 | **GAP.** Product needed a checkpoint. 390 handle exists. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Space cards use `SortableRearrangeList` + `DragRearrangeHandle` (`title` + now `aria-label="Drag to rearrange"`).
- `handleSpaceReorder` maps `activeId`/`overId` → `onReorderSpaces(fromIndex, toIndex)`. Self-id is a no-op.
- `handleReorderSpaces` was `setSpaces` + `arrayMove` only. No `addHistoryCheckpoint`. Ctrl+Z after a drop rewound the last `space:create`.
- Create space precomputed `Space ${spaces.length + 1}` in the click handler. A second click before the closure refreshed sent `Space 1` again and toasted a name conflict.

## Product fix

`PDFViewer.jsx` (min-viable) — `handleReorderSpaces` now reads live `spacesRef`, no-ops on the same index / out-of-range, then `addHistoryCheckpoint('space:update', { fromIndex, toIndex, updateKeys: ['order'] })` before `arrayMove`. Did not invent a new history reason (`space:update` stays eligible). Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, or sibling region-row checkpoints.

`SpacesPanel.jsx` — handle `aria-label="Drag to rearrange"`; Create space no longer precomputes N from `spaces.length` (lets `handleSpaceCreate` mint from live `prev`).

## Live-proved

Playwright `debug/scenarios/e2e-spaces-card-reorder.spec.mjs` **1 / 1 (20.9s)** on Vite `http://127.0.0.1:5180` + `?testPdf=clickable-link-test.pdf`. Node `spacesCardReorder.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: `e2eUnlistedControls` Create-space name slice updated to the live mint (was the stale `spaces.length` string). 8448 not loosened.

Receipt log: `SPACES_CARD_REORDER_PROOF` persist `null`, `intendedMethod: pointer`, `cancelKeptSpace1First: true`, `penArmedReordered: true`, `undoRewound: true`, `singleSpaceNoOp: true`, 390 `mobileCreate: 1` / `mobileHandles: 4` / `mobileReordered: true` / names after `["Space 2","Space 1","Space 3","Space 4"]` (two Create clicks minted four cards on the sheet; the handle still moved Space 1 off first).

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| ≥2 spaces drag | **pass** | Pointer handle dropped Space 1 onto Space 2. Rail + stored (Pages↔Spaces) `['Space 2', 'Space 1']`. |
| Stored + rail | **pass** | Same order after the Pages tab remount. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Single space | **pass** | No spaces: handle count **0**. One space: handle stays; self-drag no-op. |
| Cancel mid-drag | **pass** | Escape kept `['Space 1', 'Space 2']`. |
| Pen-armed | **pass** | Pen `btn-active`; Space 2 dragged back under Space 1. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z restored `['Space 1', 'Space 2']` (`space:update`). Ctrl+Shift+Z returned `['Space 2', 'Space 1']`. Both cards stayed. |
| 390 | **pass** | Handle present. Pointer drag moved Space 1 off first (`mobileReordered: true`). Two Create clicks minted four named cards on this sheet (not the GAP). |

No error boundary. SVG default. No Move up / Move down.

## Classification after this pass

- **GAP found and proven:** Spaces space-card reorder (desktop + 390 handle). Actual: ≥2 cards; drop so Space 1 is no longer first; stored + rail update; Escape / single-space / Pen-armed; undo `space:update`.
- **Product bugs fixed:** reorder had no undo checkpoint (sibling of region-rename / visibility / Delete); Create space used a stale `spaces.length` name.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces region-row **Hide/Show survey annotations** (`aria-label="Hide survey annotations"` / `onToggleSurveyAnnotations`) — survey-context only, sibling of already-proven canvas Hide/Show. Space CSV / PDF Pages stay leftover-18. Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleReorderSpaces` live-index no-op + `space:update` checkpoint only)
- `src/sidebar/SpacesPanel.jsx` (handle `aria-label`; Create space live name)
- `debug/scenarios/e2e-spaces-card-reorder.spec.mjs`
- `tests/spacesCardReorder.test.mjs`
- `tests/e2eUnlistedControls.test.mjs` (Create-space name slice)
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
