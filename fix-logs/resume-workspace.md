# Resume workspace — 2026-08-21 (cloud `/workspace`)

**Does not mark the audit goal complete.**  
**Did not retry the 18 host leftovers.**  
**Did not read `.bot-credentials.json` / `.env*`.**  
**Did not apply SQL to production Survey (`cvamwtpsuvxvjdnotbeg`).**  
**Did not loosen eraser `INTERACTIVE_BUDGET` 75 / 250.**

## 1. Environment facts

| Fact | Value |
|---|---|
| Workspace | `/workspace` (path changed from `…/Survey-BetaSafeS2/.claude/worktrees/nifty-elion-773074`) |
| OS | Linux 6.12.94+ (headless cloud VM) |
| Node | v22.14.0 / npm 10.9.7 |
| Repo | `github.com/kal-voe/survey` |
| Branch on arrival | `cursor/cloud-agent-1787327676009-d4ori` @ `5c1bf665` |
| `main` | `9a5260c3` (`origin/main`) |
| Linked Cursor environment | none (`environment: null`; just-in-time pod) |
| Display / Electron | no Electron display |
| iOS Simulator | not available |
| Docker / Colima / Podman | not used; no local Supabase |
| Personal auto-login | not written |
| `node_modules` on arrival | **missing** (install run this pass) |

Blocked in this environment (unchanged): iOS Simulator, Electron native chooser, personal auto-login writes, production SQL apply, live Turnstile / MSAL / Stripe / inbox / two-client lease.

## 2. What transferred vs missing (arrival)

Preserved-state claim: 96 unique IDs proven; unblocked E2E catalog done; 18 host leftovers; audit tree ~111 files; product fixes (HubPreview / DevTestRoute / Dashboard fail-closed, P1-45, ReSignInModal, DocumentsLedger `DismissBarrier`, mobile `FONT_FAMILIES` / `requestClose`) already landed on the worktree.

| Artifact | On arrival in `/workspace` | Verdict |
|---|---|---|
| `.planning/logic-audit-2026-08-20/` | **111 files** (REPORT, ISSUE-INVENTORY, known-bugs JSON, COMPLETION-AUDIT, E2E-*, fix-logs + artifacts) | **transferred** |
| Canonical 96 IDs in docs | KB-1, KB-2, P1-01…55, P2-01…39; 103 vs 96 counting | **transferred** (docs) |
| 18 host leftovers listed | same 18 IDs in COMPLETION-AUDIT §7 | **transferred** (docs) |
| Product `src/` vs `main` | **empty** — `5c1bf665` added docs only (`111 files, +7236`) | **missing** |
| HubPreview / DevTestRoute `previewBlocked` | **absent** (main stubs) | **missing** |
| Dashboard `onSignOut` toast | **absent** | **missing** |
| ReSignInModal → `resetPassword` | **absent** (Phase-33 TODO stub) | **missing** |
| DocumentsLedger `insideRefs={[ref, trigger]}` | **absent** (`[ref]` only) | **missing** |
| Mobile `FONT_FAMILIES` import | **absent** | **missing** |
| P1-45 `bookmark:delete` history slice | **absent** | **missing** |
| `tests/reSignInReset.test.mjs` / style + sheet contracts | **absent** | **missing** |
| Sibling product commit `995e07b9` | present locally (`origin/cursor/cloud-agent-1787324283091-rl3w7`) | usable restore source |
| Sibling earlier commit `00fda232` | present (`origin/cursor/cloud-agent-1787277229263-ufp5h`; 120 product files, subset) | not needed after `995e07b9` |
| `origin/claude/nifty-elion-773074` | `590ce571` = main tip at that branch; **no product diffs** | not a restore source |
| Host leftovers 18 | still host-blocked; not retried | **unchanged** |

Arrival vs preserved state: **audit evidence transferred; product fixes did not.** This checkout was docs-only on `main`.

## 3. Restore (already-landed diffs; no redesign)

Restored **214** product / test / debug / in-tree SQL files from `995e07b9` (`git checkout 995e07b9 -- src tests supabase/functions supabase/migrations debug/scenarios debug/playwright.reuse-5173.config.mjs scripts/e2e-unlisted-live.mjs`).

**Not restored:** `graphify-out/` AST cache; `.planning/` (this checkout already had the later 111-file tree including `completion-audit-current.md`).

Post-restore symbols (this disk):

| Fix | Proof on disk |
|---|---|
| HubPreview fail-closed | `src/home/HubPreview.jsx:25` `previewBlocked` |
| DevTestRoute fail-closed | `src/DevTestRoute.jsx:15` `previewBlocked` |
| Dashboard sign-out errors | `src/Dashboard.jsx:2395-2396` `onSignOut` → `signOut()` catch |
| ReSignInModal reset | `src/components/collab/ReSignInModal.jsx` `planReSignInPasswordReset` + `resetPassword` |
| E2E-CATALOG-01 More-menu | `src/home/DocumentsLedger.jsx:52` `insideRefs={[ref, trigger]}` |
| Mobile fonts | `src/mobile/MobilePdfViewerChrome.jsx` import `FONT_FAMILIES` |
| P2-35(b) sheet close | `requestTextSheetClose` / `dismissUsersSheet` |
| P1-45 undo | `src/PDFViewer.jsx:12753` `'bookmark:delete'` |

Invariants re-grepped after restore (hold):

- `zoomGeneration` — `PDFViewer.jsx:3244` / `setZoomGeneration` `:1956` + `:1992`
- SVG `viewBox={`0 0 ${width} ${height}`}` — `SVGAnnotationLayer.jsx:4666`
- Container-aware `containerW / width` → `effectiveScale` — `PageAnnotationLayer.jsx:7747-7751`
- Single-name `FONT_FAMILIES` — `annotationStyleCatalog.js:34`
- CORS `Access-Control-Allow-Origin: '*'` — checkout / portal / send-email / excel-apply-changeset (not tightened)
- Zero `checkAndQuit` in `src/`

## 4. What this pass continued

Unblocked work possible here is **prove the restored contracts in this checkout**, not re-run host E2E.

- Restored already-landed product + Node/Playwright specs from `995e07b9`.
- Did **not** invent a rewrite.
- Did **not** retry X-01, X-05 persist, X-06 writeback, U-04, A-01 Turnstile complete, A-02 live MSAL, A-03 inbox, A-05 Stripe click, A-06, UL-03 native pick, UL-13, UL-15, UL-16, UL-20, UL-21, UL-22, UL-24, UL-45.
- Did **not** apply the five in-tree migrations.
- Official `npm test` still expected to be able to exit 1 on `partialEraserComplexity` wall-clock noise; budget left 75 / 250.

Focused Node proofs (this checkout; see §6 when filled): pending at first write; filled after `npm install` + contract run.

## 5. Leftovers unchanged (18 hosts)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers (in-tree, not applied): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## 6. Unblocked vs unproven **in this checkout**

On arrival: **all unblocked product proofs were unproven here** (code was `main`). After restore, symbols match the worktree. Node contract results:

| Suite | Result |
|---|---|
| `tests/reSignInReset.test.mjs` | *pending — filled after install* |
| `tests/annotationStyleUiContract.test.mjs` | *pending* |
| `tests/mobileSheetCloseAnimation.test.mjs` | *pending* |
| `tests/bookmarkAtomicEdit.test.mjs` | *pending* |
| `tests/pdfViewerUndoOneLiners.test.mjs` | *pending* |
| `tests/hubDismissBarrierContracts.test.mjs` | *pending* |
| `tests/annotationZOrder.test.mjs` | *pending* |
| `tests/chromeE2EContracts.test.mjs` | *pending* |

Live Vite / Playwright / Capacitor / Electron native paths from the prior catalog are **not re-run** in this VM (no display / no Simulator / no personal auto-login). Those remain proven on the prior receipts (`e2e-capacitor-ul46.md`, `e2e-local-hosts.md`, etc.), now present in `.planning/`.

## 7. Goal

Stays **open**.
