# Handoff: professional-polish pass — headers, architecture guide, dead-import prune

**Generated**: 2026-05-29 (afternoon "keep optimizing until ~50% context" session)
**Branch**: `main` — everything below is committed locally on `main`. Nothing pushed (Isaiah pushes on his own cadence).
**State**: Build green (`vite build`, exit 0). `npm test` = **834 pass / 0 fail / 6 skip** (unchanged from baseline, verified after every change this session).

## What this session did (3 commits, oldest→newest)

1. **`989afa0d` — file-header overviews on the five top-level modules.** Pure comments.
   - `src/App.jsx`: replaced the **stale, wrong** `// App.jsx - PDF Management Dashboard` comment with an accurate header (this file is now a shared constants/helpers module, NOT the app; rename candidate).
   - `src/SurveySpacesRail.jsx`: added a header (it was the only big file missing one), incl. the "Spaces in the name renders no Spaces UI" clarification.
   - `src/PDFViewer.jsx`, `src/AppShell.jsx`, `src/Dashboard.jsx`: already had accurate headers — added the four-invariants + NO-GO note to the viewer; added a guard note to the shell (corrected in commit 2).
2. **`1d7a5602` — architecture guide + AppShell guard-note fix.**
   - `docs/ARCHITECTURE.md` (233 lines): a verified, skimmable map of `src/` for parallel agent + human work — entry point, the five top-level modules and their one-directional import graph, the published-API communication pattern, the NO-GO zones + four invariants, the verification workflow. Every structural claim was grep/ls-verified.
   - `src/AppShell.jsx`: corrected the guard note — the identity-churn guard actually lives in **PDFViewer's publisher effects**, not the shell. (See "CLAUDE.md is stale" below.)
3. **`ebc80d62` — pruned 177 dead imports from `src/App.jsx` + added a checker tool.**
   - App.jsx became pure non-React helper code after the extractions (zero JSX, zero hook calls, zero `React.*`), leaving 177 unused import specifiers across 72 statements (incl. the entire React import). Removed them with a surgical AST transform that only touches import-declaration spans.
   - Verified safe **three ways**: `scripts/check-undef.mjs` set-diff showed ZERO new unresolved identifiers; build green; tests unchanged.
   - Added **`scripts/check-unused-imports.mjs`** — read-only companion to `check-undef.mjs`; reports unused/duplicate imports, `--json` mode for automation.

## Current architecture (read `docs/ARCHITECTURE.md` first — it's the source of truth)

- `src/AppShell.jsx` (~2,857) — the real app root (main.jsx imports its default). Tabs, auth/entity state, chrome host divs, top-right zoom pill, Dashboard↔PDFViewer router. RECEIVES the rail/toolbar APIs.
- `src/PDFViewer.jsx` (~34,300) — the document viewer. **One giant React function component** (see below). PUBLISHES leftRailApi/rightRailApi/bottomToolbarApi.
- `src/Dashboard.jsx` (~3,875) — the home screen.
- `src/App.jsx` (~2,180 now) — **misnamed**: shared constants/helpers module, imported by viewer + shell. Leaf (imports none of the big three; no cycles).
- `src/SurveySpacesRail.jsx` (~2,980) — the survey right rail (renders no Spaces UI despite the name).

## Recommended next steps (risk-ordered, safest first)

1. **Rename `src/App.jsx` → `src/shared/viewerShared.js`** (or split into `constants/` + `utils/`). The single biggest remaining "amateur smell" (a file named App.jsx that isn't the app). MECHANICAL but multi-file: update the import path in `PDFViewer.jsx` and `AppShell.jsx` (the import LISTS don't change, only the path), move the file, and **repoint the source-guard tests that read `App.jsx` by filename** (last session repointed 7 such tests to read App.jsx + PDFViewer.jsx concatenated — those file-reads need updating). Verify: `check-undef` + build + test. Do it as one focused commit.
2. **Repo-wide dead-import cleanup** using the new `scripts/check-unused-imports.mjs`. Current scan: **99 unused specifiers across 78 files** (most 1–2 each; App.jsx already done). Top offenders: `PageAnnotationLayer.jsx` (14 — HIGH-RISK file, handle with care), `components/FabricEditCanvas.jsx` (3), `components/CompactColorPicker.jsx` (3). NOTE: a `React` flagged unused in a JSX file is safe to drop ONLY because this project uses the automatic JSX runtime (@vitejs/plugin-react) — confirm build stays green. Also 2 files have duplicate imports. The `/tmp/prune.mjs`-style transform from commit 3 can be reused (it lived at `scripts/_prune_tmp.mjs`, deleted after use — rewrite from the commit if needed). Always gate on check-undef + build + test.
3. **`src/components/LocateModal.jsx` is confirmed dead** (imported by nobody; the live Locate dialog is inline `showLocateModal` JSX in PDFViewer). Safe to delete, but it's someone's WIP — **confirm with Isaiah** before deleting (git-reversible either way).
4. **Internal PDFViewer extractions (own session, careful).** See the NO-GO warning below.

## Warnings / invariants (still law)

- **PDFViewer.jsx is ONE giant React function component** (opens ~line 234, closes at EOF; ~202 useState / 224 useRef / 318 useCallback / 188 useEffect). Almost nothing is verbatim-liftable. Only ~8 pure helpers (useCallback w/ empty deps, no refs/state) could move to a module cheaply. Everything else (history engine, page ops, survey, Excel sync) is a closure over dozens of setters/refs → must become a hook taking a wide ref/setter bundle (medium-high risk). The four API-publisher effects bundle most handlers, so any handler an extraction touches is likely referenced by a publisher.
- **NO-GO zones in PDFViewer (never relocate/rewrite):** (1) the Syncfusion zoom/scale lifecycle (`beginSyncfusionScaleConfirmPending` ~1780, the `setZoomGeneration(prev=>prev+1)` signal, the snapshot/commit/transform cluster); (2) the per-page Syncfusion overlay portal render loop in the JSX (the `createPortal` `.map`). There are 7 NO-GO banners in the file marking these.
- **The four CLAUDE.md invariants** (container-aware canvas sizing, SVG viewBox owns all zoom scaling, never remove `zoomGeneration`, single-name Fabric `fontFamily`) are correctness law.
- **CLAUDE.md is STALE on one point:** it says the identity-churn guard "lives in AppShell.jsx." After the PDFViewer extraction, the publisher effects (and their `(prev)=>` compare guard) moved to `PDFViewer.jsx`. AppShell only RECEIVES the APIs. Worth fixing in CLAUDE.md (use `/gotcha`).
- **No automated test renders the viewer/home/shell.** Build + check-undef + source-guard tests cover *static* correctness; behavioral/visual changes still want a dev-server look.
- **Verify before asserting "dead"/"used":** confirm with a fresh single command (grep file contents / `check-unused-imports.mjs`), not a remembered claim.

## Session note (environment)

This session hit a tooling glitch: large parallel tool batches got cancelled when one call errored, and long multi-line output truncated/garbled in the display. Several mid-session "findings" were noise and were corrected by clean single-command re-checks (see `memory/session-moments/2026-05-29.md`, 15:25 INSIGHT). Working rule for the next agent: **small sequential tool calls, tiny outputs, never mix Edits with a Bash call that can fail.** Final state is fully verified and clean.
