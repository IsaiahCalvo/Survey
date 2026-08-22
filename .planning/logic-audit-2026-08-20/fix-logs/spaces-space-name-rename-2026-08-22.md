# Spaces space-name rename — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces Add pages, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18: Spaces **space-name rename** (`aria-label={`Rename ${space.name}`}` / `commitSpaceName`). Catalog completeness only typed Hunt Space. Distinct from region-row Click to rename, Create space, space-card Delete, and leftover-18 `onExportSpaceCSV` / `onExportSpacePDF`. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, Turn on/off, Expand/Collapse, Go to page, Hide/Show survey or canvas, space-card reorder, region Delete/rename, Edit region, Add pages as the GAP, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, survey-rail family, callout/line/poly handles, nubbin, Fit height, thumbnails, Search, keyboard, every-swatch, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not region-row rename)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + rename + pages) | Cluster: Create Space 1/2 + Hunt Space + page `99` reject / page `1` add. Empty / Escape / duplicate / undo / Pen / two-card / 390 never owned for the **card title**. |
| Region-row Click to rename | `commitRegionRename` / `Region 1`. Named space-name rename as a distinct leftover. |
| Add pages | Named leftover-18 export next; space-name rename stayed cluster/contrast. |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label={`Rename ${space.name}`}` / `.space-name-inline` / `commitSpaceName` | **GAP.** Cluster Hunt Space only. Checkpoint fired before empty/duplicate no-op. |
| Create space | Cluster (Space 1/2 + mint fix). Distinct leftover. |
| space-card Delete (`space-card-delete-button` + confirm) | Last-space contrast only. Distinct leftover. |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`.

## Source (before live)

- Card title `input.space-name-inline` `aria-label={`Rename ${space.name || 'Space'}`}`. Enter blurs; blur calls `commitSpaceName`. Escape restores `space.name` then blurs.
- `commitSpaceName` trims; empty/whitespace falls back to the current name (or `Space`). Calls `onRenameSpace` only when the trimmed value differs.
- `handleRenameSpace` → `onSpaceUpdate({ name })` → `handleSpaceUpdate`. Empty toasts `Space name cannot be empty.` Duplicate toasts `A space with this name already exists. Please choose a different name.`
- `handleSpaceUpdate` checkpointed **before** those checks. Ctrl+Z after a rejected rename consumed the last `space:create` / `space:update`. The uncontrolled field also kept the rejected text (`key` stays `${id}:${oldName}`).

## Product fix

`PDFViewer.jsx` (min-viable) — `handleSpaceUpdate` name path now looks up `spacesRef`, no-ops empty / duplicate / same-name, and `addHistoryCheckpoint('space:update')` only on a real label change. `SpacesPanel` `commitSpaceName` restores the field when `onRenameSpace` returns `false`. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, region Esc-cancel, overlay `role=switch`, `regionOverlayDisabledKey`, Add-pages `space:update`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-space-name-rename.spec.mjs` **1 / 1 (5.4s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesSpaceNameRename.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). 8448 not loosened.

Receipt log: `SPACES_SPACE_NAME_RENAME_PROOF` persist `null`, `emptyFallback: "Space 1"`, `escapeCancel: true`, `intendedHuntKitchen: true`, `penArmed: true`, `undoRewound: true`, `twoCardIsolation: true`, `duplicateRejected: true`, 390 `mobileCreate: 1` / `mobileRename: 2` / `mobileRenamed: true`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Enter unique name | **pass** | `Space 1` → `Hunt Kitchen`. Pages tab then Spaces still `Hunt Kitchen`. |
| Stored + card label | **pass** | `aria-label="Rename Hunt Kitchen"` after tab switch. No `file.id`. |
| Scope | **pass** | `commitSpaceName` / `handleRenameSpace`. Not region-row Click to rename. Not `onExportSpaceCSV` / `onExportSpacePDF`. Not Create / card Delete. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Empty / whitespace | **pass** | Falls back to `Space 1` (not rejected-empty toast from the UI path). |
| Escape cancel | **pass** | Typed `Temp-Esc` discarded; field stays `Space 1`. |
| Duplicate name | **pass** | `Hunt Pantry` → `Hunt Hall` toasts; field restores `Hunt Pantry`. Hunt Hall stays. |
| Pen-armed | **pass** | Renames to `Hunt Pantry`; Pen keeps `btn-active`. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Undo `Hunt Pantry` → `Hunt Kitchen`; Redo back. Card stays. Duplicate reject does not add a checkpoint (next Undo pops Hunt Hall, leaves Space 2). |
| Two cards | **pass** | Space 2 → `Hunt Hall`; Hunt Pantry stays. |
| 390 | **pass** | Create **1**; Rename field **2** (`/Rename Space/i`); committed `Mobile-Kitchen`. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces space-name rename (desktop + 390). Actual: unique name stored + card label; empty/whitespace fallback; Escape cancel; duplicate toast + restore; Pen-armed; undo `space:update`; two-card isolation.
- **Product bugs fixed:** name empty/duplicate/same-name no longer checkpoint; rejected rename restores the card field.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook.
- **Next unique leftover (not this pass):** Spaces **Create space** (`aria-label="Create space"` / `handleCreateSpace` / `handleSpaceCreate`). Cluster mint only (Space 1/2). Follow-up: space-card Delete (`space-card-delete-button` + confirm). leftover-18 Space CSV / PDF Pages stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`handleSpaceUpdate` name pre-check before checkpoint)
- `src/sidebar/SpacesPanel.jsx` (`commitSpaceName` restore on reject)
- `debug/scenarios/e2e-spaces-space-name-rename.spec.mjs`
- `tests/spacesSpaceNameRename.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
