# Handoff — Safety-Net-First Extraction of PDFViewer's Load-Bearing Engines

_Owner directive 2026-07-01: "Break the heavy machinery out of the giant files to make them
stronger — but do it the safe way. First build automated tests that prove the risky behaviors
still work, confirm those tests actually pass (fix them until they do), THEN extract the engines
one step at a time, testing each step. Fully autonomous — no owner involvement, no owner testing."_

This is the follow-on to `HANDOFF-strengthen-codebase.md`. That campaign finished Priority 1
(all dead zoom/scroll code removed) and the CLEAN, safely-verifiable extractions from `PDFViewer.jsx`
and `pdfAnnotationImporter.js`. It then hit a hard, honest ceiling: the remaining bulk of the giant
files is **load-bearing engines** (zoom/scale lifecycle, per-page overlay portal render loop,
undo/redo + save history, Excel sync/import/export, cloud realtime sync) that have **no behavioral
test coverage**, so extracting them blind would violate "green means green." This handoff removes that
blocker by building the coverage first, then does the extractions behind it.

Full context + prior tally: `debug/defragilize/PROGRESS.md`. Seam map: workflow `wtxzbbu8u` (see that
ledger). Branch: `claude/magical-raman-95374e` (keep working here; do NOT push — land on the branch).

---

## RUN MODE — fully autonomous, do not stop, do not ask, owner never tests

- **No owner involvement of any kind.** Never ask the owner to test, decide, or approve mid-run.
  Verify everything yourself with the gates below. Do NOT add a React hook/component test framework
  (that would need an owner waiver) — the whole safety net is built on the EXISTING `agent-cli`
  Playwright end-to-end pattern (no new dependency) + node unit tests. This keeps the run unattended.
- **Phase A before Phase B, no exceptions.** Build/confirm the safety net FIRST. Do not extract any
  engine until the tests that would catch its regression exist and pass reliably.
- **Honest tests only.** Every new test must actually drive the real behavior and FAIL if that
  behavior breaks. No tautologies, no `assert(true)`, no skipping the hard path, no deleting a failing
  test to go green. If a test you write is flaky or wrong, FIX IT until it reliably passes for the
  right reason — do not weaken the assertion to make red turn green.
- **Green means green.** Never mark a step done while build, node tests, or the app e2e are failing.
  If a step breaks something, fix it or revert that step.
- **One step at a time, commit each.** Small commits, one logical change each, full gate after each.
- Only stop for a TRUE blocker you cannot resolve any other way. There are no owner-gated items in
  this plan — if you think you found one, re-read this doc; the intent is total autonomy.

## Verification model + environment (learned the hard way — read this)

Gates, run after EVERY step:
- `npx vite build`
- `node scripts/run-node-tests.mjs`  (baseline this session: **1716 pass / 0 fail / 84 skip**)
- The relevant `agent-cli` e2e flow(s) for what you touched (see Phase A inventory).

Dev server for the e2e:
- Copy `.env .env.local .env.test` from the repo root into the worktree first (they're gitignored and
  don't carry into a worktree).
- Start the worktree server on a FREE port and point the e2e at it:
  `npx vite --port 5185 --strictPort` then `APP_URL=http://localhost:5185 node agent-cli/<script>.mjs`.
  A stale dev server from another directory may squat :5180 — do NOT trust it; use your own port.
- **Cold-compile false-fail:** a fresh dev server JIT-compiles the ~1.5MB viewer chunk on the first
  doc-open after a build, so the first (sometimes the first two) `render-smoke`/e2e runs can false-fail
  "blank canvas" or time out on a control selector. Warm the path (run it once), then re-run; a
  PERSISTENT fail across ~3 warm attempts is real, a first-run blank is not.
- **graphify CPU contention:** each `git commit` fires a background `graphify update` rebuild that can
  starve the dev-server compile and make a smoke run false-fail. If a smoke fails right after a commit,
  re-run it standalone once the machine settles before believing it.
- **Test backend hygiene:** the roundtrip/sync/Excel e2e hit a REAL Supabase backend on throwaway
  documents. Confirm they target the dedicated TEST project (`.env.test` / survey-test), NEVER the
  production "Survey" project. Do not write test data to production. (See memory: survey-test project,
  no-Docker-use-cloud-Supabase.)

## Correctness invariants — NEVER violate during any extraction (verbatim moves preserve them)

- Container-aware canvas sizing: measure `containerEl.offsetWidth / pageSize.width`, never `pageSize*scale`.
- Single-name `fontFamily` in Fabric (never a CSS fallback stack).
- The `zoomGeneration` signal contract (fires at zoom-start; canvases auto-commit on it).
- SVG viewBox owns all zoom scaling — no JavaScript zoom coordination in `SVGAnnotationLayer.jsx`.
Extractions are VERBATIM moves — move code, do not restructure or add memoization. If a move would
touch any invariant, keep that logic exactly as-is inside the moved unit.

---

## PHASE A — Build & confirm the safety net (do this fully before Phase B)

### A0. Fix `viewerShared.js` node-importability (enables unit-testing shared pure logic)
`src/viewerShared.js` can't be imported in node because it (and likely its dep subgraph) use
extensionless local imports (e.g. `import ... from './utils/annotationPreviewDiag'` — node ESM needs
`.js`). Add the correct explicit extension (`.js`/`.jsx`) to every relative import in `viewerShared.js`
AND walk the transitive local imports it pulls in, fixing each until `node -e "import('./src/viewerShared.js')"`
resolves. Vite is unaffected (it resolves both forms); this only unlocks node. Gate: build + node tests
must stay green. Commit. (This unblocks tested extraction of the space CSV/PDF export and other
viewerShared-dependent pure logic later.)

### A1. Inventory what's ALREADY covered (do not rebuild these — just confirm they pass)
Run each and confirm PASS (warm-retry per the cold-compile note). These are your existing net:
- Save → reopen roundtrip: `agent-cli/roundtrip-save-reopen.mjs` (PRIMARY GATE), `reupload-survival.mjs` (SAFETY NET).
- Durable sync path: `agent-cli/yjs-roundtrip.mjs`, `agent-cli/survey-roundtrip.mjs`.
- Excel data-loss guard: `agent-cli/excel-corruption-e2e.mjs`. Import-once: `agent-cli/import-once-roundtrip.mjs`.
- Version history / lock: `agent-cli/version-history-e2e.mjs`, `agent-cli/lock-document-e2e.mjs`.
- Callouts: `agent-cli/callout-e2e.mjs`, `agent-cli/callout-interaction-e2e.mjs`.
- Render: `agent-cli/render-smoke.mjs`. Idle/sleep recovery: `regress-idle-disappearance.mjs`, `repro-sleep-wake.mjs`.
If any is red for a real reason, treat that as a pre-existing bug: fix it (or, if genuinely
environmental, document precisely why) before relying on it as a gate.

### A2. Fill the coverage GAPS (write new `agent-cli/*-e2e.mjs`, same Playwright pattern)
These risky behaviors are NOT yet covered and each engine you'll extract in Phase B needs its guard.
Write one honest e2e per gap (drive the real app, assert the observable outcome, fail if it breaks):
1. **Undo / redo** — draw a shape, undo (Cmd+Z) → gone; redo (Cmd+Shift+Z) → back. Cover all four redo
   chords if cheap (see memory: undo/redo hotkeys). Guards the history engine extraction.
2. **Survey-marker CRUD** — create a survey marker, edit its name, delete it; assert each in the panel
   and on the page. Guards survey-marker + cloud-sync extraction.
3. **Bookmarks / spaces** — add a bookmark/space, reorder, delete; assert persistence across reopen.
   Guards bookmark/space helper extraction.
4. **Form-field edit persistence** — type into a PDF form field, blur, reopen the doc → value persists.
   Guards the already-extracted `usePdfjsFormFieldPersistence` and the save pipeline.
Note on ZOOM: synthetic wheel events CANNOT drive the real cursor-zoom path (memory: Playwright zoom
limitation) — do NOT fake a zoom e2e. Zoom is guarded instead by the existing `zoomController` node
unit tests + `render-smoke` (renders at scale) + strict verbatim-only moves. Keep zoom extractions the
most conservative of all.

### A3. Assemble the full gate
Add a small `agent-cli/full-e2e.mjs` (or a shell runner) that runs the whole suite (existing + new)
and exits non-zero if any fail, with the warm-retry built in. This is the Phase B per-step gate.
Confirm the ENTIRE suite passes reliably (run it twice back-to-back to shake out flakiness; fix any
flaky flow until it's reliably green for the right reason). Commit the net. Only now start Phase B.

---

## PHASE B — Extract the load-bearing engines, one at a time, behind the net

Method per engine (same discipline that made Priority 1 safe):
1. Map the slice precisely (a read-only investigation workflow is ideal): exact current line range,
   every state/ref/effect/callback member, every EXTERNAL reference (things outside the slice that use
   it), and every one of the source-assertion tests / invariants it touches.
2. Adversarially verify the map (a second agent tries to prove the extraction unsafe: a missed caller,
   a broken dep array, a hook-order change, an invariant touched, a source-assertion string removed).
3. Extract VERBATIM into `src/hooks/useX.js` (stateful) or `src/utils/x.js` (pure). Pull the bug-prone
   PURE logic into exported, node-tested functions; move the wiring unchanged. Keep hook call order
   identical (the slice's hooks must be contiguous; the new hook calls them in the same order).
4. Run the FULL gate (build + node tests + the full e2e suite incl. the specific new guard). Commit.
   If anything is red, fix or revert — never paper over.

Suggested order (safest / best-covered first; each has its Phase-A guard):
1. **Bookmark / space helpers** — well-covered by the new bookmarks e2e; relatively self-contained.
2. **Survey-marker CRUD** — behind the survey-marker e2e + existing survey-roundtrip.
3. **Undo/redo history engine** — behind the undo/redo e2e; large + load-bearing, go slow, small slices.
4. **Save / export pipeline** — behind roundtrip-save-reopen + reupload-survival + version-history.
5. **Excel sync/import/export** — behind excel-corruption + import-once; touches the linked-Excel engine,
   extract only cohesive sub-units.
6. **Cloud realtime sync** — behind yjs-roundtrip; adversarially verify TWICE (CRDT/realtime — see memory
   "adversarial verify realtime": ≥2 adversarial passes + code review before shipping).
7. **Overlay portal render loop / zoom-scale lifecycle** — LAST and most conservative. Weakest e2e
   coverage (zoom limitation). Verbatim-only, tiny slices, lean on unit tests + render-smoke, and if a
   slice can't be honestly verified, DOCUMENT it as still-deferred rather than shipping it blind.

Also opportunistically finish the CLEAN P2/P3 items unblocked by A0 (e.g. the space CSV/PDF export
→ tested util, once viewerShared is node-importable) and continue P3 on the tractable UI panels
(TemplatesEditor, BookmarksPanel, SearchTextPanel, Dashboard) as mechanical sub-component splits once a
panel-level smoke flow exists to catch prop-wiring regressions.

## "Done" =
Every engine that CAN be honestly guarded is extracted behind a passing test that would fail if it
broke; PDFViewer.jsx (and the other giant files) are materially smaller with cohesive engines in their
own modules; the full suite (build + node tests + full e2e) is green; and anything genuinely
un-guardable is explicitly documented as deferred with the reason — not shipped blind.

## Guardrails carried forward
- Min-viable diff in `PDFViewer.jsx` / `PageAnnotationLayer.jsx` / the Fabric canvases /
  `SVGAnnotationLayer.jsx`; never refactor opportunistically while in there.
- Parked / out of scope (do not start): PrintPanel removal (KAL-315); the manual overlay-lag recorder
  tooling (harmless + entangled; the broken auto-recorder was already removed).
- Land on the branch; push only after owner approval (not required to complete the work).
