# Phase 27: CRDT Foundation - Research

**Researched:** 2026-04-27
**Domain:** Yjs CRDT bootstrap (per-document Y.Doc + IndexedDB persistence + multi-tab Web Locks election + binary-update Postgres schema design + license CI gate) wrapped under the unchanged SVG-display + Fabric-edit-on-demand rendering layers
**Confidence:** HIGH (Yjs trio + Web Locks + IndexedDB error model verified against official docs); HIGH (this app's seam location confirmed in source); MEDIUM (compaction cadence v1 — back-of-envelope, Phase 32 owns hardening); HIGH (anti-recommendations / banned patterns — from STACK.md + PITFALLS.md + Yjs official docs)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**First-open loading experience**
- The PDF page renders immediately on document open — never a blocking loading spinner.
- Saved annotations fade in over a fraction of a second once they hydrate from local storage.
- No blocking spinner. No skeleton placeholder over the annotation area.
- Pattern reference (user-named): Linear, Figma, Notion, Google Docs.
- Design intent: perceived speed beats real speed — never make the user stare at a spinner. The PDF being visible immediately reads as "fast and alive" even when the underlying hydration takes the same wall-clock time as a spinner would.

**Multi-instance behavior**
- **Two browser tabs of the same document on the same computer (web version):** both tabs work and stay live in sync with each other (Google Docs pattern). Web Locks election still picks one tab as the local-persistence leader internally — that's the multi-tab safety mechanism — but to the user, both tabs are read/write and live with each other.
- **Two windows of the same document inside the desktop app:** opening the same document twice is NOT allowed. The second open just brings the existing window forward / hands the user back to the first window. (User decision.)
- **Two different devices on the same document:** always sync. This is the whole point of v2.4 — locked from day one. Out of scope for this phase's UX work but the foundation must support it without rework.

**Storage failure behavior (IndexedDB unavailable, full, or corrupted)**
- The document still opens — never block.
- A visible banner appears at the top of the document explaining what's broken, that local saving is offline, that work won't be safe if they go offline, and how to fix it (e.g. clear cache, exit private browsing).
- Annotations continue syncing to the cloud only until local storage is restored.
- Pattern reference: Linear, Notion, Figma graceful-degradation banners.
- Anti-pattern explicitly rejected: silent fallback. If local saving is broken the user MUST know — silent fallback is dangerous because if the network drops next, the user loses everything without ever knowing why.

**applyUpdate-only invariant (architectural — locked by research)**
- The Y.Doc state is NEVER replaced wholesale from a server snapshot — only ever extended via `Y.applyUpdate(doc, update)`.
- This rule defends against the 1-second verify-wipe regression that killed the previous simple-sync system (Pitfall 5).
- Acceptance criteria must include a Playwright test that simulates a server-snapshot rehydrate while a local edit is in flight and asserts the local edit survives.

**Multi-tab safety (architectural — locked by research)**
- Web Locks API election runs BEFORE `IndexeddbPersistence` is wired up — guards `yjs/y-indexeddb#25`.
- Required even though the user-facing multi-tab UX is "both tabs work" — the lock arbitrates which tab owns the local persistence write path. The non-leader tab still reads/writes Y.Doc state, just doesn't double-write to IndexedDB.

**Highlights stay on legacy path**
- This phase does NOT migrate legacy highlight annotations into the Y.Doc.
- Highlights stay on the existing legacy sync path through v2.4 (Excel-sync risk; folded into v2.5 milestone).
- The Y.Doc data model only covers non-highlight annotations.

### Claude's Discretion
- Compaction cadence and triggering mechanism for `doc_yjs_state` snapshots — researcher + planner pick a strategy backed by benchmarks (Phase 32 owns the production hardening; Phase 27 only needs a workable v1).
- License CI gate failure mode (hard block vs warning) — pick what keeps developer flow smooth without leaking risk.
- Exact banner copy for the storage-failure UX — design pass during planning.
- Schema column nullability and exact field set on `doc_yjs_updates` / `doc_yjs_state` beyond `bytea` + `document_id` + server-authoritative timestamp + sequence number.
- Feature flag / kill switch shape for the new CRDT layer (planner decides; should be present so v2.4 ships safely).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within the foundation phase scope. Cross-device sync, presence pills, per-user undo, activity log, sharing UX all live in their own phases (28-34) per ROADMAP.md.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-03 | Every annotation creation, edit, and deletion records a server-authoritative timestamp. | Schema design covers `doc_yjs_updates` with both `client_ts` (forensic only) and `server_ts` (canonical, defaulted via Postgres `NOW()` or trigger). Phase 28 wires the actual user/device into `origin`; Phase 27 ships the schema + `applyUpdate`-only invariant so Phase 28's transport has somewhere correct to write. The `activity_log` table is also stubbed here so Phase 33 has a server-authoritative timestamp source from day one. See "Schema Design" and "Validation Architecture / REQ-AUTH-03" sections below. |

</phase_requirements>

## Summary

This phase installs Yjs as the data substrate for v2.4 multi-user collaboration without disturbing the v2.0 SVG-display + Fabric-edit immutable rendering split. Three packages land via per-phase `package.json` waiver (`yjs@^13.6.30`, `y-protocols@^1.0.7`, `y-indexeddb@^9.0.12`), MIT-verified at registry HEAD as of 2026-04-27. A `<YDocProvider docId>` mounts at the document-open boundary in `App.jsx` (per-phase narrow waiver) — the seam is the existing `useEffect(() => { const documentId = pdfFile?.id; ... }, [pdfFile?.id, user?.id])` block at `src/App.jsx:~20772`. Y.Doc instances are held in a module-scoped registry keyed by `documentId` (one Y.Doc per PDF), constructed once and reused across remounts. Web Locks API election (`navigator.locks.request("y-doc-{docId}", { mode: "exclusive" })`) gates `IndexeddbPersistence` instantiation per `yjs/y-indexeddb#25`. The non-leader tab participates in the Y.Doc via in-memory observer + BroadcastChannel handoff (loser tab broadcast-receives updates from the leader's IndexedDB writes, applies them locally without double-writing). Schema for `doc_yjs_updates` (bytea append-only log) + `doc_yjs_state` (bytea snapshot) + `activity_log` (server-authoritative) lands as Supabase migrations, with RLS policies stubbed (full policies in Phase 28). The display and edit layers (`SVGAnnotationLayer`, `PageAnnotationLayer`, `FabricDrawingCanvas`, `FabricEraserCanvas`, `FabricEditCanvas`) DO NOT learn about Yjs in this phase — the CRDT layer wraps under React state setters; Phase 29 owns the actual Fabric ↔ Y.Map binding.

The phase carries deliberate "from-day-one" guardrails against the simple-sync data-loss class. The `applyUpdate`-only invariant is enforced by an automated assertion (a node:test that grep-asserts `new Y.Doc(` only appears inside the registry's first-mount path — recommended over a custom ESLint rule because the project does not currently use ESLint, so adding one would be a new tooling surface and the assertion is ~20 lines). The license CI gate runs `license-checker` in a new GitHub Actions step (the project already has `.github/workflows/release.yml`), failing on anything outside MIT/BSD/Apache-2.0/ISC/CC0/0BSD/Unlicense. Storage-failure detection covers IndexedDB `QuotaExceededError`, `InvalidStateError`, `VersionError`, and `blocked` events; UI surface is a banner at the top of the document with copy explaining what's broken and how to fix it (per CONTEXT.md anti-silent-fallback rule).

**Primary recommendation:** Ship this phase as five workstreams that can plan in parallel but ship sequentially: (W0) test scaffold + license CI gate; (W1) Y.Doc registry + YDocProvider + applyUpdate-only invariant + lint/test enforcement; (W2) Web Locks election + BroadcastChannel handoff + IndexeddbPersistence wiring; (W3) Supabase migrations for `doc_yjs_updates` + `doc_yjs_state` + `activity_log` schema (RLS stubs only); (W4) storage-failure banner + feature-flag kill switch + desktop app single-window enforcement. The Fabric / SVG layers stay untouched — this is a foundation-only phase.

## Standard Stack

### Core (NEW packages — installed under per-phase package.json waiver)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yjs` | `^13.6.30` | CRDT engine: shared types (Y.Doc, Y.Map, Y.Array, Y.Text), conflict-free merge, binary update encoding, per-user `Y.UndoManager` (used in Phase 29) | Industry standard CRDT for collaborative apps — Tiptap, Liveblocks, Atlassian, Jupyter, Notion-likes. MIT. ~10kB gzipped. Mature (since 2015). Actively maintained — `13.6.30` published 2026-03-14 (latest at registry as of 2026-04-27). Pure ESM, zero native deps. Drop-in compatible with React 18.2 / Vite 5.2 / Electron 25 / Fabric 5.5.2. |
| `y-protocols` | `^1.0.7` | Binary encoding protocols for sync, awareness/presence, history. Required peer of yjs. | Required peer of yjs. Awareness protocol (`y-protocols/awareness`) is what Phase 33 uses for presence — installing it now keeps the dep set stable and avoids a second `package.json` waiver later. MIT. |
| `y-indexeddb` | `^9.0.12` | IndexedDB persistence provider — caches Y.Doc state in the browser/Electron renderer for instant load + offline edits | The standard Yjs offline-first cache. IndexedDB has effectively unlimited quota in Electron's `file://` / packaged-app origins (vs `localStorage`'s 5-10MB) and stores binary Yjs updates natively without base64 inflation. Auto-merges queued offline writes when the doc reconnects. MIT. **Caveat:** known multi-tab corruption issue `yjs/y-indexeddb#25` (still open as of 2026-04-27) — defended by Web Locks election (see "Multi-Tab Safety" section). |

**Version verification (2026-04-27):**
```bash
$ npm view yjs version          → 13.6.30
$ npm view y-protocols version  → 1.0.7
$ npm view y-indexeddb version  → 9.0.12
$ npm view license-checker version → 25.0.1
```

All three packages confirmed at the versions STACK.md locked. License-checker (used by the new CI gate) is at 25.0.1 — also MIT.

### Supporting (REUSE — already in dependency tree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | `^2.81.1` (existing) | Postgres + Auth + (future) Realtime | Owns the new `doc_yjs_updates` / `doc_yjs_state` / `activity_log` table CRUD via existing client. Auth/Realtime wiring is Phase 28's job — Phase 27 only ships the schema + RLS stubs. |
| `vite-plugin-node-polyfills` | `^0.24.0` (existing devDeps) | Vite-side ESM resolution helper for `lib0` (Yjs's encoding lib) | Already installed. Insurance for any `lib0` dynamic-import edge case under Vite 5; expected no-op. Yjs ships modern ESM and works clean under Vite 5 today. |

### Tools (NEW dev dependencies — installed under same package.json waiver)

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `license-checker` | `^25.0.1` | Audit installed packages for non-permissive licenses | Runs in CI as `license-checker --production --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;CC0-1.0;0BSD;Unlicense'`. Failure mode: hard CI block on non-allowed license (rationale below). Already MIT itself. |

### Anti-installs (do NOT add)

| Package | Why Rejected |
|---------|--------------|
| `AlexDunmow/y-supabase` | Author marks "not recommended for production". Last meaningful commit 2023. Known broadcast-storm bug (`discuss.yjs.dev/t/2447`). STACK.md anti-rec. |
| `@hocuspocus/provider` / `@hocuspocus/server` | Phase 28's spike chooses transport — installing here pre-decides. |
| `@y/websocket@4.0.0-0` | Pre-release. STACK.md anti-rec. |
| `y-websocket@3.0.0` | Bare-bones reference provider, no auth. STACK.md anti-rec. |
| Fabric.js 6.x upgrade | Out of scope for v2.4 per CLAUDE.md "Stay on Fabric 5.5.2." |
| Any GPL/AGPL-licensed transitive | License gate enforces. |

### Installation

```bash
# Core CRDT layer (per-phase package.json waiver):
npm install yjs@^13.6.30 y-protocols@^1.0.7 y-indexeddb@^9.0.12

# License gate (devDep, same waiver):
npm install --save-dev license-checker@^25.0.1
```

**Bundle size impact (verified via STACK.md, gzipped):**
- `yjs` ~10kB
- `y-protocols` ~3kB
- `y-indexeddb` ~1.5kB
- **Total ship cost: ~15kB gzipped, all tree-shaken under Vite 5.**

## Architecture Patterns

### Recommended File Structure (NEW files this phase ships)

```
src/
├── lib/
│   └── collab/                            # NEW — CRDT layer (Phase 27 onward)
│       ├── ydocRegistry.js                # NEW — module-scoped Map<docId, Y.Doc>; getOrCreate / dispose
│       ├── ydocLifecycle.js               # NEW — Web Locks election + IndexeddbPersistence wiring + BroadcastChannel handoff
│       ├── storageFailureDetector.js      # NEW — wraps IndexedDB error events; emits { code, blocking, message } to UI
│       ├── crdtFeatureFlag.js             # NEW — kill-switch reader (env var + localStorage override)
│       └── __tests__/
│           ├── ydocRegistry.test.mjs
│           ├── applyUpdateOnlyInvariant.test.mjs   # grep-assert: new Y.Doc( only inside ydocRegistry.js
│           └── storageFailureDetector.test.mjs
├── hooks/
│   └── useYDoc.js                         # NEW — React hook: getOrCreate from registry, expose ydoc + isHydrating + storageState
├── components/
│   └── collab/                            # NEW
│       ├── YDocProvider.jsx               # NEW — context provider; mounts at App.jsx document-open boundary
│       └── StorageFailureBanner.jsx       # NEW — top-of-document banner; reads storageState from useYDoc
└── App.jsx                                # MODIFIED (narrow waiver) — wrap document body in <YDocProvider docId={pdfFile?.id}>

supabase/migrations/
└── 20260428000000_phase27_crdt_foundation_schema.sql  # NEW — doc_yjs_updates + doc_yjs_state + activity_log + RLS stubs

.github/workflows/
└── license-gate.yml                       # NEW — runs license-checker on every PR (or extend release.yml)
```

**Phase 28 will add:** `src/lib/collab/SupabaseYjsProvider.js` (or `HocuspocusYjsProvider.js`), full RLS policies on the three new tables, server-side update validator.
**Phase 29 will add:** `src/lib/collab/crdtAnnotationBridge.js`, `src/lib/collab/crdtUndoManager.js`, `src/hooks/useAnnotationsCRDT.js`.

### Pattern 1: Y.Doc Registry — module-scoped Map keyed by documentId

**What:** A single module-scoped registry holds at-most-one Y.Doc per (browser-process, documentId) pair. Re-entering React components (mount/unmount/HMR) reuses the existing Y.Doc; switching PDFs returns a different Y.Doc keyed by the new document id. Construction is rare; the registry never destroys on PDF-switch (per Pitfall 21 — destroy is permanent and only happens on app close or hard eviction).

**When to use:** Every callsite that needs a Y.Doc for a documentId. Never `new Y.Doc()` outside this module.

**Why not React state / context for the doc itself:** A Y.Doc is a long-lived stateful object that survives HMR, route changes, and React tree replays. Holding it in `useState` or context value forces destroy/recreate on remounts and breaks the lifecycle. The right shape is "module-scoped registry + React context that exposes `useYDoc()` lookups against the registry."

**Example:**
```js
// src/lib/collab/ydocRegistry.js — Source: Yjs official patterns + this app's needs
import * as Y from 'yjs';

const REGISTRY = new Map(); // Map<documentId, { doc: Y.Doc, refCount: number }>

export function getOrCreateYDoc(documentId) {
  if (!documentId) {
    throw new Error('[ydocRegistry] documentId required');
  }
  let entry = REGISTRY.get(documentId);
  if (!entry) {
    // applyUpdate-only invariant: this is the ONLY place new Y.Doc() may appear.
    // The applyUpdateOnlyInvariant.test.mjs assertion grep-checks this.
    const doc = new Y.Doc({ guid: documentId, autoLoad: false });
    entry = { doc, refCount: 0 };
    REGISTRY.set(documentId, entry);
  }
  entry.refCount += 1;
  return entry.doc;
}

export function releaseYDoc(documentId) {
  const entry = REGISTRY.get(documentId);
  if (!entry) return;
  entry.refCount -= 1;
  // NOTE: deliberately do NOT destroy on refCount===0. Y.Doc.destroy() is permanent
  // (Pitfall 21). Destroy only on app close, where it's the last thing to happen.
}

export function _evictForTest(documentId) {
  // Test-only escape hatch. Never call from production code.
  REGISTRY.delete(documentId);
}
```

**HMR safety note:** Vite HMR replays modules. Stash the registry on `globalThis.__ydocRegistry__` (guarded `if (!globalThis.__ydocRegistry__) globalThis.__ydocRegistry__ = new Map();`) so HMR replays don't lose live Y.Doc instances. This is the same pattern used by Tiptap and Liveblocks for similar long-lived singletons.

### Pattern 2: Web Locks election BEFORE IndexeddbPersistence

**What:** Use `navigator.locks.request("y-doc-{docId}", { mode: "exclusive" }, async (lock) => { ... })` to elect ONE leader tab per (browser-process, documentId). Only the leader instantiates `IndexeddbPersistence`. Loser tabs participate via in-memory Y.Doc + BroadcastChannel updates from the leader.

**When to use:** Every YDocProvider mount, before any IndexedDB-touching code runs. This is the entire defense against `yjs/y-indexeddb#25`.

**Browser support (verified MDN 2026-04-27):**
- Chromium / Electron: Baseline since Chrome 69 (2018). Available in Electron 25+ (Chromium 114).
- Safari iOS: Baseline since iOS 15.4 (March 2022) — so Capacitor 8 iOS is fine.
- Firefox: Baseline since 96 (Jan 2022).
- Web Locks is "Baseline Widely available" since March 2022 across all major browsers — safe to depend on without polyfill.

**Lock release semantics (CRITICAL):** The lock is released when the callback's returned promise resolves, NOT when the tab closes. If the callback returns a never-resolving promise (which is the leader-election pattern), the lock holds for the lifetime of the tab; when the tab process ends, the browser auto-releases. This is exactly the shape we want.

**Example — leader election with BroadcastChannel handoff:**
```js
// src/lib/collab/ydocLifecycle.js — Source: MDN Web Locks API + yjs/y-indexeddb#25 mitigation patterns
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

export async function attachLifecycle(ydoc, documentId, { onStorageState }) {
  const lockName = `y-doc-${documentId}`;
  const channelName = `y-doc-bc-${documentId}`;
  const bc = new BroadcastChannel(channelName);
  const updateOrigin = { source: 'remote-bc' }; // observers must short-circuit on this
  let persistence = null;
  let role = 'unknown';

  // Loser-tab path: receive updates from leader via BroadcastChannel.
  bc.onmessage = (ev) => {
    if (ev.data?.type === 'update') {
      Y.applyUpdate(ydoc, new Uint8Array(ev.data.update), updateOrigin);
    }
  };

  // Local updates that are NOT remote-bc origin → broadcast to siblings.
  ydoc.on('update', (update, origin) => {
    if (origin !== updateOrigin) {
      bc.postMessage({ type: 'update', update });
    }
  });

  // Race for the leader lock. The callback never resolves on the winning tab —
  // that's how we hold the lock for the tab's lifetime. The lock auto-releases
  // when the tab process dies; another tab then promotes itself by re-running
  // navigator.locks.request().
  navigator.locks.request(lockName, { mode: 'exclusive' }, async () => {
    role = 'leader';
    try {
      persistence = new IndexeddbPersistence(documentId, ydoc);

      persistence.on('synced', () => onStorageState({ code: 'ok', role: 'leader' }));

      // y-indexeddb errors come from the underlying IDBRequest. The provider
      // does NOT surface them on the public API (#25 again), so we listen at
      // a lower level.
      window.addEventListener('unhandledrejection', (e) => {
        if (e.reason?.name === 'QuotaExceededError') {
          onStorageState({ code: 'quota_exceeded', role: 'leader', error: e.reason });
        } else if (e.reason?.name === 'InvalidStateError') {
          onStorageState({ code: 'invalid_state', role: 'leader', error: e.reason });
        } else if (e.reason?.name === 'VersionError') {
          onStorageState({ code: 'version_mismatch', role: 'leader', error: e.reason });
        }
      });

      // Hold the lock for the tab's lifetime. This promise intentionally never resolves.
      await new Promise(() => {});
    } finally {
      // Only runs if the lock-holding promise rejects (it doesn't here, but defensive).
      persistence?.destroy();
    }
  });

  // The non-leader tab's request queues. When the leader tab closes,
  // the lock releases, and the queue's next request is granted — so this
  // function call promotes the next tab automatically.

  return {
    detach() {
      bc.close();
      // Provider is destroyed by the leader's finally block when the tab closes.
    },
    role: () => role,
  };
}
```

**Why both leader and loser tabs participate in the Y.Doc:** Per CONTEXT.md, the user-facing UX for two-tabs-on-same-computer is "both tabs work and stay live in sync (Google Docs pattern)." The Web Locks election arbitrates **which tab owns the IndexedDB write path** (multi-tab safety), not which tab is the user's tab. The non-leader tab still has a fully-live in-memory Y.Doc that emits and applies updates via BroadcastChannel; from the user's perspective, both tabs are read/write.

**Why BroadcastChannel and not a second IndexeddbPersistence:** Two `IndexeddbPersistence` instances against the same Y.Doc is exactly the bug `yjs/y-indexeddb#25` documents — duplicated updates. BroadcastChannel is the canonical browser API for same-origin same-process tab coordination, fires synchronously across tabs, and carries `Uint8Array` payloads natively (no base64).

### Pattern 3: applyUpdate-only invariant — automated assertion, not just convention

**What:** Every code path that incorporates remote (or rehydrated) state into the Y.Doc uses `Y.applyUpdate(doc, update, origin)`. Never `new Y.Doc()` after init. Never "tear down and rebuild from server."

**Yjs official guarantee** (verified at https://docs.yjs.dev/api/document-updates 2026-04-27): *"Document updates are commutative, associative, and idempotent. This means that you can apply them in any order and multiple times."* This is the property that makes `applyUpdate` safe under any race — local-edit-then-server-snapshot, server-snapshot-then-local-edit, two server snapshots, and re-applying the same update all converge to the same final state.

**Enforcement (recommendation: node:test assertion, not custom ESLint rule):**

The project does not currently use ESLint (verified — no `.eslintrc*` files, no `eslint` in `package.json`). Adding ESLint just to ship one custom rule is high-friction. A simpler, equally-effective enforcement: a `node --test` assertion that grep-greps the source tree.

```js
// src/lib/collab/__tests__/applyUpdateOnlyInvariant.test.mjs
// Source: pattern adapted from Yjs PITFALLS.md guidance + this project's existing
// node --test convention (see tests/svgKeyboardHandlers.test.mjs etc.)
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { execSync } from 'node:child_process';

test('applyUpdate-only invariant — `new Y.Doc(` appears only inside ydocRegistry.js', () => {
  // Ripgrep the entire src/ tree for `new Y.Doc(` constructor calls.
  const rg = execSync(
    `git grep -nE "new[[:space:]]+Y\\\\.Doc\\\\(" -- 'src/**/*.{js,jsx,ts,tsx}' || true`,
    { encoding: 'utf8' }
  ).trim();
  const matches = rg ? rg.split('\n') : [];

  // The ONE allowed location.
  const allowedFile = 'src/lib/collab/ydocRegistry.js';
  const violations = matches.filter(line => !line.startsWith(`${allowedFile}:`));

  strictEqual(
    violations.length,
    0,
    `applyUpdate-only invariant violated. \`new Y.Doc(\` may only appear in ${allowedFile}. ` +
    `Found unauthorized usages:\n${violations.join('\n')}\n` +
    `Defends against Pitfall 5 (1-second verify-wipe regression).`
  );
});
```

**Why test, not ESLint:**
- Project has no ESLint setup → adding it is a separate decision.
- `node --test` already runs in `npm test` (the project's test convention).
- A grep-based assertion catches the EXACT pattern the rule needs to ban without parsing AST.
- The error message educates future contributors about WHY the rule exists (links Pitfall 5).
- Zero new tooling = zero new maintenance.

**Trade-off accepted:** Grep is less semantically precise than AST. False positive: a comment that contains `new Y.Doc(`. False negative: someone uses `const D = Y.Doc; new D();`. Both are acceptable — the comment case is rare and the bypass case is willful, not accidental. PRs introducing either are review-flagged.

### Pattern 4: Storage-failure detection — per CONTEXT.md anti-silent-fallback rule

**What:** Detect IndexedDB failure modes (quota exceeded, blocked, version mismatch, unavailable in private browsing) and surface them via `onStorageState` callback that `<StorageFailureBanner>` reads. Per CONTEXT.md, banner is mandatory whenever storage is broken; document still opens; cloud sync continues.

**IndexedDB error names to detect (verified MDN):**
| Error name | Trigger | UX message |
|------------|---------|------------|
| `QuotaExceededError` | Disk full or per-origin quota hit | "Local saving paused — your device is out of storage. {fix-guidance}" |
| `InvalidStateError` | IndexedDB API not available (private browsing on some platforms) | "Local saving offline — try a non-private browser window." |
| `VersionError` | Existing local DB is at a higher schema version than the app expects (downgrade) | "Local saving disabled — your local cache was made by a newer version. Clear cache to fix." |
| `blocked` event on `indexedDB.open()` | Another tab is holding an old connection during a version upgrade | "Local saving waiting — close other tabs of this app and reload." |
| `UnknownError` / connection failure | Browser-side IDB corruption, OS-level FS problem | "Local saving offline — see {help-link}." |

**Detection implementation:** Listen on `window.unhandledrejection` and the `IDBOpenDBRequest`'s `onerror` / `onblocked` events. y-indexeddb does NOT surface these on its public API today (related to the same #25 thread), so subscribing at the browser-API level is necessary.

**Banner UX (planner finalizes copy):**
- Position: top of the document area, NOT a modal (anti-blocking per CONTEXT.md).
- Color: warning-yellow background, dismissible only after user acknowledges; reappears on every doc open while broken.
- Copy template: `"⚠ Local saving paused. {what-broke}. Your work is still being saved to the cloud as long as you're connected. {how-to-fix}."`
- Link: opens a help doc explaining the common causes (private browsing, full disk, etc.).
- Anti-pattern explicitly banned: silent fallback. If banner detection fails to fire when IDB is broken, that's a P0 bug.

### Anti-Patterns to Avoid

- **Per-page Y.Array of annotations.** Position-keyed identity breaks under concurrent edits. Use `Y.Map<id, Y.Map>` flat at the doc root, derive `annotationsByPage` in `useAnnotationsCRDT` (Phase 29). (Pitfall 12)
- **Workspace-scoped Y.Doc** ("one Y.Doc for the whole user account"). Bleeds annotations across PDFs and grows unboundedly. Per-PDF Y.Doc (registry keyed by `documentId`) is the only correct shape. (Pitfall 20)
- **Y.Doc.destroy() on PDF switch.** Permanent — re-opening rebuilds from scratch and loses the resume-fast property. Only destroy on app close, and only after `provider.disconnect()` has flushed pending writes. (Pitfall 21)
- **Storing pen-stroke points as Y.Array.** Pen-stroke is commit-once-edit-rarely; granular CRDT structure for points balloons update size by 10–100x with zero collaborative benefit. Store the path as opaque JSON inside the annotation's Y.Map. (Phase 29 detail; foundation just needs to allow nested Y.Map.)
- **Awareness state in Y.Doc.** Cursors / selections / "Bob is editing" go on `Y.Awareness`, never on `Y.Doc`. Awareness is ephemeral with no history; Y.Doc state is durable with full history. Conflating them bloats history forever. (Phase 33 detail; foundation just needs to keep `y-protocols/awareness` available.)
- **Replacing Y.Doc on rehydrate.** This phase's whole reason for being. `applyUpdate(doc, update)`-only. (Pitfall 5)
- **Two `IndexeddbPersistence` instances against the same Y.Doc.** The literal bug in `yjs/y-indexeddb#25`. Web Locks election prevents.
- **Generating a new Y.Doc clientID per WebSocket connection.** Causes awareness flicker on every reconnect (Pitfall 18 — Phase 33's concern, but the foundation must keep `clientID` stable across reconnects within a tab session).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conflict-free merge of concurrent annotation edits | Custom OT layer / hand-rolled diff-merge / "last-writer-wins-with-timestamps" | `yjs` Y.Map property-level merge | Yjs has 8+ years of CRDT research baked in. Building OT in 2026 over a CRDT-friendly stack is a 6-12 month rebuild. |
| Local offline-first persistence of Y.Doc state | Custom `localStorage`-base64-blob serializer | `y-indexeddb` | Native binary storage, transactional, auto-merges queued offline writes. localStorage is 5-10MB cap, sync, base64-only. |
| Multi-tab election | Custom `localStorage`-poll heartbeat / leader-by-timestamp | `navigator.locks.request("name", {mode:"exclusive"})` + BroadcastChannel | Web Locks API has guaranteed exclusive semantics, OS-level enforcement, auto-release on tab close. localStorage-poll has race windows. |
| Awareness / presence (cursors, selections) | Custom Postgres `document_presence` row + 30s polling | `y-protocols/awareness` (Phase 33) | Awareness is sub-100ms, zero DB writes, auto-cleanup on disconnect. Polling is 30s stale and saturates RLS reads. (Foundation phase: don't bake polling into the new layer.) |
| Per-user undo (Phase 29) | Custom undo stack scoped manually to the local user's ops | `Y.UndoManager` with `trackedOrigins: new Set([localClientID])` | Native Yjs primitive; ~600 LOC of Yjs internals you'd otherwise replicate. (Foundation phase: install y-protocols so this is available without a second waiver later.) |
| Binary Yjs update encoding | Custom base64 / JSON / Buffer round-trip | `Y.encodeStateAsUpdate(doc)` + `Postgres bytea` column | `Uint8Array` ↔ `bytea` round-trips natively via supabase-js v2.x. JSON-stringifying a Uint8Array silently produces `{"0":1,"1":2,...}` — unusable. (Pitfall 15) |
| License auditing | Manual review on PRs | `license-checker --onlyAllow` in CI | Catches transitive deps that a manual review misses. AGPL contagion is commercially fatal in a Stripe-billed app. (Pitfall 22) |
| Snapshot compaction (Phase 32) | Custom delete-after-N-updates pruner | `Y.encodeStateAsUpdate` + `Y.applyUpdate` to fresh doc | Phase 32 uses Yjs's native compaction — not Phase 27's job, but the schema must support it (sequence numbers + snapshot's `through_seq`). |

**Key insight:** Yjs is a 10-year-old library with the CRDT mathematics solved. The trap is treating "Yjs is just a library" as license to skip the integration patterns — but the integration patterns (origin-tagged transactions, awareness vs Y.Doc separation, Web Locks election, per-document Y.Doc, snapshot architecture) are exactly the parts where the simple-sync system bled data. The library is HIGH confidence; the integration is where this phase's work goes.

## Common Pitfalls

This phase defends against pitfalls **1, 2, 5, 10, 12, 15, 17, 20, 21, 22** per ROADMAP.md. The full pitfall catalog is in `.planning/research/PITFALLS.md`. Below: how each pitfall lands in this specific phase's work, what to verify, and the warning signs.

### Pitfall 1: Migration partial-state — schema must be designed for dual-write era

**What goes wrong:** v2.4 client writes Y.Doc updates while v2.3 clients still write legacy `document_annotations` rows. If the schema doesn't allow both worlds to coexist for weeks-to-months during rollout, the rollout becomes a data-loss event.

**How this phase defends:** Designs `doc_yjs_updates` as **append-only** (no deletes; tombstones via Yjs internal mechanism), with a `client_anno_id` column that maps 1:1 to the legacy `document_annotations.client_anno_id`. Phase 30 (dual-write) reads the `client_anno_id` to maintain the bridge. **Critical: this schema does NOT include "diff between cloud and local means delete" semantics.** That was the simple-sync killer. Append-only + idempotent backfill keyed by `client_anno_id` is the only pattern allowed.

**Warning signs to surface in verification:**
- Phase 28+ schema review must confirm no DELETE statements anywhere in the migration code path.
- Idempotent backfill test: run the backfill twice, confirm zero duplicates (Phase 30 owns the actual backfill; Phase 27 just verifies the schema supports it).

### Pitfall 2: y-indexeddb multi-tab corruption — `yjs/y-indexeddb#25`

**What goes wrong:** Two tabs in same browser/Electron window both instantiate `IndexeddbPersistence` against the same `Y.Doc.guid`, both flush updates to the same IDB store, replay-on-reload duplicates updates and silently drifts the doc.

**Status:** GitHub issue verified open as of 2026-04-27 (no resolution upstream).

**How this phase defends:** Web Locks API election (Pattern 2 above). The leader tab is the ONLY tab that instantiates `IndexeddbPersistence`. Loser tabs participate via in-memory Y.Doc + BroadcastChannel updates. CONTEXT.md UX is preserved: both tabs are read/write to the user; only the IDB write path is single-leader.

**Warning signs:**
- IndexedDB store size grows linearly with tab opens (not edits) → election broken.
- Annotations appear, vanish, reappear during reload → duplicate updates being replayed.
- Playwright two-tab scenario must verify zero duplicate updates in IDB after concurrent edits.

### Pitfall 5: 1-second verify-wipe regression — applyUpdate-only invariant

**What goes wrong:** A naive "rehydrate from server snapshot" step replaces in-flight local Y.Doc state, wiping the user's mid-flight edit. Same family of bug as the simple-sync killer.

**How this phase defends:** `applyUpdate`-only invariant (Pattern 3 above). The grep assertion catches `new Y.Doc(` outside the registry. The runtime BroadcastChannel update path uses `Y.applyUpdate`, never replacement. Phase 28's transport adapter inherits this rule.

**Warning signs:**
- A user reports "my redline disappeared right after the app loaded."
- Logs show `applyUpdate` followed within <2 seconds by a delete-set-overlap with what the user just drew.
- Any code path constructing `new Y.Doc()` outside `ydocRegistry.js` is a smell.

### Pitfall 10: Y.Doc grows forever — snapshot architecture from day 1

**What goes wrong:** Without snapshot compaction, a Y.Doc with a year of edits hits the ~5MB-encoded mark, blowing past Supabase Realtime's 1MB initial-sync payload limit.

**How this phase defends:** Schema includes `doc_yjs_state (bytea snapshot)` with a `through_seq` column. Phase 32 builds the actual compaction job; Phase 27 just guarantees the schema can hold a snapshot + a sequence number for "updates after this snapshot" replay.

**Compaction cadence v1 (Claude's discretion — back-of-envelope estimate, Phase 32 owns hardening):**
- Trigger snapshot when `count(updates after last snapshot) >= 200` OR `time-since-last-snapshot >= 24 hours` AND there's been at least one new update.
- Sizing: an annotation Y.Map update is ~100-500 bytes. 200 updates ≈ 60KB delta to compact. Daily active doc with 50 edits/day → snapshot every ~4 days. Idle doc → snapshot once a day. 1MB soft cap on total payload (snapshot + tail) → effectively never approaches the Supabase Realtime limit.
- Implementation deferred to Phase 32. Phase 27 ships only the schema column.

### Pitfall 12: Y.Map vs Y.Array — schema choice locked

**What goes wrong:** Choosing Y.Array for the per-page annotation list creates positional-identity bugs and contention.

**How this phase defends:** Schema design locks `Y.Map<annotationId, Y.Map<field,value>>` for annotations and callouts at the Y.Doc root. Phase 29 implements; Phase 27 documents the schema convention so Phase 29 has no decision to make.

### Pitfall 15: Wrong column type — bytea, not TEXT

**What goes wrong:** Storing Yjs binary updates as TEXT requires base64 encoding; supabase-js v2 has imperfect bytea round-trips in some configurations; JSON.stringify on a Uint8Array silently produces `{"0":1,...}`.

**How this phase defends:** Schema columns are `bytea`. The migration includes a round-trip test (encode a Y.Doc, INSERT, SELECT, decode, deep-equal). One tested I/O module is the ONLY place that touches the binary boundary.

**Warning signs:**
- `Y.applyUpdate` throws on data that came back from Supabase → encoding pipeline is corrupting.
- `content_size_bytes` doesn't match `length(content)` server-side → corruption mid-flight.

### Pitfall 17: Schema evolution — version columns from day 1

**What goes wrong:** v2.5 adds a new annotation field; v2.4 client receives it and falls over.

**How this phase defends:** Every Y.Map shape includes a `meta.schemaVersion` field. The data model document (Phase 29) defines forward-compat reading rules; Phase 27 just locks the convention that every Y.Map.set goes through a typed builder that emits `schemaVersion`.

### Pitfall 20: Y.Doc per session leak — registry pattern

**Defended by Pattern 1 above.** Registry keyed by `documentId`, never by session-id. Per-PDF Y.Doc, never workspace-scoped.

### Pitfall 21: Destroy mid-tx — lifecycle pattern

**Defended by Pattern 1 above.** `releaseYDoc` does NOT destroy. Destroy only on app close, after `provider.disconnect()` flushes. Phase 27 documents this; Phase 28 wires the provider disconnect.

### Pitfall 22: AGPL contagion — license CI gate

**Defended by:** `license-checker --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;CC0-1.0;0BSD;Unlicense'` in a new GitHub Actions step. Hard CI block (rationale below).

**Failure mode recommendation: HARD CI block.** Rationale:
- Project is Stripe-billed → AGPL contagion is commercially fatal.
- New deps land via PR; PR-time block costs minutes; post-merge discovery costs days/weeks of legal review.
- "Warn only" softens the gate to a recommendation; humans miss recommendations in busy review queues.
- All three Yjs packages are MIT-verified; the gate is forward-protection against a future transitive dep, not a current threat.

**Trade-off accepted:** A new dev might hit the gate on a legitimate package and feel friction. Mitigation: the failure message includes the offending package, its license, and a clear "if this is intentional, add `@2tag-license-waiver: <reason>` to PR body" escape hatch. (The escape hatch is a manual step — `license-checker` doesn't natively support it, so the waiver tag is a human-review marker, not an auto-bypass.)

## Code Examples

Verified patterns from Yjs official docs + this app's existing conventions.

### Constructing a Y.Doc in the registry (only allowed location)

```js
// src/lib/collab/ydocRegistry.js
// Source: https://docs.yjs.dev/api/y.doc + this app's convention
import * as Y from 'yjs';

const REGISTRY = (globalThis.__ydocRegistry__ ??= new Map());

export function getOrCreateYDoc(documentId) {
  let entry = REGISTRY.get(documentId);
  if (!entry) {
    // applyUpdate-only invariant — the ONE allowed `new Y.Doc(` site.
    const doc = new Y.Doc({ guid: documentId, autoLoad: false });
    entry = { doc, refCount: 0, createdAt: Date.now() };
    REGISTRY.set(documentId, entry);
  }
  entry.refCount += 1;
  return entry.doc;
}
```

### Mounting at the document-open boundary (App.jsx waiver site)

```jsx
// src/App.jsx — narrow waiver, mount only.
// Source: existing useEffect at App.jsx:~20772 that fires on (pdfFile?.id, user?.id) becoming non-null.
// The YDocProvider wraps the document body so all child components see the Y.Doc.

// BEFORE (existing code):
//   {pdfFile && <SyncfusionPDFContainer pdfFile={pdfFile} ... />}

// AFTER (Phase 27):
{pdfFile && (
  <YDocProvider docId={pdfFile.id}>
    <SyncfusionPDFContainer pdfFile={pdfFile} {...rest} />
  </YDocProvider>
)}
```

The provider unmounts when `pdfFile` becomes null (PDF closed) and remounts on a different docId (PDF switched). Internally, the Y.Doc is held by the registry and survives unmount/remount.

### Web Locks election + IndexeddbPersistence (full path)

See **Pattern 2** above (`attachLifecycle` function).

### Storage-failure detection wiring

```js
// src/lib/collab/storageFailureDetector.js
// Source: MDN IndexedDB error model
export function attachStorageFailureDetector({ onState }) {
  const handlers = [];
  const wrap = (eventName, handler) => {
    window.addEventListener(eventName, handler);
    handlers.push(() => window.removeEventListener(eventName, handler));
  };

  wrap('unhandledrejection', (e) => {
    const name = e.reason?.name;
    if (name === 'QuotaExceededError') {
      onState({ code: 'quota_exceeded', message: 'Local storage is full.', error: e.reason });
    } else if (name === 'InvalidStateError') {
      onState({ code: 'invalid_state', message: 'Local storage is unavailable in this browser context (often private browsing).', error: e.reason });
    } else if (name === 'VersionError') {
      onState({ code: 'version_mismatch', message: 'Local cache was made by a newer version. Clear browser cache to fix.', error: e.reason });
    }
  });

  // y-indexeddb opens IDB via indexedDB.open() — listen for `blocked` and connection failures.
  // Implementation note: this is best-effort. The y-indexeddb library does not expose its
  // IDBOpenDBRequest publicly, so we rely on unhandledrejection to catch the post-open errors.

  return { detach() { handlers.forEach((fn) => fn()); } };
}
```

### Schema migration (Supabase)

```sql
-- supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql
-- Source: STACK.md schema design + ARCHITECTURE.md §6 (Option B append-only log)
-- Phase 27 ships SCHEMA + RLS STUBS only. Phase 28 lands full RLS policies.

CREATE TABLE IF NOT EXISTS doc_yjs_updates (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,                            -- Y.Doc clientID (per-tab)
  seq         BIGINT NOT NULL,                          -- per-document monotonic; populated by Phase 28
  update      BYTEA NOT NULL,                           -- binary Yjs update; defends Pitfall 15
  origin      JSONB,                                    -- { userId, deviceId, sessionId, clientTs } — Phase 28 populates
  client_ts   TIMESTAMPTZ,                              -- client-claimed (forensic only)
  server_ts   TIMESTAMPTZ NOT NULL DEFAULT NOW(),       -- server-authoritative (REQ AUTH-03)
  CONSTRAINT  doc_yjs_updates_seq_uniq UNIQUE (document_id, seq)
);

CREATE INDEX IF NOT EXISTS doc_yjs_updates_doc_seq_idx
  ON doc_yjs_updates (document_id, seq);

CREATE TABLE IF NOT EXISTS doc_yjs_state (
  document_id   UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state         BYTEA NOT NULL,                          -- encoded Y.Doc state — defends Pitfall 15
  state_vector  BYTEA NOT NULL,                          -- for delta sync (Phase 28 transport)
  through_seq   BIGINT NOT NULL,                         -- updates up to this seq are folded into `state`
  encoding_version SMALLINT NOT NULL DEFAULT 1,          -- defends Pitfall 17 (schema evolution)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id            BIGSERIAL PRIMARY KEY,
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       UUID,                                    -- nullable for system events; Phase 28 will overwrite from auth.uid()
  device_id     TEXT,                                    -- OS hostname or user-renamed label
  op_type       TEXT NOT NULL,                           -- 'create' | 'update' | 'delete' | 'undo' | 'redo'
  anno_id       TEXT,
  client_ts     TIMESTAMPTZ,                             -- client-claimed (forensic only)
  server_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),      -- server-authoritative (REQ AUTH-03)
  summary       JSONB
);

CREATE INDEX IF NOT EXISTS activity_log_doc_server_ts_idx
  ON activity_log (document_id, server_ts DESC);

-- RLS STUBS — Phase 27 enables RLS but ships only "no access" / "owner-only" policies.
-- Phase 28 lands the full policy set gated on user_can_access_document().
ALTER TABLE doc_yjs_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_yjs_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log    ENABLE ROW LEVEL SECURITY;

-- Default-deny stub policies (Phase 28 replaces with proper user_can_access_document gating).
CREATE POLICY doc_yjs_updates_owner_only ON doc_yjs_updates
  FOR ALL USING (FALSE) WITH CHECK (FALSE);
CREATE POLICY doc_yjs_state_owner_only ON doc_yjs_state
  FOR ALL USING (FALSE) WITH CHECK (FALSE);
CREATE POLICY activity_log_owner_only ON activity_log
  FOR ALL USING (FALSE) WITH CHECK (FALSE);
```

### License CI gate

```yaml
# .github/workflows/license-gate.yml
# Source: standard license-checker invocation, hard-block on non-permissive licenses
name: License Gate
on:
  pull_request:
    paths:
      - 'package.json'
      - 'package-lock.json'

jobs:
  license-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: License check (production deps only)
        run: |
          npx license-checker \
            --production \
            --onlyAllow 'MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;CC0-1.0;0BSD;Unlicense' \
            --excludePrivatePackages
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-client localStorage offline cache | y-indexeddb provider — async, unlimited quota, native binary | 2018 (y-indexeddb 1.x) | localStorage's 5-10MB cap and JSON-only serialization ruled out for any non-trivial CRDT app. |
| Custom multi-tab heartbeat via localStorage polling | Web Locks API (`navigator.locks.request`) | 2022 (browser-baseline date) | OS-level exclusive lock with auto-release on tab death. Polling has races, spec-correct election doesn't. |
| Postgres-row-per-Yjs-update without compaction | Append-only log + periodic snapshots in `doc_yjs_state` | Standard since at least 2023 | A year-old hot doc replays 10K+ updates on cold load without compaction. With compaction, cold load is one snapshot + tail of recent updates. |
| Yjs binary updates stored as TEXT (base64) | `bytea` columns | 2024 (supabase-js v2.x bytea support stable) | Removes the base64-encoding round-trip and the JSON.stringify-Uint8Array bug class. (Pitfall 15) |
| Yjs awareness data inside Y.Doc | `y-protocols/awareness` (separate ephemeral CRDT) | Standard since y-protocols 1.0 (2020) | Awareness is ephemeral; Y.Doc is durable. Conflating them bloats history forever. (Pitfall 11) |

**Deprecated/outdated patterns** (do NOT propose):
- y-supabase package (broken, abandoned 2023)
- y-websocket@3.0.0 as production transport (bare-bones reference)
- localStorage-based cross-tab election
- Custom OT layer ("simpler than CRDT")
- new Y.Doc() per WebSocket connection (causes awareness flicker)

## Open Questions

1. **Compaction trigger heuristic — is "200 updates OR 24 hours" right for this app's edit cadence?**
   - What we know: a typical annotation update is 100-500 bytes. STACK.md cites 5MB as the soft danger zone for initial-sync over Supabase Realtime.
   - What's unclear: what's a typical "active" doc's update rate for this app? No production data yet.
   - Recommendation: **Ship "200 updates OR 24h" as Phase 27's documented v1.** Phase 32 collects production telemetry (snapshot size distribution, daily-active-doc update count) and tunes if needed. Acceptance cost is low — wrong cadence means slightly larger payloads, not data loss.

2. **Storage-failure detection completeness — does y-indexeddb expose enough error surface?**
   - What we know: y-indexeddb's public API does not surface IDBRequest errors. We rely on `window.unhandledrejection`.
   - What's unclear: are there silent failure modes where IDB write fails but no rejection fires? (Possible per the `#25` thread's tone.)
   - Recommendation: **Add a periodic health probe** — every 60s, the leader tab attempts a no-op IDB read; on failure, fire `onStorageState({ code: 'health_probe_failed' })`. Cheap insurance.

3. **BroadcastChannel payload-size limits.**
   - What we know: BroadcastChannel uses structured-clone, supports `Uint8Array` natively. Spec doesn't define a hard cap, but Chrome's IPC has practical limits (~32MB).
   - What's unclear: do bulk Yjs updates (e.g., a paste of 100 annotations = ~50KB) flow cleanly?
   - Recommendation: **Verify in Phase 27 implementation with a synthetic 100-annotation paste in the two-tab Playwright scenario.** If it fails, fall back to "leader writes to IDB; loser reads from IDB on a bounce-bounce pattern." Almost certainly unnecessary, but cheap to verify.

4. **Desktop app single-window enforcement — Electron-side or app-side?**
   - What we know: per CONTEXT.md, two windows of the same document inside the desktop app must NOT be allowed; the second open hands the user back to the first window.
   - What's unclear: does this go in Electron's main process (`app.requestSingleInstanceLock` + per-doc message passing), or in the renderer (BroadcastChannel coordination)?
   - Recommendation: **Renderer-side BroadcastChannel + window.focus()**. The same BroadcastChannel infra used for tab leader/loser coordination can carry an "open document X" message; if a window with that doc is already open, it `window.focus()`es itself and the new window closes. Lower friction than a main-process IPC layer; works identically in browser.

5. **Feature flag / kill switch shape.**
   - What we know: per CONTEXT.md, a feature flag is desired so v2.4 can ship safely with a rollback path.
   - What's unclear: env var (build-time)? localStorage override (per-user runtime)? Supabase `feature_flags` row (per-account remote)?
   - Recommendation: **Three-tier read order: localStorage > env var > default-on.**
     - `localStorage.getItem('CRDT_LAYER_DISABLED') === '1'` overrides everything (per-tab developer/user escape hatch).
     - `import.meta.env.VITE_CRDT_LAYER_DISABLED === '1'` overrides default (build-time off-switch).
     - Default: ON in v2.4. Phase 33+ can graduate to a Supabase-row remote flag if telemetry warrants.
   - Reads via `src/lib/collab/crdtFeatureFlag.js`; planner finalizes shape.

6. **Y.Doc clientID stability across BroadcastChannel handoff.**
   - What we know: each `new Y.Doc()` constructor generates a fresh random `clientID` (Yjs internal). Per Pitfall 18, awareness flickers if clientID changes per WebSocket reconnect.
   - What's unclear: if the leader tab dies and the loser tab promotes, does the new leader's existing Y.Doc keep its clientID? (Yes — clientID is per-Y.Doc-instance, not per-provider.)
   - Recommendation: **Just verify in Phase 27 implementation that the loser-tab's Y.Doc clientID is stable across leader handoff.** Document. No work expected.

## Validation Architecture

`workflow.nyquist_validation: true` per `.planning/config.json`. All five success criteria + AUTH-03 require automated verification before phase close.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` (built-in Node test runner) for unit/integration; `@playwright/test` for browser/multi-tab scenarios |
| Config file | `package.json` script `"test": "node --test 'tests/**/*.test.mjs'"`; Playwright config at `debug/playwright.config.mjs` |
| Quick run command | `npm test` |
| Full suite command | `npm test && npx playwright test --config debug/playwright.config.mjs` |

The project's existing test convention is `node --test` for unit/integration (~25 test files in `tests/`) and a Playwright scenario harness at `debug/`. Phase 27 extends both.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-03 | Every annotation creation, edit, and deletion records a server-authoritative timestamp | unit (schema) + sql | `node --test tests/phase27/cryptYjsUpdatesSchema.test.mjs` + Supabase migration `\dt+ doc_yjs_updates` round-trip | ❌ Wave 0 |
| Success Criterion 1 | Single-user Y.Doc round-trip: open → annotate → close → reopen → state restored | playwright | `npx playwright test debug/scenarios/phase27-roundtrip.spec.mjs` | ❌ Wave 0 |
| Success Criterion 2 | Multi-tab safety: two tabs of same doc cannot duplicate IndexedDB updates | playwright (two-context) | `npx playwright test debug/scenarios/phase27-two-tab-no-dup.spec.mjs` | ❌ Wave 0 |
| Success Criterion 2 (sub) | Web Locks election promotes a new leader on tab close | playwright (two-context) | `npx playwright test debug/scenarios/phase27-leader-handoff.spec.mjs` | ❌ Wave 0 |
| Success Criterion 3 | `doc_yjs_updates`, `doc_yjs_state`, `activity_log` tables exist with bytea columns | unit (sql migration smoke) | `node --test tests/phase27/schemaPresence.test.mjs` (queries `information_schema.columns`) | ❌ Wave 0 |
| Success Criterion 3 (sub) | Bytea round-trip: encode Y.Doc → INSERT → SELECT → decode → deep-equal original | unit (integration) | `node --test tests/phase27/byteaRoundTrip.test.mjs` | ❌ Wave 0 |
| Success Criterion 4 | applyUpdate-only invariant: `new Y.Doc(` only inside `ydocRegistry.js` | unit (grep assertion) | `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` | ❌ Wave 0 |
| Success Criterion 4 (sub) | Server-snapshot rehydrate during in-flight local edit preserves the local edit | playwright | `npx playwright test debug/scenarios/phase27-rehydrate-no-wipe.spec.mjs` | ❌ Wave 0 |
| Success Criterion 5 | License CI gate: PR adding a non-allowed-license dep fails the workflow | CI workflow + smoke test | `.github/workflows/license-gate.yml` exists and runs `license-checker --onlyAllow ...` on PR | ❌ Wave 0 |
| Storage failure UX | Banner appears when IDB is unavailable / quota exceeded; document still opens | playwright (with IDB stub) | `npx playwright test debug/scenarios/phase27-storage-banner.spec.mjs` | ❌ Wave 0 |
| Lifecycle | Y.Doc registry: switching PDFs preserves both Y.Docs; never destroyed on switch | unit | `node --test tests/phase27/ydocRegistry.test.mjs` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` (~30s — node:test only). Catches schema/invariant/registry regressions immediately.
- **Per wave merge:** `npm test && npx playwright test --config debug/playwright.config.mjs --grep phase27` (~3 min — adds the 5 phase27 Playwright scenarios). Catches runtime browser-side regressions.
- **Phase gate:** Full suite green (existing 181/182 baseline preserved + new Phase 27 tests) before `/gsd:verify-work 27`.

### Wave 0 Gaps

The following must exist before any subsequent wave starts implementation work:

- [ ] `tests/phase27/applyUpdateOnlyInvariant.test.mjs` — grep-asserts the invariant (covers Success Criterion 4)
- [ ] `tests/phase27/ydocRegistry.test.mjs` — covers registry pattern (Pitfall 20, 21)
- [ ] `tests/phase27/schemaPresence.test.mjs` — covers Success Criterion 3 schema existence
- [ ] `tests/phase27/byteaRoundTrip.test.mjs` — covers Pitfall 15
- [ ] `tests/phase27/storageFailureDetector.test.mjs` — covers storage-failure branch surface
- [ ] `tests/phase27/cryptYjsUpdatesSchema.test.mjs` — covers AUTH-03 server_ts column existence + non-null + default `NOW()`
- [ ] `debug/scenarios/phase27-roundtrip.spec.mjs` — covers Success Criterion 1
- [ ] `debug/scenarios/phase27-two-tab-no-dup.spec.mjs` — covers Success Criterion 2
- [ ] `debug/scenarios/phase27-leader-handoff.spec.mjs` — covers leader handoff sub-criterion
- [ ] `debug/scenarios/phase27-rehydrate-no-wipe.spec.mjs` — covers Success Criterion 4 sub
- [ ] `debug/scenarios/phase27-storage-banner.spec.mjs` — covers storage-failure UX
- [ ] `.github/workflows/license-gate.yml` — covers Success Criterion 5
- [ ] `tests/phase27/conftest.mjs` (or shared `setup.mjs`) — Y.Doc fixtures, IDB-stub helper, two-tab Playwright fixture

No new test framework install required — `node --test` is built-in, Playwright is already in devDeps.

## Sources

### Primary (HIGH confidence)
- [Yjs Documentation — Document Updates (applyUpdate, encodeStateAsUpdate, mergeUpdates)](https://docs.yjs.dev/api/document-updates) — confirms updates are commutative, associative, idempotent (the math behind the applyUpdate-only rule)
- [Yjs Documentation — Y.Map (field semantics, deep observation)](https://docs.yjs.dev/api/shared-types/y.map)
- [Yjs Documentation — Y.UndoManager (trackedOrigins for per-user undo, Phase 29 prep)](https://docs.yjs.dev/api/undo-manager)
- [Yjs Documentation — Allowing offline editing (y-indexeddb wiring)](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [Yjs License (MIT)](https://docs.yjs.dev/license)
- [yjs/y-indexeddb GitHub](https://github.com/yjs/y-indexeddb) — provider source + #25 issue
- [yjs/y-indexeddb#25 — multi-tab corruption with multiple IndexeddbPersistence](https://github.com/yjs/y-indexeddb/issues/25) — confirmed open as of 2026-04-27
- [y-protocols on npm — `1.0.7`](https://www.npmjs.com/package/y-protocols) — Awareness + Sync protocols
- [MDN — Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — Baseline since March 2022; navigator.locks.request signature; release semantics
- [MDN — IndexedDB error events (QuotaExceededError, VersionError, InvalidStateError, blocked)](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/error_event)
- [npm — yjs@13.6.30](https://www.npmjs.com/package/yjs) — version verified at registry HEAD 2026-04-27
- [npm — y-indexeddb@9.0.12](https://www.npmjs.com/package/y-indexeddb) — version verified
- [npm — y-protocols@1.0.7](https://www.npmjs.com/package/y-protocols) — version verified
- [npm — license-checker@25.0.1](https://www.npmjs.com/package/license-checker) — version verified
- Internal: `.planning/research/STACK.md` — locked Yjs trio + version pins + anti-recommendations
- Internal: `.planning/research/ARCHITECTURE.md` — Y.Doc placement, registry pattern, two top-level Y.Maps, Option B append-only log
- Internal: `.planning/research/PITFALLS.md` — full 22-pitfall catalog; this phase defends 1, 2, 5, 10, 12, 15, 17, 20, 21, 22
- Internal: `.planning/research/SUMMARY.md` — single decision document; convergence + open questions
- Internal: `.planning/ROADMAP.md` Phase 27 + Phase 28 sections — success criteria + boundary notes
- Internal: `.planning/phases/27-crdt-foundation/27-CONTEXT.md` — locked decisions
- Internal: `src/App.jsx:~20772` — verified document-open boundary at the existing `useEffect(() => { const documentId = pdfFile?.id; ... }, [pdfFile?.id, user?.id])` block

### Secondary (MEDIUM confidence)
- [Yjs Community discussion — "Infinite loop of updates with React"](https://discuss.yjs.dev/t/infinite-loop-of-updates-caused-in-rare-situation-with-react/1121) — informs Phase 29's echo-loop guard but cited here for the origin-tag pattern this phase establishes
- [Yjs Community discussion — "Garbage Collection and Version Snapshotting"](https://discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839) — informs Pitfall 10 schema design
- [PowerSync blog — Postgres + Yjs CRDT pattern](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync) — bytea storage + batching pattern; informs `doc_yjs_updates` / `doc_yjs_state` schema

### Tertiary (LOW — informational only, not load-bearing)
- [AlexDunmow/y-supabase](https://github.com/AlexDunmow/y-supabase) — explicitly NOT recommended; reference for what a Supabase-Yjs binding shape looks like, not a dep

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Yjs trio versions verified at registry; license verified MIT; bundle size verified per STACK.md.
- Architecture: HIGH — registry pattern matches Yjs official guidance + this app's seam confirmed in `App.jsx`; Web Locks API spec verified MDN.
- Pitfalls (this phase's subset): HIGH — Yjs/IndexedDB/Supabase mechanics verified; pitfall mapping inherited from PITFALLS.md.
- Compaction cadence v1: MEDIUM — back-of-envelope estimate, no production telemetry; explicit Phase 32 deferral.
- Storage-failure detection completeness: MEDIUM — covered the documented IDB error names but acknowledged a possible silent-failure surface; recommended periodic health probe as insurance.
- BroadcastChannel payload limits: MEDIUM — spec is permissive but practical Chromium limits not formally measured for this app's update sizes.

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days — Yjs ecosystem is stable; Supabase Realtime / Web Locks are baseline; no fast-moving spec churn expected). If Phase 27 implementation slips past 2026-05-27, re-verify package versions only.
