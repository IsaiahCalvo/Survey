# ☀️ MORNING UPDATE — Right-rail redesign overnight build (2026-05-29)

**Branch:** `feature/right-rail-redesign` (branched off `codex/annotation-overlay-architecture-2026-05-28`). Nothing pushed — yours to test, then approve.
**Build:** `npm run build` ✓ (~20s). **Tests:** 830 pass / 4 fail / 6 skip — identical to baseline (the 4 failures pre-exist).
**Quick UI check (no auth):** `npm run dev:ui`, then open `http://localhost:<port>/?testPdf=text-search-glyph-lab.pdf`. A test PDF was copied to `public/debug-fixtures/` (gitignored). Templates need the cloud backend, so use your normal dev server (`npm run dev`) to test the Survey panel.

## ✅ Slice 1 — page/zoom/fit moved to a top-right pill (commit `5383e009`) — VERIFIED LIVE
The page, zoom, and fit controls left the old 48px right strip and now sit in a compact horizontal pill in the **top-right corner**, copying Walkthrough's expanded zoom-controls layout: `− 71% +`  ·  `‹ 1 · 3 ›`  ·  single **Fit** button with a downward dropdown. All controls reuse the same published `bottomToolbarApi`, so the zoom invariants (zoomGeneration, container-aware sizing, Syncfusion scale pipeline) are untouched. Verified in the dev route — see `prototypes/inapp-slice1.png`.

## 🟡 Slice 2 — Survey/Spaces tabs in the right rail (commit `2df81932`) — BUILD + REVIEW VERIFIED, NEEDS YOUR DEV-SERVER CHECK
Could not runtime-verify: the survey panel only renders with a cloud-backed template, which the dev test route cannot create (no Supabase). What it does:
- Adds a **Survey | Spaces** tab bar to the existing survey panel, matching the left rail's expanded tab height exactly (active = accent icon + brighter label, no chunky underline — height parity preserved with a reserved transparent border).
- **Spaces tab** renders the same `SpacesPanel` the left rail uses, wired to the handlers the viewer already publishes.
- **Collapsed strip** is now icons-only (Survey + Spaces) with hover tooltips anchored to the left; clicking an icon expands straight to that tab.
- Default tab is **Survey**, so your existing survey flow is unchanged (the tab bar is just added above it). The rail now sits flush to the screen edge.
- **Please verify:** open Survey (with a template) → tab bar shows; switch to **Spaces** → list/create works; collapse → icons + tooltips.

## ⏭️ Deliberately deferred (safe, not done blind)
- Rail is still **gated on survey being active**. Making it **persistent** (collapsed strip always visible, Spaces reachable without survey) needs the visibility model decoupled + null-guards for the no-template case — left for a verified pass.
- **Spaces still also lives in the left rail** (not removed). Remove it from the left once the right rail is persistent.

## ↩️ Rollback
- Slice 2 only (keep the verified pill): `git reset --hard 5383e009`
- Everything: `git reset --hard a68468a7`

## Files
- `src/App.jsx` only (top-bar pill; chrome-right-host → 0 width; survey panel → tabbed rail; `SpacesPanel` import). `.gitignore` (dev fixture + playwright artifacts).
- Interactive design mockup the build matches: `prototypes/right-rail-mockup.html`.

---

# Handoff: Pro-grade cleanup, lost-work recovery, and the App.jsx breakup

**Generated**: 2026-05-28
**Branch**: `codex/annotation-overlay-architecture-2026-05-28` (NOT pushed; all work is local)
**Status**: Recovery phase complete & verified. Next major work = the App.jsx breakup. Two visible items intentionally deferred.

## Goal

Make this Electron + React PDF-annotation app professional and **parallel-agent-ready** — the core blocker is `src/App.jsx` (~49.5k lines, ~31% of the codebase), which forces every agent to collide in one file. Secondary goal this session: recover feature work that lived on unmerged branches and was missing from the running app.

## Completed (this session, all on the current branch, verified `npm run build` + `npm test` green)

- [x] **Deep-dive audit** of security, structure, cruft, deps → `audit/deep-dive-today/REPORT.md`.
- [x] **Security (CRITICAL) — RESOLVED:** removed the leaked `VITE_GITHUB_LOG_TOKEN` from `.github/workflows/release.yml`, AND the user **revoked the leaked token on 2026-05-28, verified dead** (`gh api user` → HTTP 401 Bad credentials). It was the GitHub CLI OAuth token (`gho_`, `repo` scope), revoked via Settings → Applications → Authorized OAuth Apps → GitHub CLI → Revoke. `gh` on this machine is now logged out (re-login when needed; do NOT bake any token into builds again). The separate unused classic PAT "My Laptop CLI" was also deleted.
- [x] **Test command fix:** `npm test` glob now also runs `src/**/__tests__/*.test.mjs` (was silently skipping ~13 co-located test files = false green).
- [x] **Dead weight removed:** unused deps (`xlsx`, 4 `@syncfusion` ej2-angular/vue, dead `xlsx-js-style` import + its `vite.config.js` optimizeDeps entry); dead files (`src/components/PageAnnotationLayer.jsx` 41-line stub, orphaned `src/components/PDFPageItem.jsx`); fixed CLAUDE.md's high-risk path to the real `src/PageAnnotationLayer.jsx`.
- [x] **Hygiene:** untracked `audit/**/logs|screenshots|artifacts` (63→29 tracked); added `.github/workflows/ci.yml` (build+test gate); `.gitignore` updated.
- [x] **Disk:** reclaimed **~12.5 GB** by removing merged+pushed stale git worktrees (13 GB → ~516 MB).
- [x] **Branch audit** (nothing was lost — all pushed) → `audit/branch-audit-2026-05-28/REPORT.md`; complete plain-English list of visible missing work → `audit/missing-from-app-2026-05-28/REPORT.md`.
- [x] **Recovered: settings icon** (cherry-pick `5cab41f6` → `c910bc80`).
- [x] **Recovered: drag-and-drop reorder** (Spaces, Bookmarks, Projects/files, Templates, checklist, entities) from `codex/reorder-ux-and-app-split` via an isolated agent + a conflict-free 3-way merge (`7e6447f2`). **User confirmed it "feels good."**
- [x] **Recovered: in-page upload/create/share banners** (kal-23, `a68468a7`) and **Save-Log duplicate-push guard** (kal-27, `bd0c55ec`).

## Not Yet Done

- [x] ~~Revoke the leaked GitHub token~~ — DONE 2026-05-28, verified dead (401). No longer outstanding.
- [ ] **Right-side panel (kal-40)** — the next-session task. See "Right panel" below. Decision: **rebuild fresh on current code**, do NOT merge the stale branch.
- [ ] **Zoom line-thickness scaling** (stroke-scaling commit `c108347f`) — deferred; it edits the same stroke/zoom subsystem the current annotation work changed and the user reports zoom is currently rough. Needs careful by-hand reconciliation, not an auto-merge.
- [ ] **THE BIG ONE: break up `src/App.jsx`** so multiple agents can work in parallel. See "App.jsx breakup plan" below.
- [ ] Triage the **4 pre-existing failing tests** before trusting the new CI gate (they come from the in-progress annotation work; details in `audit/deep-dive-today/REPORT.md` "Build & test baseline").
- [ ] Optional: bring doc branches `kal-11/12/13/14/15/26` (planning/audit docs; `kal-11` App.jsx-split plan + `kal-15` product spec are useful for the breakup).
- [ ] Optional: remove the full duplicate clone at `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2` (~1.6 GB+).

## Failed Approaches / Don't Repeat These

- **Do NOT `git merge` the whole `codex/reorder-ux-and-app-split` branch.** It moves App.jsx in the OPPOSITE direction from the current branch (reorder shrinks via extraction +822/−2230; current grows +3019/−299) → 38 conflict regions. We deliberately recovered only the drag *feature* and left the branch's App.jsx *extraction* work behind.
- **Do NOT extract `ZoomScaleContext` / `ActiveDocumentContext` / `useSurveyMarkerExcelSync` / `useCalloutClipboard` as React contexts (as an earlier plan proposed).** Verification proved they are NOT clean seams — the zoom engine, document identity, survey/Excel domain, and callouts are fused to the interaction lifecycle and touch the load-bearing invariants. Re-wrapping Yjs breaks `trackedOrigins` identity. The honest path is in-closure custom hooks first, contexts only much later.
- **Isolated-worktree gotcha:** the recovery agent's worktree branched off the merge-base (`origin/main` = `8fc8a392`), NOT the current checkpoint — so its branch lacked the current annotation work. It worked out ONLY because a 3-way merge of the disjoint regions was conflict-free. Verify a worktree's base before trusting "no conflict with current work" claims; use `git merge-tree --write-tree HEAD <branch>` to check conflicts read-only before any merge.
- **kal-24 (teammate-marker catch-up race) is already solved by the current branch** (`src/services/annotationCloudSync.js` `onSubscribed` catch-up re-hydrate). Do not bring it — it would duplicate the fix.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Two-track plan: hygiene/guardrails first, App.jsx breakup later | Lint/CI + a clean test baseline make parallel work safe before any risky restructure |
| Recover features BEFORE breaking up App.jsx | The reorder branch already did ~6 of the planned extractions; recovering first lets the breakup build on it instead of fighting it |
| Recover drag *feature* files wholesale + graft only App.jsx wiring; exclude the extraction half | Feature files don't conflict with current work; the extraction half does |
| Rebuild the right-side panel fresh rather than merge kal-40 | kal-40 is stale and high-conflict; current code has moved past it |
| Keep everything local, unpushed; user tests on dev server | User's stated workflow: land on local, test on dev server, push only after approval |

## Current State

**Working / Building**: `npm run build` succeeds (~55–68s). `npm test` = **830 pass / 4 fail / 6 skip / 840 total**. The 4 failures pre-exist (in-progress annotation work), not from this session's changes.

**Uncommitted Changes**: none — working tree is clean. All session work is in commits `ed23d5b7..a68468a7` on the current branch.

**Rollback**: `git reset --hard ed23d5b7` restores the pre-recovery checkpoint (keeps Track-1 cleanup + the user's annotation WIP). The recovered feature commits are `c910bc80` (icon) → `a68468a7` (banners).

## Files to Know

| File | Why It Matters |
|------|----------------|
| `audit/deep-dive-today/REPORT.md` | Full security + architecture + cleanup analysis |
| `audit/branch-audit-2026-05-28/REPORT.md` | Every branch: what's on it, missing?, merge/cherry-pick/archive recommendation |
| `audit/missing-from-app-2026-05-28/REPORT.md` | Plain-English list of every user-visible change that was missing (now mostly recovered) |
| `src/App.jsx` | The ~49.5k-line monolith to break up. HIGH-RISK. Dashboard ~3257–10086, PDFViewer god-component ~10384–46904, App shell ~46904+ |
| `src/PageAnnotationLayer.jsx` | The REAL ~10k-line Fabric overlay (NOT the deleted `components/` stub). HIGH-RISK |
| `src/components/{FabricDrawingCanvas,FabricEraserCanvas,FabricEditCanvas,SVGAnnotationLayer}.jsx` | Carry the zoom invariants. HIGH-RISK |

## The four load-bearing invariants (must survive ANY refactor)

1. **Container-aware canvas sizing** — measure `containerEl.offsetWidth / pageSize.width`, never `pageSize * scale`.
2. **The `zoomGeneration` signal** must keep firing at zoom-start in `beginSyncfusionScaleConfirmPending` and stay referentially stable for the Fabric canvases that watch it. Never remove/rename.
3. **SVG viewBox owns all zoom scaling** in `SVGAnnotationLayer.jsx` — never reintroduce JS zoom coordination there.
4. **Single-name Fabric `fontFamily`** (e.g. `"Helvetica"`), never a CSS fallback stack.

## Right panel (next-session task)

`kal-40` (`origin/isaiahcalvo123/kal-40-convert-expanded-rail-controls-into-horizontal-labeled-tabs`) turned the narrow icon-only strip on the RIGHT edge of the PDF view (Survey, Spaces, page, zoom, fit) into a strip that expands (48px → 272px) into a labeled panel, and moved the Survey/Spaces buttons into it. It touches `src/App.jsx` + `src/PDFSidebar.jsx`. It is stale/high-conflict vs current. **Plan: show the user what it looks like first (screenshots exist on the branch: `kal-40-*.png`), agree on the design, then rebuild fresh on current code rather than merging the old branch.**

## App.jsx breakup plan (the big goal — do after annotation work stabilizes)

Ordered, lowest-risk-first, from the deep-dive (verification-corrected). **Reconcile with the reorder branch's already-shipped extractions — do NOT redo them.** The reorder branch already extracted PDF viewer chrome, the left-rail orchestration, template reorder rows, the print-panel controller hook, and removed the dead bottom toolbar + retired callout stubs; its roadmap doc is `docs/audits/APP_REMAINING_EXTRACTION_QUEUE_2026-05-26.md` (bring it via the `kal-11` plan branch if useful).

1. Extract `PDFThumbnail` + its private `thumbnailQueue` → `src/components/PDFThumbnail.jsx` (low risk; import shared `isStorageFileNotFoundError`).
2. Extract the dashboard dnd rows → `src/components/dashboard/SortableRows.jsx` (low; ~408 lines, import shared color/font helpers — note some of this may already be done by the recovered reorder work, so re-check first).
3. Extract module-scope debug bridges → `src/utils/appDebugBridges.js` (low).
4. Extract the entire `Dashboard` forwardRef → `src/components/Dashboard/Dashboard.jsx` (medium; biggest no-invariant decoupling; no tests — verify at runtime).
5. Delete the dead `BottomToolbar` if still present (the reorder recovery may already have removed it — check).
6. **Do NOT** extract the zoom/document/survey/callout contexts yet (see Failed Approaches). If pursued later: lift the zoom engine and Excel-workbook lifecycle into IN-CLOSURE hooks first, verify `npm test` + Fabric auto-commit, contexts only after.

## Resume Instructions (next session)

1. Confirm clean state: `git -C <repo> status` (should be clean), `git log --oneline -8` (should show `a68468a7` at top).
2. Re-baseline: `npm run build` (expect success) and `npm test` (expect 830 pass / 4 fail / 6 skip). If counts differ, investigate before changing anything.
3. **Right panel:** open the `kal-40-*.png` screenshots on `origin/isaiahcalvo123/kal-40-...` to show the user the old design, agree on the look, then rebuild fresh on current `src/App.jsx` + `src/PDFSidebar.jsx`. Verify build + the four invariants untouched.
4. **Then the breakup:** start at Step 1 above, ONE extraction per commit, run `npm run build` + `npm test` after each, never let the 4-invariant set regress. Re-check what the reorder recovery already extracted before extracting anything (avoid duplicating Steps 2/5).

## Warnings

- The leaked GitHub token was **revoked and verified dead on 2026-05-28** — no longer a concern. (Reminder: never bake a token into builds again; Save Log uses the `gh` CLI / share sheet.)
- **`src/App.jsx` is the highest-risk file**; minimum-viable diffs only; `npm test` after every touch.
- The 4 failing tests are pre-existing (from annotation WIP) — the new CI gate will show red until they're triaged; don't mistake that for your own breakage.
- Nothing is pushed. The user pushes only after they approve on their dev server.
- The reorder branch (`codex/reorder-ux-and-app-split`) and its commit `b494da78` are preserved in this branch's history — its extraction half is the reference roadmap, not something to re-merge wholesale.
