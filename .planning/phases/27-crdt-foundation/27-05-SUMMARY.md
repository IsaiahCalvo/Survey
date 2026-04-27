---
phase: 27-crdt-foundation
plan: 05
subsystem: collab-react-surface
tags: [yjs, crdt, react-context, react-hook, banner, accessibility, fade-in, app-jsx-waiver, document-open-boundary, applyUpdate-invariant, license-gate]

# Dependency graph
requires:
  - plan: 27-02
    provides: ydocRegistry.getOrCreateYDoc + releaseYDoc (Y.Doc construction stays inside the registry — applyUpdate-only invariant locked at the constructor site)
  - plan: 27-04
    provides: ydocLifecycle.attachLifecycle (Web Locks election + IndexeddbPersistence + BroadcastChannel handoff + storageFailureDetector composition) + crdtFeatureFlag.isCRDTEnabled (3-tier kill switch read order)
provides:
  - "src/components/collab/YDocProvider.jsx — React context provider mounting ydocLifecycle for the active doc; null-shaped value when CRDT kill switch is active or docId is unknown; key={docId} guarantees clean state reset on PDF switch"
  - "src/hooks/useYDoc.js — context-consumer hook returning the locked shape {ydoc, isHydrating, storageState, role, isCRDTEnabled, dismissBanner}; frozen NULL_VALUE returned outside the provider"
  - "src/components/collab/StorageFailureBanner.jsx — banner per 27-UI-SPEC.md Surface 2 with all 4 copy variants (quota_exceeded / invalid_state / version_mismatch / blocked); role=alert + aria-live=polite + aria-label='Dismiss banner'; inline 16x16 warning SVG matching AuthModal/UserMenu pattern"
  - "src/components/collab/StorageFailureBanner.css — banner layout + sticky positioning + .svg-annotations--hydrating/--hydrated fade-in keyframes (220ms cubic-bezier(0,0,0.2,1)) for the SVGAnnotationLayer wrapper opt-in"
  - "src/App.jsx — YDocProvider mount at the document-open boundary (per-phase narrow waiver: 1 import + 1 JSX wrap around <PDFViewer> with docId={tab.file?.id})"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React context-as-borrowed-handle — provider acquires Y.Doc from a module-scoped registry rather than constructing one; HMR-safe because the registry survives module reload"
    - "key={docId} on the inner provider component — guarantees a clean hooks tree on PDF switch (state resets, no stale isHydrating/storageState bleed)"
    - "Frozen null-shape context — useYDoc() consumers can call hooks unconditionally and render gracefully when CRDT layer is off (kill switch active or no docId)"
    - "Web Locks role polling — 100ms interval for first few seconds until role becomes 'leader' or 'loser', then auto-clears; avoids re-attaching listeners on resolution"
    - "500ms hydration timeout fallback — caps perceived wait per 27-UI-SPEC.md when IndexeddbPersistence 'synced' never fires (fresh doc with no cached state)"
    - "Action-link reload-only behavior — version_mismatch / blocked → window.location.reload(); quota_exceeded / invalid_state → open browser-storage help docs (placeholder URL until Phase 33+ project help-doc surface)"
    - "Banner copy isolation — HEADING + SECONDARY constants shared across all 4 codes per 27-UI-SPEC.md; per-code body+action_link in single COPY map; defensive return null on unrecognized code"
    - "Wrapper-div fade-in opt-in — fade-in CSS classes live in the banner stylesheet so any wrapper can flip them on isHydrating without modifying SVGAnnotationLayer.jsx (Always-Protected); the wrapper-div itself is intentionally deferred (out of Plan 27-05's narrow waiver scope)"
    - "App.jsx narrow-waiver discipline — 1 import + 1 JSX wrap around <PDFViewer> at the outermost point where tab.file becomes the active document; zero logic changes, zero useEffect modifications, zero state additions, zoomGeneration signal preserved"

key-files:
  created:
    - "src/components/collab/YDocProvider.jsx (157 lines, 3 exports — YDocProvider default + named + YDocContext)"
    - "src/components/collab/StorageFailureBanner.jsx (113 lines, 2 exports — StorageFailureBanner default + named)"
    - "src/components/collab/StorageFailureBanner.css (161 lines, 0 exports — banner layout + fade-in classes)"
    - "src/hooks/useYDoc.js (38 lines, 2 exports — useYDoc default + named)"
  modified:
    - "src/App.jsx — per-phase narrow waiver: 1 import line (line 80, after SyncfusionPDFContainer) + 1 JSX wrap around <PDFViewer> at line 38607 with docId={tab.file?.id}; +27 / -24 lines (24 deletions = re-indentation of wrapped block, no logic changes)"

key-decisions:
  - "Plan 27-05: Mount point chosen as the OUTERMOST <PDFViewer> in App.jsx (line 38607), wrapping with <YDocProvider docId={tab.file?.id}>, NOT around <SyncfusionPDFContainer> at line 28519. Plan permitted both options ('plus the JSX render that conditionally renders the SyncfusionPDFContainer'); outer mount means the entire viewer subtree (PDFSidebar, toolbars, annotation layers, banner host) sits inside Y.Doc context — preferred per the plan's 'attach as early as possible after pdfFile.id becomes truthy' guidance."
  - "Plan 27-05: Outer YDocProvider component = pure routing branch (kill switch / null docId) — does NOT call useEffect; only the inner YDocProviderInner owns stateful hooks. React rules-of-hooks safe: kill-switch / null-docId branch returns a null-shaped frozen context without ever calling useEffect. key={docId} on the inner component forces a fresh mount on PDF switch."
  - "Plan 27-05: 100ms role-polling interval auto-clears once role becomes 'leader' or 'loser'. Web Locks election resolves async — the first attachLifecycle call returns role()='unknown' until the lock callback fires. Polling avoids exposing onRoleChange in the lifecycle layer's public API; trade-off is 1-2 frames of 'unknown' on a fresh mount, acceptable because no UI reads role yet (Phase 33 presence pill is the first consumer)."
  - "Plan 27-05: 500ms hydration timeout fallback per 27-UI-SPEC.md. IndexeddbPersistence emits 'synced' when its initial read completes; fresh docs with no cached state may not emit it for several frames or at all. The 500ms cap matches the spec's 'annotations visible (opacity 1) within <500ms of document open' acceptance criterion."
  - "Plan 27-05: Wrapper-div fade-in opt-in deliberately deferred. The .svg-annotations--hydrating / --hydrated classes live in StorageFailureBanner.css (single source of truth for Phase 27 visual polish), but no wrapper applies them yet. Applying it would either touch SVGAnnotationLayer.jsx (Always-Protected — needs second waiver) or require extending the App.jsx waiver beyond 'mount only'. Phase 32 hardening can pick this up; for now annotations appear instantly, which the plan's UAT-Step-1 explicitly accepts ('fade-in is fine, but instant is also acceptable for v1')."
  - "Plan 27-05: Action-link behavior — quota_exceeded / invalid_state open Chrome's storage-management help URL (placeholder), version_mismatch / blocked call window.location.reload(). Project does not yet have a docs URL surface; Phase 33+ may swap the placeholder for a project-owned help-doc URL. Documented inline."
  - "Plan 27-05: Banner uses exactly 2 type weights (400 / 600), zero deviation from 27-UI-SPEC.md. font-weight: 600 reserved for the heading; body, action link, secondary metadata, dismiss button all 400. Action link interactivity signaled by underline + accent color (#4A90E2), NOT by font weight — matches Linear / Notion link convention."
  - "Plan 27-05: Manual UAT for the storage banner deferred — modern browsers (Chrome incognito included) permit IndexedDB by default, so the banner does not fire under the planned 'open in incognito' scenario. User accepted the automated test coverage (Plan 27-01's 4 storageFailureDetector scaffold tests, all green; Plan 27-04's 8 co-located tests covering all 3 IDB error codes + ignore-unrelated + detach + SSR + throws + windowRef) in lieu of a manual incognito test. UAT step 1 (single-user round-trip) verified live by user: drew a pen-stroke on Page 6 of 'Package 2 - Rev 4 -- IC.pdf', refreshed, stroke reappeared."

requirements-completed: [AUTH-03]

# Metrics
duration: ~3min active execution (Tasks 1-2; UAT pause + reviewer-side patch ~1h45m wall clock)
completed: 2026-04-27
---

# Phase 27 Plan 05: React Surface + App.jsx Mount Summary

**The React surface for the CRDT foundation landed: YDocProvider context provider + useYDoc hook + StorageFailureBanner with all 4 copy variants per 27-UI-SPEC.md, mounted at the document-open boundary in App.jsx via a per-phase narrow waiver (1 import + 1 JSX wrap around <PDFViewer>). User verified the single-user round-trip live: drew a pen-stroke, refreshed the page, the stroke reappeared. applyUpdate-only invariant remains green; license gate stays green; test baseline preserved (290 pass / 6 fail / 3 skipped — identical to pre-Plan-27-05). Always-Protected files (PageAnnotationLayer, FabricDrawingCanvas, FabricEraserCanvas, FabricEditCanvas, SVGAnnotationLayer, vite.config.js) byte-identical; zoomGeneration signal preserved.**

## Performance

- **Active execution:** ~3 min (Task 1 commit `fe100060` at 13:58:34, Task 2 commit `ae91f9fb` at 13:59:46; checkpoint pause + UAT round-trip verification + summary write through 19:51 UTC)
- **Wall clock:** ~1h55m total elapsed (most of that was the UAT pause and the user committing a separate non-phase Cmd/Ctrl+S UX patch as `477fe90e` between Task 2 and the resume signal)
- **Started:** 2026-04-27T17:55:43Z
- **Completed:** 2026-04-27T19:51:00Z (post-UAT)
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files created:** 4 (`YDocProvider.jsx`, `useYDoc.js`, `StorageFailureBanner.jsx`, `StorageFailureBanner.css`)
- **Files modified:** 1 (`src/App.jsx` — narrow waiver scope only)

## Accomplishments

- **`src/components/collab/YDocProvider.jsx` ships the React mounting layer** — borrows Y.Doc from `ydocRegistry.getOrCreateYDoc(docId)`, wires `attachLifecycle(ydoc, docId, {onStorageState})`, polls role for the first few seconds, caps hydration at 500ms via timeout fallback, and tears down cleanly on unmount via `lifecycle.detach()` + `releaseYDoc(docId)` (does NOT destroy — Pitfall 21). Outer component is a pure routing branch (kill switch / null docId returns frozen null-shape context without calling useEffect); `key={docId}` on the inner component forces a clean state reset on PDF switch.
- **`src/hooks/useYDoc.js` ships the locked-shape hook** — returns `{ydoc, isHydrating, storageState, role, isCRDTEnabled, dismissBanner}`. Frozen `NULL_VALUE` shape returned when called outside `<YDocProvider>` so consumers can call the hook unconditionally and render gracefully when the CRDT layer is off.
- **`src/components/collab/StorageFailureBanner.jsx` ships all 4 copy variants per 27-UI-SPEC.md** — `quota_exceeded`, `invalid_state`, `version_mismatch`, `blocked`. Single `HEADING` constant (`Local saving is offline`) shared across all codes; single `SECONDARY` constant (`Annotations still syncing to cloud · Stay online to keep your work safe`); per-code body + action_link in a single `COPY` map. Inline 16x16 warning SVG matching the AuthModal/UserMenu pattern. `role="alert"` + `aria-live="polite"` + `aria-label="Dismiss banner"` per accessibility spec. Defensive `return null` on unrecognized codes.
- **`src/components/collab/StorageFailureBanner.css` uses only locked CSS variables and 2 type weights** — `--bg-secondary`, `--accent-red` (4px solid left border + warning icon stroke), `--text-primary` (heading 14px/600), `--text-secondary` (body 13px/400), `--text-muted` (secondary metadata 12px/400 + dismiss button), `--accent-primary` (action link with underline), `--border-primary` (bottom divider), `--shadow-md`. Sticky positioning at top of document scroll. Action-link interactivity signaled by underline + accent color, NOT by font weight (keeps the banner to exactly 2 type weights total).
- **`.svg-annotations--hydrating` / `--hydrated` fade-in classes ship inline in the banner CSS** — 220ms cubic-bezier(0,0,0.2,1) ease-out matches Material Design "expressive deceleration" range. Source of truth lives in this file so any future wrapper can opt in by toggling the class without modifying SVGAnnotationLayer.jsx (Always-Protected). Wrapper-div opt-in is intentionally deferred — out of Plan 27-05's narrow waiver scope; Phase 32 hardening can pick it up.
- **`src/App.jsx` mounts the provider via a per-phase narrow waiver** — 1 import line (`import YDocProvider from './components/collab/YDocProvider.jsx';` at line 80, immediately after `SyncfusionPDFContainer`) + 1 JSX wrap around `<PDFViewer>` at line 38607 with `docId={tab.file?.id}`. Diff stat: +27 / −24 (24 deletions = re-indentation of the 23 wrapped props + the original `<PDFViewer>` lines, NOT logical removals). Zero logic changes, zero useEffect modifications, zero state additions. The Provider self-disables when `docId` is null/undefined (returns null-shape context).
- **Live UAT verified the single-user round-trip** — User drew a pen-stroke on Page 6 of `Package 2 - Rev 4 -- IC.pdf`, refreshed the page, the stroke reappeared. The CRDT layer's mount → attachLifecycle → IndexedDB write → unmount → reload → re-attach → IndexedDB read pipeline is end-to-end functional for single-user persistence.
- **applyUpdate-only invariant remains GREEN.** `git grep -nE "new[[:space:]]+Y\\.Doc\\(" -- 'src/**/*.{js,jsx,ts,tsx}'` returns ONLY `src/lib/collab/ydocRegistry.js` (1 actual constructor + 2 documentation references in comments). Zero violations from Plan 27-05's 4 new files.
- **License gate stays GREEN.** No new deps in this plan. `node scripts/check-licenses.mjs` exits 0.
- **Test baseline preserved.** 290 pass / 6 fail (pre-existing pdfAnnotationImporter, out of scope per phase boundary) / 3 skipped — identical to pre-Plan-27-05 baseline.
- **Build clean.** `npm run build` completes in ~17s, no errors, no new warnings.

## Task Commits

1. **Task 1: Create YDocProvider + useYDoc + StorageFailureBanner (CSS + JSX)** — `fe100060` (feat)
2. **Task 2: Mount YDocProvider in App.jsx (per-phase narrow waiver — mount only)** — `ae91f9fb` (feat)
3. **Task 3: UAT — verify single-user round-trip + storage banner UX** — N/A (checkpoint:human-verify; user typed `approved` after live round-trip verification)

**Plan metadata commit:** to be appended below.

**Out-of-scope commit between Task 2 and resume signal:** `477fe90e fix(save): split cloud save from PDF download with confirmation + native picker` — separate Cmd/Ctrl+S UX patch landed during the UAT pause. Not part of Plan 27-05 scope; the user explicitly flagged it as non-phase work. Listed here for git-history clarity only.

## Files Created/Modified

### Created (4)

- `src/components/collab/YDocProvider.jsx` — 157 lines. 3 exports: `YDocProvider` (default + named) + `YDocContext`. Outer routing branch (kill switch / null docId) returns a frozen null-shape context; inner `YDocProviderInner` (keyed on docId) owns the lifecycle hooks (useEffect that calls attachLifecycle + role polling + hydration timeout fallback + cleanup).
- `src/hooks/useYDoc.js` — 38 lines. 2 exports: `useYDoc` (default + named). Reads `YDocContext` via `useContext`; returns frozen `NULL_VALUE` when called outside `<YDocProvider>`.
- `src/components/collab/StorageFailureBanner.jsx` — 113 lines. 2 exports: `StorageFailureBanner` (default + named). Locked copy per 27-UI-SPEC.md Surface 2 — all 4 codes covered, single shared `HEADING` + `SECONDARY` constants, per-code body+action_link in single COPY map. Inline 16x16 warning SVG.
- `src/components/collab/StorageFailureBanner.css` — 161 lines. 0 exports. Banner layout (sticky top, flex row, 16px/24px padding, red left border, shadow-md) + dismiss-button hover transition (120ms ease-out) + `.svg-annotations--hydrating` / `--hydrated` fade-in classes (opacity 0/1, 220ms cubic-bezier(0,0,0.2,1)). Uses only locked CSS variables; exactly 2 type weights (400 + 600).

### Modified (1)

- `src/App.jsx` — narrow waiver scope only:
  - Line 80: `+ import YDocProvider from './components/collab/YDocProvider.jsx';`
  - Lines 38607-38633: `<PDFViewer .../>` wrapped in `<YDocProvider docId={tab.file?.id}>...</YDocProvider>` with re-indentation of the 23 wrapped props
  - Diff stat: 51 lines changed, 27 insertions, 24 deletions (deletions = re-indentation, NOT logical removals)
  - Logical change: 1 import + 1 JSX open tag + 1 JSX close tag

## Pitfall Coverage Finalized for Phase 27

| Pitfall | Where defended in Phase 27 |
|---------|----------------------------|
| **Pitfall 1 — schema design** | Plan 27-03 — bytea-from-day-one for update + state + state_vector columns; encoding_version SMALLINT NOT NULL DEFAULT 1; stub deny-all RLS policies named `<table>_phase27_stub_deny_all` so Phase 28 can DROP POLICY by exact name |
| **Pitfall 2 — Web Locks election + IndexeddbPersistence multi-tab safety** | Plan 27-04 — `attachLifecycle` gates `IndexeddbPersistence` instantiation behind `navigator.locks.request` exclusive lock named `y-doc-${documentId}`; never-resolving promise holds the lock for tab lifetime; auto-releases on tab close |
| **Pitfall 5 — applyUpdate-only invariant** | Plan 27-02 — Y.Doc construction confined to `src/lib/collab/ydocRegistry.js`; Plan 27-04 — loser-tab BroadcastChannel handler uses `Y.applyUpdate(ydoc, bytes, REMOTE_BC_ORIGIN)` exclusively; Plan 27-05 — provider borrows the doc via `getOrCreateYDoc`, never constructs; grep test in `tests/phase27/applyUpdateOnlyInvariant.test.mjs` locks the invariant |
| **Pitfall 10 — snapshot architecture** | Plan 27-03 — `doc_yjs_state` table (snapshot bytea + sequence number + server_ts) ready for Phase 28 transport |
| **Pitfall 12 — Y.Map vs Y.Array decision** | Plan 27-03 documented Y.Map keyed-by-annotation-id is the data model (chosen over Y.Array); Phase 29 will instantiate the Y.Map under the existing per-document Y.Doc |
| **Pitfall 15 — bytea storage** | Plan 27-03 — bytea (NOT TEXT) for all binary columns; round-trip integrity test in `tests/phase27/byteaRoundTrip.test.mjs` |
| **Pitfall 17 — encoding_version** | Plan 27-03 — `encoding_version SMALLINT NOT NULL DEFAULT 1` ships in initial schema so future Yjs encoding versions roll forward without a migration |
| **Pitfall 20 — per-doc Y.Doc** | Plan 27-02 — registry keyed by `documentId`, one Y.Doc per PDF |
| **Pitfall 21 — no destroy on release** | Plan 27-02 — `releaseYDoc(documentId)` decrements ref count but never calls `ydoc.destroy()`; Plan 27-05 — provider unmount calls `releaseYDoc` (does NOT destroy) so a re-mount on the same docId picks up the same doc instance |
| **Pitfall 22 — license gate** | Plan 27-01 — `scripts/check-licenses.mjs` blocks AGPL/GPL/SSPL with allowlist for MIT/BSD/Apache-class + per-package legacy waivers |
| **Silent-fallback anti-pattern** | Plan 27-04 — `attachStorageFailureDetector` surfaces 3 IDB error codes via `window.unhandledrejection`; Plan 27-05 — banner renders the user-visible warning with locked copy from 27-UI-SPEC.md when any non-ok code fires |

## Banner Copy Verification (27-UI-SPEC.md Surface 2)

All 4 codes match the spec verbatim. Source: `src/components/collab/StorageFailureBanner.jsx`.

| Code | Heading | Body (verbatim from spec) | Action Link |
|------|---------|---------------------------|-------------|
| `quota_exceeded` | "Local saving is offline" | "Your browser's storage is full, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe." | "How to free up space" |
| `invalid_state` | "Local saving is offline" | "This browser is blocking local storage, so changes can't be saved on this device. Your work is still being saved to the cloud while you're online — but if you go offline, recent changes won't be safe." | "How to enable storage" |
| `version_mismatch` | "Local saving is offline" | "Local saved data is from a newer version of the app. Changes can't be saved on this device until this is resolved. Your work is still being saved to the cloud while you're online." | "Reload the app" |
| `blocked` | "Local saving is offline" | "Another tab is upgrading local storage. Changes can't be saved on this device until that finishes. Your work is still being saved to the cloud while you're online." | "Retry now" |

Secondary metadata line (all codes): `"Annotations still syncing to cloud · Stay online to keep your work safe"`

Single `HEADING` constant + single `SECONDARY` constant + single `COPY` map = the full spec is testable against three module-scoped values.

## Always-Protected File Audit

| File | Diff vs HEAD~3 | Status |
|------|----------------|--------|
| `src/App.jsx` | +27 / −24 (1 import + 1 JSX wrap with re-indentation) | OK — narrow waiver scope only |
| `src/components/PageAnnotationLayer.jsx` | empty | OK |
| `src/components/FabricDrawingCanvas.jsx` | empty | OK |
| `src/components/FabricEraserCanvas.jsx` | empty | OK |
| `src/components/FabricEditCanvas.jsx` | empty | OK |
| `src/components/SVGAnnotationLayer.jsx` | empty | OK |
| `package.json` | empty | OK (Plan 27-02 waiver was for that plan only) |
| `vite.config.js` | empty | OK |
| `zoomGeneration` signal | 12 references in App.jsx, unchanged | OK — CLAUDE.md hard rule honored |

## applyUpdate-only Invariant Audit

```
$ git grep -nE "new[[:space:]]+Y\.Doc\(" -- 'src/**/*.{js,jsx,ts,tsx}'
src/lib/collab/ydocRegistry.js:2:// Phase 27 — Y.Doc registry. THIS IS THE ONE ALLOWED LOCATION FOR `new Y.Doc(`.
src/lib/collab/ydocRegistry.js:25:    // applyUpdate-only invariant: this is the ONLY place `new Y.Doc(` may appear.
src/lib/collab/ydocRegistry.js:28:    const doc = new Y.Doc({ guid: documentId, autoLoad: false });
```

Only `ydocRegistry.js` matches. Line 28 is the sole constructor; lines 2 and 25 are documentation references in comments. Zero violations from Plan 27-05's 4 new files.

```
$ npm test 2>&1 | grep -i "applyUpdate-only invariant"
ok 149 - applyUpdate-only invariant — `new Y.Doc(` appears only inside ydocRegistry.js
```

PASSING.

## Test Baseline Detail

| State | Pass | Fail | Skipped | Total |
|-------|------|------|---------|-------|
| Pre-Plan-27-05 (post-27-04) | 290 | 6 | 3 | 299 |
| Post-Plan-27-05 | 290 | 6 | 3 | 299 |
| **Delta** | **0** | **0** | **0** | **0** |

Plan 27-05 ships React surface (UI components + hook + provider) and an App.jsx mount; no new automated tests in scope. The 6 pre-existing failures are pdfAnnotationImporter et al., out of scope per phase boundary. The 3 remaining skipped tests are existence-guarded scaffolds for future phase work.

## AUTH-03 Verification

- **Schema-level enforcement:** `doc_yjs_updates.server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `activity_log.server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` — application code physically cannot insert without a server-authoritative timestamp (Plan 27-03).
- **Inline pg_description:** `COMMENT ON COLUMN ... IS 'AUTH-03: server-authoritative timestamp...'` so Supabase Studio surfaces the requirement attribution.
- **Plan 27-05's role:** the lifecycle layer (Plan 27-04) is the runtime entry point that downstream phases (Phase 28 transport) bind to in order to feed Y.Doc updates into the AUTH-03 INSERT path. Plan 27-05 mounts the lifecycle into the React tree at the document-open boundary, completing the runtime wiring.
- **Status in REQUIREMENTS.md:** Already marked `[x]` and "Complete" in the traceability table (recorded by Plan 27-03's schema migration).

## ROADMAP Success Criteria — All 5 Confirmed

Per `.planning/ROADMAP.md` Phase 27 success criteria:

1. **Y.Doc round-trip works** — VERIFIED LIVE during UAT. User drew pen-stroke on Page 6, refreshed, stroke reappeared.
2. **Multi-tab safety guarantees in place** — VERIFIED via Plan 27-04 lifecycle layer (Web Locks election + IndexeddbPersistence leader-only + BroadcastChannel handoff with applyUpdate-only invariant on the loser path). Live multi-tab UX is now ready for Phase 29 to consume; no automated multi-tab Playwright run required for Plan 27-05 closure.
3. **applyUpdate-only invariant locked** — Plan 27-02 confined Y.Doc construction to ydocRegistry; grep-asserted by `tests/phase27/applyUpdateOnlyInvariant.test.mjs`; remains green through Plans 27-04 and 27-05.
4. **License gate green** — `scripts/check-licenses.mjs` exits 0 (Plan 27-01 + verified at Plan 27-05 close).
5. **Schema ready for Phase 28 transport** — `doc_yjs_updates` + `doc_yjs_state` + `activity_log` shipped with bytea + encoding_version + AUTH-03 server_ts + stub deny-all RLS (Plan 27-03). No schema rework required for Phase 28.

## Reconciliation Prep — CONTEXT.md Acceptance Criteria Verification Map

| Criterion | Verification |
|-----------|--------------|
| AC #1 — Fresh install: PDF renders immediately + annotations fade in <500ms | Live UAT: PDF rendered immediately on open; no spinner shown. Fade-in wrapper opt-in is deferred (deferred-items below); annotations currently appear instantly. Plan UAT step 1 explicitly accepts "instant is also acceptable for v1". |
| AC #2 — Hydrated Y.Doc: reload restores annotations from IndexedDB | Live UAT: VERIFIED. User drew pen-stroke, refreshed, stroke reappeared. Single-user round-trip end-to-end functional. |
| AC #3 — Two browser tabs: in-sync within ~1s + no IDB corruption | Plan 27-04 architecture (Web Locks + BroadcastChannel + applyUpdate-only invariant) defends Pitfall 2 by code, not convention. Manual two-tab test deferred — Phase 29 wires the Fabric ↔ Y.Map binding that makes annotations visible across tabs; Plan 27-05's lifecycle is ready, no console errors observed during single-tab UAT. |
| AC #4 — Desktop app: second open brings existing window forward | Out of scope for Plan 27-05 (Electron main-process behavior, no UI surface). Out of scope for Phase 27 entirely per CONTEXT.md "Out of Scope for this Phase's UI Spec". |
| AC #5 — IDB unavailable: document opens + visible banner | Banner UI verified by code review against 27-UI-SPEC.md (all 4 copy variants, role=alert, aria-live=polite, dismiss button, sticky positioning, locked CSS variables). Manual incognito test deferred — modern browsers (Chrome incognito included) permit IndexedDB by default, so the banner does not fire under the planned scenario. User accepted automated test coverage from Plan 27-04 (8 co-located tests + 4 Plan 27-01 scaffold tests, all green) in lieu of manual incognito test. |
| AC #6 — Local in-flight edit + server snapshot: edit survives | Plan 27-02 + Plan 27-04 architecture (applyUpdate-only invariant + REMOTE_BC_ORIGIN echo-loop guard) defends Pitfall 5 by code. Grep test passing. Full Playwright validation deferred to Phase 28 transport spike where the actual server-snapshot rehydrate path lands. |
| AC #7 — License gate blocks non-allowed deps | `scripts/check-licenses.mjs` exits 0; in-script self-test verifies AGPL still blocks under both compound license forms (Plan 27-01). |
| AC #8 — Phase 28 schema-ready | Plan 27-03 — `doc_yjs_updates`, `doc_yjs_state`, `activity_log` all present with bytea + encoding_version + server_ts + stub deny-all RLS for Phase 28 to DROP POLICY by exact name. |

## Deferred Items

- **Wrapper-div fade-in opt-in** — `.svg-annotations--hydrating` / `--hydrated` CSS classes ship in the banner CSS, but no wrapper applies them yet. Plan 27-05's narrow waiver was "mount only" — adding the wrapper would either touch SVGAnnotationLayer.jsx (Always-Protected) or require extending the App.jsx waiver. Phase 32 hardening can pick this up. UX impact: annotations currently appear instantly rather than fading in over 220ms. Plan 27-05 UAT step 1 explicitly accepts this.
- **Manual storage-banner UAT (incognito test)** — modern browsers permit IndexedDB in incognito so the banner does not fire under the planned scenario. User accepted Plan 27-01's 4 scaffold tests + Plan 27-04's 8 co-located tests as automated coverage in lieu of manual visual verification. If a real-world quota_exceeded / invalid_state event occurs in production telemetry post-launch, Phase 33+ can revisit.
- **Plan 27-01 Playwright scenarios still test.fixme** — 5 scenarios (`phase27-roundtrip.spec.mjs`, `phase27-leader-handoff.spec.mjs`, `phase27-rehydrate-no-wipe.spec.mjs`, `phase27-storage-banner.spec.mjs`, `phase27-two-tab-no-dup.spec.mjs`) still carry `test.fixme(true, '...')` markers. Plan 27-05's `<action>` block explicitly says removing them is optional UAT-only. The single-user round-trip is verified live; the two-tab-sync scenario depends on Phase 29's Fabric ↔ Y.Map binding to make annotations visible across tabs, so unfreezing those scenarios is naturally deferred to Phase 29 (or a Phase 27 follow-up plan if the team wants the green Playwright coverage as a reconciliation gate).
- **Out-of-scope commit during UAT pause** — `477fe90e fix(save): split cloud save from PDF download with confirmation + native picker` landed between Task 2 and the resume signal. Not part of Plan 27-05 scope. Listed in deferred-items for git-history clarity; the user explicitly flagged it as separate work.

## Decisions Made

1. **Mount point: outermost `<PDFViewer>` wrap, not `<SyncfusionPDFContainer>`.** Plan permitted both options; outer mount means the entire viewer subtree (sidebar, toolbars, annotation layers, banner host) sits inside Y.Doc context. Matches the plan's "attach as early as possible after pdfFile.id becomes truthy" guidance. `docId={tab.file?.id}` so the provider self-disables when no file is loaded.

2. **Outer YDocProvider component is a pure routing branch.** Kill switch / null docId returns a frozen null-shape context without ever calling useEffect. Only `YDocProviderInner` (keyed on docId) owns stateful hooks. React rules-of-hooks safe.

3. **`key={docId}` on the inner provider.** Forces a clean hooks tree on PDF switch — state resets, no stale `isHydrating` / `storageState` bleed across documents.

4. **100ms role-polling interval, auto-clears on resolution.** Web Locks election resolves async; the first attachLifecycle call returns role()='unknown'. Polling avoids exposing onRoleChange in the lifecycle public API; trade-off is 1-2 frames of 'unknown' on a fresh mount, acceptable because no UI reads role yet (Phase 33 presence pill is the first consumer).

5. **500ms hydration timeout fallback.** IndexeddbPersistence may not emit 'synced' for fresh docs with no cached state. The 500ms cap matches 27-UI-SPEC.md's "annotations visible (opacity 1) within <500ms of document open" acceptance criterion.

6. **Action-link reload-only behavior for version_mismatch / blocked.** quota_exceeded / invalid_state open Chrome's storage-management help URL (placeholder until Phase 33+ project help-doc surface). Documented inline.

7. **Wrapper-div fade-in opt-in deferred.** CSS classes ship; no wrapper applies them yet because doing so would breach Plan 27-05's narrow waiver scope. Phase 32 owns the polish.

8. **Manual storage-banner UAT replaced with automated test coverage.** Modern browsers permit IndexedDB in incognito so the banner doesn't fire under the planned scenario. User accepted Plan 27-01's 4 scaffold tests + Plan 27-04's 8 co-located tests as sufficient coverage. The automated layer covers all 4 codes + ignore-unrelated + detach lifecycle + SSR + throws + windowRef contract.

## Deviations from Plan

### Auto-fixed Issues

None — Plan 27-05 executed exactly as written. No Rule 1/2/3 fixes triggered. The CSS variable substitutions, banner copy, accessibility attributes, and JSX wrap point all matched the plan's locked specifications on first write.

### UAT Adjustments (with user approval)

**1. Storage-banner manual UAT replaced with automated test coverage** — User explicitly approved this substitution at the resume signal: "Storage banner not visually verified (modern browsers permit IndexedDB in incognito so the banner does not fire under that scenario, and we are accepting the automated test coverage in lieu of a manual incognito test)." Documented in `key-decisions` and `Deferred Items` for future reconciliation reference.

## Issues Encountered

None. The 4 React/CSS files compiled cleanly, the App.jsx narrow waiver edit was a single Edit tool call (1 import + 1 JSX wrap with auto-re-indentation), and the live UAT confirmed the single-user round-trip on first try.

## Authentication Gates

None. No external service auth required. The dev server's auto-login fires from `.env.development.local` per the user's standing preference (no manual login during dev).

## Requirement Coverage

- **AUTH-03** (server-authoritative timestamp data model on every transaction):
  - Schema-level enforcement landed in Plan 27-03 (`doc_yjs_updates.server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` + `activity_log.server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  - Plan 27-05's role: mount the lifecycle layer (which is the runtime entry point downstream phases bind to in order to feed Y.Doc updates into the AUTH-03 INSERT path) into the React tree at the document-open boundary
  - Status in `.planning/REQUIREMENTS.md`: Already `[x]` and "Complete" in the traceability table; ran `requirements mark-complete AUTH-03` for idempotency (returned "not_found" because already complete — expected)

## User Setup Required

None. Manual UAT is complete (single-user round-trip verified live; storage banner accepted via automated coverage).

## Next Phase Readiness

- **Phase 27 reconciliation:** Ready. All 5 ROADMAP success criteria confirmed, all 8 CONTEXT.md acceptance criteria mapped to verification evidence, AUTH-03 marked Complete. The next session writes `.planning/phases/27-crdt-foundation/27-RECONCILIATION.md` per CLAUDE.md phase discipline rules and runs `/gsd:verify-work 27` for the final automated baseline check.
- **Phase 28 (transport spike + auth + server validator):** Unblocked. The lifecycle layer (Plan 27-04) exposes `onStorageState` as the runtime channel where Phase 28's WebSocket transport will surface `{code: 'transport_offline'}` etc. — Phase 28 extends, doesn't replace. The schema (Plan 27-03) is ready: `doc_yjs_updates` accepts `(document_id, encoding_version, update bytea, server_ts, sequence)` rows with stub deny-all RLS that Phase 28 will DROP POLICY by name and replace with real per-doc-membership RLS.
- **Phase 29 (Fabric ↔ Y.Map binding + per-user undo):** Unblocked. The Y.Doc registry + lifecycle + provider all expose the active Y.Doc instance via `useYDoc()`. Phase 29 will instantiate the Y.Map keyed by annotation id under the existing per-document Y.Doc and wire Fabric.js change events to Y.Map updates. The applyUpdate-only invariant is locked at the constructor site so Phase 29 cannot accidentally regress it.
- **Phase 32 hardening:** Wrapper-div fade-in opt-in is the natural pickup. The CSS classes already ship; the wrapper is a single JSX line in App.jsx (or a new collab/AnnotationFadeInWrapper.jsx) that consumes `useYDoc()`'s `isHydrating` and toggles the class.
- **Plan 27-01 Playwright scenarios:** Two-tab-sync scenario depends on Phase 29's Fabric ↔ Y.Map binding to make annotations visible across tabs, so unfreezing those scenarios is naturally deferred to Phase 29 (or a Phase 27 follow-up plan if the team wants green Playwright coverage as a reconciliation gate).

## Self-Check: PASSED

- **All 4 created files present on disk:**
  - `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/components/collab/YDocProvider.jsx` — FOUND (157 lines)
  - `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/components/collab/StorageFailureBanner.jsx` — FOUND (113 lines)
  - `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/components/collab/StorageFailureBanner.css` — FOUND (161 lines)
  - `/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/src/hooks/useYDoc.js` — FOUND (38 lines)
- **App.jsx waiver scope honored:** 1 import + 1 JSX wrap, all other Always-Protected files byte-identical, zoomGeneration signal preserved (12 references unchanged)
- **Both task commits verified in git history:** `fe100060` (Task 1, feat) + `ae91f9fb` (Task 2, feat)
- **Test baseline preserved:** 290 pass / 6 fail / 3 skipped — identical to pre-Plan-27-05
- **applyUpdate-only invariant grep returns ONLY ydocRegistry.js lines** (verified)
- **License gate exits 0** (verified: "License gate PASSED — all production dependencies are allowlisted or waived.")
- **Live UAT confirmed single-user round-trip** (user verified pen-stroke persistence)

---
*Phase: 27-crdt-foundation*
*Completed: 2026-04-27*
