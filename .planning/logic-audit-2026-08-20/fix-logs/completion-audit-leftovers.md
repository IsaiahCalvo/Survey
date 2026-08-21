# Completion-audit leftovers — 2026-08-21 (evidence re-pass)

Did not stamp `file.id`. Did not apply migrations. Did not read `.bot-credentials.json` or `.env*`. Invariants unchanged. No commit. Goal stays open.

## Source reconstruction

On-disk still missing: `REPORT.md`, `ISSUE-INVENTORY.md`, `FIX-LOG.md`, `known-bugs-deep-dive.json`.  
Recovered the ID list from git `00fda232` (not re-written to the tree). Canonical unique IDs: **96** (KB-1, KB-2, P1-01…P1-55, P2-01…P2-39). JSON adds no extra IDs.

## Restore this pass — P1-48

Desktop `commitName` in `src/sidebar/BookmarksPanel.jsx` still called `onRename?.(item.id, nextName)` and kept the unsaved clash name.

**Min-diff:** `BookmarkTreeRow` now runs `prepareAtomicBookmarkEdit`. Clash / empty / invalid page → toast + revert `item.name`. Intended rename uses `result.updates.name`. Folders without `pageIds` pass page `1` so the helper can still check the name.

**Intended:** rename Entrance → Lobby commits prepared name.  
**Break:** rename Entrance → Roof (clash) toasts and reverts.  
**Edge:** whitespace-only name `ok: false`; desktop no longer calls `onRename` with raw `nextName`.

Proof: `tests/bookmarkAtomicEdit.test.mjs` **5 / 5**. Not a high-risk file.

## Symbol re-grep

90 / 91 claimed paths hit. The one miss was a **wrong path**, not a stomp: `lastOwnerGuard.js` lives at `src/home/lastOwnerGuard.js:9` (imported by `AccessManagementModal.jsx`). P2-07 still on disk. Zero `checkAndQuit`. Invariants hold (`zoomGeneration`, SVG `viewBox`, container-aware `effectiveScale`, single-name `FONT_FAMILIES`, CORS `*`).

## Lease (A-06 / UL-45)

No complete in-repo `email|userId|tier|status` tuple. Placeholders only (`AGENTS.md` `<USER_ID>`; `tests/testAccountLease.test.mjs` fake `user-alpha`).

```
node scripts/test-account-lease.mjs assign --task KAL-AUDIT-E2E
# → At least one exact account assignment is required
```

Lease path **stopped**. Did not assign. Did not run a leased harness.

## Counts (see COMPLETION-AUDIT.md)

| Catalog | proven | weak | missing | host-blocked |
|---|---|---|---|---|
| Original 96 | **96** | **0** | **0** | **0** (apply leftovers noted, IDs still proven in-tree) |
| E2E 130 (59+46+25) | **109** | **0** | **0** | **21** remaining live paths |

## Host-blocked IDs (remaining intended path)

X-01, X-05 (cloud persist), X-06 (host writeback), U-04 (cloud usage), A-01 (Turnstile), A-02 (MSAL), A-03 (inbox), A-05 (Stripe), A-06 (two-client roster), P-01 (native Capacitor), UL-03 (native pick/cancel), UL-13 (profile persist), UL-15, UL-16, UL-20, UL-21, UL-22, UL-24, UL-45, UL-46, E2E-CHROME-03.

SQL apply leftovers (do not retry production Survey): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Not restored

- P1-45 session undo closed in `p1-45-undo.md` (no 30-day trash row).
- KB-1 leftover `erasePageAnnotations({mode:'entire'})` if a caller bypasses the canvas.
- Five in-tree migrations (apply blocked).
- Native Electron chooser pick/cancel, Stripe, MSAL/Google password, captcha, wipe, Capacitor.

## Files

- `src/sidebar/BookmarksPanel.jsx` — desktop `commitName` through `prepareAtomicBookmarkEdit`
- `tests/bookmarkAtomicEdit.test.mjs` — P1-48 intended + break + edge
- `COMPLETION-AUDIT.md` — every ID reclassified proven / weak / missing / host-blocked

No commit. **Goal stays open.**
