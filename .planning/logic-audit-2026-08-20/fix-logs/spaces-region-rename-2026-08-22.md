# Spaces region-row Click to rename — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces Edit region areas, the named leftover is Spaces region-row **Click to rename** (`aria-label="Click to rename"` / `commitRegionRename`). Distinct from space-name rename (Hunt Space / `Rename ${space.name}`) and from Edit region areas. Reused the draw path only as setup — did **not** replay overlay / last-space asserts. Not leftover-18. Live-proved on `?testPdf=clickable-link-test.pdf` (plus `spike-120-pages.pdf` for same-space duplicate). Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, notes Photo/Video, 390 Choose Survey Marker, Choose survey template re-pick, Excel fail-closed, item Copy → space, survey-rail family, U-02 create/rename *space* / add-pages (this is **region** rename). UL-31 Continue pin stays parked.

## Why this is the next GAP (and not Edit region / space rename)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + rename + pages) | Spaces tab + Create space + Hunt Space rename + page `99` reject / page `1` add. Region-row label never committed. |
| Edit region areas | Draw / Confirm / overlay Hide/Show / last space. Named next leftover: region-row Click to rename. 390 Edit **0** that session. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Click to rename"` on `.region-name-display` / `commitRegionRename` | **GAP.** Stored + rail label. |
| Empty name / Escape / duplicate | **GAP.** Product: empty → `Region ${pageId}`; Escape cancels; same-space duplicate toasts. |
| Pen-armed / undo / two regions | **GAP.** |
| 390 page-row / Edit after Create | **GAP last pass** (`mobileEdit: 0`). Compiled-in (`!mobileMode` is not the gate). Taken this session after rename. |
| leftover-18 unplaced-rows / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Region row button `aria-label="Click to rename"` → `handleRegionEditClick` → inline `input.region-name-inline`. Enter / blur call `commitRegionRename` (`editingRegionValue.trim()`). Escape calls `cancelRegionRename` + `stopPropagation`.
- Space-name chrome is a different control: `aria-label={`Rename ${space.name || 'Space'}`}` / `commitSpaceName`.
- `handleRenameRegion` → `onSpaceRenamePage` → `handleSpaceRenamePage`. Empty/whitespace → `Region ${pageId}`. Same-space `hasNameConflict` toasts `A region with this name already exists in this space. Please choose a different name.`
- `handleSpaceRenamePage` was `setSpaces`-only. No `addHistoryCheckpoint`. Ctrl+Z after a commit rewound the last `space:update` (drawn region) instead of the label.

## Product fix

`PDFViewer.jsx` (min-viable) — `handleSpaceRenamePage` now pre-checks conflict / no-op against `spacesRef`, then `addHistoryCheckpoint('space:update', { spaceId, pageId, updateKeys: ['assignedPages'] })` only on a real label change. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, `noteHasContent`, or survey undo-Esc.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-region-rename.spec.mjs` **1 / 1 (8.1s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf` (duplicate slice on `spike-120-pages.pdf`). Node `spacesRegionRename.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`) + isolated `partialEraserComplexity` **11960.66 > 8448** (not loosened).

Receipt log: `SPACES_REGION_RENAME_PROOF` persist `null`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Click to rename + Enter | **pass** | `Region 1` → `Kitchen`. Pages tab then Spaces still `Kitchen`. |
| Stored + rail | **pass** | Display label after tab switch. No `file.id`. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace | **pass** | Falls back to `Region 1` (not rejected). |
| Escape cancel | **pass** | Typed `Temp-Esc` discarded; label stays `Region 1`. Overlay stayed (no undo-Esc). |
| Duplicate name | **pass** | Page 2 → `Kitchen` toasts; stays `Region 2`. Page 1 stays `Kitchen`. |
| Pen-armed | **pass** | Renames to `Pantry`; Pen keeps `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Ctrl+Z → `Kitchen`; Ctrl+Shift+Z → `Pantry`. Region row stays. |
| Two regions | **pass** | Space 2 → `Hall`; Space 1 stays `Pantry`. |
| 390 | **pass** | Create **1**; Click to rename **1** committed `Mobile-Kitchen`; Edit **1** opened Region editing toolbar; Cancel via `evaluate` click (sheet backdrop intercepts Playwright pointer). `.space-region-row` count raced **0** the same tick the buttons were **1**. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces region-row Click to rename (desktop + 390). 390 page-row / Edit after Create also proven this session.
- **Product bugs fixed:** region rename had no undo checkpoint.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces region-row **Hide/Show canvas annotations** (`aria-label="Hide canvas annotations"` / `region-visibility-button`). Distinct from overlay Hide/Show switch. Follow-up: region-row Delete (`onRemovePage`). Not leftover-18. UL-31 Continue pin stays parked. Do not re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`).
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleSpaceRenamePage` checkpoint only)
- `debug/scenarios/e2e-spaces-region-rename.spec.mjs`
- `tests/spacesRegionRename.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
