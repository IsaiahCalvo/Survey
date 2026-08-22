# Spaces Create space — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Independent catalog vs E2E-STATUS + 2026-08-21/22 fix-logs. After Spaces space-name rename, leftover-18 Space CSV / PDF Pages stay parked. Unique leftover that is **not** leftover-18: Spaces **Create space** (`aria-label="Create space"` / `handleCreateSpace` / `handleSpaceCreate`). Cluster completeness + context-menu spec only minted Space 1/2 after isolated clicks. Distinct from space-name rename (`Rename ${space.name}`), space-card Delete, and leftover-18 `onExportSpaceCSV` / `onExportSpacePDF`. Live-proved on `?testPdf=clickable-link-test.pdf`. Did **not** invent Extract / Note-Link create / Print / stamp / measure / Group / ellipse radii / ink vertices / UL-03 pick / checklist items / Copy-to-Spaces / category Move/Copy stub. Did **not** invent `.env.local`. Did **not** replay leftover-18, Turn on/off, Expand/Collapse, Go to page, Hide/Show survey or canvas, space-card reorder, region Delete/rename, Edit region, Add pages, space-name rename as the GAP, Photo/Video, 390 switcher, template re-pick, Excel fail-closed, Copy-space, survey-rail family, callout/line/poly handles, nubbin, Fit height, thumbnails, Search, keyboard, every-swatch, pages structure, flatten, mobile chrome. UL-31 Continue pin stays parked.

## Why this is the next GAP (and not space-name rename)

| Prior claim | What was actually asserted |
|---|---|
| U-02 **pass** (create + rename + pages) | Cluster / `e2e-context-menu-spaces`: isolated click → Space 1, second click → Space 2. Rapid double-click / Pen / max / undo / 390 burst never owned. |
| space-name rename | Named Create space as the next leftover. Card title only. |
| space-card reorder mint fix | Unique `Space N` from live `prev`. A second click in the same burst still appended another card (390 reorder pass minted four named cards). |

## Hunt (independent catalog)

| Candidate | Verdict |
|---|---|
| `aria-label="Create space"` / `handleCreateSpace` / `handleSpaceCreate` | **GAP.** Cluster Space 1/2 only. Burst still minted extras. |
| space-card Delete (`space-card-delete-button` + confirm) | Last-space contrast only. Distinct leftover. |
| leftover-18 Space CSV / PDF Pages / Print / Forms / Note create / Group / stamp / measure / Extract / Link create / checklist items / copyModeActive Copy-to-space / category Move/Copy stub | Parked / compile-hidden / dead stub. |

Did **not** invent a persist seam. No `file.id`. No compiled product max (`MAX_SPACE` / `maxSpaces` absent).

## Source (before live)

- Header plus `aria-label="Create space"` (or Upgrade when `!canManageSpaces`) calls `handleCreateSpace` → `onSpaceCreate({ assignedPages: [] })`. No precomputed `Space ${spaces.length + 1}`.
- `handleSpaceCreate` checkpoints `space:create` then `setSpaces` mints the next free `Space N` from live `prev`.
- Unique names stopped the duplicate-name toast. A rapid double-click still appended two cards. The 390 reorder pass recorded two Create clicks minting four named cards on the sheet.
- No product max. `?testPdf=` developer can create (`canManageCollaborativeSpaces` with `documentId: null`).

## Product fix

`PDFViewer.jsx` (min-viable) — `handleSpaceCreate` now returns before `addHistoryCheckpoint('space:create')` when a second nameless mint arrives inside 320ms (`spaceCreateBurstRef`). Intentional second Create waits for the new card. Did not invent a max. Did not loosen the function-only left-rail guard. Did not touch `zoomGeneration`, SVG viewBox zoom, canvas sizing, space-name rename pre-check, Add-pages `space:update`, overlay `role=switch`, or survey undo-Esc siblings.

## Live-proved

Playwright `debug/scenarios/e2e-spaces-create-space.spec.mjs` **1 / 1 (8.1s)** on Vite `http://localhost:5173` + `?testPdf=clickable-link-test.pdf`. Node `spacesCreateSpace.test.mjs` **3 / 3**. Official `npm test` after PDFViewer: standing `pageOperationsQueueMounted` (`Cannot find module '/tmp/utils/pageContextOps.js'`). 8448 not loosened.

Receipt log: `SPACES_CREATE_SPACE_PROOF` persist `null`, `intendedMint: "Space 1"`, `desktopDblclickPlusOne: true`, `desktopRapidPairPlusOne: true`, `noProductMax: true`, `penArmed: true`, `undoPopsCreate: true`, `twoCreateIsolation: true`, 390 `mobileCreate: 1` / `mobileCreatePageWide: 1` / `mobileBeforeClick: 5` / `mobileAfterClick: 6` / `mobileAfterDblclick: 7` / `mobileDblclickDelta: 1` / `mobileStillDoubleMints: false`.

### Intended — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Click Create | **pass** | Empty list → `Space 1`. Count 0→1. |
| Unique minted name | **pass** | `Rename Space 1` / value `Space 1`. Later burst + isolate minted Space 2…6 without a name clash. |
| Count increments | **pass** | Each accepted click +1. No `file.id`. |
| Scope | **pass** | `handleCreateSpace` / `handleSpaceCreate`. Not `commitSpaceName`. Not leftover-18 export. Not space-card Delete. |

### Break — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Rapid double-click (desktop) | **pass** | After Space 1, `dblclick` → only Space 2 (not Space 3). Rapid pair → only Space 3. |
| Rapid double-click (390) | **pass** | Same sheet: Create **1** (page-wide **1**, not dual-mounted). `dblclick` Δ **1**. `mobileStillDoubleMints: false`. Prior four-card mint did not recur. |
| Pen-armed | **pass** | Mints Space 4; Pen keeps `btn-active`. |
| Product max | **pass** | No compiled max. Create stays enabled after 3 cards. No maximum / limit toast. |

### Edge — **pass**

| Slice | Verdict | Evidence |
|---|---|---|
| Undo / redo | **pass** | Undo pops Space 4 (`space:create`); Space 1–3 stay. Redo restores Space 4. |
| Two Creates isolate | **pass** | Space 5 then Space 6; Undo drops only Space 6; Space 5 and Space 1 stay. |
| 390 | **pass** | Button present. Same-fixture reload keeps desktop spaces (`isSamePdfReload`, before **5**). Click **6**; dblclick **7**. Did **not** still double-mint. |

No error boundary. SVG default.

## Classification after this pass

- **GAP found and proven:** Spaces Create space (desktop + 390). Actual: unique `Space N` mint + count increment; desktop/390 burst +1; Pen-armed; no product max; undo `space:create`; two-Create isolation.
- **Product bugs fixed:** rapid double-click no longer appends a second card; discarded burst does not checkpoint.
- **Omitted (not invented):** checklist items, category Move/Copy stub, copy-mode toolbar, leftover-18 unplaced-rows, linked workbook, product max.
- **Next unique leftover (not this pass):** Spaces **space-card Delete** (`space-card-delete-button` + confirm / `handleDelete` / `onSpaceDelete`). leftover-18 Space CSV / PDF Pages stay **parked**. Do not invent Print / stamp / measure / Group / Extract / Note-Link / checklist items / Copy-to-Spaces. UL-31 Continue pin stays parked. Do **not** re-claim unblocked GAP = 0.
- **leftover-18:** still **18**, parked (`X-01`, `X-05` persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06` roster, `UL-03`, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`). Space CSV / PDF Pages stay in that park list.
- **compile-hidden:** unchanged (Print panel, Forms, text-markup create, Note create, Group/Ungroup, stamp, measure, Extract, Link create, two-page, Actual size).

## Files

- `src/PDFViewer.jsx` (`spaceCreateBurstRef` + gate before `space:create` checkpoint)
- `src/sidebar/SpacesPanel.jsx` (comment: burst-gating lives in `handleSpaceCreate`)
- `debug/scenarios/e2e-spaces-create-space.spec.mjs`
- `tests/spacesCreateSpace.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md`
- `.planning/logic-audit-2026-08-20/FEATURE-MATRIX.md`
- this receipt

Goal stays open.
