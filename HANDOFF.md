# Handoff: break up the viewer file — phase 2 (stateful concerns → hooks)

**Generated**: 2026-05-29 (late-evening session — pure-helper extraction wave)
**Branch**: `main` — all work committed locally on `main`, **10 commits ahead of `origin/main`, nothing pushed** (Isaiah's direct-to-main workflow: he tests on his dev server first, pushes on his own cadence).
**Status**: Phase 1 (safe warm-up) DONE + verified. Ready to start phase 2.
**Tracking issue**: KAL-127 (Survey project) — "Break up PDFViewer into hooks/modules for collision-free parallel work."

---

## Goal

Break up the ~33k-line document viewer (`src/PDFViewer.jsx`) so multiple agents can work on different parts WITHOUT colliding. It is still one big React closure — that single file is the collision surface that blocks parallel work. This is the gating step for the whole backlog, and it serves the north star (a lighter, understandable codebase that eventually makes a custom near-zero-lag zoom / optional Syncfusion replacement feasible).

## THE NEXT SESSION'S MISSION (do this)

Extract **cohesive stateful CONCERNS into custom hooks**, each taking an explicit ref/setter bundle. This is the real break-up — it actually shrinks the file and lets agents own separate concerns. It is medium-to-high risk: these are NOT pure helpers, they are closures over dozens of `useState` setters / `useRef`s.

**First action of the session (do before lifting anything):** produce a *coupling map* — for each candidate concern, list exactly which state/refs/setters/other-handlers it reads and writes. That map defines each hook's parameter bundle and its return surface. A parallel read-only agent fan-out is a good fit for building this map (read-only = no collisions).

Candidate concerns (verify coupling first, lift the most isolated first, one concern → one commit):
- history / undo-redo engine (note: its pure helpers already live in `src/utils/historyHelpers.js` — the hook would own the stateful machinery + refs)
- survey-marker logic
- Excel two-way sync
- page operations (add / delete / reorder / rotate)
- annotation context menu
- print / export orchestration (its pure helpers already live in `src/utils/exportHelpers.js`)

## Completed (this session — phase 1)

- [x] Built `scripts/find-hoistable.mjs` — Babel binding-scope analysis that PROVES a top-level component function captures nothing from component scope (zero "captures" = safe to lift verbatim).
- [x] Ran a 28-agent adversarial verification pass (`scripts/wf-verify-hoistable.mjs`) over every capture-free candidate (call sites, name collisions, identity-sensitivity, JSX, external refs).
- [x] Built `scripts/extract-helpers.mjs` — codemod that rewrites a useCallback/arrow/fn declaration into an exported module function, derives + re-relativizes its imports, removes the in-component decl, and inserts the viewer import.
- [x] Extracted **30 pure, capture-free helpers** into **9 modules** (zero behavior change): `src/utils/viewState.js`, `historyHelpers.js`, `regionGeometry.js`, `annotationData.js`, `bookmarkOutline.js`, `counterGeometry.js`, `exportHelpers.js`, `overlayDebug.js`, and `src/components/annotationHydrationCover.jsx`.
- [x] Repointed 2 source-guard tests whose scanned patterns moved (`tests/performance/overlayPresentationGate.test.mjs`, `tests/annotationInitialHydrationSource.test.mjs`) to also read the new modules — intent preserved.
- [x] Updated `docs/ARCHITECTURE.md` with the module map. Viewer **34,295 → 33,218 lines**.
- [x] Every extraction gated: check-undef set-diff (zero new unresolved) + `vite build` + `npm test` **834/0/6**.

## Not Yet Done

- [ ] The phase-2 concern → hook extractions above (the actual unlock).
- [ ] The two deferred identity-sensitive helpers (see Failed/Deferred below).
- [ ] After the break-up: one more full audit, THEN start parallel implementation on the Survey backlog.

## Failed / Deferred Approaches (don't repeat blindly)

- **`find-hoistable` flags a function purely on capture-freeness — that is necessary but NOT sufficient for a verbatim lift.** Two capture-free helpers were DELIBERATELY left in the viewer: `sanitizeTemplateConfig` and `boundsMatch`. Both are plain (non-memoized) functions whose per-render reference identity is consumed in React dependency arrays (`boundsMatch` in one `useCallback`'s deps; `sanitizeTemplateConfig` in five, AND it is duplicated verbatim in `src/Dashboard.jsx`). Lifting them to stable module functions would change WHEN those memoized callbacks/effects re-run. They need a deliberate, separately-tested change (and a shared-module dedup with Dashboard for `sanitizeTemplateConfig`), not a verbatim lift. Also left alone: `syncfusionResourceUrl` (a `useMemo` VALUE, not a reusable helper — converting changes eval timing) and `handleSyncfusionTextSelectionEnd` (a 4-line no-op — not worth a module).
- **Don't try to extract concerns that touch the NO-GO zones.** See Warnings.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Prove capture-freeness with an AST tool, then adversarially verify, before any edit | The viewer is the single highest-risk file; "looks pure" is not proof. The tool + verification gave provable safety. |
| Extracting a helper transitively unlocks its callers | After lifting a helper, its in-component callers may become capture-free (their only capture was the helper just moved). Re-run `find-hoistable` after each wave — 5 of the 30 were cascade unlocks. The cascade converged on its own. |
| One concern → one commit, gated every time | Localizes any regression; keeps each diff a minimum-viable, reviewable relocation. |
| Sequential edits, not parallel agents, for the actual file edits | Two agents editing the one 34k-line file collide — that's the exact problem we're solving. Parallel agents are only for READ-ONLY analysis (e.g. the coupling map). |

## Current State

**Working**: Build green (`vite build`, exit 0). `npm test` = **834 pass / 0 fail / 6 skip**. Verified after every commit and at session end. Tree clean.

**Broken**: nothing.

**Uncommitted Changes**: none — everything is committed on local `main`.

## Files to Know

| File | Why it matters |
|------|----------------|
| `src/PDFViewer.jsx` | The ~33k-line viewer being split. HIGH-RISK. Component opens ~line 240, runs to EOF; module scope above it is pure imports. |
| `src/viewerShared.js` | Shared constants + pure helpers imported by the viewer and the app shell. New util modules re-import from here as `../viewerShared`. |
| `scripts/find-hoistable.mjs` | Run first to see what's still safe to lift. Output: capture-free candidates with their import needs. |
| `scripts/extract-helpers.mjs` | The codemod (CONFIG of module → function names; `--write` to apply). Note: it OVERWRITES module files — append cascade-unlocked helpers by hand (see git history `5540792d`, `b5fc2677` for the pattern). |
| `scripts/check-undef.mjs` / `check-unused-imports.mjs` | The verification gate: zero new unresolved identifiers + no orphaned imports after each move. |
| `docs/ARCHITECTURE.md` | The `src/` map + the viewer-helper module list. |

## Resume Instructions

1. Confirm baseline: `npm run build` (expect exit 0) and `npm test` (expect **834 pass / 0 fail / 6 skip**). If not green, STOP and investigate before touching anything.
2. Read KAL-127 (Survey project) and the "Mission" section above.
3. Build the coupling map FIRST: for each candidate concern, list the state/refs/setters/handlers it reads + writes. Fan out read-only agents over the viewer to do this in parallel (no collisions). Pick the most-isolated concern to lift first.
4. Extract that one concern into a custom hook taking an explicit ref/setter bundle and returning its handlers. Keep the four API-publisher effects (`leftRailApi` / `rightRailApi` / `bottomToolbarApi` / `topToolbarApi`) and the 2026-05-13 identity-churn guard intact — almost every handler you touch is referenced by a publisher.
5. Gate after the extraction (non-negotiable): `node scripts/check-undef.mjs src/PDFViewer.jsx` set-diff shows zero new unresolved + `vite build` green + `npm test` stays **834/0/6**. If anything regresses, revert that extraction. One concern → one commit.
6. Watch for source-guard test failures: several tests scan `viewerShared.js` + `PDFViewer.jsx` (concatenated) for code patterns. If you move a guarded pattern into a new module, add that module to the test's scanned source (see the two test fixes this session for the pattern).

## Warnings

- **NO-GO — never relocate or rewrite during the split:** the Syncfusion zoom/scale lifecycle (`beginSyncfusionScaleConfirmPending`, the `setZoomGeneration(prev => prev + 1)` signal, the snapshot/commit/transform cluster) and the per-page overlay portal render loop (the `createPortal` `.map` in the JSX). The four CLAUDE.md invariants are law (container-aware canvas sizing; SVG viewBox owns all zoom; never remove `zoomGeneration`; single-name Fabric `fontFamily`). Grep for the in-file NO-GO banners before touching anything nearby.
- **Counter drag code is flagged `[COUNTER WIP — DO NOT TOUCH]`** around its handlers — coordinate before touching that flow (its pure geometry helpers already moved to `src/utils/counterGeometry.js`, which was safe).
- **zsh gotcha:** unquoted `--include=*.js` / `$var` globs trip zsh — quote globs or use `-print0 | xargs -0`.
- **Don't trust "dead"/"used"/"pure" from memory** — re-verify with a fresh single command (`find-hoistable`, `check-unused-imports`, grep) before acting.
- Syncfusion removal is a maybe-someday goal, NOT required. The "annotations disappearing" issue is our own sync safeguards, not Syncfusion (tracked separately as KAL-92).
