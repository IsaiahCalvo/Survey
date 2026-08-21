# Completion audit — current disk (2026-08-21 later)

**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not read `.bot-credentials.json` / `.env*`. Did not apply SQL to prod Survey. Did not retry the 18 host leftovers as live hosts.

## npm test

| Run | Result |
|---|---|
| First official `npm test` (before this-pass src fixes) | **exit 1** — `tests/annotationStyleUiContract.test.mjs` missing `FONT_FAMILIES` in `MobilePdfViewerChrome.jsx` |
| After font + ReSignIn + sheet-close + P1-07 test updates | main files **all passed** (187 remaining after `pdfViewerStaleIdCommits` = 0 fail; focused contracts 13 / 13) |
| Official `npm test` after those fixes | **exit 1** — isolated `tests/partialEraserComplexity.test.mjs` wall-clock (`p95CommitMs` ≤ 75 / `maxCommitMs` ≤ 250). Not an audit-ID reopen. Did not loosen the eraser budget. Did not touch eraser engine. |

**Report this exit:** official `npm test` **1**.

## graphify

AST-only extract of 6 src files (`HubPreview.jsx`, `DevTestRoute.jsx`, `Dashboard.jsx`, `MobilePdfViewerChrome.jsx`, `ReSignInModal.jsx`, `reSignInAccount.js`): **63 nodes / 177 edges**. Merge preview 21406 nodes. `to_json` refused to overwrite `graph.json` (existing 25415 nodes) — left the on-disk graph intact.

## 96 unique IDs (disk, not memory)

Canonical set from restored `ISSUE-INVENTORY.md` / `REPORT.md` body / `known-bugs-deep-dive.json`: **KB-1 + KB-2 + P1-01…P1-55 + P2-01…P2-39 = 96**. Headline 103 is pre-fold (see COMPLETION-AUDIT §7). JSON adds no extra IDs.

| Verdict | Count |
|---|---|
| **proven** | **96** |
| **weak** | **0** |
| **missing** | **0** |
| **host-blocked** (as vanished IDs) | **0** |

Per-ID citations live in `COMPLETION-AUDIT.md` §1. This pass re-parsed that table (**95 rows → 96 unique IDs**, `P1-40 / P1-41` combined) and resolved every proof basename on disk (naive relative paths were `src/services/*`, `src/hooks/*`, `src/contexts/*`, `src/electron/*`, `src/components/collab/*`, `supabase/functions/*`). SQL **apply** leftovers stay proven in-tree, not missing.

## Stale-vs-current (requested surfaces)

| Surface | On-disk now | Audit was |
|---|---|---|
| HubPreview / DevTestRoute | `previewBlocked(...)` for sign-in / reset / profile / delete / OAuth | A-02 already said hubPreview fail-closed; A-01 now also cites both mocks |
| Dashboard | `onSignOut` toasts thrown `signOut` errors | not previously called out |
| P1-45 | `src/sidebar/bookmarkEditUtils.js:77-89` confirm; `PDFViewer.jsx:12747-12759` `bookmark:delete` | still live |
| P-01 / UL-46 | Capacitor receipts already on disk | still proven |
| A-01 | guest chrome proven; Turnstile host-blocked; mocks fail-closed | updated |

## ReSignInModal verdict

**Wired** to the existing `AuthContext.resetPassword(email, captchaToken)` path (same as AuthModal / AccountSettings). Not an unused stub.

- **Can appear** on a real signed-in document: `YDocProvider` opens it on `login_expiry_failure` (`AppShell.jsx` wraps every tab, including `?testPdf=`).
- **Forgot password** now plans via `planReSignInPasswordReset`, calls `resetPassword`, shows “link has been sent…” on success, or an honest error.
- **`?testPdf=` / HubPreview:** `previewBlocked` throws (`Test PDF cannot send password reset emails.` / `Preview cannot…`) → `reset_failed`, no silent success.
- **Intended / break / edge:** `tests/reSignInReset.test.mjs` **3 / 3**.

## Extra unblocked bugs this pass

1. **Mobile font menu** used a hardcoded six-name list instead of `FONT_FAMILIES` — contract test failed. Min-diff: import + `FONT_FAMILIES.map` in `MobilePdfViewerChrome.jsx`.
2. **P2-35(b) regression:** tool-change and More/presence/history/sync hard-hid sheets (`setTextDefaultsOpen(false)` / `setPresenceOpen(false)`). Restored `requestTextSheetClose` / `dismissUsersSheet`. `tests/mobileSheetCloseAnimation.test.mjs` **5 / 5**.
3. **P1-07 source contract** still id-based (`replaceTextInPageJson`) but the test still looked for `originalRef.current` inside the helper. Updated the test; product already correct.

High-risk files not edited. Invariants hold: `zoomGeneration` (`PDFViewer.jsx:3244`), SVG `viewBox={`0 0 ${width} ${height}`}` (`SVGAnnotationLayer.jsx:4666`), container-aware `containerW / width` (`PageAnnotationLayer.jsx:7751`), single-name `FONT_FAMILIES`, CORS `Access-Control-Allow-Origin: '*'`.

## Remaining 18 host-blocked (do not retry)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged: P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Goal

Stays **open**.
