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
| Repo | `github.com/kal-voe/survey` (remote notes move to `Kal-Voe/Survey`) |
| Branch | `cursor/cloud-agent-1787327676009-d4ori` |
| Arrival commit | `5c1bf665` (docs-only vs `main`) |
| Restore source | `995e07b9` (`origin/cursor/cloud-agent-1787324283091-rl3w7`) |
| This-pass restore commit | `f05e2f5a` then evidence follow-up |
| `main` | `9a5260c3` |
| Linked Cursor environment | none (`environment: null`; just-in-time pod) |
| Display / Electron | no Electron display |
| iOS Simulator | not available |
| Docker / local Supabase | not used |
| Personal auto-login | not written |
| `node_modules` on arrival | missing; `npm install` this pass (851 packages) |
| Vite this pass | `npm run dev:ui` → `http://localhost:5173/` HTTP 200 |

Blocked here (unchanged): iOS Simulator, Electron native chooser, personal auto-login writes, production SQL apply, live Turnstile / MSAL / Stripe / inbox / two-client lease.

## 2. What transferred vs missing (arrival)

Preserved-state claim: 96 unique IDs proven; unblocked E2E catalog done; 18 host leftovers; audit tree ~111 files; product fixes already landed on the worktree.

| Artifact | On arrival in `/workspace` | Verdict |
|---|---|---|
| `.planning/logic-audit-2026-08-20/` | **111 files** (REPORT, ISSUE-INVENTORY, known-bugs JSON, COMPLETION-AUDIT, E2E-*, fix-logs + artifacts) | **transferred** |
| Canonical 96 IDs in docs | KB-1, KB-2, P1-01…55, P2-01…39; 103 vs 96 is counting | **transferred** (docs) |
| 18 host leftovers listed | same 18 IDs in COMPLETION-AUDIT §7 | **transferred** (docs) |
| Product `src/` vs `main` | **empty** — `5c1bf665` added docs only (`111 files, +7236`) | **missing** |
| HubPreview / DevTestRoute `previewBlocked` | **absent** | **missing** |
| Dashboard `onSignOut` toast | **absent** | **missing** |
| ReSignInModal → `resetPassword` | **absent** (Phase-33 TODO stub) | **missing** |
| DocumentsLedger `insideRefs={[ref, trigger]}` | **absent** (`[ref]` only) | **missing** |
| Mobile `FONT_FAMILIES` / `requestClose` | **absent** | **missing** |
| P1-45 `bookmark:delete` history slice | **absent** | **missing** |
| Restored Node/Playwright contracts | **absent** | **missing** |
| Sibling `995e07b9` | present locally (214 product/test/debug/sql files) | restore source |
| Sibling `00fda232` | present (120 files; subset of `995e07b9`) | not needed after restore |
| `origin/claude/nifty-elion-773074` | `590ce571` = no product diffs | not a restore source |

Arrival vs preserved state: **audit evidence transferred; product fixes did not.** Checkout was docs-only on `main`.

## 3. Restore (already-landed diffs; no redesign)

Restored **214** files from `995e07b9` plus `package.json` extraFiles for `quitCoordinator.cjs` / `quitPolicy.cjs` (P2-11 packaging). Command:

`git checkout 995e07b9 -- src tests supabase/functions supabase/migrations debug/scenarios debug/playwright.reuse-5173.config.mjs scripts/e2e-unlisted-live.mjs package.json`

**Not restored:** `graphify-out/` AST cache; `.planning/` (later 111-file tree already here). **Not invented:** no new product rewrite.

Post-restore symbols (this disk):

| Fix | Proof on disk |
|---|---|
| HubPreview fail-closed | `src/home/HubPreview.jsx:25` `previewBlocked` |
| DevTestRoute fail-closed | `src/DevTestRoute.jsx:15` `previewBlocked` |
| Dashboard sign-out errors | `src/Dashboard.jsx:2395-2396` |
| ReSignInModal reset | `ReSignInModal.jsx` `planReSignInPasswordReset` + `resetPassword` |
| E2E-CATALOG-01 More-menu | `DocumentsLedger.jsx:52` `insideRefs={[ref, trigger]}` |
| Mobile fonts | `MobilePdfViewerChrome.jsx` import `FONT_FAMILIES` |
| P2-35(b) sheet close | `requestTextSheetClose` / `dismissUsersSheet` |
| P1-45 undo | `PDFViewer.jsx:12753` `'bookmark:delete'` |

Invariants re-grepped after restore (hold):

- `zoomGeneration` — `PDFViewer.jsx:3244` / `setZoomGeneration` `:1956` + `:1992`
- SVG `viewBox={`0 0 ${width} ${height}`}` — `SVGAnnotationLayer.jsx:4666`
- Container-aware `containerW / width` → `effectiveScale` — `PageAnnotationLayer.jsx:7747-7751`
- Single-name `FONT_FAMILIES` — `annotationStyleCatalog.js:34`
- CORS `Access-Control-Allow-Origin: '*'` — checkout / portal / send-email / excel-apply-changeset (not tightened)
- Zero `checkAndQuit` in `src/`

`graphify` CLI is **not installed** on this pod (`command -v graphify` empty). `graphify-out/graph.json` exists from the snapshot; AST update skipped.

## 4. What this pass continued

Only remaining unblocked work possible here: restore the landed product, then prove it **in this checkout**. Did not redo the full 130-ID live catalog. Did not invent substitutes for the 18 hosts.

### Node contracts (this checkout)

`node --test` on the focused restored suites: **130 pass / 2 fail**. The 2 fails are **this Node 22.14** loading `.ts` helpers (`ERR_UNKNOWN_FILE_EXTENSION` on `billingReturn.ts`) — official runner has no strip-types flag. Same two files with `--experimental-strip-types`: **39 / 39 pass**.

| Suite | Result |
|---|---|
| `tests/reSignInReset.test.mjs` | **3 / 3** |
| `tests/annotationStyleUiContract.test.mjs` | pass (desktop+mobile `FONT_FAMILIES`) |
| `tests/mobileSheetCloseAnimation.test.mjs` | pass (`requestClose` / not `setOpen(false)`) |
| `tests/bookmarkAtomicEdit.test.mjs` | pass |
| `tests/pdfViewerUndoOneLiners.test.mjs` | pass (includes P1-45) |
| `tests/hubDismissBarrierContracts.test.mjs` | pass (More-menu trigger) |
| `tests/annotationZOrder.test.mjs` | pass |
| `tests/annotationStyleCatalog.test.mjs` | pass |
| sheet motion close + touchcancel | pass |
| `tests/billing.test.mjs` + `tests/chromeE2EContracts.test.mjs` | **39 / 39** with `--experimental-strip-types` |
| extra restored cluster (sharing, last-owner SQL file, excel identity, legacy arrow, stale-id, W4-03, named restore, erase approval, CRDT scope, spaces map, YDoc overlap) | **61 / 61** |

Official `npm test` **completed this pass** (see §8). Isolated `partialEraserComplexity` budget left **75 / 250**. Do not treat a wall-clock or V8-allocation exit 1 on this host as an audit-ID reopen.

### Live Vite (this checkout; unblocked only)

`http://localhost:5173/` + Playwright Chromium (`debug/playwright.reuse-5173.config.mjs`). Did not invent captcha / OAuth / Stripe.

| Spec | Result |
|---|---|
| `e2e-a01-hubpreview-adversarial.spec.mjs` | **5 / 5** (11.0s) — intended + empty/garbage + double-submit + signup/guest/Google/SSO + Forgot password no silent success |
| `e2e-hubpreview-noop-hunt.spec.mjs` | **10 / 10** |
| `e2e-silent-stub-hunt.spec.mjs` | **10 / 10** (`?testPdf=` DevTestRoute fail-closed) |
| `e2e-p1-45-adversarial.spec.mjs` | **6 / 6** (18.6s) — dismiss no-op, undo/redo subtree, shape preserved, stack-bottom no-op, single delete, no 30-day trash row |

## 5. Leftovers unchanged (18 hosts)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers (in-tree, **not** applied): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## 6. Unblocked vs unproven **in this checkout**

On arrival: **all unblocked product proofs were unproven here** (code was `main`).

After restore + this-pass proofs:

| Surface | This checkout |
|---|---|
| Restored fail-closed (HubPreview / DevTestRoute) | **proven** live 5+10+10 |
| P1-45 undo | **proven** Node + live 6 / 6 |
| ReSignInModal reset planner | **proven** Node 3 / 3 |
| Mobile `FONT_FAMILIES` / `requestClose` | **proven** Node contracts |
| E2E-CATALOG-01 More-menu barrier | **proven** Node contract |
| Full 130-ID live catalog re-run | **not re-run** (prior receipts transferred; do not redo) |
| Capacitor P-01 / UL-46 | prior Simulator receipts transferred; **not re-run** (no Simulator) |
| Official full `npm test` | **exit 1** — only leftover is isolated `partialEraserComplexity` crossing500 **allocation** on this host (timing 75/250 held). See §8. |
| 18 host leftovers | **still unproven** (blocked; not retried) |

## 7. Goal

Stays **open**.

## 8. Official `npm test` (this checkout, 2026-08-21)

Command: `npm test` → `node scripts/run-node-tests.mjs`. Node v22.14.0. Did not loosen `INTERACTIVE_BUDGET` 75 / 250. Did not apply prod SQL. Did not retry the 18 host leftovers.

| Run | Exit | What happened |
|---|---|---|
| 1 (pre-fix) | **1** | First `.ts` importer (`tests/accountNativeE2EContracts.test.mjs`) — `ERR_UNKNOWN_FILE_EXTENSION` on `billingReturn.ts`. Host/runtime contract, not product. |
| 2 (strip-types only) | **1** | `tests/releaseIntegrity.test.mjs` "Node test gate isolates files and bounds hangs" still expected `['--test', file]`. |
| 3 (official after both min-diffs) | **1** | 439 files started (436 main + 3 isolated). **3906 tests / 3864 pass / 1 fail.** Runner stops on first fail, so isolated `svgPathTransformFidelity` was not reached. |

**Fail list (run 3, the official result):**

1. `tests/partialEraserComplexity.test.mjs` — `500 crossing cuts preserve every component inside bounded memory and release time`  
   `total allocation 11966.34 MiB exceeded 8448.00 MiB`  
   **Not** a 75 / 250 wall-clock miss. Geometry, component count (501), serialized-bytes, p95/max commit ms, and CPU asserts ran first and passed. Shallow500 (same file) passed.  
   Same class as the file's own note: crossing allocation is already bimodal on CI from V8 nursery sizing (6.4–7.3 GiB). This cloud VM is a higher mode. **Left the allocation ceiling and the 75 / 250 timing budget.** Do not treat as an audit-ID reopen.

**Reached isolated suites:** `annotationDocConcurrency` 103 / 103; `partialEraseCurveLocality` 15 / 15; `partialEraserComplexity` 9 / 10 (above).  
**Unreached isolated, run the same spawn after stop:** `svgPathTransformFidelity` 12 / 12.

**Min-diffs (not product / not high-risk files):**

- `scripts/run-node-tests.mjs` — spawn `['--experimental-strip-types', '--test', file]` so restored Deno/edge `_shared/*.ts` helpers load on Node 22.
- `tests/releaseIntegrity.test.mjs` — runner-contract regex matches that spawn.

Invariants not touched: container-aware canvas sizing, SVG viewBox zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.
