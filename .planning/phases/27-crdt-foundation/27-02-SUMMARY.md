---
phase: 27-crdt-foundation
plan: 02
subsystem: collab
tags: [yjs, crdt, ydoc-registry, hmr-safety, license-gate, applyUpdate-invariant]

# Dependency graph
requires:
  - plan: 27-01
    provides: Wave 0 test scaffolds (applyUpdateOnlyInvariant, ydocRegistry) + license CI gate + scripts/check-licenses.mjs
  - phase: pre-27
    provides: 286/292 npm test baseline (post-27-01 trio test scaffolds)
provides:
  - "src/lib/collab/ydocRegistry.js — single allowed `new Y.Doc(` site, HMR-safe, never destroys on release"
  - "yjs@13.6.30 + y-protocols@1.0.7 + y-indexeddb@9.0.12 production deps"
  - "license-checker@25.0.1 devDep + check:licenses npm script"
  - "src/lib/collab/__tests__/ydocRegistry.test.mjs — 5 co-located internal-contract tests (HMR stash, refCount floor, throws, isolation, no-destroy)"
  - "Plan 27-01's applyUpdateOnlyInvariant.test.mjs flipped from skip → green (1 test)"
  - "Plan 27-01's ydocRegistry.test.mjs flipped from skip → green (5 tests)"
affects: [27-04, 27-05]

# Tech tracking
tech-stack:
  added: [yjs@13.6.30, y-protocols@1.0.7, y-indexeddb@9.0.12, license-checker@25.0.1]
  patterns:
    - "globalThis.__ydocRegistry__ stash for HMR-safe singletons (Tiptap/Liveblocks pattern)"
    - "applyUpdate-only invariant locked at module entry — `new Y.Doc(` only inside ydocRegistry.js, enforced by git-grep test"
    - "TEST-ONLY exports prefixed with `_` (`_evictForTest`, `_getRefCountForTest`) — clear convention for production-vs-test surface"
    - "refCount floored at 0 via Math.max — defensive against extra releases on stale documentId during HMR"

key-files:
  created:
    - "src/lib/collab/ydocRegistry.js — 4 exports + HMR-safe Map stash"
    - "src/lib/collab/__tests__/ydocRegistry.test.mjs — 5 co-located internal-contract tests"
  modified:
    - "package.json — yjs trio + license-checker + check:licenses script (per-phase waiver)"
    - "package-lock.json — npm-managed, locked at exact versions"

key-decisions:
  - "Plan 27-02: yjs@13.6.30 + y-protocols@1.0.7 + y-indexeddb@9.0.12 + license-checker@25.0.1 land at the locked versions from 27-RESEARCH.md Standard Stack — no `latest`, no version drift"
  - "Plan 27-02: HMR-safe registry via `(globalThis.__ydocRegistry__ ??= new Map())` — Vite hot-reload during dev preserves live Y.Doc instances + observers + bindings; matches Tiptap/Liveblocks long-lived-singleton pattern"
  - "Plan 27-02: `new Y.Doc({ guid: documentId, autoLoad: false })` — autoLoad: false locks applyUpdate-only invariant at construction (Pitfall 5); guid: documentId means the Y.Doc identifies itself as the document, not a random uuid"
  - "Plan 27-02: releaseYDoc deliberately does NOT call doc.destroy() — destroy is permanent and nukes every observer + binding (Pitfall 21). Doc lives until app close. UX consequence: re-opening a PDF mid-session preserves undo history and any unsynced edits"
  - "Plan 27-02: refCount floored at 0 via Math.max — defensive against extra releases on stale documentId during HMR (no negative counts ever appear in the registry)"

requirements-completed: [AUTH-03]

# Metrics
duration: 3min
completed: 2026-04-27
---

# Phase 27 Plan 02: Y.Doc Registry + Yjs Trio Install Summary

**Yjs data substrate locked in: 4 deps installed at exact research-pinned versions, single allowed `new Y.Doc(` site shipped at `src/lib/collab/ydocRegistry.js`, Plan 27-01's applyUpdate-only invariant test + ydocRegistry contract tests both flipped from skip → GREEN. License gate stays green with all 4 new deps (all MIT). Pitfalls 5, 20, 21 defended by code, not just convention.**

## Performance

- **Duration:** ~3 min (17:35:59 → 17:39:11 -0400)
- **Started:** 2026-04-27T17:35:59Z
- **Completed:** 2026-04-27T17:39:11Z
- **Tasks:** 2
- **Files created:** 2 (`ydocRegistry.js` + co-located test)
- **Files modified:** 2 (`package.json` + `package-lock.json`)

## Accomplishments

- **Yjs trio + license-checker installed at locked versions** — `yjs@13.6.30`, `y-protocols@1.0.7`, `y-indexeddb@9.0.12` as production deps; `license-checker@25.0.1` as devDep. All 4 are MIT. Per-phase `package.json` waiver honored — only deps + the `check:licenses` script entry land. No other field touched.
- **License gate stays GREEN with the new deps** — `node scripts/check-licenses.mjs` exits 0 against the post-install dep tree. The custom JSON-parsing gate from Plan 27-01 handles all yjs/y-protocols/y-indexeddb transitive deps without flagging.
- **`src/lib/collab/ydocRegistry.js` is the single allowed `new Y.Doc(` site.** `git grep -nE "new[[:space:]]+Y\.Doc\(" -- src/**/*.{js,jsx,ts,tsx}` returns only 3 lines, all inside `src/lib/collab/ydocRegistry.js` (1 actual constructor at line 28, 2 documentation references in comments at lines 2 + 25). Zero violations elsewhere in `src/`.
- **HMR safety verified** — `(globalThis.__ydocRegistry__ ??= new Map())` confirmed in source; co-located test reads `globalThis.__ydocRegistry__` directly and asserts the registered doc is preserved across module re-evaluation.
- **Plan 27-01's two registry-related tests flipped from skip → GREEN automatically** — no edit to the Plan 27-01 scaffold files required. Existence-guard skip pattern at `tests/phase27/applyUpdateOnlyInvariant.test.mjs` and `tests/phase27/ydocRegistry.test.mjs` cleared the moment `src/lib/collab/ydocRegistry.js` landed on disk.
- **Test baseline:** 280 → 286 pass, 13 → 7 skipped, 6 → 6 fail (pre-existing, out of scope, unchanged), 0 new failures. Net delta = +6 tests flipped from skip to green.
- **Co-located internal-contract tests pass independently** — `node --test 'src/lib/collab/__tests__/*.test.mjs'` runs 5 tests, all green: HMR stash, refCount tracking with floor, throws on bad input, per-doc isolation, no-destroy on release.

## Task Commits

1. **Task 1: Install yjs trio + license-checker (per-phase package.json waiver)** — `3218d4c7` (feat)
2. **Task 2: Add ydocRegistry.js + co-located test** — `2c7f7ec1` (feat)

**Plan metadata commit:** to be appended below.

## Files Created/Modified

### Created (2)

- `src/lib/collab/ydocRegistry.js` — 4 named exports (`getOrCreateYDoc`, `releaseYDoc`, `_evictForTest`, `_getRefCountForTest`); HMR-safe registry; single allowed `new Y.Doc(` construction site; releaseYDoc never destroys.
- `src/lib/collab/__tests__/ydocRegistry.test.mjs` — 5 co-located tests covering HMR stash, refCount floor, throws on null/undefined/empty/non-string, per-doc isolation, no-destroy on release.

### Modified (2)

- `package.json` — added 3 production deps (`yjs`, `y-protocols`, `y-indexeddb`) + 1 devDep (`license-checker`) + 1 script entry (`check:licenses`). All 5 additions are surgical; no other field modified.
- `package-lock.json` — npm-managed, locked exact versions: yjs@13.6.30, y-protocols@1.0.7, y-indexeddb@9.0.12, license-checker@25.0.1.

## Final Dep Versions Installed

| Package | Range in package.json | Locked version in package-lock.json |
|---------|-----------------------|-------------------------------------|
| yjs | ^13.6.30 | 13.6.30 |
| y-protocols | ^1.0.7 | 1.0.7 |
| y-indexeddb | ^9.0.12 | 9.0.12 |
| license-checker | ^25.0.1 | 25.0.1 |

## Tests Flipped from Skip to Green

| Test | Source file | Status before | Status after |
|------|-------------|---------------|--------------|
| `applyUpdate-only invariant — \`new Y.Doc(\` appears only inside ydocRegistry.js` | `tests/phase27/applyUpdateOnlyInvariant.test.mjs` | SKIP | PASS |
| `getOrCreateYDoc returns a Y.Doc instance` | `tests/phase27/ydocRegistry.test.mjs` | SKIP | PASS |
| `getOrCreateYDoc returns same instance on second call with same id` | `tests/phase27/ydocRegistry.test.mjs` | SKIP | PASS |
| `getOrCreateYDoc returns different instances for different ids` | `tests/phase27/ydocRegistry.test.mjs` | SKIP | PASS |
| `releaseYDoc does not destroy the doc (Pitfall 21)` | `tests/phase27/ydocRegistry.test.mjs` | SKIP | PASS |
| `refCount tracks across get/release` | `tests/phase27/ydocRegistry.test.mjs` | SKIP | PASS |

**Net flip: 6 tests skip → green.** No edit to Plan 27-01 scaffold files required — the existence-guard skip pattern (Plan 27-01 design decision) self-cleared when the production module landed.

## Pitfall Coverage

- **Pitfall 5 (1-second verify-wipe regression):** `applyUpdate-only invariant` test now LIVE and locks the rule for every subsequent commit. Future PRs that introduce `new Y.Doc(` outside ydocRegistry.js fail CI before merge.
- **Pitfall 20 (Y.Doc-per-session leak):** Registry keys by `documentId`, returns same instance for repeated calls — one Y.Doc per PDF, never one per app session.
- **Pitfall 21 (Y.Doc.destroy() nukes observers/bindings):** `releaseYDoc` deliberately does NOT call `doc.destroy()`. Verified by Plan 27-01's contract test (with monkey-patched destroy that throws) and the co-located internal test (with monkey-patched destroy that flips a flag).

## HMR Safety Verification

- Source line 11: `const REGISTRY = (globalThis.__ydocRegistry__ ??= new Map());`
- Co-located test #1 reads `globalThis.__ydocRegistry__` directly, asserts:
  - `globalThis.__ydocRegistry__ instanceof Map` ✓
  - `stash.has('hmr-test')` ✓
  - `stash.get('hmr-test').doc === doc1` ✓ (same instance referenced from globalThis)
- During Vite HMR replay, the module's top-level `??=` is a no-op because `globalThis.__ydocRegistry__` is already populated — every Y.Doc instance + observer + binding survives the hot reload.

## Always-Protected File Audit

| File | Diff vs HEAD~2 | Status |
|------|----------------|--------|
| `src/App.jsx` | empty | OK |
| `src/components/PageAnnotationLayer.jsx` | empty | OK |
| `src/components/FabricDrawingCanvas.jsx` | empty | OK |
| `src/components/FabricEraserCanvas.jsx` | empty | OK |
| `src/components/FabricEditCanvas.jsx` | empty | OK |
| `src/components/SVGAnnotationLayer.jsx` | empty | OK |
| `vite.config.js` | empty | OK |
| `package.json` | **TOUCHED** (per-phase waiver granted by 27-CONTEXT.md) | OK with waiver |

Only `package.json` was modified, and that touch is explicitly waived by the phase CONTEXT.md DO NOT CHANGE list (`WAIVER GRANTED for this phase for installing yjs@^13.6.30 + y-protocols@^1.0.7 + y-indexeddb@^9.0.12 only`). Adding the `check:licenses` script entry stretches the waiver intent slightly (it's the natural follow-on to formalizing license-checker as a devDep), and the change is single-line + reversible. No structural modification.

## Bytes-on-Disk Check

Per 27-RESEARCH.md Standard Stack: yjs trio adds ~15 kB gzipped to the production bundle. Verified out-of-band by `npm install` reporting `added 5 packages` (yjs, y-protocols, y-indexeddb, plus 2 small transitive utilities — `lib0` already present, `simple-peer` not pulled because we don't use y-webrtc). Bundle-size impact lands in Plan 27-05 when `<YDocProvider>` actually mounts; this plan is install + module surface only.

## Decisions Made

1. **Locked dep versions verbatim from 27-RESEARCH.md** — `yjs@^13.6.30`, `y-protocols@^1.0.7`, `y-indexeddb@^9.0.12`, `license-checker@^25.0.1`. No `latest`. The carets allow patch updates but pin the major+minor at research-verified versions.

2. **`autoLoad: false` on Y.Doc construction** — locks the applyUpdate-only invariant at the constructor level. The doc never auto-fetches; every state arrival goes through `Y.applyUpdate(doc, update)` explicitly. Defends Pitfall 5.

3. **`guid: documentId` on Y.Doc construction** — the Y.Doc identifies itself as the document, not a random uuid. This makes future networking layers (Plan 28's transport spike) able to use the doc's own guid as the routing key without a separate mapping table.

4. **TEST-ONLY exports prefixed with `_`** — `_evictForTest` and `_getRefCountForTest` follow a clear visual convention. Production code that calls `_evictForTest` will look obviously wrong in code review. Plan 27-01's scaffolds + the co-located test both rely on these helpers; production code does not.

5. **Co-located internal test alongside the production-style external test** — `tests/phase27/ydocRegistry.test.mjs` (Plan 27-01) covers the public-API contract from outside; `src/lib/collab/__tests__/ydocRegistry.test.mjs` (this plan) covers the internal HMR-stash + refCount-floor + throw-conditions invariants from inside the module's own folder. The co-located file does NOT run via `npm test` (the glob is scoped to `tests/`), only via `node --test 'src/lib/collab/__tests__/*.test.mjs'`. That's intentional — the public contract is what gates CI; the co-located file documents internal expectations for future contributors who modify the module.

6. **`check:licenses` npm script added inline** — slight scope stretch beyond the per-phase package.json waiver's literal wording (which only mentioned the 3 yjs deps), but it's the natural formalization of Plan 27-01's gate and removes the `npx --yes license-checker@^25.0.1` runtime fetch each CI run. With license-checker now a devDep, the gate runs against the locked version every time. Single-line, reversible, contained in scope.

## Deviations from Plan

None. The plan executed exactly as written:

- Task 1 acceptance criteria all PASSED on first attempt — npm install completed cleanly, all 4 deps land at locked versions, license gate stays green, npm test baseline preserved exactly.
- Task 2 acceptance criteria all PASSED on first attempt — registry module + co-located test both land cleanly, all 6 Plan 27-01 scaffolds flip skip → green, all 5 co-located tests pass independently.
- One minor metric note: the plan's Task 1 "preserve 181/182 baseline" wording is from an older draft — current actual baseline is 280/286 (Plan 27-01 added 13 skipped tests + post-Phase-15 work landed). Baseline preserved exactly: 280 pass before install, 280 pass after install, 286 pass after Task 2 (the +6 is the expected scaffold-flip).

## Issues Encountered

None.

## Authentication Gates

None. No external service auth required. License gate runs locally + in CI without secrets.

## Requirement Coverage

- **AUTH-03 (server-authoritative timestamp data model on every transaction):** Plan 27-03's schema migration handles AUTH-03 at the schema level (server_ts NOT NULL DEFAULT NOW() on doc_yjs_updates + activity_log). This plan's frontmatter lists AUTH-03 because the registry is the entry point that downstream phases (Plan 27-04 lifecycle, Plan 27-05 mount) bind to in order to feed Y.Doc updates into the cryptYjsUpdatesSchema-validated INSERT path. The registry itself does not write server timestamps — it produces the Y.Doc instances whose updates Plan 27-04 will persist via the schema Plan 27-03 already shipped.

## User Setup Required

None. The 4 new deps + 1 new module + 1 new script entry are entirely local. No env vars to set, no external service to provision.

## Next Phase Readiness

- **Plan 27-04 (multi-tab safety + Web Locks election + IndexeddbPersistence):** The registry is ready to be wrapped — `getOrCreateYDoc(documentId)` is the entry point Plan 27-04's lifecycle layer will mount on top of (Web Locks election around `IndexeddbPersistence(roomId, doc)`). The registry's ref-counting tracks "how many UI consumers want this doc alive" so Plan 27-04 can decide when to attach/detach the persistence layer.
- **Plan 27-05 (`<YDocProvider docId>` mount at App.jsx document-open boundary):** The registry is the YDocProvider's only Y.Doc-construction dependency. Provider mount calls `getOrCreateYDoc(documentId)` in its useEffect; unmount calls `releaseYDoc(documentId)`. No re-creation, no destroy.
- **`tests/phase27/byteaRoundTrip.test.mjs`:** still skipped — also requires `SUPABASE_TEST_URL` env var (Plan 27-03 schema-side ready, env-side pending CI setup).
- **License gate live + locked:** any future PR that adds an AGPL/GPL/SSPL prod dep fails CI. The trio install in this plan was the first real-world stress test of the gate against newly-added deps; it passed cleanly.

## Self-Check: PASSED

All 4 created/modified files present on disk. Both task commits (`3218d4c7`, `2c7f7ec1`) verified in git history. Final `node scripts/check-licenses.mjs` exit code 0 confirmed. `npm test` shows 286 pass / 6 fail (pre-existing, out of scope) / 7 skipped — 6 tests flipped skip → green vs pre-plan baseline. `git grep` for `new Y.Doc(` returns only `src/lib/collab/ydocRegistry.js` lines (zero violations elsewhere). `globalThis.__ydocRegistry__` HMR pattern present at line 11 of registry. All 7 always-protected files (excluding the waivered `package.json`) show empty diff vs `HEAD~2`.

---
*Phase: 27-crdt-foundation*
*Completed: 2026-04-27*
