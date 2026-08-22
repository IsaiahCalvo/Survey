# Mobile Bookmarks up/down / create / jump — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Did **not** replay leftover-18, invented `.env.local`, Eraser Size presets, Counter Size/Start, F3/Ctrl+G, counter Delete, Cloud bump 1–20, Search Previous/result-row, keyboard matrix, every-swatch, callout paste, thin leftovers, PDF links, History, pages, flatten, mobile 390 header/dock chrome, leftover-18 fail-closed, hub extras, waves 5–13.

Did **not** invent compile-hidden Print / stamp / measure / Group-Ungroup / Extract Pages / Note-Link create.  
Did **not** run a 768 Playwright pass — source has no tablet-specific chrome.

## Independent catalog (this pass)

Source: `AppShell.jsx` `matchMedia('(max-width: 720px)')` → `MobilePdfViewerChrome` + `PDFSidebar` `mobileMode`. `BookmarksPanel` mobile list uses **up/down buttons**, not desktop dnd-kit (V-07). Prior 390 chrome opened Spaces + History, not this sheet.

| Candidate | Verdict |
|---|---|
| **Mobile Bookmarks create / up-down / Open / page clamp** | **This pass.** Distinct components from V-07 dnd-kit. |
| Tablet 768 chrome | **Not a cluster.** Only breakpoint is `max-width: 720px`. At 768, `isNarrowShell` is false → desktop `AppShell` chrome (CSS wrap of the same components). No `TabletPdfViewerChrome` / `isTablet`. |
| leftover-18 (18 hosts) | Parked. `.env.local` / `.bot-credentials.json` / Docker still missing. |
| Custom Print panel | Compile-hidden. `PRINT_PANEL_ENABLED = false` (`PDFViewer.jsx`). |
| Forms designer | Compile-hidden. `{false && (` (`AppShell.jsx`). |
| Text-highlight split | Compile-hidden. `showTextMarkupHighlightMenu = false` (KAL-240). |
| Note / Underline / Strike / Squiggly create | Compile-hidden. Commented `TODO` in review dropdown. |
| Group / Ungroup | Compile-hidden. Omitted from context menu until matrix-per-shape rewrite (`useAnnotationContextMenu.jsx`). |
| Stamp / measurement / Extract Pages / Link create | Absent as user tools. Not invented. |

## Live chrome

390×844 `?testPdf=spike-120-pages.pdf`. Dock **Open pages, search, and bookmarks** → hub tab **Bookmarks** → `mobile-bookmark-list`.

## Product (min-viable)

1. `src/sidebar/bookmarkReorderUtils.js` — `swapBookmarkSiblingOrder` (same two-row `order` swap the inline handler used).
2. `src/sidebar/BookmarksPanel.jsx` — mobile up/down calls that helper.
3. `src/PDFSidebar.jsx` — hub tabs now have `aria-label={tab.label}`. Live snapshot had unnamed icon-only tab buttons, so Bookmarks was not findable.

Not high-risk files. Invariants unchanged.

## 1. Intended — **pass**

Playwright `e2e-mobile-bookmarks.spec.mjs` **1 / 1 (3.7s)** on reused Vite `http://localhost:5173`. Node `mobileBookmarkMove.test.mjs` **2 / 2**.

| Check | Result |
|---|---|
| Create | `E2E-MB-A-…` then `E2E-MB-B-…` appended as adjacent rows |
| Up | Bravo **Move bookmark up** placed Bravo above Alpha |
| Down | Bravo **Move bookmark down** restored Alpha above Bravo |
| Open | Bookmark page **3** → header `3/120` |

## 2. Break / edge — **pass**

| Check | Result |
|---|---|
| First **Move up** | Disabled on the first row |
| Last **Move down** | Disabled on Bravo (then on the new last after delete) |
| Empty name | Toast `Please enter a bookmark name.` |
| Page `0` / `999` | Toast `page number between 1 and 120`; no `E2E-MB-bad-page` row |
| Clash | Same name as Alpha → `already exists` |
| Cancel | Closes the new-bookmark editor |
| Delete + confirm | Bravo row gone; Alpha stayed |
| `file.id` | `null` |

## Still parked

Leftover **18** unchanged. After this cluster, no other unique unblocked GAP remains besides leftover-18 / compile-hidden. Full table: `unblocked-catalog-exhausted-2026-08-21.md`.

## Files

- `src/sidebar/bookmarkReorderUtils.js`
- `src/sidebar/BookmarksPanel.jsx`
- `src/PDFSidebar.jsx`
- `debug/scenarios/e2e-mobile-bookmarks.spec.mjs`
- `tests/mobileBookmarkMove.test.mjs`
- this receipt

Goal stays open.
