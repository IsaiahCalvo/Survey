# Handoff — Full-codebase optimization (security batch is next)

**Generated:** 2026-06-05. **Branch:** `main`, local only, **NOT pushed** (direct-to-main; push only on user's say-so). **Baseline:** `node scripts/run-node-tests.mjs` = 888 pass / 0 fail / 6 skip; `npx vite build` clean.

## What this session landed (all local main, unpushed)
- React-perf passes 4 + a self-driving auto-loop: ~30+ mechanical, behavior-preserving wins (lazy-init useState, Set lookups, single-pass loops, memoization, hoisted constants, content-visibility, lazy-loaded SearchTextPanel + CompactColorPicker).
- **Biggest perf win:** pdf.js deferred out of the first-paint chunk (entry ~2,345KB → ~1,576KB; gzip 666→467). Lazy `loadPdfjs()` helper in `src/utils/pdfWorkerConfig.js`; consumers call it before `getDocument`.
- Bounded-concurrency parallel per-page annotation import (`src/utils/pdfAnnotationImporter.js`) — user live-tested, marks intact.
- Upload date fix (optimistic row stamped `created_at`/`updated_at`; ledger date parse uses `''` fallback so a missing date never renders as Jan 1 2000).
- **Salvaged security fixes (reviewed + re-landed):** OAuth hash injection now `JSON.stringify`; `shell:openExternal` protocol allowlist (all callers are https). Plus first-match-correct survey-marker name+type lookup Map.

## CRITICAL CONTEXT — the Haiku-loop incident (don't repeat)
The FIRST auto-loop ran its audit+verify on Haiku (the `Explore` agentType's default model). It drifted out of scope and blind-applied: 3 Electron security rewrites, an **unsafe** CRDT parallelization (two fan-outs share the `'annotations'` Y.Map — a real race), and a marker lookup with a first-vs-last-match bug. **All 6 were reverted.** Lesson now enforced: audit/verify pinned to **Sonnet** (never Haiku for judgment); apply on **Opus**; high-risk files hard-blocklisted; only mechanical perf wins auto-apply; everything sensitive is surfaced for human review + live test. See memories `feedback_prefer_sonnet_over_haiku`, `project_full_optimization_scope`.

## NEXT SESSION — start here
**The deliverable is `.planning/optimization/FINDINGS.md`** — 46 surfaced findings across security, IPC, collaboration, interaction (zoom/pan/scroll), rendering, db-sync, react-perf. Ranked by severity. NONE auto-applied; each needs review + live test.

**Do SECURITY first (most serious, mostly clear fixes):**
1. **Rotate the exposed token immediately** — `VITE_GITHUB_LOG_TOKEN` is baked into the shipped renderer bundle (`SaveLogBanner.jsx`). Rotate it, then move log upload behind the main process / out of the client bundle.
2. **Lock down filesystem IPC** — `fs:readFile/writeFile/appendFile/listDir/writeFileAtomic` in `electron-main.js` accept arbitrary renderer-supplied paths. Add a path allowlist/validation.
3. **`shell:openPath` command injection (CRITICAL)** — macOS path goes through `exec('open "...")` with quote-only escaping. Replace with `shell.openPath` (verify macOS file-open still works — that was a deliberate reliability workaround) or `execFile`.
4. `oauth:openWindow` loads any renderer URL without protocol validation; `setWindowOpenHandler` allowlist is bypassable; the continuous console log persists OAuth tokens to disk. Also a hardcoded dev path `/Users/isaiahcalvo/Desktop/...` is written on every Save Log (`AppShell.jsx`).

**Then:** IPC (sync `readFileSync` blocks main; `statSync` per console line; PDF bytes sent as plain Array not Uint8Array), then interaction smoothness (wheel handler does a live `querySelector` every tick; RegionSelectionTool does `getBoundingClientRect` + setState per pointermove and re-attaches listeners every drag frame), then collaboration races (high-risk — live-test with two users), then rendering + db-sync.

## RULES / INVARIANTS
- Sonnet for audit/verify, Opus for apply. Never Haiku for judgment.
- DO-NOT-AUTO-EDIT (surface only): CRDT/collab (`useAnnotationCloudSync.js`, `YDocProvider.jsx`, `crdtBackfill.js`), `electron-main.js`, `preload.js`, the load-bearing viewer files, plus all uncommitted WIP. Edit these only by hand, min-diff, with `npm test` + build + a live test.
- Commit with explicit paths only (never `git add -A`) — the pdf.js-cutover WIP (`viewerShared.js` engine selector, `main.jsx`, prototypes, `SearchTextPanel.jsx`, `Pdfjs*` components) must stay uncommitted. `viewerShared.js` needs partial staging (it carries WIP + committed changes).
- Local main only; push solely on the user's say-so.

## TOOLING (reusable)
- `.planning/optimization/full-optimization-loop.mjs` — the broad audit→verify→(auto-apply perf | surface sensitive) loop. Re-run via `Workflow({scriptPath})` to find more; it auto-applies mechanical perf wins and re-surfaces the rest. Pause any running loop before doing manual edits/commits (shared working tree).
- `.planning/react-perf/LEDGER.md` — full perf history; `agent-cli/` drives the real backend headlessly.

## RESUME
1. Read this + `.planning/optimization/FINDINGS.md`.
2. Confirm baseline: `node scripts/run-node-tests.mjs` (888/0/6) + `npx vite build`.
3. Start the security batch (rotate token first), one fix at a time, gate each on tests+build, commit local, live-test the Electron-facing ones with the user before trusting.
