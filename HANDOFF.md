# Handoff: split the viewer file to unlock parallel agent work

**Generated**: 2026-05-29 (late-evening session — rename + cleanup + annotation audit + Linear reconciliation)
**Branch**: `main` — everything is committed locally on `main`, **24 commits ahead of `origin/main`, nothing pushed** (Isaiah pushes on his own cadence; direct-to-main workflow, he tests on his dev server first).
**State**: Build green (`vite build`, exit 0). `npm test` = **834 pass / 0 fail / 6 skip** — verified after every commit this session and unchanged from baseline.

---

## THE NEXT SESSION'S MISSION (do this)

**Carefully split the viewer file (`src/PDFViewer.jsx`) into modules/hooks so multiple agents can work in parallel without colliding.** Then — per Isaiah's plan — get the split perfect and verified, do ONE more full audit of everything to re-establish where we stand, and only THEN start parallel implementation on the Survey backlog.

### Why this is THE blocker (the whole point)
A huge share of the app lives in one 34,295-line file. Today, any two parallel tasks that both edit it collide. Splitting it is the single unlock for "point 20+ agents at the backlog at once." This directly serves the north star: (1) parallel agent work, and (2) a lighter, understandable codebase that makes the eventual zoom/Syncfusion work feasible.

### The hard truth about `src/PDFViewer.jsx` (measured 2026-05-29)
- 34,295 lines. ONE React function component: `export function PDFViewer({ ...~30 props })` opens at **line 240**, closes at EOF.
- ~202 `useState`, ~224 `useRef`, ~318 `useCallback`, ~188 `useEffect`, ~22 `useMemo`, ~164 distinct `handle*` callbacks.
- **Almost nothing is verbatim-liftable.** Handlers are closures over dozens of setters/refs. Most extractions must become a **custom hook that takes a wide ref/setter bundle and returns handlers** — medium-to-high risk, not copy-paste.
- The **four API-publisher effects** (`leftRailApi` / `rightRailApi` / `bottomToolbarApi` / `topToolbarApi`) bundle most handlers, so almost any handler you extract is referenced by a publisher. Keep the publisher contract AND the 2026-05-13 identity-churn guard intact on every edit (compare next API vs previous before returning new state; treat function-only identity churn as unchanged).

### NO-GO — never relocate or rewrite during the split
- The Syncfusion **zoom/scale lifecycle** (`beginSyncfusionScaleConfirmPending`, the `setZoomGeneration(prev => prev + 1)` signal, the snapshot/commit/transform cluster).
- The **per-page overlay portal render loop** (the `createPortal` `.map` in the JSX).
- The four CLAUDE.md invariants are law (container-aware canvas sizing; SVG viewBox owns all zoom; never remove `zoomGeneration`; single-name Fabric `fontFamily`).
- Grep for the in-file NO-GO banners before touching anything near these.

### Recommended split strategy (safest-first, one focused commit each)
1. **Warm up** with the ~8 genuinely pure helpers (`useCallback` with empty deps, no refs/state) → move to a plain module. Trivial, low-risk, builds confidence + the harness.
2. **Then extract cohesive, low-coupling CONCERNS into custom hooks**, each taking an explicit ref/setter bundle. FIRST map each concern's coupling before lifting it. Candidate concerns to evaluate (verify coupling first, lift the most isolated first): the history/undo-redo engine; survey-marker logic; Excel two-way sync; page operations (add/delete/reorder/rotate); the annotation context-menu; print/export orchestration.
3. **Never** extract anything entangled with the zoom lifecycle or the portal loop.
4. **Verification gate after EVERY extraction** (non-negotiable): `scripts/check-undef.mjs` set-diff shows zero new unresolved identifiers + `vite build` green + `npm test` stays **834/0/6**. If anything regresses, revert that extraction. One concern → one commit.
5. Update `docs/ARCHITECTURE.md` as the file shrinks and concerns move out.

---

## WHY (north star — unchanged, keep in mind)
1. **Parallel agent work** (the viewer split is the gating step).
2. **Performance — buttery, Drawboard-level zoom.** Today's zoom is the pain point. This is a dedicated future milestone, NOT to be started during the split. Two clarifications from Isaiah this session:
   - **Ripping out Syncfusion is only a maybe-someday goal** (licensing / wanting proprietary or open-source ownership), NOT required. Syncfusion is a solid professional tool.
   - **The "annotations disappearing" problem is NOT a Syncfusion problem** — it was our own SYNC safeguards hiding annotations (a stale/smaller snapshot replacing the visible set; survey-marker hydrate-empty read as a delete). Fixable independently of Syncfusion. Tracked in KAL-92.

---

## Linear state (Survey project ONLY)

Projects are correctly separated — **measurements live in the Takeoff project, transcription/speech-to-text in Walkthru** — so ignore those; only the **Survey** project is this app. Verified 2026-05-29: nothing is misfiled.

What changed in Linear this session:
- **KAL-80** (audit annotation/callout ownership) → **DONE** (delivered by `docs/ANNOTATION-CONTRACT.md`).
- **KAL-86** (map sync/import/export pipeline) → **DONE** (same doc).
- **KAL-81** (unify callouts with the main annotation model) → blueprint attached as a comment; this is the **keystone migration** (fold the separate callout store into the main model, mirroring how `counter` already works). High-risk, needs a schema + CRDT backfill, the forks are load-bearing until it lands. A **dedicated effort — NOT piecemeal, NOT during the viewer split.**
- **KAL-125** (NEW, High/Bug): callout + survey-marker delete bypass the per-user ownership gate (collab security). Independently fixable — a good early **parallel** candidate once the split is done.
- **KAL-126** (NEW, Medium/Bug): stamp (image) annotations render nothing and are dropped from export — decide scope.
- **KAL-82** (dead code), **KAL-85** (duplicate rendering layers), **KAL-92** (disappearance regression tests): progress + concrete findings added as comments; still open.

The annotation source of truth is **`docs/ANNOTATION-CONTRACT.md`** (the contract, per-type conformance table, 20-item divergence catalogue with `file:line` evidence, and a safest-first remediation plan). `docs/ARCHITECTURE.md` is the `src/` map. (Note: Isaiah wants to eventually move off Linear too, but not yet.)

---

## This session's commits (8, oldest→newest, all local `main`)
1. rename `src/App.jsx` → `src/viewerShared.js` (honest name; repointed 2 importers + 9 test/script reads).
2. removed 99 dead import specifiers across 78 files (surgical AST-span transform).
3. added `docs/ANNOTATION-CONTRACT.md` + refreshed `docs/ARCHITECTURE.md`.
4. removed orphaned dead code (`AnnotationContext.jsx` + `OptimizedPDFPage.jsx` + the dead `DB_TYPE_TO_FABRIC_DEFAULT` map).
5. added top-of-file headers to 96 source files (95 by a 13-agent pass + the protected viewer-overlay file by hand).
6. fixed a stale `CLAUDE.md` high-risk entry + refreshed this handoff.
7. completed the annotation audit (callout text-style flags + context-menu addendum).
Each gated on build + `npm test` (834/0/6) before commit.

## Open flags / confirm-before-acting
- Two empty 0-byte orphan files with no importers: `src/contexts/SurveySessionContext.jsx`, `src/hooks/useSurveySync.js`. Likely deletable — confirm with Isaiah.
- `src/components/LocateModal.jsx` — dead (nobody imports it; the live Locate dialog is inline in the viewer). Someone's WIP — confirm before deleting.
- More dead-code candidates are queued in the KAL-82 comment (the `CalloutOverlay` no-op stub, `saveAnnotatedPDFFile.js`, legacy `renderArrow`, `sticky_note`).

## Tooling + working rules (carry forward)
- **Verify before asserting** "dead"/"used" with a fresh single command, not memory.
- Dead-import scan: `find src -type f \( -name '*.js' -o -name '*.jsx' \) -print0 | xargs -0 node scripts/check-unused-imports.mjs --json`.
- Undefined-identifier check: `scripts/check-undef.mjs <file>` (baseline set-diff; see `memory/reference_extraction_undef_checker.md`).
- **zsh gotcha:** unquoted `$var` does NOT word-split in zsh — pass file lists via `-print0 | xargs -0` or `${(f)var}`.
- **Workflow tool gotcha:** `args` arrived in-script as a STRING — guard with `const X = Array.isArray(args) ? args : JSON.parse(args)`.
- Keep tool batches small and outputs tiny; one focused, verified commit per change.
