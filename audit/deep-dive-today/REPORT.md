# Survey BetaSafeS2 — Deep-Dive Architecture & Risk Report

_As of 2026-05-28. Synthesized from four specialist audits (security, App.jsx anatomy, structure, cruft, deps/build) and their independent verifications. Findings whose verification did not hold have been dropped or downgraded; line-range and reachability corrections have been applied._

---

## Plain-English summary

**What this is.** Survey BetaSafeS2 is a desktop PDF annotation app for survey/inspection work. It is an Electron app (a web app wrapped to run on Mac/Windows, with iOS/Android variants) built in React, using Syncfusion to render PDFs and Fabric.js to draw on them. It talks to Supabase (login, database, file storage), Stripe (billing), and Microsoft 365 / OneDrive (the two-way Excel sync feature). The cloud and payment plumbing is, encouragingly, set up correctly.

**The single biggest structural problem.** Almost the entire app's user interface lives in **one file: `src/App.jsx`, which is 49,558 lines long.** Inside that file, one component — the PDF viewer — is roughly 36,500 lines and holds about 200 pieces of state, 224 references, 187 effects, and 316 callbacks in a single function. Six unrelated features (zoom, callouts, cloud sync, real-time collaboration, the Survey Marker + Excel sync, and the giant on-screen layout) all share data simply by living in that one function's scope. There are **zero** internal "boundaries" (React context providers) splitting it up.

The practical consequence: **two engineers — or two AI agents — cannot safely work at the same time.** Even if one is fixing the survey panel and the other is fixing zoom, they are both editing the same 36,500-line function and the same shared variables, so their changes collide on merge. Worse, there is **no automated safety net** — no linter, no type checker, and the test command silently skips 13 of the test files (including the highest-risk collaboration code), so a broken edit can land looking "green."

**The headline recommendation.** Do the work in two tracks. **Track 1 (this week, low risk): hygiene + guardrails** — reclaim ~13 GB of disk from dead git worktrees, revoke the leaked GitHub token, fix the test command so it stops lying, and add a basic lint + CI check. **Track 2 (multi-week, careful): carve `App.jsx` apart in a strict order**, starting with the genuinely safe, self-contained pieces (the dashboard/home screen, thumbnails) and stopping well short of the zoom engine, which the verification work proved is *not* a clean seam and should be left mostly intact for now. After Track 2's early steps, 3–4 agents can work in parallel on separate files instead of one giant one.

---

## Top risks (ranked)

| # | Risk | Severity | One-line fix |
|---|------|----------|--------------|
| 1 | **Live GitHub write-token shipped in every build**, targeting a **public** repo (`IsaiahCalvo/Survey`). Verified: the actual token is inlined byte-for-byte in `dist/assets/index-*.js`. | **Critical** | Revoke the token now; move "Save Log" uploads server-side; drop `VITE_GITHUB_LOG_TOKEN` from `release.yml`. |
| 2 | **Electron 25 is end-of-life** with ~18 known CVEs and ships an old Chromium; main window also omits `sandbox:true`. | **High** | Plan a scoped upgrade to a supported Electron major; add `sandbox:true`; re-run zoom/print/OAuth smoke tests. |
| 3 | **Preload bridge gives the web layer unrestricted read/write to any file path** (`fs:readFile`/`writeFile`/`appendFile`/`listDir`, etc., all unguarded except `fs:clearDir`). | **High** | Allowlist file operations to app-data + user-chosen dirs; reject absolute/traversal paths. _(Note: the renderer gets read/write, not arbitrary delete — only `fs:clearDir`, which is guarded, can delete.)_ |
| 4 | **`shell:openExternal` accepts unvalidated URLs; macOS `shell:openPath` builds a shell `open` command** — command injection via `$(...)`/backticks was reproduced; `setWindowOpenHandler` uses loose substring matching. | **High** | Validate URLs with `new URL()` + https allowlist; use `shell.openPath` (no shell) instead of `exec('open ...')`; exact-hostname allowlist. |
| 5 | **No Content-Security-Policy** anywhere; page also loads remote Google fonts. This is the multiplier that turns any script injection into host compromise via #3/#4. | **High** | Inject a strict CSP via `session.defaultSession.webRequest.onHeadersReceived`; self-host the font. |
| 6 | **Vulnerable parsers on untrusted input** — `pdfjs-dist` 3.11.174 (arbitrary JS on malicious PDF) is the genuinely reachable high-severity exposure; `fabric` 5.5.2 (SVG-export XSS). | **High** | Upgrade `pdfjs-dist` and `fabric`; treat parsed PDFs as untrusted. |
| 7 | **`npm test` silently skips 13 co-located test files** (CRDT collab, dual-write queue, cloud sync) — every run gets a false green. | **High** | Widen the glob: `node --test 'tests/**/*.test.mjs' 'src/**/__tests__/*.test.mjs'`, then re-baseline. |
| 8 | **No ESLint / Prettier / typecheck and no CI build/test gate** — nothing catches a bad edit before it lands on main. | **High** | Add ESLint flat config (warnings first) + a `ci.yml` running `npm ci && npm run build && npm test`. |
| 9 | **`App.jsx` is 49,558 lines** and forces agent collisions (see dedicated section). | **High (structural)** | Ordered decomposition, lowest-risk first; do **not** touch the zoom engine yet. |
| 10 | **OAuth callback hash injected via `executeJavaScript` string interpolation** (only double-quotes escaped). | **Medium** | Use `loadFile(path, { hash })` or a typed IPC message instead of string injection. |
| 11 | **MS Graph OAuth tokens were committed in `1.log` history** (now gitignored, tokens expired). | **Medium** | Confirm revoked; keep `*.log` ignored; add a secret scan once CI exists. |
| 12 | **~13.4 GB of disk** wasted in stale git worktrees (see Quick wins). | **Medium (hygiene)** | Remove merged/stale worktrees and duplicated `node_modules`. |
| 13 | **Dead/duplicate `src/components/PageAnnotationLayer.jsx` stub** mislabeled in CLAUDE.md's high-risk list — an agent told to edit "the protected file" by that path opens the wrong, dead file. | **Medium** | Delete the stub + orphaned `PDFPageItem.jsx`; fix CLAUDE.md to point at `src/PageAnnotationLayer.jsx`. |

**Resolved by verification (downgraded/dropped):**
- The security finding that **xlsx/xlsx-js-style prototype-pollution is reachable from attacker `.xlsx` files** was **not upheld**: `XLSX.` is never called in `src/` (confirmed — 0 calls in App.jsx). The import is dead. The real `.xlsx` parsing runs through ExcelJS, which `npm audit` does not rate high. The genuine untrusted-parse risk is `pdfjs-dist` (risk #6). The fix becomes *delete the dead import*, not "migrate to a CDN build."
- All "verified safe" items (no secrets in git history, Supabase anon-key-only, RLS enabled and hardened, Stripe webhook signature verification, correct base Electron flags) hold — keep as the security baseline.

---

## The App.jsx problem & the decomposition plan

### Why it's coupled

`App.jsx` (49,558 lines) is really three things stacked in one file:

1. A **Dashboard** (home screen: projects, documents, templates, entities) — lines ~3257–10086.
2. A **PDFViewer** god-component — lines ~10384–46904, about **36,500 lines** — holding ~201 `useState`, ~224 `useRef`, ~187 `useEffect`, ~316 `useCallback` in a single closure.
3. A thin **App shell** (tabs, routing, chrome portal hosts) — lines ~46904–49558.

The PDFViewer mixes six unrelated concerns: the Syncfusion zoom/overlay lifecycle, callouts, annotation cloud sync, Yjs collaboration/presence, Survey Marker + Excel two-way sync, and a ~11,000-line JSX render tree at the bottom that reads *everyone's* variables. There are **no context providers and no `useReducer`** in the file: every cross-feature dependency is satisfied by sharing the same local scope. The render tree reading every feature's state is exactly why the file "can't be split by feature without first extracting the truly-shared spine."

The good news (from the structure audit): **coupling *out* of `App.jsx` is healthy.** Only 2 files import from it; 18 components consume the 5 existing React contexts instead of prop-drilling; business logic lives in `services/` and `lib/collab/`. So the blast radius is mostly *internal* to the file — which is what makes a careful, ordered extraction feasible.

### The four correctness invariants that must survive every extraction

Per CLAUDE.md, these are non-negotiable and bind regardless of any file move:
1. **Container-aware canvas sizing** — measure `containerEl.offsetWidth / pageSize.width`, never `pageSize * scale`.
2. **The `zoomGeneration` signal** must keep firing at zoom-start inside `beginSyncfusionScaleConfirmPending` and stay referentially stable for the Fabric canvases that watch it.
3. **SVG viewBox owns all zoom scaling** — never reintroduce JavaScript zoom coordination in `SVGAnnotationLayer.jsx`.
4. **Single-name `fontFamily`** for Fabric Textbox/IText (never a CSS fallback stack).

### The ordered extraction sequence (lowest risk first)

> **Important corrections applied from verification.** The original proposal's line ranges and some risk ratings were materially wrong. The verified-safe steps are kept and re-scoped; the high-risk context-provider steps were proven **not** to be clean seams and are explicitly re-characterized as "do not attempt as scoped."

**Step 1 — `src/components/PDFThumbnail.jsx`** (risk: **low**, unblocks parallel: yes)
- **Moves:** `PDFThumbnail` (App.jsx 3062–3256) **plus** its private `thumbnailQueue` concurrency limiter (3017–3059, which the original proposal omitted).
- **Invariants:** none touched (off-DOM thumbnail raster at fixed `scale:0.3`).
- **Watch-out:** `isStorageFileNotFoundError` is **shared** with Dashboard's error handler — import it from a shared util, do **not** move it. `GlobalWorkerOptions.workerSrc` is set at App.jsx:508 and must run first (it does).
- **Why it unblocks:** thumbnail/caching work stops requiring anyone to open `App.jsx`.

**Step 2 — `src/components/dashboard/SortableRows.jsx`** (risk: **low**, unblocks parallel: yes)
- **Moves:** the five dnd-kit row/overlay components **only — App.jsx 1946–2354** (~408 lines), NOT the 1946–3061 range the proposal gave. Lines 2356–3061 are color utils, the **data-persistence layer**, item/annotation helpers, and `thumbnailQueue` — they do **not** belong here and have unrelated consumers. The "~1.1k lines shed" figure was inflated by ~700 misattributed lines.
- **Invariants:** none (pure props/dnd-kit; the `FONT_FAMILY` here is applied to plain HTML `<input>`s, not Fabric).
- **Watch-out:** import `getHexFromEntityColor`/`getOpacityFromEntityColor`/`FONT_FAMILY` (used elsewhere too) — do **not** duplicate them.

**Step 3 — `src/utils/appDebugBridges.js`** (risk: **low**, unblocks parallel: minor)
- **Moves:** module-scope debug-dump builders (~228–330). Pure functions reading window globals.
- **Invariants:** none. Declutters the top-of-file import/constant region everyone edits.

**Step 4 — `src/components/Dashboard/Dashboard.jsx`** (risk: **medium**, unblocks parallel: **yes — biggest decoupling**)
- **Moves:** the entire `Dashboard` forwardRef (3257–10057). Dashboard and PDFViewer are two different screens sharing only `documents`/`templates`/`entities` via props; Dashboard never imports or renders PDFViewer.
- **Invariants:** **none** of the four (all are viewer-side). The `viewBox`/`fontFamily` hits inside Dashboard are decorative SVG icons and the CSS UI font stack — not the governed cases.
- **Contract:** 9 props + a **4-method `useImperativeHandle`** (`dashboardRef`). App calls 3 of the 4.
- **Real risk source (corrected):** NOT "volume of props/hooks threaded" — those (`useProjects`/`useDocuments`/etc.) are hook calls *inside* Dashboard, reachable via the same imports. The real work is **partitioning ~26 module-scope helpers**: import the shared ones (`hexToRgba`, `hasNameConflict`, `getHexFromColor`, `getOpacityFromEntityColor`, `normalizeName`, `isStorageFileNotFoundError`, the modal-hover handlers) from a shared module rather than duplicating; co-move the Dashboard-exclusive ones. **No test coverage on Dashboard — verify at runtime.**
- **Why it unblocks:** home-screen agents and viewer agents stop sharing a file. This is the single biggest no-invariant decoupling available.

**Step 5 — DELETE `BottomToolbar` (App.jsx 10087–10381)** — *not* an extraction (risk: **trivial**)
- Verification proved this component is **dead code**: `grep '<BottomToolbar'` returns nothing. The live bottom toolbar was lifted into the chrome-right rail and re-implemented as the `bottomToolbarApi` block (~47826+, with Forms/richTextEditor/zoom features this stale copy lacks). The correct action is **delete**, not move. Extracting it would falsely imply the live toolbar lives there.

**Steps 6+ — feature hooks and context providers: DEFER, re-scope, or do not attempt as proposed**

The verification work is unambiguous here, and this is the most important guidance in the report:

- **`ZoomScaleContext` — DO NOT extract as scoped.** It is not a separable spine. The named state (`scale`/`zoomMode`/`manualZoomScale` + `zoomGeneration` + `beginSyncfusionScaleConfirmPending`) is fused to the entire Syncfusion zoom interaction lifecycle: the `syncfusionZoomChange` handler, `finalizeSyncfusionInteractionIdle`, the deferred-commit path, the overlay-transform RAF loop, the proxy/freeze/snapshot machinery, **and** `setZoomGeneration` is also fired from the annotation-overlay watchdog (line 19829), not just at zoom-start. Real risk: **very high / borderline do-not-touch**, directly on invariants #1, #2, #3. If ever attempted, first extract the whole zoom engine into a single `useSyncfusionZoom()` hook *still called inside PDFViewer* (same closure, refs preserved), prove `npm test` + Fabric auto-commit, and only then expose read-only values via a memoized, split context.

- **`ActiveDocumentContext` — DO NOT re-wrap Yjs.** `useYDoc` already reads a context from `YDocProvider`; re-providing it is redundant layering that can only *break* the `trackedOrigins`/`undoCtx` identity invariant it claims to protect. `pdfDoc`/`numPages`/`pageNum`/`pageSizes` are read at 500+ in-component sites and written from the Syncfusion load loop and the monolithic PDF-change reset effect; a context yields no decoupling while forcing a massive in-place rewrite. Honest first step (if any): a non-context `useActiveDocumentState()` hook PDFViewer destructures.

- **`useSurveyMarkerExcelSync` — NOT a clean seam.** The state is scattered across 14103–14145, 16836–17172, 17490–17491, 19752+, the 20000–30800 handlers, **and** a second large cluster at 32991–38950 (~60% of marker logic lives *outside* the proposed window). It **does** touch invariants #1 and #3 on the marker click-to-place coordinate path (32418–32515, reads SVG viewBox + `offsetWidth`) and renders via `SVGAnnotationLayer`. The only defensibly clean sub-seam is the **pure Excel-workbook lifecycle** (session create/refresh/close + fingerprint compute), extracted as a hook taking `graphClient`/`selectedTemplate`/`surveyMarkers` as inputs. Leave marker state, placement math, and the render path in PDFViewer.

- **`useCalloutClipboard` — re-scope and split.** The proposal mislabeled `pasteAnnotationAt` (line 32422) as a callout function — it is generic-annotation clipboard logic over `annotationsByPageRef` and reads SVG viewBox geometry; it does **not** belong in a callout module. The blank-commit policy is **already** extracted to `src/utils/calloutBlankCommit.js` (nothing to move), and invariant #4 is already enforced inside `calloutEditAdapter.js` via `sanitizeFontFamily`. The only coherent unit is `handleCut/Copy/PasteCallout` + the clipboard state pair — but `callouts` state is the spine of collab/history/survey/page-load (30+ writes), so any hook must take the setters as parameters and App.jsx must retain ownership. Real risk: **high**, mostly a pass-through; low value as a first move.

---

## Quick wins

Safe, high-value cleanups doable now with low risk. Several are READ-ONLY recommendations (the cruft agent did not execute destructive ops) — exact commands are provided.

### 1. Reclaim ~13 GB from stale git worktrees (biggest single win)
All 26 "locked" worktrees are held by a **dead process (pid 7087)** — the locks are stale. 16 point at already-merged `kal-*` branches (~7.7 GB). 15 worktrees each carry a full ~1.6 GB `node_modules` (~11.8 GB total; confirmed 15 dirs on disk).

```bash
# Review first:
git -C /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2 worktree list
find /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/.claude/worktrees \
  -maxdepth 2 -name node_modules -type d -print

# Remove the 16 MERGED kal-* worktrees + worktree-agent-* throwaways (--force needed for stale lock):
git -C /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2 \
  worktree remove --force .claude/worktrees/agent-XXXX   # repeat per merged worktree

# Prune 4 broken-pointer entries (safe — working trees already gone):
git -C /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2 worktree prune -v

# Then delete merged local branches:
git -C /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2 branch -d kal-21 kal-33 kal-34 ...
```
**LEAVE the 5 UNMERGED worktrees** (kal-15, kal-20, kal-23, kal-40, kal-53) — they may hold unpushed work. Reclaimable now: **~7.7 GB** from merged worktrees, more if you also delete duplicated `node_modules` in kept worktrees.

### 2. Revoke the leaked GitHub token (security, do this first)
Revoke/rotate `VITE_GITHUB_LOG_TOKEN` in GitHub settings now; it is recoverable from every shipped build. Then remove it from the renderer and `release.yml:53`, and audit the public `IsaiahCalvo/Survey` repo's `logs` branch for anything sensitive already pushed.

### 3. Fix the lying test command
Change `package.json` test script to also run co-located tests:
```json
"test": "node --test 'tests/**/*.test.mjs' 'src/**/__tests__/*.test.mjs'"
```
Then re-baseline the pass count (13 currently-uncounted files cover CRDT collab, dual-write queue, cloud sync).

### 4. Remove verified-unused dependencies (one-line `package.json` edits each)
Verified by the deps agent as having **zero imports** in `src/`:
- `xlsx` (bare SheetJS) — 0 imports; carries a high-severity advisory with no fix.
- `@syncfusion/ej2-angular-base`, `@syncfusion/ej2-angular-pdfviewer`, `@syncfusion/ej2-vue-base`, `@syncfusion/ej2-vue-pdfviewer` — Angular/Vue wrappers in a React app, 0 imports (confirmed).
- Also remove the **dead `xlsx-js-style` import on App.jsx:7** — `XLSX.` is called 0 times (confirmed); this single deletion eliminates the SheetJS prototype-pollution/ReDoS surface entirely.

Keep `exceljs` and the live `xlsx-js-style` package only if still referenced after the import removal; run a full build + `npm test` after each batch.

### 5. gitignore additions + untrack committed logs
```bash
# Add to .gitignore:
.cursor/
audit/**/logs/
audit/**/*.log
# Untrack committed run artifacts (contain Supabase URL + anon key):
git rm -r --cached audit/kal-54/logs audit/kal-54/screenshots
git rm --cached 1.log   # if still tracked anywhere
```
Then `git gc --prune=now` to clear 7 `tmp_obj_*` garbage files. **Do NOT rewrite history while worktrees exist** — defer any `git filter-repo` to a coordinated one-time op after all stale worktrees are gone.

### 6. Delete dead files + fix the CLAUDE.md safety hazard
- Delete `src/components/PageAnnotationLayer.jsx` (41-line stub) and orphaned `src/components/PDFPageItem.jsx` (0 importers).
- **Fix CLAUDE.md's high-risk list** to point at `src/PageAnnotationLayer.jsx` (the real 10k-line file), not the dead stub — currently an agent following the protection list opens the wrong file.
- Delete the dead `BottomToolbar` (App.jsx 10087–10381).
- Repoint or delete the backup scripts hardcoding the non-existent `/Users/isaiahcalvo/Desktop/Survey` (they silently no-op and would auto-push WIP if the path were ever fixed).
- Rename `src/pdf.worker.js.js` (double extension).
- Fix README's "Electron 38" → Electron 25.

---

## Parallel-agent readiness

**Today: effectively 1 agent at a time inside the viewer.** `App.jsx` is the "barrier file" — the PDFViewer god-component and its 36,500-line body mean any two viewer-feature edits collide, and there is no lint/CI to catch a bad cross-edit before it lands on main.

**After Track 1 (hygiene + guardrails) — same day:**
- The lint + CI gate turns "agent broke main" from a manual discovery into an automatic red X. This is the highest-leverage single change for safe parallel work, even before any decomposition.
- The test-glob fix removes the false-green that hides collab/sync breakage.

**After decomposition Steps 1–4 — realistically 3 agents in parallel on independent files:**
1. **Dashboard agent** — `src/components/Dashboard/Dashboard.jsx` (home screen, fully decoupled from the viewer).
2. **Thumbnail/caching agent** — `src/components/PDFThumbnail.jsx`.
3. **Viewer agent** — still owns the remaining `App.jsx` PDFViewer body, but no longer collides with dashboard or thumbnail work.

The dnd-rows and debug-bridge extractions add two more genuinely independent files for dashboard-DnD and tooling work, so a 4th agent on those is safe.

**The remaining barrier:** the PDFViewer body is still one file. The verifications proved the zoom engine, document-identity state, survey/excel domain, and callout state are **not** cleanly separable yet — they are the densest, most ref-entangled region. So **do not promise N-way parallelism inside the viewer.** The honest path to more parallelism there is the *intermediate* step: extract the zoom engine and the Excel-workbook lifecycle into **in-closure custom hooks first** (same module, refs preserved, `npm test` + Fabric auto-commit verified), and only consider contexts after the consuming features are themselves moved into child components. Until that happens, treat the viewer as a single-owner file.

**Net:** realistically **3–4 parallel agents** after Steps 1–4, with the viewer remaining a single-agent zone until the zoom/document spine is safely hooked-ified in a later, dedicated effort.

---

## Build & test baseline

From the deps/build agent (current state):
- **Build:** `vite build` succeeds, exit 0, ~29s.
- **Tests:** `node --test` reports **758 pass / 4 fail / 6 skipped / 768 total** — **but** this excludes the 13 co-located `src/**/__tests__` files (the test-glob bug). Re-baseline after fixing the glob.
- **The 4 failing tests:**
  - `tests/annotationInitialHydrationSource.test.mjs` — asserts string patterns against `App.jsx` source; **likely caused by the current uncommitted App.jsx edit** (`git diff`: ~65 insertions / 32 deletions). Re-run against a clean HEAD (`git stash`) to confirm.
  - `tests/eraserSaveHistorySyncContracts.test.mjs` — "expected pointer deferral before pushing" (behavioral contract).
  - `tests/performance/overlayPresentationGate.test.mjs` — wheel-zoom exponent 0.0044 vs asserted <=0.004 (decide: intended -> update bound, or regression -> fix source).
  - `tests/phase31/legacyBulkUpsertGate.test.mjs` — "callout Supabase upsert start log must exist" (log-contract).
  - Triage these before declaring the suite green.
- **Bundle:** production JS is **15.3 MB (~5 MB gzipped), not code-split** — Vite warns about >500 kB chunks. Three modules (`pdf-lib`, `exceljs`, `debugBridge.js`) are both statically and dynamically imported, defeating the intended split. Fix by picking one import style per heavy module and adding `manualChunks` for Syncfusion/fabric/pdfjs/yjs.
- **`npm audit`:** 36 vulns (5 critical, 13 high). Criticals are transitive in the deprecated `request -> jimp -> to-ico` icon-build chain. The genuinely reachable high is `pdfjs-dist`. `npm audit fix` covers the non-breaking subset (ws, brace-expansion). Leave breaking fixes (Electron, exceljs downgrade) for scoped upgrades.
- **No secrets ever committed** to git history — verified clean (the only hardcoded JWT is the public Supabase anon key, by design).

---

## Appendix: full findings by area

### A. Security (verdicts applied)

- **A1 — Critical: GitHub write-token in shipped bundle.** `SaveLogBanner.jsx:112,167` reads `VITE_GITHUB_LOG_TOKEN`; used on desktop (`preload.js:87` -> `electron-main.js:1135`) and browser (direct PUT to `api.github.com/repos/IsaiahCalvo/Survey/contents/`). `release.yml:53` injects it into the build; Vite inlines it as plaintext. **Verified:** the live token appears byte-for-byte in `dist/assets/index-BmO7OAVW.js`, and `IsaiahCalvo/Survey` is PUBLIC. Minor nuance: the leaked credential is a `gho_`-prefixed token (OAuth/installation-style), not a classic `ghp_` PAT — severity unchanged. Fix: revoke; move uploads server-side (Supabase Edge Function or Storage under RLS); drop the `release.yml` line + fetch fallback; audit the public repo's `logs` branch.
- **A2 — High: unrestricted filesystem bridge.** `preload.js` forwards raw `path` to unguarded `fs:*` handlers (`electron-main.js:657–783`). **Verified:** read/write/append/list are open; only `fs:clearDir` is guarded (requires `'TestLogs'`). **Correction applied:** the title's "delete" is overstated — no exposed method does arbitrary `unlink`/`rm`; the risk is arbitrary read/write (incl. overwrite/clobber). Fix: allowlist safe roots, canonicalize with `path.resolve`, prefer the existing `dialog:openFile`/`dialog:saveFile` flow.
- **A3 — High: `openExternal`/`openPath` injection.** **Verified by empirical test:** the macOS `exec('open "...")` escaping does NOT neutralize `$(...)`/backticks — a `$(touch /tmp/...)` payload executed. `setWindowOpenHandler` allows `evil.com/google` via substring match. Fix: `new URL()` + https/host allowlist; `shell.openPath` (no shell); exact-hostname matching.
- **A4 — High: no CSP.** **Verified:** no meta tag in `index.html`, no `onHeadersReceived` in `electron-main.js`; remote fonts loaded. Defense-in-depth gap that multiplies A2/A3. Fix: strict CSP via `onHeadersReceived`; self-host font. Validate `connect-src` origins against real usage before shipping to avoid breakage.
- **A5 — High: Electron 25 EOL.** **Verified:** `package.json` pins `^25.2.1` (installed 25.9.8); `npm audit` flags HIGH with fix at 42.3.0; main window omits `sandbox:true` while helper print windows set it. Fix: scoped major upgrade + `sandbox:true`; re-verify zoom/canvas invariants + PDF/print/OAuth.
- **A6 — High: vulnerable parsers.** **Verified with correction:** `pdfjs-dist` 3.11.174 is the genuinely reachable HIGH (untrusted PDF parsing). `fabric` 5.5.2 HIGH (SVG-export XSS). The **xlsx prototype-pollution path is NOT reachable** — `XLSX.` is never called; the import is dead. Fix: delete the dead `xlsx-js-style` import, upgrade `pdfjs-dist` + `fabric`, drop the deprecated `request`/`jimp` chain.
- **A7 — Medium: OAuth hash injection** via `executeJavaScript` string interpolation with only double-quote escaping (`electron-main.js:262–281`). Fix: `loadFile(path, { hash })` or typed IPC; or `JSON.stringify(hash)`.
- **A8 — Info / verified safe baseline:** no secrets in history; Supabase anon-key-only renderer; RLS enabled across 14 migrations and hardened (`20260211224047_fix_permissive_rls_policies.sql`); Stripe webhook signature-verified; base Electron flags correct (`contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`); no `dangerouslySetInnerHTML`/`eval`/`new Function`; MSAL clientId + Stripe publishable key are public identifiers. **No action; retain as baseline.**

### B. App.jsx anatomy
49,558 lines; 277 `useState` / 215 `useEffect` / 237 `useRef` / 339 `useCallback` total across the file; **0 context providers, 0 `useReducer`**, 9 inline components. The collision driver is the PDFViewer closure (~10384–46904, ~36.5k lines) mixing six concerns plus an ~11k-line JSX render tree that reads all of them. See "The App.jsx problem & the decomposition plan" for the corrected, ordered extraction sequence.

### C. Structure
Module layout (`components/hooks/services/contexts/utils/lib/...`) is coherent; imports are clean (max 2 levels deep). Real problems are guardrails/hygiene: no lint/format/typecheck; the `npm test` glob skips 13 co-located tests; CI has no build/test/lint gate (only license, log-triage, release workflows); dead `PageAnnotationLayer` stub + orphaned `PDFPageItem` shadow the real files and mislead CLAUDE.md's protection list; loose core components in `src/` root; stale README/HANDOFF docs; committed OAuth tokens in `1.log` history (expired); 63 tracked `audit/` files including logs. Encouraging: only 2 files import from `App.jsx` — blast radius is mostly internal.

### D. Cruft
~13.5 GB reclaimable, almost all from worktree sprawl: 31 worktrees under `.claude/worktrees/` (13.4 GB), 15 with duplicated `node_modules` (~11.8 GB; confirmed). All 26 "locked" worktrees held by dead pid 7087 (stale locks); 16 point at merged branches (~7.7 GB). 4 prunable broken-pointer entries. `.git` is healthy at 272 MB (159 MB pack carries historical `.cursor/debug.log` 16 MB dumps + a `pdf-counter-playground` npm-cache, both now untracked). **Not dead code:** the same-name `PageAnnotationLayer.jsx`/`TextLayer.jsx` pairs are distinct live components (the cruft "duplicate" heuristic tripped on same names in different dirs) — leave alone. `.env` never committed.

### E. Deps / build
Builds clean (29s). 758/768 tests pass (excludes 13 co-located files). Bundle 15.3 MB un-split; 3 modules dual-imported. `xlsx` + 4 Angular/Vue Syncfusion packages unused (verified). Backup scripts point at a non-existent dir (silent no-op + would auto-push WIP). Electron 25 EOL is the top version risk. `npm audit`: 36 vulns; reachable HIGH is `pdfjs-dist`. No secrets in history. Add ESLint + CI; consolidate spreadsheet libs on `exceljs`.

---

_End of report. The two-track plan — hygiene/guardrails now, careful ordered App.jsx decomposition next — is the safest route to a parallel-agent-ready codebase without regressing the four load-bearing zoom/canvas invariants._
