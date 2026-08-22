# Hub Archive Search / filter / sort — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last TabBar Close tab hunt (`fix-logs/tab-close-hunt-2026-08-22.md`) named Archive **Search / filter / sort**. Search was mounted (`archiveSearch: 2`); empty copy was still `0`; Restore stays leftover-18. This is **local chrome**, **not** leftover-18, **not** Archive empty chrome, **not** Close tab.

| Control | Class |
|---|---|
| `Search archive...` | Real. `searchArchiveItems` / `visibleArchiveItems`. Case-insensitive name substring; project kept when a child matches. |
| Filter menu Show All / Documents / Projects / Templates | Real. `ARCHIVE_FILTERS` / `filterArchiveItems`. |
| Sort menu File / Project / Most recently archived / Size + Name/Archived column headers | Real. `ARCHIVE_SORT_OPTIONS` / `nextSortState`. |
| `empty=1` Archive | Existing empty contrast. Empty chrome already catalog-completeness live. |
| Restore / Delete forever | Host-blocked leftover-18. Preview callbacks are `previewBlocked`. Not invented. |
| `mobileProjectLayout` | Unreachable. Not invented. |

Did **not** replay Templates family; Documents extras / Lock persist / Open file; Projects extras / file Move/Copy / card reorder / Team write / file Search / file-row reorder / file Delete / file-row Open; Archive empty chrome; Spaces; Survey-rail; PDF waves; TabBar Close tab.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav | Families **already proven**. |
| `/?hubPreview=1&tab=archive` | Heading Archive; Search **2**; seed Atrium / Site plan / Bravo; host UUID error **0** | Search / filter / sort is this slice. Empty copy **0** because the list is seeded. |
| `/?hubPreview=1&empty=1&tab=archive` | Nothing in Archive; Search **2**; Restore **0** until Select | Empty contrast. Not a replay of empty chrome as the GAP. |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse | — | Unreachable |

There was **no** existing HubPreview archive fixture query. `empty=1` is the real empty contrast. Default `?hubPreview=1` now seeds a local normalized list (same shape as `archiveContract`) so Search can match. Restore is not a local writeback.

## Live proof

**Intended**

- Seeded `/?hubPreview=1&tab=archive`: default order `Atrium`, `Site plan`, `Bravo checklist` (`ap1`, `ad1`, `at1`).
- Search `site` / `SITE` → Site plan. `Level 1` keeps Atrium and shows the child (Level 2 hidden). Clear restores all three.
- Filter Documents / Projects / Templates / All narrows by type.
- Name header A–Z / Z–A; Size menu `ad1`, `ap1`, `at1`; Most recently archived restores default.

**Break**

- `/?hubPreview=1&empty=1&tab=archive`: Nothing in Archive; Search still **2**; typing Site keeps empty copy (no no-match line — `items.length === 0`); Restore **0** until Select; no UUID host error.
- Documents nav isolation: SE-011 still listed.

**Edge**

- Escape keeps the query (`site`) and does not clear.
- Select + Restore on Site plan: toast `Could not restore`; rows stay (`restoreDidNotRemove: true`). Not invented writeback.
- 390: mobile Search match / case / no-match / clear; filter Documents / All; empty fixture visible empty copy.

## Product

1. HubPreview Archive was calling live `loadArchive('dev-hubpreview-user')`. That id is not a UUID, so Postgres returned `invalid input syntax for type uuid` and empty copy never mounted. **Fix:** HubPreview passes a local `archiveItems` seed (or `[]` on `empty=1`); SurveyHub renders `ArchiveScreen` when `archiveItems` is an array. `ArchiveScreenContainer` treats a non-UUID `user.id` as no user (no host call). Restore / Delete forever stay `previewBlocked`.
2. After typing in Search, the first click on the filter/sort button was swallowed by Search's `DismissBarrier`. **Fix:** `dismissActionSelector=".archive-filter-button"` (same contract Templates Search already uses).
3. Rows now carry `data-archive-item-id` / `data-archive-item-type` (Documents already has `data-document-id`).

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-archive-search.spec.mjs` **1 / 1 (5.8s)**
- Node `tests/archiveSearch.test.mjs` **3 / 3** (plus `tests/archiveScreen.test.mjs` still **43 / 43** in the same run: **46 / 46**)
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `ARCHIVE_SEARCH_PROOF` `defaultOrder: ["ap1","ad1","at1"]`, `nameAz` / `nameZa` / `sizeDesc`, `archiveHostError: 0`, `emptyRestore: 0`, `restoreDidNotRemove: true`, `mobileEmpty: true`

## What is not claimed

This is **not** unblocked GAP = 0. Hunt after this slice: `fix-logs/archive-search-hunt-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.
