---
phase: 27-crdt-foundation
plan: 04
subsystem: collab
tags: [yjs, crdt, web-locks, broadcast-channel, indexeddb-persistence, multi-tab-safety, storage-failure-detection, kill-switch, applyUpdate-invariant]

# Dependency graph
requires:
  - plan: 27-01
    provides: Wave 0 storageFailureDetector test scaffold (existence-guard skip pattern) + applyUpdate-only invariant test
  - plan: 27-02
    provides: ydocRegistry.getOrCreateYDoc — the Y.Doc instance attachLifecycle wraps (no new Y.Doc construction in this plan)
provides:
  - "src/lib/collab/storageFailureDetector.js — attachStorageFailureDetector({onState, windowRef?}) returning {detach}; emits 'quota_exceeded' / 'invalid_state' / 'version_mismatch' codes from window.unhandledrejection"
  - "src/lib/collab/crdtFeatureFlag.js — isCRDTEnabled() with 3-tier read order (localStorage > VITE env > default ON)"
  - "src/lib/collab/ydocLifecycle.js — attachLifecycle(ydoc, documentId, {onStorageState}) returning {detach, role}; Web Locks election + IndexeddbPersistence (leader-only) + BroadcastChannel handoff with applyUpdate-only invariant on the loser-tab path"
  - "src/lib/collab/__tests__/storageFailureDetector.test.mjs — 8 co-located tests covering 3 IDB codes + ignore-unrelated + detach + SSR + throws + windowRef"
  - "Plan 27-01's tests/phase27/storageFailureDetector.test.mjs flipped from skip → green (4 tests)"
affects: [27-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Web Locks API leader election — `navigator.locks.request(name, {mode:'exclusive'}, async () => await new Promise(() => {}))` holds the lock for tab lifetime; browser auto-releases on tab close"
    - "BroadcastChannel handoff — leader broadcasts updates, losers apply via `Y.applyUpdate(ydoc, bytes, REMOTE_BC_ORIGIN)`; echo-loop guard via origin equality check"
    - "REMOTE_BC_ORIGIN as `Object.freeze({ source: 'remote-bc' })` — Phase 29 observers short-circuit by reference equality"
    - "IDB error name → stable code mapping (QuotaExceededError → 'quota_exceeded', InvalidStateError → 'invalid_state', VersionError → 'version_mismatch') routed via window.unhandledrejection"
    - "3-tier feature flag read order (localStorage > import.meta.env > default ON) with try/catch around localStorage for private-browsing safety"
    - "options.windowRef test-injection seam — public-API matches the Plan 27-01 scaffold contract without leaking test-only code into production paths"

key-files:
  created:
    - "src/lib/collab/storageFailureDetector.js (74 lines, 1 export — attachStorageFailureDetector)"
    - "src/lib/collab/crdtFeatureFlag.js (49 lines, 1 export — isCRDTEnabled)"
    - "src/lib/collab/ydocLifecycle.js (145 lines, 1 export — attachLifecycle)"
    - "src/lib/collab/__tests__/storageFailureDetector.test.mjs (109 lines, 8 tests)"
  modified:
    - "tests/phase27/storageFailureDetector.test.mjs — destructured { detach } per locked Pattern 4 interface (Rule 3 alignment so scaffold flips skip → green)"

key-decisions:
  - "Plan 27-04: options.windowRef on attachStorageFailureDetector — supports the Plan 27-01 scaffold's fakeWindow injection without forcing globalThis monkey-patching. Resolves to globalThis.window when omitted; SSR-safe falls through to no-op detach when neither is available."
  - "Plan 27-04: Aligned tests/phase27/storageFailureDetector.test.mjs to the 27-RESEARCH.md Pattern 4 locked interface (`{detach}` return shape, not bare detach). The scaffold was written before Pattern 4 finalized; updating destructuring is a Rule 3 blocking fix to satisfy the plan's success criterion that the scaffold flip from skip to green."
  - "Plan 27-04: ydocLifecycle.js comment phrasing — the original draft contained the literal pattern that the applyUpdate-only invariant grep matches. Rewrote the comment to describe the rule without containing the literal pattern (`a Y.Doc directly` instead of `new Y.Doc()`). Defends the invariant test from a false-positive flag on the lifecycle file's own self-documenting comment."
  - "Plan 27-04: Storage detector composes inside the leader-tab path of attachLifecycle, not in the loser-tab path. Loser tabs do not write to IDB (Web Locks election guarantees), so a second detector on the loser side would only catch errors that already fired on the leader. The leader's onStorageState callback is annotated with `role:'leader'` so 27-05's banner UI knows where the failure originated."
  - "Plan 27-04: REMOTE_BC_ORIGIN is `Object.freeze({source:'remote-bc'})` — frozen object means Phase 29 observers can use reference equality to short-circuit echo loops. Same instance is exported from this module so consumers compare to the canonical reference, not a copy."
  - "Plan 27-04: detach() does NOT release the Web Lock. The lock is held by an outstanding navigator.locks.request callback that returns a never-resolving promise. We can't synchronously cancel that from outside. Browser releases on tab close. For test-driven detach (rare in production), the next attachLifecycle on the same documentId queues behind this one until tab close. Acceptable trade-off — Plan 27-05 mounts attachLifecycle once per <YDocProvider> mount, and YDocProvider mounts/unmounts only on PDF switch (not test-frequency)."
  - "Plan 27-04: Feature flag does NOT expose a setter — developers toggle via DevTools `localStorage.setItem('CRDT_LAYER_DISABLED', '1')` directly. Read-only API keeps the kill switch a deliberate human action, not something an accidental code path can flip on a user."

requirements-completed: [AUTH-03]

# Metrics
duration: 4min
completed: 2026-04-27
---

# Phase 27 Plan 04: Multi-Tab Safety + Storage Failure Detection + Kill Switch Summary

**Runtime lifecycle layer landed: Web Locks election gates IndexedDB persistence (Pitfall 2 / yjs/y-indexeddb#25 defended by code), BroadcastChannel handoff broadcasts updates between tabs with applyUpdate-only invariant on the loser path, storage failure detector emits 3 IDB error codes via window.unhandledrejection, and crdtFeatureFlag exposes a 3-tier read-order kill switch. Plan 27-01's storageFailureDetector scaffold (4 tests) flips skip → green; applyUpdate-only invariant remains green; license gate stays green; zero always-protected files touched.**

## Performance

- **Duration:** ~4 min (17:44:01Z → 17:48:41Z)
- **Started:** 2026-04-27T17:44:01Z
- **Completed:** 2026-04-27T17:48:41Z
- **Tasks:** 3
- **Files created:** 4 (`storageFailureDetector.js`, `crdtFeatureFlag.js`, `ydocLifecycle.js`, `__tests__/storageFailureDetector.test.mjs`)
- **Files modified:** 1 (`tests/phase27/storageFailureDetector.test.mjs` — Rule 3 alignment to locked Pattern 4 interface)

## Accomplishments

- **`src/lib/collab/storageFailureDetector.js` ships the IDB error → code mapping** — QuotaExceededError → `'quota_exceeded'`, InvalidStateError → `'invalid_state'`, VersionError → `'version_mismatch'`. Listens on `window.unhandledrejection`. Returns `{detach}` per locked Pattern 4 interface. Accepts `options.windowRef` for test injection without leaking test-only code into production paths. SSR-safe: returns no-op detach when window is undefined.
- **`src/lib/collab/crdtFeatureFlag.js` ships the 3-tier kill switch** — read order `localStorage.CRDT_LAYER_DISABLED='1'` > `VITE_CRDT_LAYER_DISABLED='1'` > default ON. Try/catch around localStorage handles private-browsing throws. Zero `console.*` calls (silent kill switch). Read-only API — no setter exposed; developers toggle via DevTools.
- **`src/lib/collab/ydocLifecycle.js` ships Web Locks election + IndexeddbPersistence + BroadcastChannel** — `attachLifecycle(ydoc, documentId, {onStorageState})` returns `{detach, role}`. Lock named `y-doc-${documentId}`; channel named `y-doc-bc-${documentId}` (per-doc isolation). Leader instantiates exactly one IndexeddbPersistence; losers apply remote updates via `Y.applyUpdate(ydoc, bytes, REMOTE_BC_ORIGIN)` — never via `new Y.Doc()`. Echo-loop guard short-circuits when origin === REMOTE_BC_ORIGIN. SSR-safe via typeof guards on window/navigator.locks/BroadcastChannel.
- **Plan 27-01's `tests/phase27/storageFailureDetector.test.mjs` flips skip → green automatically.** All 4 scaffold tests pass against the new production module: `emits quota_exceeded on QuotaExceededError`, `emits invalid_state on InvalidStateError`, `emits version_mismatch on VersionError`, `detach removes all listeners`. Required one Rule 3 destructuring fix on the scaffold (`const { detach } = ...` instead of `const detach = ...`) to align with the locked `{detach}` return shape per 27-RESEARCH.md Pattern 4.
- **applyUpdate-only invariant remains green.** `git grep -nE "new[[:space:]]+Y\.Doc\(" -- 'src/**/*.{js,jsx,ts,tsx}'` returns ONLY 3 lines, all inside `src/lib/collab/ydocRegistry.js` (1 actual constructor + 2 documentation references in comments). Zero violations elsewhere. The lifecycle file's self-documenting comment was rewritten mid-execution to avoid the literal grep pattern (Rule 3 deviation).
- **License gate stays GREEN.** No new deps in this plan. `node scripts/check-licenses.mjs` exits 0 against the post-Plan-27-02 dep tree.
- **Test baseline preserved.** 286 → 290 pass (4 storage failure scaffolds flipped skip → green), 7 → 3 skipped (same 4 scaffolds), 6 → 6 fail (pre-existing, out of scope). Net delta: +4 tests flipped from skip to green. Co-located tests run independently: `node --test 'src/lib/collab/__tests__/*.test.mjs'` shows 13 pass (8 storageFailureDetector + 5 ydocRegistry).

## Task Commits

1. **Task 1: Create storageFailureDetector.js + co-located unit test** — `5d27d3ed` (feat)
2. **Task 2: Create crdtFeatureFlag.js (kill-switch)** — `5e4bbb76` (feat)
3. **Task 3: Create ydocLifecycle.js (Web Locks election + IndexeddbPersistence + BroadcastChannel)** — `a7015a2f` (feat)

**Plan metadata commit:** to be appended below.

## Files Created/Modified

### Created (4)

- `src/lib/collab/storageFailureDetector.js` — 74 lines. 1 named export: `attachStorageFailureDetector`. Maps 3 IDB error names to stable codes; routes via `window.unhandledrejection`. SSR-safe + windowRef-injectable.
- `src/lib/collab/crdtFeatureFlag.js` — 49 lines. 1 named export: `isCRDTEnabled`. 3-tier read order; SSR-safe; private-browsing safe; silent kill switch.
- `src/lib/collab/ydocLifecycle.js` — 145 lines. 1 named export: `attachLifecycle`. Web Locks election + IndexeddbPersistence (leader-only) + BroadcastChannel handoff (loser side via Y.applyUpdate). Composes with attachStorageFailureDetector inside the leader path.
- `src/lib/collab/__tests__/storageFailureDetector.test.mjs` — 109 lines. 8 tests: 3 IDB code mappings + ignore-unrelated + detach + SSR + throws + windowRef.

### Modified (1)

- `tests/phase27/storageFailureDetector.test.mjs` — destructured `{detach}` in 4 places per locked Pattern 4 interface. Rule 3 blocking fix; scaffold now passes against the production module.

## Pitfall Coverage (this plan adds defense for)

| Pitfall | Where defended |
|---------|----------------|
| **Pitfall 2 — y-indexeddb multi-tab corruption (`yjs/y-indexeddb#25`)** | `attachLifecycle` gates `IndexeddbPersistence` instantiation behind `navigator.locks.request` exclusive lock. Only the leader tab writes to IDB; losers apply updates via BroadcastChannel + `Y.applyUpdate`. Lock holds for tab lifetime via never-resolving promise; auto-releases on tab close; next tab promotes itself automatically. |
| **Pitfall 5 — applyUpdate-only invariant on cross-tab message handoff** | Loser-tab BroadcastChannel handler uses `Y.applyUpdate(ydoc, bytes, REMOTE_BC_ORIGIN)` exclusively. The lifecycle file does not contain a Y.Doc constructor. The applyUpdate-only invariant grep test passes with only ydocRegistry.js matching. |
| **Silent-fallback anti-pattern (CONTEXT.md decision — explicit)** | `attachStorageFailureDetector` surfaces 3 IDB error codes to `onStorageState` callback so 27-05's banner UI can render the user-visible warning. CONTEXT.md: "if local saving is broken the user MUST know — silent fallback is dangerous because if the network drops next, the user loses everything without ever knowing why." |

## Browser-API Dependencies (verified)

- **`navigator.locks.request`** — Web Locks API, Baseline Widely Available since March 2022. Chrome 69+, Firefox 96+, Safari iOS 15.4+. Safe in Capacitor 8 / Electron 25 / web. No polyfill required.
- **`BroadcastChannel`** — Baseline since 2015 across all major browsers.
- **`window.unhandledrejection`** — Baseline since 2015. Fires for unhandled Promise rejections including IndexedDB request failures that bubble through `IDBOpenDBRequest.onerror`.
- **`y-indexeddb` (already installed Plan 27-02)** — provides `IndexeddbPersistence(documentId, ydoc)`.

## SSR Safety Audit

All 3 modules confirmed SSR-safe via `typeof window !== 'undefined'` guards:

- `storageFailureDetector.js`: line 47 — falls through to `{detach: () => {}}` when window unavailable
- `crdtFeatureFlag.js`: line 30 — `typeof window !== 'undefined' && window.localStorage` guard
- `ydocLifecycle.js`: lines 38-43 — guards `window`, `navigator`, `navigator.locks`, `BroadcastChannel`; returns `{detach: () => {}, role: () => 'unknown'}`

Verified by direct node smoke test:
```
$ node -e "import('./src/lib/collab/ydocLifecycle.js').then(...)"
SSR no-op detach: PASS
SSR role: unknown
SSR role unknown: PASS
SSR detach() did not throw: PASS
```

## applyUpdate-only Invariant Audit

```
$ git grep -nE "new[[:space:]]+Y\.Doc\(" -- 'src/**/*.{js,jsx,ts,tsx}'
src/lib/collab/ydocRegistry.js:2:// Phase 27 — Y.Doc registry. THIS IS THE ONE ALLOWED LOCATION FOR `new Y.Doc(`.
src/lib/collab/ydocRegistry.js:25:    // applyUpdate-only invariant: this is the ONLY place `new Y.Doc(` may appear.
src/lib/collab/ydocRegistry.js:28:    const doc = new Y.Doc({ guid: documentId, autoLoad: false });
```

Only ydocRegistry.js matches. The actual constructor is line 28; lines 2 and 25 are documentation references in comments. Zero violations from this plan.

## Always-Protected File Audit

| File | Diff vs HEAD~3 | Status |
|------|----------------|--------|
| `src/App.jsx` | empty | OK |
| `src/components/PageAnnotationLayer.jsx` | empty | OK |
| `src/components/FabricDrawingCanvas.jsx` | empty | OK |
| `src/components/FabricEraserCanvas.jsx` | empty | OK |
| `src/components/FabricEditCanvas.jsx` | empty | OK |
| `src/components/SVGAnnotationLayer.jsx` | empty | OK |
| `package.json` | empty | OK |
| `vite.config.js` | empty | OK |

Zero touches outside `src/lib/collab/` and `tests/phase27/storageFailureDetector.test.mjs`. The Plan 27-02 waiver for package.json was for that plan only; this plan adds zero deps.

## Tests Flipped from Skip to Green

| Test | Source file | Status before | Status after |
|------|-------------|---------------|--------------|
| `emits quota_exceeded on QuotaExceededError` | `tests/phase27/storageFailureDetector.test.mjs` | SKIP | PASS |
| `emits invalid_state on InvalidStateError` | `tests/phase27/storageFailureDetector.test.mjs` | SKIP | PASS |
| `emits version_mismatch on VersionError` | `tests/phase27/storageFailureDetector.test.mjs` | SKIP | PASS |
| `detach removes all listeners` | `tests/phase27/storageFailureDetector.test.mjs` | SKIP | PASS |

**Net flip: 4 tests skip → green.** Required one Rule 3 destructuring fix on the scaffold (4 sites) to match the locked Pattern 4 `{detach}` return shape.

## Test Baseline Detail

| State | Pass | Fail | Skipped | Total |
|-------|------|------|---------|-------|
| Pre-Plan-27-04 (post-27-03) | 286 | 6 | 7 | 299 |
| Post-Plan-27-04 | 290 | 6 | 3 | 299 |
| **Delta** | **+4** | **0** | **−4** | **0** |

Net: 4 tests flipped skip → green, zero new failures, zero regressions on the 6 pre-existing failures (pdfAnnotationImporter et al — all out of scope per phase boundary).

Co-located tests (run separately, not via `npm test`):
```
$ node --test 'src/lib/collab/__tests__/*.test.mjs'
# tests 13
# pass 13
# fail 0
```

8 storageFailureDetector tests (this plan) + 5 ydocRegistry tests (Plan 27-02). All pass independently.

## Decisions Made

1. **`options.windowRef` test injection on `attachStorageFailureDetector`** — Plan 27-01 scaffold passes a fake window object. Implementation accepts `windowRef` and resolves to `globalThis.window` when omitted. This makes the public API explicit about its dependency on the global window without requiring tests to monkey-patch globalThis. Documented inline in the module's JSDoc.

2. **Aligned scaffold to locked Pattern 4 interface (Rule 3 deviation)** — `tests/phase27/storageFailureDetector.test.mjs` was originally written with `const detach = attachStorageFailureDetector(...)`, but the locked Pattern 4 returns `{detach}`. Per Rule 3 (blocking) and the plan's explicit success criterion that the scaffold flip from skip → green, I updated the scaffold's 4 destructuring sites. The Pattern 4 interface is the source of truth (locked by 27-RESEARCH.md); the scaffold was written before Pattern 4 was finalized. No production behavior changed.

3. **Comment rewrite to keep applyUpdate-only invariant green (Rule 3 deviation)** — The original draft of `ydocLifecycle.js` had a self-documenting comment containing the literal `new Y.Doc()` pattern (in backticks). The applyUpdate-only invariant grep test would flag that comment as a violation. Rewrote the comment to describe the rule without containing the pattern: `"This file MUST NOT construct a Y.Doc directly"` instead of `"This file MUST NOT construct \`new Y.Doc()\`"`. The rule is still clearly documented; the grep no longer matches.

4. **Storage detector composes inside the leader-only path** — `attachStorageFailureDetector` is called inside the leader's lock body, not before it. Loser tabs do not write to IDB (Web Locks election guarantees), so they have no IDB error path to surface. The leader's `onStorageState` callback is annotated with `role:'leader'` for 27-05 banner attribution. If a loser tab is later promoted to leader (after the previous leader closes), it re-runs the lock body and re-attaches its own detector at that point. No double-attachment on the loser side.

5. **`REMOTE_BC_ORIGIN` as a frozen object reference, not a string** — Phase 29 observers will short-circuit echo loops by checking `origin === REMOTE_BC_ORIGIN` (reference equality). Using `Object.freeze({source:'remote-bc'})` and exporting the canonical reference means downstream consumers compare identity, not structural equality. Strings would force a string compare on every observer fire — slower, and identical strings from different sources would also match (false-positive short-circuit). Frozen object reference is the right primitive here.

6. **`detach()` cannot release the Web Lock synchronously** — The lock is held by an outstanding `navigator.locks.request` callback whose promise never resolves. We can't cancel that from outside. Browser releases on tab close. For test-driven detach (rare), the next attachLifecycle on the same documentId queues behind this one until tab close. Documented inline. Acceptable trade-off — production mounts/unmounts on PDF switch, not test frequency.

7. **Feature flag is read-only** — No setter exposed. Developers toggle via DevTools `localStorage.setItem('CRDT_LAYER_DISABLED', '1')` and reload. Read-only API keeps the kill switch a deliberate human action — an accidental code path cannot flip the feature off for a user.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Aligned `tests/phase27/storageFailureDetector.test.mjs` to locked Pattern 4 `{detach}` return shape**
- **Found during:** Task 1 (when running the scaffold to confirm flip from skip → green)
- **Issue:** The Plan 27-01 scaffold was written with `const detach = attachStorageFailureDetector(...)`, but 27-RESEARCH.md Pattern 4 locks the return shape to `{detach}`. The plan's `<action>` block also returns `{detach}`. Plan 27-04's success criterion requires the scaffold to flip skip → green, but the un-aligned scaffold would throw `detach is not a function` against the locked interface.
- **Fix:** Updated 4 destructuring sites in the scaffold from `const detach = ...` to `const { detach } = ...`. Production behavior unchanged.
- **Files modified:** `tests/phase27/storageFailureDetector.test.mjs`
- **Commit:** `5d27d3ed` (Task 1)

**2. [Rule 3 - Blocking] Rewrote a self-documenting comment in `ydocLifecycle.js` to avoid the applyUpdate-only invariant grep pattern**
- **Found during:** Task 3 (when running the invariant test against the staged file)
- **Issue:** The plan's `<action>` template comment said `"This file MUST NOT construct \`new Y.Doc()\`"`. The applyUpdate-only invariant test uses `git grep -nE "new[[:space:]]+Y\.Doc\("` which matches that literal pattern in the comment, flagging the lifecycle file as a violation. Plan 27-04's success criterion requires the invariant test to remain green.
- **Fix:** Rewrote the comment to: `"This file MUST NOT construct a Y.Doc directly. ... the only allowed Y.Doc constructor site is ydocRegistry.js"`. The rule is still clearly documented; the grep no longer matches.
- **Files modified:** `src/lib/collab/ydocLifecycle.js` (one comment block)
- **Commit:** `a7015a2f` (Task 3)

Both fixes are Rule 3 (blocking) — without them the plan's success criteria would fail. Neither changed any production behavior; both align documentation/tests to the locked architectural rules.

## Issues Encountered

None beyond the two Rule 3 alignments documented above.

## Authentication Gates

None. No external service auth required. Plan is entirely local module surface + browser-API integration. No env vars touched.

## Requirement Coverage

- **AUTH-03 (server-authoritative timestamp data model on every transaction):** Plan 27-03's schema migration handles AUTH-03 at the schema level. This plan's frontmatter lists AUTH-03 because the lifecycle layer is the runtime entry point that downstream phases (Plan 27-05 mount, Phase 28 transport) bind to in order to feed Y.Doc updates into the cryptYjsUpdatesSchema-validated INSERT path. The lifecycle module itself does not write server timestamps — it produces `onStorageState` events that 27-05's UI surfaces.

## User Setup Required

None. The 3 new modules + 1 co-located test + 1 scaffold alignment are entirely local. No env vars to set, no external service to provision, no migration to run.

## Next Phase Readiness

- **Plan 27-05 (`<YDocProvider docId>` mount in `src/App.jsx` document-open boundary):** Ready. The Provider's `useEffect` will:
  1. Call `getOrCreateYDoc(documentId)` (Plan 27-02) to acquire the Y.Doc
  2. Wrap `attachLifecycle(ydoc, documentId, {onStorageState})` (this plan) for Web Locks + IDB + BC
  3. Surface `onStorageState` events to a banner component for the user-visible warning
  4. Check `isCRDTEnabled()` (this plan) at mount time — if false, skip attachLifecycle entirely
  5. On unmount, call the lifecycle's `detach()` and `releaseYDoc(documentId)`
- **Plan 27-01's BroadcastChannel + Web Locks Playwright scenarios** (currently `test.fixme`): unblocked by Plan 27-05's UI mount. Two-tab scenario can drive real `attachLifecycle` calls via the live App and assert IDB store growth + zero duplicate updates.
- **Phase 28 (transport):** the lifecycle layer's `onStorageState` channel is also where Phase 28's WebSocket transport will surface `{code:'transport_offline'}` etc. Phase 28 extends, doesn't replace.

## Self-Check: PASSED

All 4 created files present on disk. All 3 task commits (`5d27d3ed`, `5e4bbb76`, `a7015a2f`) verified in git history. `npm test` shows 290 pass / 6 fail (pre-existing, out of scope) / 3 skipped — 4 tests flipped skip → green vs pre-plan baseline. `git grep` for `new Y.Doc(` returns only `src/lib/collab/ydocRegistry.js` lines (zero violations from this plan's three new files). `node scripts/check-licenses.mjs` exits 0. All 8 always-protected files (`src/App.jsx`, 5 components under `src/components/`, `package.json`, `vite.config.js`) show empty diff vs `HEAD~3`. Co-located test suite (13 tests) passes independently. SSR smoke test on ydocLifecycle confirms no-op handle when window/navigator are absent.

---
*Phase: 27-crdt-foundation*
*Completed: 2026-04-27*
