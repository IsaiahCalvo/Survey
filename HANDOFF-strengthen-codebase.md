# Handoff — De-Fragilize the Codebase (campaign goal for a fresh session)

_Owner-set goal 2026-06-30: "Strengthen every part of the app so nothing is fragile.
Break the big files into small pieces, delete dead code, keep running ponytail +
fallow." This doc sets up a focused session/milestone to execute that._

## What "fragile" means here (and the fix)

One file, `src/PDFViewer.jsx`, is **33,982 lines** and owns a huge share of the app
(zoom/scale lifecycle, per-page overlay portals, save/sync, history engine). When
that much lives in one file, a small change in one corner can ripple to a far
corner — that's the fragility. **28 source files are over 1,000 lines.** The cure is
the same one already proven on the mobile app (9,319 → 1,816 lines, 25 modules):
extract cohesive pieces into small, single-purpose files so changes stay local, and
delete code that no longer runs. Smaller files + good automated tests = not fragile.

## RUN MODE — autonomous, do not stop until done

- **Do not stop until the goal is fully met:** all dead zoom/scroll + recorder code
  removed, and `PDFViewer.jsx` (plus the other >1k-line files) broken into small
  modules. Work batch after batch, committing each, without pausing to ask the owner
  to weigh in. Only stop for a genuine blocker you cannot resolve any other way, or an
  explicit NEEDS-OWNER item (there are none left in this plan except the parked
  PrintPanel + mobile step-12, both listed as out of scope).
- **Never ask the owner to test.** The owner will not hand-test. You verify everything
  yourself with the automated gates below.
- **Build whatever tests are required — honestly, no cheating.** When you delete code
  that had test coverage, or extract a module, add real tests that would actually FAIL
  if the behavior broke. No tautological asserts, no `assert(true)`, no tests that skip
  the hard path, no deleting a failing test to go green. A test that can't fail is a
  lie; write the one that catches the regression.
- **Green means green:** never mark a batch done while build, node tests, or the app
  smoke/e2e are failing. If something breaks, fix it or revert that batch — do not
  paper over it.
- Keep going through the whole 28-file list. "Done" = the giant files are genuinely
  broken down and the dead code is genuinely gone, verified.

## Verification model (owner doesn't manually test)

Owner does NOT want to hand-test between batches. Self-verify with the automated
gates, every batch:
- `npx vite build`
- `node scripts/run-node-tests.mjs`  (baseline **1685 pass / 0 fail**)
- For any PDFViewer/overlay/canvas change, also drive the real app headless:
  start a worktree dev server (`npx vite --port 5180 --strictPort`, after copying
  `.env .env.local .env.test` from repo root — they're gitignored and don't carry
  into a worktree), then `APP_URL=http://localhost:5180 node agent-cli/render-smoke.mjs`
  and `… agent-cli/callout-interaction-e2e.mjs`.
- **Cold-compile gotcha:** a freshly-started vite dev server compiles modules JIT on
  first request, so the e2e's tight waits can false-FAIL at `button[title="Callout"]`
  on the first run. Warm the path once (render-smoke + one e2e run), then re-run; it
  passes. Don't chase a code bug when only the cold first run fails.
- Where a deletion removes the only coverage of still-live behavior, **write a small
  replacement test** (node `test` + `assert`, no new frameworks) rather than leaving a gap.

## Guardrails (carry forward — these still bind)

- Minimum-viable diff in `PDFViewer.jsx` / `PageAnnotationLayer.jsx` / the Fabric
  canvases / `SVGAnnotationLayer.jsx`; never refactor opportunistically while in there.
- **Correctness invariants (never violate):** container-aware canvas sizing (measure
  `containerEl.offsetWidth / pageSize.width`, not `pageSize*scale`); single-name
  `fontFamily` in Fabric; the `zoomGeneration` signal contract; SVG viewBox owns all
  zoom scaling (no JS zoom coordination in SVGAnnotationLayer).
- Small commits, one logical change each. Land on local `main`; **push only after
  owner approval.**
- Validate every deletion against real importers/call sites + the 13 source-assertion
  tests below — fallow/ponytail findings are a floor, not ground truth.

---

## Priority 1 — Finish the dead zoom/scroll code removal in PDFViewer.jsx

**Owner approved 2026-06-30:** remove the dead old-zoom/scroll code AND the broken
overlay-lag recorder, **including the source-assertion test lines that only guard
dead code.** This was previously blocked because removing it breaks those guard tests
and no one had okayed touching them. It's unblocked now — but it's surgery, because
the guard tests protect a **mix of dead and still-live logic in the same file.**

`usePdfjsRenderer` is hardcoded `true` (line ~926); the legacy Syncfusion render arm
is gone. Branches behind `if (!usePdfjsRenderer)` / `if (true) return` are dead.

### NEVER touch (live, despite looking dead)
- The two **KAL-241** scroll bail-outs (find by the `KAL-241` comment — formerly
  lines 5437 / 5609). Live performance disables.
- `handleLegacyOverlayPaintCommitted` (live pdf.js overlay handler, formerly ~1894–1899).

### The entanglement — 13 tests read PDFViewer.jsx as TEXT and assert on its source
```
tests/syncStatusUi.test.mjs                         tests/pdfAnnotationImporter.test.mjs
tests/surveyMarkerNamePromptContract.test.mjs       tests/annotationIdleRecoveryContracts.test.mjs
tests/eraserSaveHistorySyncContracts.test.mjs       tests/phase31/idAtCreationStamping.test.mjs
tests/annotationInitialHydrationSource.test.mjs     tests/performance/overlayPresentationGate.test.mjs
tests/pdfSaveExportContract.test.mjs                src/services/__tests__/regionJournalWiring.test.mjs
tests/excelStaleGuardContracts.test.mjs             src/services/__tests__/excelDeleteGrace.test.mjs
                                                    src/utils/__tests__/surveyMarkerSyncSafety.test.mjs
```
`tests/performance/overlayPresentationGate.test.mjs` is the tricky one: it guards
**both** the dead recorder (`OVERLAY_LAG_RECORDER_*` constants) **and still-live
zoom/scroll safety** ("wheel zoom rejects suspicious 10% reports", "stays capped
below runaway speed", "scroll page-request delay within budget", "wheel scroll gain
follows a smooth curve", "refreshes batched during interaction"). Recorder summary
logic was also split into `src/utils/overlayDebug.js` (2026-05-29), so it's not all
in PDFViewer.

### Method (per block, slow and careful)
1. Pick one dead block (start with the most self-contained; the renderPage cluster
   and the mouse/wheel handler cluster must each be deleted **atomically** — deleting
   one piece leaves broken dependency arrays).
2. Grep its symbols across the whole file for live callers; confirm truly unreachable.
3. Check the 13 test files: does any assert this exact source? If a failing assertion
   guards **dead** code → delete that assertion. If it guards **live** zoom/scroll
   safety → keep the live logic (do NOT delete it to satisfy ponytail).
4. Delete code + matching dead assertions together. Run the full gate. Commit small.

Detailed block-by-block map (items C, 4c renderPage cluster, 4d mouse/wheel cluster,
4f overlay recorder, with original line refs) is in
`debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md` §4 — re-grep every line ref first
(numbers have drifted) and treat it as a floor.

## Priority 2 — Break PDFViewer.jsx into modules

After the dead code is gone, extract cohesive units into small files, leaf-first,
behavior identical, one extraction per commit, full gate after each. Candidate seams
(verify before cutting): the save/export pipeline, the history/undo engine, the
overlay-portal render loop, survey-marker CRUD, paste/clipboard, bookmark/space
helpers, template module handling. Move pure helpers to `src/utils/`, stateful
slices to `src/hooks/`. Mirror the mobile-split discipline: **do not** add memoization
or restructure behavior during an extraction.

## Priority 3 — Same treatment across the codebase

28 files exceed 1,000 lines. Next-largest after PDFViewer:
```
9,652  src/PageAnnotationLayer.jsx        3,431  src/hooks/useAnnotationCloudSync.js
5,331  src/components/SVGAnnotationLayer   3,418  src/utils/pdfAnnotationImporter.js
4,436  src/hooks/useSVGInteraction.js      3,180  src/AppShell.jsx
3,666  src/components/FabricEditCanvas     2,453  src/sidebar/BookmarksPanel.jsx
3,459  src/RegionSelectionTool.jsx         2,352  src/home/TemplatesEditor.jsx
3,450  src/SurveySpacesRail.jsx            2,187  src/viewerShared.js
```
Work the list largest-first, same method. `PageAnnotationLayer.jsx` and the canvases
are high-risk — same minimum-diff care as PDFViewer.

## Ongoing — keep it lean

- Run the **fallow audit** (`npm run audit:dead | audit:dupes | audit:code | audit:health`)
  periodically; validate every finding (raw output is mostly false positives here),
  never auto-delete, gate every deletion. Intentional keeps are recorded in
  `debug/fallow-audit/REPORT.md`.
- Keep **ponytail** active — prefer stdlib/native, delete over add, shortest working diff.
- Already shipped this session toward leanness: ID generators → `crypto.randomUUID()`,
  inline JSON-clone → a standalone `src/utils/deepClone.js`. See git log
  `stdlib(...)` commits on this branch.

## Parked / out of scope (do not start without owner)
- PrintPanel removal (Linear KAL-315) — owner-deferred.
- Mobile `useDocumentState` hook extraction (step 12) — needs an owner device test.
