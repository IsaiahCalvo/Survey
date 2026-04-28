---
phase: 28-transport-spike-auth-validator
plan: 03
subsystem: collab
tags: [yjs, hocuspocus, websocket, supabase-auth, transport, crdt]

# Dependency graph
requires:
  - phase: 27-crdt-foundation
    provides: Y.Doc registry + applyUpdate-only invariant + ydocLifecycle channel
  - phase: 28-transport-spike-auth-validator (Plan 28-01 — Wave 0 scaffolds)
    provides: HocuspocusYjsProvider.test.mjs scaffold (created inline as Rule 3 fix)
  - phase: 28-transport-spike-auth-validator (Plan 28-02 — interface contract reference)
    provides: SupabaseYjsProvider public contract — mirrored by this plan
provides:
  - Hocuspocus fallback-path Yjs provider with same public contract as SupabaseYjsProvider
  - Dynamic-import safety so missing @hocuspocus/provider is a runtime error, not a build break
  - Token-thunk Pitfall 1 defense (fresh JWT every reconnect via supabase.auth.getSession)
  - Wave 0 scaffold for HocuspocusYjsProvider — 2 tests pass, 3 skipped pending package install
affects: [28-04 (benchmark harness consumes both providers), 28-06 (wire-up uses winning provider)]

# Tech tracking
tech-stack:
  added: [] # Zero new packages — @hocuspocus/provider is a CONDITIONAL waiver gated on Plan 28-04
  patterns:
    - "Async provider factory wrapping a dynamic import — defers package presence check to runtime"
    - "Token-thunk pattern (Hocuspocus token: () => Promise<string>) for fresh-JWT-on-reconnect"
    - "Same disconnect()-only public surface as SupabaseYjsProvider for swappability"

key-files:
  created:
    - src/lib/collab/HocuspocusYjsProvider.js
    - tests/phase28/HocuspocusYjsProvider.test.mjs
  modified: []

key-decisions:
  - "Async factory asymmetry vs SupabaseYjsProvider (sync) — dynamic import requires await; documented for Plan 28-04 / 28-06 to handle"
  - "Dynamic import wrapped in try/catch with explicit conditional-waiver error message — operator gets one actionable instruction, not a stack trace"
  - "Wave 0 test scaffold for HocuspocusYjsProvider created inline as Rule 3 fix because Plan 28-01 had not been executed yet — scaffold matches the spec from 28-01-PLAN.md verbatim"

patterns-established:
  - "Conditional package install via dynamic-import error message — pattern for any future optional dependency in this codebase"
  - "Provider contract mirror — async or sync factory, same disconnect() handle shape, same callback surface (onUpdateRejected, onTransportState)"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 3min
completed: 2026-04-27
---

# Phase 28 Plan 03: HocuspocusYjsProvider Fallback Wrapper Summary

**Hocuspocus-backed Yjs provider mirroring SupabaseYjsProvider's contract via async dynamic import with conditional-waiver error path**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-27T23:56:10Z
- **Completed:** 2026-04-27T23:59:16Z
- **Tasks:** 1 (plus 1 Rule 3 blocking-fix scaffold creation)
- **Files modified:** 2 (both new)

## Accomplishments

- `src/lib/collab/HocuspocusYjsProvider.js` (155 LOC) — fallback-path Hocuspocus wrapper. Async factory with dynamic import of `@hocuspocus/provider`. Returns `{ disconnect }` handle interchangeable with SupabaseYjsProvider's return shape.
- Dynamic import safety — when `@hocuspocus/provider` is not installed (default state per CONTEXT.md conditional waiver), the factory throws a clear runtime error: `"@hocuspocus/provider not installed — Phase 28 conditional package.json waiver gated on spike outcome (Plan 28-04). Install via npm install @hocuspocus/provider@^2.13.6 ONLY if Hocuspocus wins the spike."`
- Pitfall 1 defense reused — token thunk pattern: `token: async () => (await supabase.auth.getSession()).data?.session?.access_token`. Hocuspocus calls this on every reconnect attempt → fresh JWT on every reconnection, no stale-token channel freeze.
- `onStatus` → `onTransportState` wiring (`'connected'`→`'online'`, `'disconnected'`→`'offline'`, `'connecting'` intentionally silent).
- `onAuthenticationFailed` → `onUpdateRejected` wiring (kick UX banner surface mirrors SupabaseYjsProvider's RLS-violation flow).
- applyUpdate-only invariant preserved — no Y.Doc constructor call site added; comment phrasing avoids the regex-matchable form (matches `ydocLifecycle.js` pattern).
- `package.json` byte-untouched — conditional waiver remains gated on Plan 28-04's spike decision.
- Wave 0 scaffold flips: Test 1 (export shape) + Test 5 (missing-package error path) PASS; Tests 2-4 SKIPPED pending `@hocuspocus/provider` install.

## Task Commits

1. **Task 1: HocuspocusYjsProvider wrapper + Wave 0 scaffold** — `82fd7e51` (feat)

## Files Created/Modified

- `src/lib/collab/HocuspocusYjsProvider.js` — Hocuspocus wrapper; async factory `createHocuspocusYjsProvider({ documentId, ydoc, supabase, url, awareness, onUpdateRejected, onTransportState })`. 155 LOC. Dynamic import with explicit missing-package error. Token thunk reads session fresh on every call. `disconnect()` calls `provider.destroy()` idempotently.
- `tests/phase28/HocuspocusYjsProvider.test.mjs` — Wave 0 contract scaffold (192 LOC). 5 tests using the per-test `existsSync` skip-guard pattern from Phase 27. Test 1 verifies export shape (no package required). Tests 2-4 require `@hocuspocus/provider` to construct a real provider instance (skipped by default — conditional waiver). Test 5 verifies the missing-package error path runs cleanly when the package is absent.

## Public Contract Mirror

The wrapper mirrors SupabaseYjsProvider (Plan 28-02) so Plan 28-04's benchmark can swap providers behind a single `--transport=supabase|hocuspocus` flag. Args shape:

```js
// Both providers accept the same args shape:
{ documentId, ydoc, supabase, awareness?, onUpdateRejected?, onTransportState? }
// Hocuspocus wrapper accepts an additional optional `url` arg (Hocuspocus WS URL).

// Both return:
{ disconnect: () => void }
// SupabaseYjsProvider additionally exposes { send, getChannel } — Plan 28-04's
// benchmark reads only the disconnect handle, so the asymmetry is contractual.
```

**Async asymmetry (documented for downstream plans):** SupabaseYjsProvider's factory is sync; HocuspocusYjsProvider's is async (the dynamic import requires `await`). Plan 28-04's benchmark and Plan 28-06's wire-up MUST `await` whichever factory they pick. The plan's decision tree is wrapped in async by default, so this asymmetry is a one-line difference at the call site.

## Pitfall 1 Defense Reuse

SupabaseYjsProvider relies on `authSessionBridge.attachAuthSessionBridge()` (Plan 28-02) which hooks `TOKEN_REFRESHED` → `supabase.realtime.setAuth(freshToken)`.

HocuspocusYjsProvider achieves the same defense via a different surface: Hocuspocus's `token: () => Promise<string>` thunk pattern. The thunk is called on every reconnect attempt by Hocuspocus internally, so a refreshed JWT is always picked up. No app-level timer needed (zero `setInterval` / `setTimeout` in the wrapper, matching the authSessionBridge pattern).

Both surfaces converge on the same outcome: a JWT-expiry mid-session does NOT freeze the live channel. The user's "Linear / Notion / Figma silent refresh" decision (CONTEXT.md) is honored regardless of which provider wins the spike.

## Decisions Made

- **Async factory asymmetry accepted.** SupabaseYjsProvider is sync; HocuspocusYjsProvider is async because of the dynamic import. Documented in the file's JSDoc and in this summary so Plan 28-04's harness wraps both calls in `await` consistently.
- **Wave 0 scaffold inline rather than blocking on Plan 28-01.** Plan 28-01 (Wave 0 scaffold plan) had not been executed at the time this plan ran, so `tests/phase28/HocuspocusYjsProvider.test.mjs` did not exist. Per Rule 3 (blocking issue auto-fix), the scaffold was created inline matching the spec from 28-01-PLAN.md exactly. When Plan 28-01 eventually executes, its task will need to detect this scaffold already exists (or merge cleanly).
- **Test 5 — missing-package error path is not skip-guarded by `HAS_HOCUSPOCUS`.** It uses an inverted guard: it runs ONLY when `@hocuspocus/provider` is absent (i.e. the default state during the spike). This means the error-path coverage is exercised by the default Wave 0 run; only Tests 2-4 require the package install to flip from skip→green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Wave 0 test scaffold for HocuspocusYjsProvider did not exist**
- **Found during:** Task 1 (verification setup)
- **Issue:** Plan 28-03's `<verify>` block runs `node --test tests/phase28/HocuspocusYjsProvider.test.mjs`, but Plan 28-01 (which owns the Wave 0 scaffolds) had not been executed yet. Running `node --test` against a missing file exits with code 1, blocking verification.
- **Fix:** Created `tests/phase28/HocuspocusYjsProvider.test.mjs` inline matching the spec from 28-01-PLAN.md Task 1 verbatim — 5 tests using `existsSync` skip-guard pattern from Phase 27 Plan 27-01. Tests 2-4 use the dual `HAS_HOCUSPOCUS` guard since constructing a real provider needs the package; Tests 1 + 5 run without the package (export shape + missing-package error path).
- **Files modified:** `tests/phase28/HocuspocusYjsProvider.test.mjs` (new file, 192 LOC)
- **Verification:** `node --test tests/phase28/HocuspocusYjsProvider.test.mjs` → 5 tests, 2 pass, 3 skipped, 0 fail
- **Committed in:** `82fd7e51` (Task 1 commit)
- **Note for Plan 28-01:** When Plan 28-01 executes, this scaffold already exists. Plan 28-01's task should `git status` first and skip recreating this file, or merge cleanly if any spec drift is found (the inline scaffold matches 28-01-PLAN.md spec exactly, so no merge conflict expected).

**2. [Rule 1 — Bug] applyUpdate-only invariant grep matched the comment**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** First draft of the file's header comment used the literal phrase `` `new Y.Doc(` `` to document the invariant. The `applyUpdateOnlyInvariant.test.mjs` grep then matched the comment, returning 1 instead of 0.
- **Fix:** Rephrased the comment to use `"construct a Y.Doc directly"` — matches the existing `ydocLifecycle.js` phrasing pattern, doesn't trigger the regex.
- **Files modified:** `src/lib/collab/HocuspocusYjsProvider.js` (header comment edit before commit)
- **Verification:** `grep -c "new Y.Doc(" src/lib/collab/HocuspocusYjsProvider.js` returns 0; `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` exits 0
- **Committed in:** `82fd7e51` (Task 1 commit, single-pass; no prior commit had the bug)

**3. [Rule 1 — Bug] Test 5 skip-guard precedence**
- **Found during:** Task 1 (initial scaffold dry-run)
- **Issue:** First draft used `targetMissingReason || HAS_HOCUSPOCUS ? '...' : false` for Test 5's skip. JavaScript precedence parsed this as `targetMissingReason || (HAS_HOCUSPOCUS ? '...' : false)`, so when `targetMissingReason` was truthy, it would fall through to the wrong branch and report Test 5 as "@hocuspocus/provider IS installed" even though neither the target nor the package was present.
- **Fix:** Rewrote as a nested ternary: `targetMissingReason ? targetMissingReason : HAS_HOCUSPOCUS ? '...' : false`. Now skip reasons report correctly for all 4 combinations of (target present/absent × package present/absent).
- **Files modified:** `tests/phase28/HocuspocusYjsProvider.test.mjs`
- **Verification:** `node --test tests/phase28/HocuspocusYjsProvider.test.mjs` → 5 tests, 2 pass, 3 skipped, 0 fail with correct skip reasons
- **Committed in:** `82fd7e51` (Task 1 commit, single-pass; bug fixed before commit)

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** All three were necessary for the verification step to pass. No scope creep — the Wave 0 scaffold was a missing prerequisite owned by Plan 28-01, and the two bugs were caught and fixed before commit. The plan's primary deliverable (HocuspocusYjsProvider.js wrapper) shipped exactly per spec.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None. The conditional package.json waiver for `@hocuspocus/provider` is **NOT** activated by this plan. Per CONTEXT.md, that waiver is granted ONLY IF Hocuspocus wins the spike (Plan 28-04 decision). Until then:

- Operators do NOT need to install `@hocuspocus/provider`
- The wrapper file is dormant — `src/App.jsx` does not import it
- The default-path benchmark (Plan 28-04) runs against SupabaseYjsProvider only when `@hocuspocus/provider` is missing
- If the benchmark runs both prototypes, the operator installs `@hocuspocus/provider` ahead of the run (this is a temporary local install that may be reverted if SupabaseYjsProvider wins)

## Next Phase Readiness

- **Plan 28-04 (benchmark) unblocked** — both providers now exist (Plan 28-02 SupabaseYjsProvider + Plan 28-03 HocuspocusYjsProvider) with mirrored contracts. The benchmark harness can call `await createHocuspocusYjsProvider(args)` or `createSupabaseYjsProvider(args)` based on the `--transport` flag.
- **Plan 28-04 must handle async asymmetry** — SupabaseYjsProvider is sync; HocuspocusYjsProvider is async. The harness wraps both call sites in `await` (no-op for the sync factory).
- **Plan 28-04 must install `@hocuspocus/provider` locally** before running the Hocuspocus arm of the benchmark. The waiver is conditional — install for the bake-off, decide on permanent install based on the result.
- **Always-Protected lane preserved** — zero touches to `App.jsx`, `package.json`, `vite.config.js`, PAL, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, SVGAnnotationLayer.
- **Phase 27 baseline preserved** — applyUpdate-only invariant still green.

## Self-Check: PASSED

- File `src/lib/collab/HocuspocusYjsProvider.js` exists and is committed at `82fd7e51`
- File `tests/phase28/HocuspocusYjsProvider.test.mjs` exists and is committed at `82fd7e51`
- Commit `82fd7e51` exists in `git log`
- All acceptance criteria from PLAN.md verified:
  - `grep -c "export async function createHocuspocusYjsProvider"` = 1
  - `grep -c "await import('@hocuspocus/provider')"` = 1
  - `grep -c "Phase 28 conditional package.json waiver"` = 1
  - `grep -c "new Y.Doc("` = 0
  - `grep -c "supabase.auth.getSession"` = 2 (header comment + thunk)
  - `grep -c "onTransportState?"` = 2 (online + offline)
  - `grep -c "onAuthenticationFailed"` = 3 (header comment + handler decl + handler body)
  - `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` exits 0
  - `node --test tests/phase28/HocuspocusYjsProvider.test.mjs` exits 0 (2 pass, 3 skipped, 0 fail)
  - `git diff --stat src/App.jsx ... package.json vite.config.js` is empty

---
*Phase: 28-transport-spike-auth-validator*
*Completed: 2026-04-27*
