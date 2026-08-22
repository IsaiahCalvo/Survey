# Hub Archive Select / All / None / Done — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last Archive Preview hunt (`fix-logs/archive-preview-hunt-2026-08-22.md`) named Archive **Select / All / None / Done** — local selection chrome that aims Restore / Delete forever. Search / filter / sort, row Preview / Close preview, and Show documents were just proven. Restore / Delete forever stay leftover-18. This is **local chrome**, **not** leftover-18, **not** Documents Select (Duplicate / Move/Copy / Share / Delete).

| Control | Class |
|---|---|
| Select / Done | Real. `selectMode` on; Done clears `selectedIds`. |
| All / None | Real. `nextSelectAll` over **visible** top-level rows only. |
| Row click in Select | Real. Toggles checkbox; does not open Preview. |
| Child Preview Level 1 in Select | Real exclusion. Children are not selectable; `previewDocument` no-ops. |
| Restore / Delete forever | Host-blocked leftover-18. `previewBlocked`. Toast + rows stay. Not invented. |
| Delete forever confirm | Real gate (`DELETE_FOREVER_COPY`). Cancel writes nothing. Confirm still fail-closed. |
| `empty=1` Archive | Existing empty contrast. Select still present; Restore until Select **0**; after Select, Restore/Delete disabled. |
| 390 Select actions | Were under the account chip (product bug). Now `archive-mobile-summary` + `mobile-header-select-row`. |

Did **not** replay Archive Search / filter / sort; Archive row Preview / Close preview; Show documents expand; Archive empty chrome; TabBar Close tab; Documents extras + Open file; Projects family; Templates family; Spaces; Survey-rail; PDF waves.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav | Families **already proven**. Documents Select has Duplicate / Move/Copy, no Restore. |
| `/?hubPreview=1&tab=archive` | Heading Archive; Select **1**; Restore until Select **0**; seed Atrium / Site plan / Bravo; host UUID error **0** | Select / All / None / Done is this slice. |
| `/?hubPreview=1&empty=1&tab=archive` | Nothing in Archive; Select still there; Restore **0** until Select | Empty contrast. |
| leftover-18 | Restore / Delete forever clicked | Fail-closed toast; rows stay. Not invented. |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse | — | Unreachable |
| Open account menu | Present in inventory | A-04 parked. Not invented. |

## Live proof

**Intended**

- Seeded `/?hubPreview=1&tab=archive`: Select visible; Restore / All / Done **0**. Site plan Preview then Select hides the pane. Row click checks `ad1` (`aria-pressed`); Restore enables. Toggle off disables Restore.
- All selects `['ap1','ad1','at1']` and becomes None. None clears. Done returns Select, clears checks, restores last `previewId` (Site plan).
- Filter Documents then All selects only `ad1`. Switching back to All leaves `ad1` checked and the button reading All.
- Show documents + Select: Preview Level 1 does not select a child; Restore stays disabled until Atrium is checked.

**Break**

- `/?hubPreview=1&empty=1&tab=archive`: Nothing in Archive; Restore **0** until Select; after Select, All / Restore / Delete forever present and Restore/Delete disabled; All keeps zero rows; Done hides Restore. No UUID host error.
- Documents isolation: Documents Select shows Duplicate / Move/Copy and **0** Restore / Delete forever. Archive Select shows Restore / Delete forever and **0** Duplicate / Move/Copy.

**Edge**

- Restore Site plan: toast `Could not restore 1 item: Site plan.`; order stays `['ap1','ad1','at1']`; row stays selected.
- Delete forever Bravo: Cancel leaves rows and no delete toast. Confirm: toast `Could not delete 1 item: Bravo checklist.`; Bravo stays.
- 390: Select / All / None / Done; Restore and Delete forever fail-closed the same way; empty Select keeps Restore disabled.

## Product

On 390, Archive Select / All / Restore / Delete forever lived in the ellipsized header subtitle and sat under the absolutely-positioned account chip (`mobile-profile` intercepts pointer events). Documents already ships `documents-mobile-summary` + `mobile-header-select-row`. **Fix:** Archive subtitle is now `archive-mobile-summary` / `archive-item-count` / `archive-select-row mobile-header-select-row` / `archive-select-actions`. Mobile CSS excludes the summary from the generic subtitle ellipsis and `display: contents` so the select row is full-width (`order: 4`). Restore / Delete forever stay `previewBlocked`.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-archive-select.spec.mjs` **1 / 1 (6.1s)**
- Node `tests/archiveSelect.test.mjs` **3 / 3** (plus `tests/archiveScreen.test.mjs` still **43 / 43** in the same run: **46 / 46**)
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `ARCHIVE_SELECT_PROOF` `defaultOrder: ["ap1","ad1","at1"]`, `archiveHostError: 0`, `restoreBeforeSelect: 0`, `emptySelectKeepsZeroRows: true`, `desktopAllNoneDone: true`, `allOverVisibleOnly: true`, `childExcluded: true`, `restoreFailClosed: true`, `deleteForeverFailClosed: true`, `documentsIsolation: true`, `mobileSelect: true`, `mobileEmpty: true`

## What is not claimed

This is **not** unblocked GAP = 0. Hunt after this slice: `fix-logs/archive-select-hunt-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.
