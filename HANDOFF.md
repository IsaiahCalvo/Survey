# Handoff: rename + repo cleanup + the annotation-contract map

**Generated**: 2026-05-29 (evening "drive it forward until ~50% context" session)
**Branch**: `main` — everything below is committed locally on `main`. Nothing pushed (Isaiah pushes on his own cadence; direct-to-main workflow, test on the dev server first).
**State**: Build green (`vite build`, exit 0). `npm test` = **834 pass / 0 fail / 6 skip** — verified after EVERY commit this session (unchanged from baseline throughout).

## WHY (the north star — unchanged, read first)

The breakup + cleanup + documentation serve two goals, the second being the real prize:
1. **Parallel agent work.** Small, single-purpose, accurately-headed files so many agents can work at once without colliding or guessing intent. (Isaiah's stated end-state: point ~20–50 agents at the Linear backlog at once, each scoped, verified, self-reporting.)
2. **Performance — own the rendering + zoom.** The app leans on **Syncfusion** for the PDF viewer; its zoom is the pain point (laggy, not smooth/professional). The long-term prize is to **remove Syncfusion entirely**, own the PDF rendering, and build **custom near-zero-lag zoom**. Every cleanup makes that swap feasible by getting the codebase light + understandable. Bias all cleanup toward **fewer layers / lighter weight**.

**NO-GO for piecemeal refactor (still law):** the Syncfusion zoom/scale lifecycle and the overlay portal render loop in `PDFViewer.jsx`. The eventual zoom/Syncfusion replacement is a dedicated, well-planned milestone, NOT something to chip at during cleanup. Same discipline now applies to the **callout unification** (see below) — it's a dedicated migration, not a piecemeal job.

## What this session did (6 commits, oldest→newest)

1. **`ad2ad6e9` — renamed `src/App.jsx` → `src/viewerShared.js`.** The file stopped being the app root long ago; it's a leaf module of shared constants + helpers (zero JSX). Kept it FLAT in `src/` (not nested in `shared/`) so its own relative imports don't shift. Repointed the 2 live importers (`PDFViewer.jsx:238`, `AppShell.jsx:39` — only the path string changed), 9 test/script filesystem reads (incl. a real `readFileSync` in `src/utils/__tests__/surveyMarkerSyncSafety.test.mjs`), and stale comment refs. Rewrote the header.
2. **`ff272116` — removed 99 dead import specifiers across 78 files.** 66 were just an unused `React` default (safe under the automatic JSX runtime). Surgical AST-span transform (only import declarations rewritten; all other bytes untouched). Re-scan now reports 0 unused.
3. **`4a91a308` — `docs/ANNOTATION-CONTRACT.md` + refreshed `docs/ARCHITECTURE.md`.** The big one — see next section.
4. **`204125fe` — removed orphaned annotation dead code** (remediation #1+#2): deleted `src/contexts/AnnotationContext.jsx` (a fully-built parallel `AnnotationStore` state engine nothing renders) + its only consumer `src/components/OptimizedPDFPage.jsx`, and the unused `DB_TYPE_TO_FABRIC_DEFAULT` map in `annotationTypeSerializers.js`. Each verified dead by grep (0 external refs) first.
5. **`d73e4d5c` — top-of-file headers on 96 source files.** A 13-agent parallel pass added 95 concise, accurate headers (grounded strictly in each file's real exports/imports); PageAnnotationLayer.jsx headered by hand. Callout/survey-marker-pipeline files carry a pointer to `docs/ANNOTATION-CONTRACT.md`. All comment-only insertions (0 deletions).
6. **(this commit) — fixed stale `CLAUDE.md` high-risk list + this handoff.** The high-risk entry described a nonexistent `App.jsx` as the 1.3MB zoom file; corrected to list `PDFViewer.jsx` (the actual 1.5MB zoom/render-loop file) and describe `viewerShared.js` accurately.

## The key new artifact: `docs/ANNOTATION-CONTRACT.md` (READ IT)

A 10-agent parallel audit mapped every annotation type across 9 lifecycle stages
(create / state / render / serialize / sync / undo / edit / delete / export). The doc contains:
- **The shared contract** — the one way annotations are supposed to flow, stage by stage, with `file:line` anchors.
- **A per-type conformance table** — ✅ on contract / ⚠️ necessary divergence / ❌ accidental.
- **A 20-item divergence catalogue** with evidence + recommendation + risk/effort.
- **A safest-first remediation plan** (12 ordered actions).

### The headline finding (this is what Isaiah asked about)
**Callout is the odd-one-out**, diverging from the shared contract at nearly EVERY stage: a separate `callouts[]` state slice (normalized 0–1 coords instead of page-pixel Fabric), a separate serializer (`annotation_data.callout` + an explicit deserialize bypass at `annotationTypeSerializers.js:101`), a fully parallel cloud-sync + a dedicated `Y.Map('callouts')`, a bespoke history-scope module (`calloutHistoryScope.js`), a separate render loop, an edit adapter, AND an **ungated delete** (no `canModify` — a real collaboration security gap).

**Root cause:** callouts were grafted in from a reference "Callout app", not designed on the contract; Phase 14 ("unified-svg-callout-render-shared-tool-foundation") began unifying but never finished. **Decisive proof it's accidental, not necessary:** the **counter** tool is an equally composite multi-part group object yet rides the unified path (in `annotationsByPage`, shared serializer/sync/history, dispatched by a `data.type==='counter'` guard). The ONLY genuinely necessary callout-specific code is the leader-line geometry (`renderCallout`'s richer signature) + the `data-callout-id` hit-test. **survey_marker** is a milder runner-up (its separation is mostly legit Excel-two-way-sync + dedicated DB columns).

## Recommended next steps (safest-first — full detail in ANNOTATION-CONTRACT.md remediation plan)

**Safe, independent, do-anytime (low risk):**
1. Retire the `Callout/index.jsx` `CalloutOverlay` stub — it's a mounted no-op (renders `null`). Repoint its 3 re-exports to `./types`, remove the 3 `<CalloutOverlay>` render sites + 2 default imports, delete the stub. (Touches PDFViewer + PAL — minimal diff under the standing waiver; run `npm test`.)
2. Delete the dead `saveAnnotatedPDFFile.js` helper (silently drops callouts+markers; confirm dead first).
3. Decide the 2 empty 0-byte orphan files (`src/contexts/SurveySessionContext.jsx`, `src/hooks/useSurveySync.js`) — no importers; likely deletable but **confirm with Isaiah** (could be placeholders).
4. Delete the legacy `renderArrow` group renderer after a data audit confirms no stored/cloud data serializes arrows as Fabric groups.

**Real correctness/security fixes (HIGH risk — touch PDFViewer delete paths; do each isolated + verified, ideally tell Isaiah first):**
5. **Callout delete has no `canModify` gate** (`PDFViewer.jsx:~10461` keyboard, `PageAnnotationLayer.jsx:~4346` context-menu) — a non-owner can delete other users' callouts; the same op on a shape is gated. Route callout ids through `canModify` + `buildBulkDeletePlan`.
6. **Survey-marker delete uses a bespoke ownership chain** (`PDFViewer.jsx:~23243`) instead of `permissionScope.getAnnotationAuthorId` — author resolved from a different slot than the canonical chain → inconsistent authority. Route through `permissionScope`.
7. **Stamp (image) silently renders nothing AND exports nothing** despite being a DB type — likely a lost render path from the SVG migration. Decide scope with Isaiah: add `renderImage` + export case, or make the skip explicit/diagnosed.

**The KEYSTONE (do LAST, dedicated effort, HIGH risk + large):**
8. Migrate callouts into `annotationsByPage` as page-coord Fabric `group` objects with `data.type==='callout'` (mirroring counter). Collapses ~6 divergences at once (separate state, serializer, sync, CRDT map, history scope, count arg). **Requires a schema + CRDT backfill** (existing callout rows + live-collab `Y.Map('callouts')` entries → page-coord groups). The dependent forks are load-bearing UNTIL this lands — do NOT delete them piecemeal first. This finishes Phase 14. Treat like the zoom rewrite: plan it as its own milestone.

## Open flags / things to confirm
- **2 empty orphan files** (above) — flagged, not touched.
- **`src/components/LocateModal.jsx`** — still confirmed dead (nobody imports it; the live Locate dialog is inline `showLocateModal` JSX in PDFViewer). Someone's WIP — **confirm before deleting** (git-reversible either way).
- No automated test renders the viewer/home/shell. Build + tests cover static correctness; behavioral/visual changes still want a dev-server look.

## Tooling + workflow notes (carry forward)
- **Verify before asserting "dead"/"used"** with a fresh single command, not a remembered claim.
- `scripts/check-unused-imports.mjs --json <files…>` — read-only unused/duplicate-import scanner. To scan the repo: `find src -type f \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 node scripts/check-unused-imports.mjs --json`.
- `scripts/check-undef.mjs <file>` — undefined-identifier (globals) checker; baseline set-diff per `memory/reference_extraction_undef_checker.md`.
- **zsh gotcha:** unquoted `$var` does NOT word-split in zsh — passing a file list via a var gives the tool ONE giant arg. Use `-print0 | xargs -0`, or `${(f)var}`, or `${=var}`.
- **Workflow gotcha:** the `Workflow` tool's `args` must be passed as an actual JSON value, but it arrived in-script as a STRING this session — guard with `const X = Array.isArray(args) ? args : JSON.parse(args)`.
- **Verification gate for any cleanup:** re-scan (or grep) to prove the change did what you intended + `vite build` + `npm test` (must stay 834/0/6) before committing. One focused commit per change.

## Where the audit data lives
- `docs/ANNOTATION-CONTRACT.md` — the contract + catalogue + plan (the source of truth for the next phase).
- `docs/ARCHITECTURE.md` — the `src/` map (updated for the rename; now points to the contract doc).
- Session moments: `~/.claude/projects/-Users-isaiahcalvo-Documents-Projects-Active-Survey-BetaSafeS2/memory/session-moments/2026-05-29.md` (evening entries).
