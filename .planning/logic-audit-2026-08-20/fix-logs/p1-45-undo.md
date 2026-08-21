# P1-45 — Bookmark group delete undo

Date: 2026-08-21  
Worktree: `nifty-elion-773074`  
No commit. Goal stays open.

## Original finding (git `00fda232` REPORT.md)

Deleting a bookmark group permanently deleted all nested bookmarks — no count in the confirm, no undo. Bookmarks were absent from the undo snapshot and the 30-day trash system.

Prior pass closed count + confirm (`describeBookmarkDeleteConfirm` / `window.confirm`) and left undo/trash as leftover. Confirm copy said “This cannot be undone.”

## What was still wrong (re-read, not trusted leftover)

`handleBookmarkDelete` in `PDFViewer.jsx` still hard-deleted the subtree with no history checkpoint. Toolbar Undo after accept did not restore (wave 4 leftover). Confirm/count were already correct.

## Min-diff

Scoped bookmark slice only. Annotation snapshots stay bookmark-free so later shape undo does not clobber sidebar edits.

- `src/sidebar/bookmarkEditUtils.js` — `planBookmarkDelete`, `applyBookmarkHistorySlice`, `historyStateHasBookmarks`; confirm no longer says it cannot be undone
- `src/PDFViewer.jsx` — `bookmarksRef`; `handleBookmarkDelete` checkpoints `bookmark:delete` then applies `plan.next`; `restoreHistoryState` applies bookmarks only when the snapshot carries the key; undo/redo copy the live list onto the opposite stack
- `src/utils/historyHelpers.js` — `isLegacyAnnotationHistoryMeta` accepts `bookmark:` (same gate as `space:`)

No 30-day trash / History-panel row. No `zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name font / CORS change.

## Proof

**Intended:** delete group + nested → Undo restores both.  
**Break:** missing / unknown id → no confirm, no checkpoint, no delete. Dismiss confirm keeps both (live).  
**Edge:** annotation-only snapshots have no `bookmarks` key (sidebar untouched). Redo after undo deletes the subtree again.

```
node --test tests/bookmarkAtomicEdit.test.mjs tests/pdfViewerUndoOneLiners.test.mjs
# → 20 / 20
```

Live reused Vite `http://localhost:5173` (`npm run dev:ui`, not killed):

```
npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave4.spec.mjs --grep "P1-45"
# → 1 / 1 (3.8s)
```

`npm test` (`node scripts/run-node-tests.mjs`) after the PDFViewer + history-gate edits: **exit 0**.

## Verdict

**proven**

## Remaining (unchanged, not this ID)

Host-blocked live paths: X-01, X-05 (cloud persist), X-06 (host writeback), U-04 (cloud usage), A-01 (Turnstile), A-02 (MSAL), A-03 (inbox), A-05 (Stripe), A-06 (two-client roster), P-01 (native Capacitor), UL-03 (native pick/cancel), UL-13 (profile persist), UL-15, UL-16, UL-20, UL-21, UL-22, UL-24, UL-45, UL-46, E2E-CHROME-03.

SQL apply leftovers (do not retry production Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.
