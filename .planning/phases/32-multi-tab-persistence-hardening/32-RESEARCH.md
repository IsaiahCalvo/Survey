# Phase 32: Multi-Tab + Persistence Hardening — Research

**Researched:** 2026-05-14
**Domain:** Yjs persistence hardening (server-side Y.Doc snapshot/compaction with `through_seq` semantics on the existing Phase 27 `doc_yjs_state` / `doc_yjs_updates` schema), multi-tab coordination layered on top of the Phase 27 Web Locks election + BroadcastChannel update fan-out, IndexedDB-quota UX via `StorageManager.estimate()`, and Playwright multi-tab stress testing
**Confidence:** HIGH (Yjs compaction APIs + y-indexeddb internals + Web Locks + StorageManager.estimate verified against official docs and source); HIGH (existing app seam locations confirmed in source — `ydocLifecycle.js`, `YDocProvider.jsx`, `SyncStatusChip.jsx`, `crdtAnnotationBridge.js`, `crdtDualWriteQueue.js`, `doc_yjs_state` schema); HIGH (per-property LWW story — already shipped via Phase 29 `crdtAnnotationBridge.js` per-property `Y.Map.set` writes; no new layer needed for COLLAB-03 / OFFLINE-03); HIGH (anti-recommendations / what NOT to hand-roll — Yjs official guidance + this codebase's existing Phase 27 invariants)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**What you see when offline**
- Keep the existing sync chip in the left-rail footer (it already shows status today). Do not add a permanent banner.
- A more prominent banner only appears when saving is **stuck or risky** — concretely: queue has been non-empty for > 30 seconds without progress, OR the last write attempt errored. The banner is dismissible and re-shows on the next stuck-condition.
- Three sync chip states, visually distinct (not subtle dot colors): `Offline — N changes queued` / `Syncing N changes…` / `Up to date`.

**Storage filling up warning**
- Two tiers, not one.
- **Tier 1 (quiet):** at ~80% of the IndexedDB quota, surface a non-blocking warning (small banner / chip variant). Does not interrupt editing.
- **Tier 2 (loud):** when a write actually fails OR usage crosses ~95%, show a stronger blocking warning with a clear next action ("Free up space" link / suggestion to close stale tabs). Editing can be paused at this tier.

**Two tabs of the same PDF**
- The app already prevents opening the same PDF in two tabs **inside one window** — that guard stays.
- The cross-tab sync target is the edge case where the user opens the app in a second browser window (or a separate Electron window) and lands on the same document. In that case, edits in window A appear in window B within ~1 second, via BroadcastChannel.
- BroadcastChannel coordinator is per-`docId` and carries Yjs update payloads (small) plus a small awareness ping ("which tab is the active writer right now").

**Snapshot cleanup (compaction)**
- Triggered by a fixed update-count threshold, not a timer.
- Default threshold: every **100 updates** since the last snapshot. Configurable via the existing collab config surface so we can dial it for production traffic.
- Compaction runs in a background-friendly slot (idle callback, not in the middle of a user gesture). On completion, old updates beyond the snapshot's `through_seq` are pruned/archived per the existing schema design.
- Cold-load order is unchanged: apply snapshot first, then replay any updates after `through_seq`.

**Multi-tab Web Locks stress test**
- A Playwright scenario opens the same document in two tabs and runs 100+ open/close cycles, alternating which tab holds the IndexedDB lock.
- Pass criteria: zero IndexedDB corruption, every annotation made in either tab is present after reload, lock election always converges to exactly one writer.

### Claude's Discretion

- Exact pixel design / wording of the storage-quota Tier 1 chip variant — match the existing sync chip styling.
- Exact `idleCallback` vs `setTimeout` cadence for the compaction job — pick whichever measures cleaner under stress.
- The exact `BroadcastChannel` message schema — should mirror the wire format already used by the chosen Phase 28 transport so future agents recognize it.
- Whether the stuck-banner copy says "Save is stuck" vs "Couldn't reach the cloud" — pick the friendlier phrasing during planning.

### Deferred Ideas (OUT OF SCOPE)

- Y.Awareness presence pill (avatars of who is currently in the doc) — Phase 33.
- Activity log sidebar — Phase 33.
- "Pick up where you left off" cross-device resume banner — Phase 33.
- Per-annotation Tags surface (right-click + properties three-dot) — Phase 33.
- 4-role sharing UX, permission revocation, legacy decommission — Phase 34.
- Highlights moving to the CRDT path — folded into v2.5 per ROADMAP.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OFFLINE-01 | User can keep editing offline; changes persist locally and remain visible | `IndexeddbPersistence` already auto-saves every Y.Doc update (Phase 27 `ydocLifecycle.js`). The Phase 27 BroadcastChannel + Web Locks election + `applyUpdate`-only invariant + Y.Doc's own update queue mean offline edits are durable the moment the user's pointer lifts. Phase 32's job: ship a Playwright scenario that **proves** OFFLINE-01 (network off → 10 annotations → reload → visible), and harden it against the storage-fail edge cases that the existing `storageFailureDetector.js` already surfaces. See § Standard Stack + § Validation Architecture. |
| OFFLINE-02 | Reconnect = silent merge with no conflict dialog | `SupabaseYjsProvider.js` already does the on-reconnect handshake (`sync_request` → `syncStep2` reply with the missing-updates delta) inside its `channel.subscribe` callback. Y.Doc's commutative/associative/idempotent `applyUpdate` semantics guarantee zero conflicts on merge. Phase 32's job: ship the reconnect scenario as Playwright + verify the sync chip cycles `Offline → Syncing → Up to date` cleanly. See § Pattern 1 + § Architecture Patterns. |
| OFFLINE-03 | Two-device offline merge — per-property LWW with timestamp tiebreak — no manual resolution | **Already implemented.** `crdtAnnotationBridge.js`'s `applyFabricCommit` writes EACH Fabric property as a separate `fabricYMap.set(key, value)` call inside one `ydoc.transact(fn, origin)`. Y.Map's CRDT semantics give per-key LWW by Yjs's logical clock automatically. `meta.updatedAt` is a wall-clock value written on every update for HUMAN-READABLE display, not for convergence. Phase 32's job: ship the two-offline-devices scenario as Playwright + verify both edit sets land cleanly without a modal. **NO new LWW layer is needed.** See § Per-Property LWW (Already Solved). |
| OFFLINE-04 | Sync chip clearly shows three states (Offline N queued / Syncing N / Up to date) | Existing `SyncStatusChip.jsx` already reads from `getSyncStatusViewModel(status, queueSize, manualSyncing)` in `src/utils/syncStatusViewModel.js`. Phase 32 extends the view-model + chip copy to: (1) the locked three-state copy verbatim (`Offline — N changes queued` / `Syncing N changes…` / `Up to date`), (2) the Tier-1 quota variant, and (3) a stuck-banner trigger that fires on the existing `cloudSyncQueueSize > 0 for > 30s` signal (already in `crdtDualWriteQueue.STUCK_THRESHOLD_MS`). The chip already mounts inside `PDFSidebar.jsx` (lifted to App-shell `#chrome-left-host` 2026-05-13) — narrow App.jsx waiver is for state-wiring only, NOT a re-mount. See § Sync Chip Architecture + § Code Examples. |
</phase_requirements>

## Summary

Phase 32 production-hardens four invisible-plumbing surfaces of the Yjs collaboration stack that Phase 27 + 28 + 29 + 31 already ship in working form. The four surfaces map cleanly to the four requirements: (OFFLINE-01) offline editing already works locally — Phase 32 proves it under Playwright; (OFFLINE-02) reconnect handshake already works in `SupabaseYjsProvider.js` — Phase 32 proves the silent merge; (OFFLINE-03) per-property LWW is already implemented via `crdtAnnotationBridge.js` writing each Fabric prop as one `Y.Map.set` call — Phase 32 proves two-device merge; (OFFLINE-04) the sync chip already mounts and reads queue size — Phase 32 swaps the copy to the three locked strings, adds a Tier-1 quota variant, and gates a stuck banner.

Two genuinely new files land: `src/lib/collab/yDocCompaction.js` (the periodic snapshot job that writes to `doc_yjs_state` and prunes `doc_yjs_updates` rows below `through_seq`) and `src/lib/collab/multiTabSync.js` (a per-`docId` BroadcastChannel coordinator that adds awareness / "active writer" pings on top of the EXISTING update fan-out in `ydocLifecycle.js`). A new Playwright suite under `debug/scenarios/phase32-*` carries the multi-tab stress test (100+ open/close cycles + 2-tab edit verification) plus the four offline-flow happy paths.

**Primary recommendation:** Ship as four small workstreams that plan independently and merge through a single Wave 0 (test scaffolds) — Wave 1: `yDocCompaction.js` + server-side schema migration for `through_seq` archival semantics; Wave 2: `multiTabSync.js` + integration into existing `ydocLifecycle.js`; Wave 3: sync chip copy + Tier-1 quota variant + stuck-banner trigger (App.jsx narrow waiver land here ONLY); Wave 4: Playwright stress + four offline-flow scenarios. **Do NOT touch `crdtAnnotationBridge.js` — per-property LWW is already done.** **Do NOT touch the wire format in `SupabaseYjsProvider.js` / `HocuspocusYjsProvider.js`.** **Do NOT modify `IndexeddbPersistence` — y-indexeddb's internal `PREFERRED_TRIM_SIZE=500` auto-compaction is orthogonal to this phase's SERVER-side snapshot job.**

## Standard Stack

### Core (Existing — Do Not Re-Add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yjs` | `^13.6.30` (already installed Phase 27) | CRDT primitives — `Y.Doc`, `Y.Map`, `Y.encodeStateAsUpdate`, `Y.encodeStateVector`, `Y.applyUpdate`, `Y.mergeUpdates` | Already locked. `encodeStateAsUpdate(ydoc, [stateVector])` is the canonical compaction primitive — produces a single binary update that contains the entire document history, safe to write to `doc_yjs_state.state`. |
| `y-indexeddb` | `^9.0.12` (already installed Phase 27) | IndexedDB persistence — the LOCAL store this phase reads usage of (via `StorageManager.estimate()`) but does NOT modify | Already locked. Crucial finding: y-indexeddb has its OWN internal compaction at `PREFERRED_TRIM_SIZE=500` updates, debounced 1000ms — Phase 32's compaction job is SERVER-SIDE (writes `doc_yjs_state` row, prunes `doc_yjs_updates` rows), NOT a replacement for y-indexeddb's local trimming. |
| `y-protocols` | `^1.0.7` (already installed Phase 27) | `sync` + `awareness` wire framing reused by `SupabaseYjsProvider.js`; Phase 32's BroadcastChannel coordinator mirrors this frame shape per CONTEXT.md decision | Already locked. The new `multiTabSync.js` reuses the EXISTING `encodeUpdate` / `decodeAndApply` helpers exported from `SupabaseYjsProvider.js` so future agents recognize the wire format. |
| `@supabase/supabase-js` | `^2.81.1` (already installed) | Server-side snapshot writes go through the existing supabase client — `doc_yjs_state` UPSERT + `doc_yjs_updates` DELETE WHERE seq < through_seq | Already locked. RLS policies on `doc_yjs_state` are already in place from Phase 28; Phase 32 adds NO new tables. |

### Supporting (Browser Natives — Zero New Deps)

| API | Surface | Purpose | When to Use |
|-----|---------|---------|-------------|
| `navigator.locks.request(name, {mode:'exclusive'}, cb)` | Baseline since March 2022; all major browsers + Electron | Phase 27 already uses this for the leader-tab election (`y-doc-${docId}` lock). Phase 32 STRESS-TESTS it, doesn't extend it. | Already mounted in `ydocLifecycle.js:119`. Stress testing happens at the Playwright layer, not the lib layer. |
| `BroadcastChannel` | Baseline; all major browsers + Electron | Phase 27 already wires `y-doc-bc-${docId}` for Y.Doc update fan-out between same-origin tabs. Phase 32's `multiTabSync.js` adds a SECOND channel (or reuses the same one with a typed message) for awareness/"active writer" coordination. | Existing usage in `ydocLifecycle.js:78`. New file `multiTabSync.js` layers awareness pings without duplicating the update fan-out. |
| `navigator.storage.estimate()` | Baseline since September 2023; secure-context only; returns `{usage, quota, usageDetails?}` | Phase 32 reads usage/quota every ~30s (or after every IDB write batch) to drive the Tier-1 / Tier-2 quota UX. | Polling cadence: ~30s while document is open; immediate read on every `quota_exceeded` event from `storageFailureDetector.js`. **Electron caveat:** `estimate()` reports free disk space, not the documented 1/3-of-disk quota — treat the Electron number as "lots of headroom" rather than a precise quota; trigger Tier-1 on **`usage > 80% of quota`** in browser, **`usage > 1GB`** in Electron as a sanity guard (the user's PDF annotation Y.Doc updates accumulate slowly — 1GB is many tens of thousands of edits). |
| `requestIdleCallback` (+ `setTimeout` fallback) | All major browsers except Safari (Safari has `requestIdleCallback` in TP 200+, ship a `setTimeout(fn, 200)` fallback) | Schedule the compaction job in an idle slot per CONTEXT.md "not in the middle of a user gesture". | Trigger on the 100th update since last snapshot — schedule `requestIdleCallback(runCompaction, {timeout: 5000})` so the job runs within 5s even under sustained editing. |

### Alternatives Considered

| Instead of | Could Use | Why we are NOT using it |
|------------|-----------|-------------------------|
| Server-side compaction job (this phase's approach) | Periodic SQL trigger / pg_cron job | Would require server cron infra + would race with live `doc_yjs_updates` inserts. Client-side compaction lets the same Y.Doc that's already in memory write the snapshot — zero new infra, no race window with in-flight edits because the snapshot is written ATOMICALLY (state + through_seq + prune in one transaction). |
| Custom multi-tab leader heartbeat | `localStorage`-poll / `setInterval` heartbeat | Already rejected in Phase 27. `navigator.locks` is OS-level exclusive and auto-releases on tab close — heartbeats have race windows. Phase 32 inherits this decision. |
| Custom per-property LWW timestamp comparator | LWWMap (`y-lwwmap` library) | Y.Map's native per-key LWW already covers COLLAB-03 / OFFLINE-03. `meta.updatedAt` is human-display only, not convergence. Adding `y-lwwmap` would be redundant and would change the on-wire format — out of scope per CONTEXT.md. |
| Periodic IDB-quota polling | Listen for `quotaexceedederror` only | Polling gives us the Tier-1 (80%) WARN before the hard failure. Without polling, the user only sees Tier-2 (the write actually failed). Polling is cheap (`estimate()` is a single async API call). |

**Installation:**
```bash
# No new packages required.
# Browser natives + existing yjs/y-indexeddb/y-protocols/@supabase/supabase-js cover everything.
```

**Version verification (registry HEAD at 2026-05-14):** Already verified in Phase 27 — `yjs@13.6.30`, `y-indexeddb@9.0.12`, `y-protocols@1.0.7`, `@supabase/supabase-js@2.81.1`. No bumps in this phase; the schema and wire format are locked.

## Architecture Patterns

### Recommended File Layout

```
src/lib/collab/
├── yDocCompaction.js     # NEW — periodic snapshot job (per-docId, started by YDocProvider)
├── multiTabSync.js       # NEW — BroadcastChannel awareness/active-writer coordinator
├── storageQuotaMonitor.js # NEW (optional, can live inside SyncStatusChip) — Tier-1/Tier-2 quota poll loop
├── ydocLifecycle.js      # EXISTING — Web Locks election + IndexeddbPersistence + BC update fan-out (DO NOT REWRITE)
├── ydocRegistry.js       # EXISTING — Y.Doc factory (DO NOT TOUCH)
├── storageFailureDetector.js # EXISTING — already detects QuotaExceededError (REUSE for Tier-2)
├── crdtAnnotationBridge.js # EXISTING — per-property LWW already shipped (DO NOT TOUCH)
├── crdtDualWriteQueue.js # EXISTING — STUCK_THRESHOLD_MS=30000 already drives stuck banner (REUSE)
└── SupabaseYjsProvider.js # EXISTING — wire format locked; export encodeUpdate/decodeAndApply for multiTabSync (REUSE)

src/components/collab/
└── YDocProvider.jsx       # EXISTING — mounts yDocCompaction + multiTabSync per docId (additive, no rewrite)

src/components/
└── SyncStatusChip.jsx     # EXISTING — extend with three-state copy + Tier-1 quota variant

src/utils/
└── syncStatusViewModel.js # EXISTING — extend with locked three-state strings + quota state

src/App.jsx                # NARROW WAIVER — sync chip state wiring + Tier-2 banner mount ONLY

debug/scenarios/
├── phase32-offline-edit-persist.spec.mjs       # NEW — OFFLINE-01
├── phase32-reconnect-silent-merge.spec.mjs     # NEW — OFFLINE-02
├── phase32-two-device-offline-merge.spec.mjs   # NEW — OFFLINE-03 (uses two browser contexts as "devices")
├── phase32-sync-chip-three-states.spec.mjs     # NEW — OFFLINE-04
├── phase32-multi-tab-stress.spec.mjs           # NEW — 100+ cycle Web Locks stress
└── phase32-compaction-roundtrip.spec.mjs       # NEW — snapshot write + prune + cold-load replay

tests/phase32/
├── yDocCompaction.test.mjs       # unit — snapshot threshold + prune + recovery
├── multiTabSync.test.mjs         # unit — BroadcastChannel message routing + echo guard
├── storageQuotaMonitor.test.mjs  # unit — Tier-1/Tier-2 threshold transitions
└── syncStatusViewModel.test.mjs  # unit — three locked-copy strings + quota variants
```

### Pattern 1: Server-Side Y.Doc Compaction (the new file)

**What:** When the count of `doc_yjs_updates` rows since the last snapshot crosses 100, schedule a `requestIdleCallback` that:
1. Reads `ydoc` from the in-memory registry (it's the leader-tab's live doc).
2. Computes `nextThroughSeq = max(seq) FROM doc_yjs_updates WHERE document_id = $1`.
3. Computes `state = Y.encodeStateAsUpdate(ydoc)` and `stateVector = Y.encodeStateVector(ydoc)`.
4. UPSERTs `doc_yjs_state {document_id, state, state_vector, through_seq: nextThroughSeq, encoding_version: 1, updated_at: NOW()}`.
5. DELETEs `doc_yjs_updates WHERE document_id = $1 AND seq <= nextThroughSeq` (the prune step).
6. Records the new "updates since last snapshot" baseline (zero out the local counter).

**When to use:** Only on the LEADER tab (Web Locks election winner). Loser tabs already short-circuit because they don't write to IDB; they also must not write to `doc_yjs_state`.

**Why server-side compaction (not local):** y-indexeddb's `PREFERRED_TRIM_SIZE=500` already locally trims the browser IndexedDB store every 1000ms after threshold. The Phase 27 schema's `doc_yjs_state` table is the CLOUD-side compaction target — it lets new devices/sessions cold-load with one `SELECT state FROM doc_yjs_state WHERE document_id = $1` + a tail of recent updates, instead of replaying tens of thousands of `doc_yjs_updates` rows.

**Concurrency guard (atomicity):** The UPSERT + DELETE must be one transaction so a crash mid-compaction can't leave the schema in a state where the snapshot is written but the updates aren't pruned (cold load would replay both — idempotent but slow), OR worse, updates pruned but snapshot UPSERT failed (cold load would lose data). Use a Postgres function (`compact_yjs_doc(document_id uuid, state bytea, state_vector bytea, through_seq bigint)`) called via `supabase.rpc()` for transactional atomicity. **Pitfall:** plain Supabase JS client UPSERT + DELETE are TWO round-trips and NOT atomic.

**Recovery story if a snapshot is corrupt:** The `doc_yjs_updates` rows up to `through_seq` are PRUNED only AFTER the snapshot row is persisted (transactional order). If a cold-load discovers `Y.applyUpdate(ydoc, state)` throws (corrupt bytea), the recovery path is:
1. Fall back to "no snapshot" cold-load (replay all `doc_yjs_updates` rows from seq 0).
2. Surface `storageFailureDetector` code `snapshot_corrupt` (NEW code Phase 32 adds) so the user sees a one-line banner: "Cloud cache rebuilding — please don't close this window."
3. After ~5s of replay-fallback rendering, the leader tab writes a fresh snapshot from the rebuilt Y.Doc — self-healing.
4. **Audit invariant:** never DELETE `doc_yjs_updates` rows that are referenced by an unverified snapshot. The transactional `compact_yjs_doc()` RPC verifies the snapshot writes successfully before the prune step.

**Example:**
```javascript
// src/lib/collab/yDocCompaction.js — Source: Phase 27 27-RESEARCH.md § Pattern 10 + Yjs docs § encodeStateAsUpdate
// NEW FILE — to be created in Wave 1 of this phase.

import * as Y from 'yjs';
import { supabase } from '../../supabaseClient.js';

const DEFAULT_THRESHOLD = 100; // CONTEXT.md decision; configurable via options.threshold
const IDLE_TIMEOUT_MS = 5000;

export function attachCompaction(ydoc, documentId, options = {}) {
  if (!ydoc || !documentId) throw new Error('[yDocCompaction] ydoc + documentId required');
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const onCompacted = options.onCompacted ?? (() => {});
  const onError = options.onError ?? (() => {});

  let updatesSinceLastSnapshot = 0;
  let scheduled = false;
  let detached = false;

  const runCompaction = async () => {
    if (detached) return;
    scheduled = false;
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      const stateVector = Y.encodeStateVector(ydoc);
      // UX comment: rpc('compact_yjs_doc') is the atomic snapshot-write + prune
      // server function. Atomic so a mid-flight crash can't leave a referenced
      // snapshot pruned. SELECT max(seq) happens inside the function so the
      // through_seq the client thinks is current matches reality at write time.
      const { data, error } = await supabase.rpc('compact_yjs_doc', {
        p_document_id: documentId,
        p_state: state,
        p_state_vector: stateVector,
      });
      if (error) throw error;
      updatesSinceLastSnapshot = 0;
      onCompacted({ throughSeq: data?.through_seq, bytes: state.byteLength });
    } catch (err) {
      onError(err);
    }
  };

  const schedule = () => {
    if (scheduled || detached) return;
    scheduled = true;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runCompaction, { timeout: IDLE_TIMEOUT_MS });
    } else {
      setTimeout(runCompaction, 200);
    }
  };

  const onUpdate = () => {
    if (detached) return;
    updatesSinceLastSnapshot += 1;
    if (updatesSinceLastSnapshot >= threshold) schedule();
  };

  ydoc.on('update', onUpdate);
  return {
    detach() {
      detached = true;
      try { ydoc.off('update', onUpdate); } catch { /* swallow */ }
    },
    // Test seam: force a compaction without waiting for the threshold.
    _forceCompactForTest: runCompaction,
  };
}
```

### Pattern 2: BroadcastChannel Awareness Coordinator (the second new file)

**What:** A per-`docId` BroadcastChannel that carries **awareness** ("who's the active writer in tab A right now") and small Y.Doc update notifications. Layers on top of `ydocLifecycle.js`'s EXISTING update fan-out — does NOT replace it.

**Wire frame mirrors SupabaseYjsProvider:** Per CONTEXT.md "should mirror the wire format already used by the chosen Phase 28 transport". The new file imports `encodeUpdate` + `decodeAndApply` from `SupabaseYjsProvider.js` (already exported) and uses the same `MESSAGE_SYNC` / `MESSAGE_AWARENESS` framing bytes.

**When to use:** Started by `YDocProvider.jsx` per docId on mount; stopped on unmount. Coexists with the existing `ydocLifecycle.js` BC — Phase 27's BC handles update fan-out, Phase 32's BC handles **awareness pings** + an optional "active writer" debounce ping that lets tab B show a subtle indicator "tab A is currently editing this annotation."

**Channel naming clarity:** Phase 27 already owns `y-doc-bc-${docId}`. Phase 32's new channel: `y-doc-aware-${docId}`. Two separate channels avoid having to discriminate message types on the same channel and avoid breaking the Phase 27 echo-guard contract (`REMOTE_BC_ORIGIN.source === 'remote-bc'`).

**Anti-pattern:** Do NOT post Y.Doc updates on the new channel. Phase 27's `ydocLifecycle.js` already does this perfectly with the `REMOTE_BC_ORIGIN` echo guard. Duplicating that path would create double-application bugs and re-amplify the cross-tab loop the Phase 27 sentinel was designed to cut.

**Example:**
```javascript
// src/lib/collab/multiTabSync.js — Source: Phase 27 ydocLifecycle.js BC pattern + y-protocols/awareness
// NEW FILE — to be created in Wave 2 of this phase.

import * as awarenessProtocol from 'y-protocols/awareness';

const REMOTE_AWARE_ORIGIN = Object.freeze({ source: 'remote-aware-bc' });

export function attachMultiTabSync(ydoc, awareness, documentId, options = {}) {
  if (!ydoc || !documentId) throw new Error('[multiTabSync] ydoc + documentId required');
  if (typeof BroadcastChannel === 'undefined') {
    return { detach: () => {}, getRemoteWriters: () => [] };
  }

  const channelName = `y-doc-aware-${documentId}`;
  const bc = new BroadcastChannel(channelName);
  let detached = false;

  // ---------------------------------------------------------------------
  // OUTBOUND: awareness changes (cursor / active writer / focus) are
  // broadcast to other tabs of the same origin.
  // ---------------------------------------------------------------------
  const onAwarenessUpdate = ({ added, updated, removed }) => {
    if (detached || !awareness) return;
    const changedClients = added.concat(updated).concat(removed);
    const payload = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients);
    bc.postMessage({ type: 'awareness', payload, originClientId: ydoc.clientID });
  };
  if (awareness) awareness.on('update', onAwarenessUpdate);

  // ---------------------------------------------------------------------
  // INBOUND: awareness from another tab — apply to local awareness state
  // with REMOTE_AWARE_ORIGIN so the Phase 28 transport's awareness publisher
  // can short-circuit (don't re-broadcast onto the realtime wire).
  // ---------------------------------------------------------------------
  bc.onmessage = (ev) => {
    if (detached) return;
    if (ev.data?.originClientId === ydoc.clientID) return; // self-echo guard
    if (ev.data?.type === 'awareness' && awareness && ev.data.payload) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        new Uint8Array(ev.data.payload),
        REMOTE_AWARE_ORIGIN
      );
    }
  };

  return {
    detach() {
      detached = true;
      try { if (awareness) awareness.off('update', onAwarenessUpdate); } catch { /* swallow */ }
      try { bc.close(); } catch { /* swallow */ }
    },
  };
}

export { REMOTE_AWARE_ORIGIN };
```

### Pattern 3: IndexedDB Quota Polling + Tier-1/Tier-2 UX

**What:** A small polling loop reads `navigator.storage.estimate()` every ~30s (and immediately on every `quota_exceeded` event from `storageFailureDetector.js`). Surfaces three states upward to `SyncStatusChip` / `YDocProvider`:
- `quota_ok`: `usage < 80% of quota`
- `quota_tier1`: `usage >= 80%` — chip variant + tooltip "Local storage filling up"
- `quota_tier2`: `usage >= 95%` OR a `quota_exceeded` event fired — banner "Free up space"

**When to use:** Mounted once per `YDocProvider` (i.e., per open document). Polling stops when the document closes.

**Electron caveat:** `navigator.storage.estimate()` in Electron reports free DISK space, not the documented 1/3-of-disk quota (electron/electron#16029). In Electron, treat the number as a sanity headroom check — trigger Tier-1 on `usage > 1GB`, Tier-2 on `usage > 4GB` OR on a real `quota_exceeded` event. Browsers use the percentage thresholds.

**Detection seam:** `import.meta.env.MODE === 'production'` is reliable; `typeof navigator?.userAgent === 'string' && navigator.userAgent.includes('Electron')` discriminates Electron from browser. **Pitfall:** do NOT rely on `process.versions.electron` in renderer — contextIsolation hides it.

### Pattern 4: Sync Chip Three Locked Strings + State Wiring

**What:** `getSyncStatusViewModel(status, queueSize, manualSyncing)` in `src/utils/syncStatusViewModel.js` is the ONLY function that returns a label string. Phase 32 changes the three branches to the locked CONTEXT.md copy verbatim:
- `queueSize > 0 && offline` → `'Offline — N changes queued'` (currently `'Offline · N saved locally'`)
- `stage === 'pending' || 'syncing' || 'migrating' || 'hydrating'` → `'Syncing N changes…'` when `queueSize > 0`, `'Syncing…'` otherwise
- otherwise → `'Up to date'` (already correct)

**App.jsx narrow waiver justified for:** wiring the queueSize prop to the new compaction-status counter (so "Syncing N changes…" knows N) and mounting the Tier-2 banner adjacent to the existing storage-failure banner. Both are state-wiring lines, not new component logic.

**Anti-pattern:** Do NOT replace the chip component or re-mount it elsewhere. The chip is already in the lifted left-rail (`PDFSidebar.jsx:483`). The chrome lift on 2026-05-13 put it in the correct App-shell host already.

### Pattern 5: Multi-Tab Web Locks Stress (Playwright shape)

**What:** A Playwright `test.describe` opens TWO `BrowserContext`s (one per "device") OR a SINGLE `BrowserContext` with multiple `page`s (for the in-window-same-origin case). The 100+ open/close cycle runs as:
```javascript
for (let i = 0; i < 100; i++) {
  const tabB = await context.newPage();
  await tabB.goto(DEV_URL + `?doc=${docId}`);
  await tabB.evaluate(() => window.__phase32WaitForLeaderRole());
  await tabA.locator('[data-anno-id]').first().click(); // edit in tab A
  await tabB.locator('[data-anno-id]').first().waitFor(); // verify visible in tab B
  await tabB.close();
}
```

**Pass criteria:** After the loop, `tabA.evaluate(() => indexedDB.databases())` reports zero "stuck" databases, `tabA.evaluate(() => window.__phase32CountAnnotations())` matches the expected count from edits, AND `tabA.evaluate(() => window.__yDocLeaderRole())` returns `'leader'` (lock survived).

**Existing scaffold to model:** `debug/scenarios/phase27-two-tab-no-dup.spec.mjs` already establishes the two-browser-context pattern + IndexedDB-inspection helper. Phase 32 builds on top.

### Anti-Patterns to Avoid

- **Adding a NEW `IndexeddbPersistence` instance.** Phase 27's `ydocLifecycle.js` already owns the only one. Multi-IDB-persistence is the literal `yjs/y-indexeddb#25` corruption bug.
- **Building a custom per-property timestamp comparator.** Y.Map is already per-key LWW; `meta.updatedAt` is display-only. A custom comparator would have to decode/re-encode every update and could violate Yjs's convergence guarantees.
- **Modifying the wire format in `SupabaseYjsProvider.js`.** Phase 28 locked it. Phase 32's `multiTabSync.js` REUSES the format via the existing exported helpers.
- **Posting Y.Doc updates on the new BroadcastChannel.** `ydocLifecycle.js`'s existing BC already does this with the proven `REMOTE_BC_ORIGIN` echo guard. New BC is awareness-only.
- **Triggering compaction on a timer.** CONTEXT.md decision: update-count threshold, not time. Time-based triggers fire during idle windows when there's nothing to compact (wasted bandwidth).
- **Calling `provider.clearData()` ever in this phase.** It destroys the local IndexedDB database — that's a nuclear option for migration phases only, not compaction.
- **Letting the compaction RPC be non-atomic (UPSERT then DELETE).** A crash between the two calls can leave a snapshot referencing rows that just got pruned — or worse, prune rows that the snapshot hasn't actually written yet. Single Postgres function only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-property LWW with timestamp tiebreak (OFFLINE-03) | Custom property timestamp comparator | Y.Map's native per-key CRDT semantics (already in `crdtAnnotationBridge.js`) | Yjs convergence is mathematically proven. Adding a comparator on top is at best redundant and at worst breaks convergence. `meta.updatedAt` is the human-display tiebreak, not the convergence tiebreak. |
| Y.Doc snapshot encoding | Custom JSON serializer of all Y.Maps | `Y.encodeStateAsUpdate(ydoc)` → bytea | Round-trips the full Y.Doc history with one call. Stable binary format across `yjs@13.x`. Stored in `doc_yjs_state.state` (already bytea per Phase 27 schema). |
| Multi-tab leader election | `localStorage`-poll heartbeat / `setInterval` ping | `navigator.locks.request(name, {mode:'exclusive'}, cb)` (already mounted in `ydocLifecycle.js`) | OS-level exclusive; auto-releases on tab close; baseline since March 2022. |
| Cross-tab Y.Doc update fan-out | A new `BroadcastChannel` for updates in `multiTabSync.js` | The EXISTING channel `y-doc-bc-${docId}` in `ydocLifecycle.js` | Already proven, already has the `REMOTE_BC_ORIGIN` echo guard, already passing the Phase 27 stress test. Reuse, don't duplicate. |
| IndexedDB-quota detection | Custom IDB usage walker | `navigator.storage.estimate()` | One-line async API; baseline since September 2023; reports usage + quota + per-system breakdown. |
| Reconnect-after-offline sync handshake | Custom delta protocol | `SupabaseYjsProvider`'s existing `syncStep1 → syncStep2` exchange | Already shipped. Fires automatically on `channel.subscribe(status === 'SUBSCRIBED')`. The server replies with everything we don't have via `Y.encodeStateAsUpdate(ydoc, remoteSV)`. |
| Stuck-queue banner trigger | New polling loop | EXISTING `crdtDualWriteQueue.STUCK_THRESHOLD_MS=30000` + `useDualWriteQueue` hook | Already polls per-second and surfaces `stuckCount`. Phase 32 just gates the new banner copy on the same signal. |
| Atomic snapshot write + prune | Two-round Supabase JS calls | Single Postgres function `compact_yjs_doc(...)` called via `supabase.rpc()` | Postgres transaction primitives guarantee no torn writes. |

**Key insight:** Most of Phase 32 is **observability + the right Playwright tests**, not new code. The CRDT plumbing is already correct; the requirements are about PROVING it via tests + making the existing chip read more clearly. Two genuinely new files (`yDocCompaction.js`, `multiTabSync.js`) plus a server-side RPC migration are the only substantive code additions.

## Common Pitfalls

### Pitfall 1: Snapshot/Prune Non-Atomic (Cold-Load Data Loss)
**What goes wrong:** The compaction job UPSERTs `doc_yjs_state` then DELETEs `doc_yjs_updates WHERE seq <= through_seq` as two separate Supabase calls. A crash, network glitch, or RLS rejection between the two leaves the schema in an inconsistent state. Worst case: rows pruned but snapshot UPSERT failed → cold load reads `state` from a stale snapshot row and misses the now-deleted recent updates.
**Why it happens:** Supabase JS client `from('table').upsert(...)` and `from('table').delete(...)` are two HTTP round-trips with no transaction.
**How to avoid:** Wrap the snapshot write + prune in a Postgres function `compact_yjs_doc(p_document_id uuid, p_state bytea, p_state_vector bytea)` that computes `through_seq` server-side from `max(seq)` AT TIME OF WRITE, does both writes in one transaction, and returns the new `through_seq`. Call via `supabase.rpc('compact_yjs_doc', { ... })`.
**Warning signs:** Cold-load logs report "applied snapshot at through_seq=X but missing updates at seq=X-2"; `doc_yjs_state.through_seq` rolls backward on consecutive runs; SELECT count(*) FROM `doc_yjs_updates` doesn't shrink after a compaction success log line.

### Pitfall 2: BroadcastChannel Awareness Re-Amplification
**What goes wrong:** `multiTabSync.js` receives an awareness update from tab A, applies it locally — and the local `awareness.on('update', ...)` listener fires, broadcasting the just-applied update BACK to tab A. Tab A receives, applies, broadcasts… infinite loop.
**Why it happens:** Awareness "update" events fire for both local AND remote-applied changes. Without an origin guard, every received message re-emits.
**How to avoid:** Use `REMOTE_AWARE_ORIGIN` (frozen object) as the third arg to `awarenessProtocol.applyAwarenessUpdate(awareness, payload, REMOTE_AWARE_ORIGIN)`. The local `onAwarenessUpdate` listener compares `transaction?.origin === REMOTE_AWARE_ORIGIN` and skips the broadcast. Mirror of the Phase 27 `REMOTE_BC_ORIGIN` pattern.
**Warning signs:** DevTools BroadcastChannel inspector shows N messages/second between two tabs that aren't actively edited; tab CPU pegs while idle; awareness state oscillates rapidly between clients.

### Pitfall 3: `requestIdleCallback` Never Fires (Safari + High Load)
**What goes wrong:** Compaction is scheduled via `requestIdleCallback` but the user is sustaining edits — the browser never finds an "idle" slot, the callback never fires, and the `doc_yjs_updates` log grows past 100, then 200, then 500 with no compaction.
**Why it happens:** Safari historically lacked `requestIdleCallback` until Tech Preview ~200; even in supporting browsers, sustained input starves it.
**How to avoid:** Always pass `{ timeout: 5000 }` so it fires within 5s regardless of load. Provide a `setTimeout(fn, 200)` fallback when `requestIdleCallback` is undefined. Also surface `_forceCompactForTest` so the Playwright suite can trigger a synchronous compaction independent of the browser idle scheduler.
**Warning signs:** `doc_yjs_updates` row count grows monotonically past the configured threshold; the `onCompacted` callback fires < once per N minutes of sustained editing.

### Pitfall 4: Electron `storage.estimate()` Reports Free Disk, Not Quota
**What goes wrong:** Tier-1 warning fires at "80% of 200GB" which never trips, OR worse, the threshold trips arbitrarily as the user's disk fills with unrelated files (download folder, photos library).
**Why it happens:** Electron's `navigator.storage.estimate()` ignores the documented 1/3-of-disk quota guidance and returns total free disk space (`electron/electron#16029`).
**How to avoid:** Branch in `storageQuotaMonitor.js` on `userAgent.includes('Electron')`. In Electron, use **absolute** thresholds: Tier-1 at `usage > 1 GB`, Tier-2 at `usage > 4 GB` OR a real `QuotaExceededError`. In browsers, use the % thresholds.
**Warning signs:** Tier-1 banner never appears in Electron testing even after a long session; OR appears immediately on a near-full system disk.

### Pitfall 5: Cold-Load Order Wrong (Snapshot After Updates)
**What goes wrong:** A new device/session reads `doc_yjs_updates` first (in seq order), applies them, THEN reads `doc_yjs_state.state` and `Y.applyUpdate` it. The snapshot contains older information that gets overwritten by the newer updates that were already applied. Net effect: depending on the merge, recent edits can vanish.
**Why it happens:** Yjs `applyUpdate` is commutative + associative + idempotent so this is technically safe, BUT it's wasteful (replay then snapshot apply) and confuses debugging.
**How to avoid:** Cold-load order is **snapshot first, updates after `through_seq` next.** Read `doc_yjs_state.through_seq` first, `Y.applyUpdate(ydoc, state)`, then `SELECT * FROM doc_yjs_updates WHERE seq > through_seq ORDER BY seq` and apply each.
**Warning signs:** Cold-load is unusually slow (replays everything); the user's most recent edits sometimes "flicker" on open then settle.

### Pitfall 6: Multi-Tab Stress Test False-Pass (Lock Held but Tab Crashed)
**What goes wrong:** The Playwright 100-cycle loop closes tab B "successfully" but the browser doesn't actually release the Web Lock for ~1-2s (process teardown lag). The next iteration's `tabB.evaluate(() => window.__yDocLeaderRole())` returns `'leader'` because the OLD lock from the previous iteration is still being released — the new tab thinks it's the leader, but so does tab A, and BOTH instantiate `IndexeddbPersistence`. Test reports green but `yjs/y-indexeddb#25` corruption fires silently.
**Why it happens:** Web Lock release is tied to tab process exit, which is async.
**How to avoid:** Add `await page.waitForTimeout(200)` (or better: `page.evaluate(() => navigator.locks.query())` to confirm the lock is actually released) BEFORE the next iteration. Assert that exactly ONE tab reports `'leader'` per check.
**Warning signs:** Stress test passes but a manual two-tab session shows duplicated IDB writes; the test occasionally fails non-deterministically with "two leaders detected" assertions.

### Pitfall 7: y-indexeddb Internal Compaction Conflicting with Phase 32 Compaction
**What goes wrong:** y-indexeddb internally trims its local IDB store every 500 updates (debounced 1000ms). Phase 32 compaction operates on the SERVER schema (`doc_yjs_state`). A naive implementation conflates the two — e.g. tries to "reset" the local IDB after a server compaction, breaking offline edits in flight.
**Why it happens:** Both layers use the word "compaction" but operate on different stores. The Phase 32 compaction does NOT touch local IndexedDB.
**How to avoid:** Document clearly in `yDocCompaction.js` that the file ONLY writes `doc_yjs_state` + prunes `doc_yjs_updates`. The local IDB is owned by y-indexeddb's internal logic. Do not call `persistence.clearData()` from this phase ever.
**Warning signs:** Local edits disappear after a compaction; offline editing breaks the moment compaction runs.

## Code Examples

### Example 1: `compact_yjs_doc` Postgres RPC (Wave 1 migration)

```sql
-- supabase/migrations/20260520000000_phase32_compaction_rpc.sql
-- Phase 32 — Server-side atomic snapshot write + prune.
-- Source: .planning/phases/32-multi-tab-persistence-hardening/32-RESEARCH.md § Pattern 1
-- Defends Pitfall 1 (Snapshot/Prune Non-Atomic).

CREATE OR REPLACE FUNCTION compact_yjs_doc(
  p_document_id UUID,
  p_state BYTEA,
  p_state_vector BYTEA
)
RETURNS TABLE(through_seq BIGINT, bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER  -- function runs as the role that created it; RLS check happens manually below
AS $$
DECLARE
  v_through_seq BIGINT;
BEGIN
  -- RLS check: caller must be authorized to write this document.
  -- Reuses the helper from Phase 28's user_can_access_document.
  IF NOT user_can_access_document(auth.uid(), p_document_id) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Compute the seq at write time so concurrent inserts don't race.
  SELECT COALESCE(MAX(seq), 0) INTO v_through_seq
    FROM doc_yjs_updates
    WHERE document_id = p_document_id;

  -- Snapshot UPSERT.
  INSERT INTO doc_yjs_state (document_id, state, state_vector, through_seq, encoding_version, updated_at)
    VALUES (p_document_id, p_state, p_state_vector, v_through_seq, 1, NOW())
  ON CONFLICT (document_id) DO UPDATE SET
    state = EXCLUDED.state,
    state_vector = EXCLUDED.state_vector,
    through_seq = EXCLUDED.through_seq,
    updated_at = EXCLUDED.updated_at;

  -- Prune.
  DELETE FROM doc_yjs_updates
    WHERE document_id = p_document_id
      AND seq <= v_through_seq;

  -- Return success.
  RETURN QUERY SELECT v_through_seq AS through_seq, OCTET_LENGTH(p_state)::BIGINT AS bytes;
END;
$$;

GRANT EXECUTE ON FUNCTION compact_yjs_doc(UUID, BYTEA, BYTEA) TO authenticated;
```

### Example 2: Sync Chip View Model With Locked Three-State Copy

```javascript
// src/utils/syncStatusViewModel.js — REPLACE existing content.
// Source: .planning/phases/32-multi-tab-persistence-hardening/32-CONTEXT.md § <decisions>

export function getSyncStatusViewModel(status, queueSize = 0, manualSyncing = false, quotaTier = 'ok') {
  const stage = status?.stage || 'idle';

  if (manualSyncing) {
    return { state: 'syncing', label: 'Syncing now...' };
  }
  if (stage === 'error') {
    return { state: 'offline', label: 'Sync error' };
  }

  // OFFLINE state: queue is non-empty OR explicitly queued stage.
  if (queueSize > 0 || stage === 'queued') {
    // CONTEXT.md locked copy: "Offline — N changes queued"
    return {
      state: 'offline',
      label: queueSize > 0
        ? `Offline — ${queueSize} ${queueSize === 1 ? 'change' : 'changes'} queued`
        : 'Saved locally',
      quotaTier,
    };
  }

  // SYNCING state: any in-flight or hydrating sync work.
  if (stage === 'pending' || stage === 'syncing' || stage === 'hydrating' || stage === 'migrating') {
    // CONTEXT.md locked copy: "Syncing N changes…"
    return {
      state: 'syncing',
      label: queueSize > 0
        ? `Syncing ${queueSize} ${queueSize === 1 ? 'change' : 'changes'}…`
        : 'Syncing…',
      quotaTier,
    };
  }

  // UP TO DATE state.
  // CONTEXT.md locked copy: "Up to date"
  return { state: 'synced', label: 'Up to date', quotaTier };
}
```

### Example 3: Two-Device Offline Merge Playwright Scenario (OFFLINE-03)

```javascript
// debug/scenarios/phase32-two-device-offline-merge.spec.mjs — NEW.
// Source: .planning/phases/32-multi-tab-persistence-hardening/32-RESEARCH.md § Validation Architecture
// Covers OFFLINE-03 — two "devices" both edit the same doc offline; both reconnect; both sets merge.

import { test, expect } from '@playwright/test';

const DEV_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173/';
const TEST_PDF = 'Package 2 - Rev 4 -- IC.pdf';

test.describe('Phase 32 — Two-device offline merge (OFFLINE-03)', () => {
  test('both devices edit offline, both reconnect, no modal, both sets present', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Open same doc on both.
    await pageA.goto(`${DEV_URL}?doc=test`);
    await pageB.goto(`${DEV_URL}?doc=test`);

    // Wait for hydration (Phase 27 signal).
    await pageA.waitForFunction(() => window.__phase27Hydrated === true);
    await pageB.waitForFunction(() => window.__phase27Hydrated === true);

    // Cut both contexts offline.
    await ctxA.setOffline(true);
    await ctxB.setOffline(true);

    // Edit different annotation in each.
    await pageA.evaluate(() => window.__phase32CreateAnnotation('rect', { color: 'red' }));
    await pageB.evaluate(() => window.__phase32CreateAnnotation('ellipse', { color: 'blue' }));

    // Reconnect both.
    await ctxA.setOffline(false);
    await ctxB.setOffline(false);

    // Wait for both to drain (no chip queue + transport online).
    await pageA.waitForFunction(() => window.__phase32QueueSize() === 0, { timeout: 10000 });
    await pageB.waitForFunction(() => window.__phase32QueueSize() === 0, { timeout: 10000 });

    // Both must see both annotations.
    const countA = await pageA.evaluate(() => window.__phase32CountAnnotations());
    const countB = await pageB.evaluate(() => window.__phase32CountAnnotations());
    expect(countA).toBe(2);
    expect(countB).toBe(2);

    // No conflict modal anywhere.
    expect(await pageA.locator('[data-conflict-modal]').count()).toBe(0);
    expect(await pageB.locator('[data-conflict-modal]').count()).toBe(0);
  });
});
```

### Example 4: Hardening the Existing Lifecycle Wire-Up in YDocProvider

```jsx
// src/components/collab/YDocProvider.jsx — ADDITIVE BLOCK inside YDocProviderInner's existing useEffect.
// Adds the two new attachments alongside the existing attachLifecycle / createTransportProvider lines.
// Do NOT rewrite — this is a 6-line additive change.

import { attachCompaction } from '../../lib/collab/yDocCompaction.js';   // NEW
import { attachMultiTabSync } from '../../lib/collab/multiTabSync.js';   // NEW

// ...inside the existing useEffect, after attachLifecycle:
const compactionHandle = attachCompaction(ydoc, docId, {
  threshold: 100, // CONTEXT.md decision
  onCompacted: ({ throughSeq, bytes }) => {
    console.info('[YDocProvider] compaction complete', { throughSeq, bytes, docId });
  },
  onError: (err) => {
    console.warn('[YDocProvider] compaction failed', err?.message, docId);
  },
});

// awareness binding comes from Phase 33; for Phase 32, multiTabSync can be wired
// with awareness=null (only the BC channel mount + future-readiness) OR with an
// internally-allocated awareness instance if Phase 33 has already shipped.
const multiTabHandle = attachMultiTabSync(ydoc, /* awareness */ null, docId);

// ...inside the existing cleanup return ():
try { compactionHandle.detach(); } catch { /* swallow */ }
try { multiTabHandle.detach(); } catch { /* swallow */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact for This Phase |
|--------------|------------------|--------------|----------------------|
| `localStorage` heartbeat for multi-tab leader | `navigator.locks.request({mode:'exclusive'})` | Baseline 2022-03 | Already adopted in Phase 27; Phase 32 just stress-tests. |
| Custom JSON snapshot serializer | `Y.encodeStateAsUpdate(ydoc)` → bytea | Yjs 13.x stable | Compaction job uses this directly. |
| `quotaexceedederror` reactive only | `navigator.storage.estimate()` polling + reactive | Baseline 2023-09 | Enables Tier-1 (80%) WARN before Tier-2 (failure). |
| Conflict-resolution modal on reconnect | Silent CRDT merge via `Y.applyUpdate` | Yjs 13.x stable | OFFLINE-02 + OFFLINE-03 explicit anti-modal — already enforced by Yjs semantics + Phase 28 transport. |
| `setTimeout`-based compaction trigger | `requestIdleCallback` with `{ timeout: 5000 }` fallback | Widely supported 2023+ | New compaction job uses idle scheduling per CONTEXT.md. |

**Deprecated/outdated:**
- "Replace Y.Doc state wholesale on rehydrate" — banned in Phase 27 (the `applyUpdate`-only invariant). Phase 32 honors it.
- Per-property timestamp comparator in app code — superseded by Y.Map native CRDT semantics + `meta.updatedAt` for display only.

## Per-Property LWW (Already Solved)

OFFLINE-03 calls out "per-property LWW with timestamp tiebreak." This is **already implemented** in `src/lib/collab/crdtAnnotationBridge.js` (Phase 29) — research-verify by reading `applyFabricCommit`:

1. Each Fabric property is written as a SEPARATE `fabricYMap.set(key, value)` call inside one `ydoc.transact(fn, origin)`.
2. Y.Map's CRDT semantics give per-key LWW automatically — concurrent writes to the same property converge to one value via Yjs's logical clock; concurrent writes to DIFFERENT properties never collide (both land).
3. `meta.updatedAt = Date.now()` is written every commit (line 302) for HUMAN-READABLE display in the Tags surface (Phase 33). It is NOT the convergence clock.
4. Phase 29 RESEARCH.md § "Per-Property LWW + Y.Map Merge Semantics" + § Anti-Pattern row "Per-property LWW for COLLAB-03 → use Y.Map.set per property" explicitly confirms this is solved.

**Phase 32 action:** **Do not add a comparator layer.** The OFFLINE-03 test (Example 3 above) proves the existing implementation works for two-device offline merge by edit + offline + reconnect.

## Sync Chip Architecture (Existing, To Be Extended)

The chip already mounts at `src/PDFSidebar.jsx:483` inside the cloud-sync footer block (visible only when `cloudSyncEnabled === true`). Its props come from `useAnnotationCloudSync` in `src/hooks/useAnnotationCloudSync.js`:
- `status: { stage: 'idle' | 'hydrating' | 'pending' | 'syncing' | 'queued' | 'synced' | 'error' | ... }`
- `queueSize: number` — count of pending writes (Phase 30 dual-write queue + Phase 32 future Yjs queue)
- `onRetry: () => Promise<void>` — chip click handler (manual flush + 4-attempt backoff)

The chip is rendered via `<SyncStatusChip status={cloudSyncStatus} queueSize={cloudSyncQueueSize} ... />`.

**Phase 32 changes:**
1. Update `getSyncStatusViewModel` to emit the three locked CONTEXT.md strings (Example 2 above).
2. Add `quotaTier` to the view model output; `SyncStatusChip` renders a small Tier-1 indicator (e.g. a yellow corner dot) when `quotaTier === 'tier1'` without changing the existing chip color.
3. Wire the new compaction-status counter + the existing `useDualWriteQueue.stuckCount` to the chip's queueSize prop (App.jsx narrow waiver — state-wiring line only).
4. Mount the Tier-2 banner adjacent to the existing `<StorageFailureBanner code='quota_exceeded' />` reuse pathway in `YDocProvider.jsx` (NO App.jsx change for the banner mount — `YDocProvider` already owns banner state).

**Net App.jsx waiver budget for this phase: <= 25 lines (LOCKED)** — covers (a) threading `quotaTier` from `useYDoc()` through the existing `<PDFSidebar cloudSyncStatus={...} cloudSyncQueueSize={...} cloudSyncQuotaTier={...} />` props chain and (b) installing dev/test window seams (`__phase32QueueSize`, `__phase32CountAnnotations`, `__phase32CreateAnnotation`) gated on `import.meta.env.MODE !== 'production'`. Leader-role seams (`__yDocLeaderRole`, `__phase32WaitForLeaderRole`) live in `YDocProvider.jsx`, NOT App.jsx (see Plan 32-06 Task 1).

## Open Questions

1. **Awareness instance ownership during Phase 32.** Phase 33 owns `Y.Awareness`. Phase 32's `multiTabSync.js` accepts an awareness instance but Phase 33 hasn't shipped yet.
   - What we know: `multiTabSync.js` works with `awareness=null` (the BC channel mounts but the awareness branch in `onAwarenessUpdate` is a no-op).
   - What's unclear: Should Phase 32 instantiate a minimal `new awarenessProtocol.Awareness(ydoc)` in `YDocProvider.jsx` so the BC channel actually has traffic to carry, or wait for Phase 33 to wire it?
   - Recommendation: instantiate the awareness instance in Phase 32 (one line: `const awareness = useMemo(() => new awarenessProtocol.Awareness(ydoc), [ydoc])` inside `YDocProvider.jsx`) and pass it into `multiTabSync`. Phase 33 will then attach its presence-pill consumer to the SAME instance. Avoids a "Phase 32 ships an unused channel" smell.

2. **Compaction RPC RLS scope.** The `compact_yjs_doc` Postgres function needs to bypass the standard `doc_yjs_state` RLS policy (which the Phase 27 schema set as deny-all). Phase 28 added per-user RLS for the regular tables; the RPC needs to invoke the existing `user_can_access_document(auth.uid(), p_document_id)` helper.
   - What we know: Phase 28 added the helper.
   - What's unclear: Does the helper consider read+write parity for collaborators (e.g. a Commenter role from Phase 34 — but Phase 34 hasn't shipped yet)?
   - Recommendation: Phase 32's RPC calls the helper with the document_id and the auth.uid() — same gate as `doc_yjs_updates` writes. If Phase 34 later refines the helper to distinguish read vs write, the RPC follows automatically.

3. **Electron `storage.estimate()` validation.** Need to confirm with a real Electron build that the Tier-1 / Tier-2 thresholds we set (1 GB / 4 GB absolute) actually trigger in practice — there's no published Electron-specific test vector.
   - What we know: `electron/electron#16029` documents the disparity.
   - What's unclear: Does the latest Electron (used by this app) still report free disk? Has Electron fixed it since 2018?
   - Recommendation: Wave 0 includes a one-time manual UAT step in the Electron build — write 100 large annotations, observe `navigator.storage.estimate()` output, document the value in a follow-up note. Phase 32 thresholds can be tuned post-UAT without re-planning.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` (built-in Node test runner) for unit/integration; `@playwright/test` v1.58.2 for browser/multi-tab scenarios |
| Config file | `package.json` script `"test": "node --test 'tests/**/*.test.mjs'"`; Playwright config at `debug/playwright.config.mjs` |
| Quick run command | `npm test` (~30s for the unit/integration suite) |
| Full suite command | `npm test && npx playwright test --config debug/playwright.config.mjs` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| OFFLINE-01 | Edit offline, reload, annotations persist | playwright | `npx playwright test debug/scenarios/phase32-offline-edit-persist.spec.mjs` | ❌ Wave 0 |
| OFFLINE-02 | Reconnect → silent merge (no modal) | playwright | `npx playwright test debug/scenarios/phase32-reconnect-silent-merge.spec.mjs` | ❌ Wave 0 |
| OFFLINE-03 | Two-device offline merge | playwright | `npx playwright test debug/scenarios/phase32-two-device-offline-merge.spec.mjs` | ❌ Wave 0 |
| OFFLINE-04 | Sync chip shows three locked strings in correct order | unit + playwright | `node --test tests/phase32/syncStatusViewModel.test.mjs` + `npx playwright test debug/scenarios/phase32-sync-chip-three-states.spec.mjs` | ❌ Wave 0 |
| Multi-tab Web Locks stress (success criterion 5) | 100+ open/close cycles, no corruption | playwright | `npx playwright test debug/scenarios/phase32-multi-tab-stress.spec.mjs` | ❌ Wave 0 |
| Compaction triggers on 100th update + prunes correctly (success criterion 6) | unit + playwright | `node --test tests/phase32/yDocCompaction.test.mjs` + `npx playwright test debug/scenarios/phase32-compaction-roundtrip.spec.mjs` | ❌ Wave 0 |
| Compaction is atomic (Pitfall 1) | sql/RPC integration | `node --test tests/phase32/compactionRpcAtomic.test.mjs` (uses local Supabase) | ❌ Wave 0 |
| BroadcastChannel awareness echo guard (Pitfall 2) | unit | `node --test tests/phase32/multiTabSync.test.mjs` | ❌ Wave 0 |
| Tier-1 / Tier-2 quota thresholds | unit | `node --test tests/phase32/storageQuotaMonitor.test.mjs` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` (~30s). Catches view-model regressions, compaction logic, multi-tab message routing, quota thresholds.
- **Per wave merge:** `npm test && npx playwright test --config debug/playwright.config.mjs --grep phase32` (~5 min). Catches runtime browser-side regressions in offline + reconnect + two-device + stress scenarios.
- **Phase gate:** Full suite green (baseline 640p/0f/6s from Phase 31 close preserved + new Phase 32 tests) before `/gsd:verify-work 32`.

### Grep-Verifiable Acceptance Signals

These signals let the planner write tasks whose "done" state is a `git grep` / log inspection rather than a subjective read:

| Signal | Grep / Inspection | What It Proves |
|--------|-------------------|----------------|
| Snapshot was written | `git grep "supabase.rpc('compact_yjs_doc'" src/lib/collab/yDocCompaction.js` | The compaction job uses the atomic RPC (Pitfall 1) |
| Snapshot logs success | Log line matching `^\[YDocProvider\] compaction complete .*throughSeq=\d+.*bytes=\d+$` in test capture | Compaction ran end-to-end and reported the through_seq + size |
| Old updates were pruned | After Playwright compaction-roundtrip, `await page.evaluate(() => fetch('/rest/v1/doc_yjs_updates?document_id=eq.X&seq=lte.Y&count=exact'))` returns 0 rows | The DELETE step inside `compact_yjs_doc` actually fired |
| BroadcastChannel posted expected message | `git grep "bc.postMessage" src/lib/collab/multiTabSync.js` returns ONE call with `type: 'awareness'`; unit test asserts the message shape | New BC channel uses the awareness-only contract — no Y.Doc update duplication |
| Web Locks election picked exactly one leader | In `phase32-multi-tab-stress.spec.mjs` after every cycle: `await Promise.all([tabA, tabB].map(p => p.evaluate(() => window.__yDocLeaderRole())))` returns exactly `['leader', 'loser']` (or `['loser', 'leader']`) — never `['leader', 'leader']` | Web Locks invariant holds under 100+ cycles |
| Sync chip state matches connection state | Playwright: after `ctx.setOffline(true)`, `await page.locator('.sync-chip').textContent()` matches `/^Offline — \d+ changes? queued$/`; after `setOffline(false) + drain`, matches `/^Up to date$/` | The three locked strings render in the correct order and exact format |
| Per-property LWW preserved (no regression) | `git grep "fabricYMap.set" src/lib/collab/crdtAnnotationBridge.js` returns at least one match (the existing per-property write); two-device merge test passes | Phase 29's bridge contract is intact; Phase 32 didn't accidentally collapse properties |
| App.jsx waiver is narrow | `git diff main -- src/App.jsx | grep -E '^\+' | wc -l` returns ≤ 25 added lines (LOCKED) | The "narrow waiver" budget held |
| applyUpdate-only invariant still green | `node --test tests/phase27/applyUpdateOnlyInvariant.test.mjs` passes | No new `new Y.Doc(` slipped in (Phase 27 invariant carry-forward) |
| Compaction did not call IDB persistence.clearData() | `git grep "\.clearData(" src/lib/collab/yDocCompaction.js` returns ZERO matches | Pitfall 7 defended — local IDB untouched |
| Snapshot/prune is atomic | Migration file exists at `supabase/migrations/*phase32*.sql` AND contains `CREATE OR REPLACE FUNCTION compact_yjs_doc` AND contains both `INSERT INTO doc_yjs_state` AND `DELETE FROM doc_yjs_updates` inside the function body | Pitfall 1 defended — single transaction by construction |

### Wave 0 Gaps

The following must exist before any subsequent wave starts implementation work. Use the Phase 27/28/29 per-test `existsSync` skip-guard pattern verbatim so the scaffolds flip skip→green as production code lands per plan:

- [ ] `tests/phase32/yDocCompaction.test.mjs` — covers threshold trigger + `_forceCompactForTest` round-trip + onError surfacing (Pitfall 3)
- [ ] `tests/phase32/multiTabSync.test.mjs` — covers BC message routing + `REMOTE_AWARE_ORIGIN` echo guard (Pitfall 2)
- [ ] `tests/phase32/storageQuotaMonitor.test.mjs` — covers Tier-1/Tier-2 threshold transitions + Electron-vs-browser branching (Pitfall 4)
- [ ] `tests/phase32/syncStatusViewModel.test.mjs` — covers the three locked-copy strings exactly + queueSize pluralization
- [ ] `tests/phase32/compactionRpcAtomic.test.mjs` — covers Pitfall 1 atomicity by injecting a mid-transaction error (uses local Supabase test instance OR a stubbed `supabase.rpc` that asserts ONE call, not two)
- [ ] `debug/scenarios/phase32-offline-edit-persist.spec.mjs` — OFFLINE-01
- [ ] `debug/scenarios/phase32-reconnect-silent-merge.spec.mjs` — OFFLINE-02
- [ ] `debug/scenarios/phase32-two-device-offline-merge.spec.mjs` — OFFLINE-03
- [ ] `debug/scenarios/phase32-sync-chip-three-states.spec.mjs` — OFFLINE-04
- [ ] `debug/scenarios/phase32-multi-tab-stress.spec.mjs` — 100+ cycle Web Locks stress (success criterion 5)
- [ ] `debug/scenarios/phase32-compaction-roundtrip.spec.mjs` — compaction trigger + prune + cold-load (success criterion 6)
- [ ] `supabase/migrations/20260520000000_phase32_compaction_rpc.sql` — `compact_yjs_doc(...)` function (Pattern 1 / Example 1)
- [ ] Window test seams: `window.__phase32CreateAnnotation`, `window.__phase32CountAnnotations`, `window.__phase32QueueSize`, `window.__phase32WaitForLeaderRole`, `window.__yDocLeaderRole` — exposed in dev/test builds only (Vite tree-shake on `import.meta.env.MODE !== 'production'`)

No new test framework install required — `node --test` is built-in, Playwright is already in devDeps. No new node packages for the production code path either (browser natives + yjs + Postgres RPC carry everything).

## Sources

### Primary (HIGH confidence)

- [Yjs Documentation — Document Updates (encodeStateAsUpdate, mergeUpdates, applyUpdate, encodeStateVector, diffUpdate)](https://docs.yjs.dev/api/document-updates) — compaction primitives
- [Yjs Documentation — Y.Map (per-key LWW semantics)](https://docs.yjs.dev/api/shared-types/y.map)
- [Yjs Documentation — Allowing offline editing (y-indexeddb wiring)](https://docs.yjs.dev/getting-started/allowing-offline-editing)
- [y-indexeddb source — `PREFERRED_TRIM_SIZE = 500` + `storeState` + `clearData`](https://github.com/yjs/y-indexeddb/blob/master/src/y-indexeddb.js)
- [y-indexeddb architecture (DeepWiki)](https://deepwiki.com/yjs/y-indexeddb/2-architecture)
- [y-websocket source — proves BroadcastChannel internal pattern + awareness fan-out](https://github.com/yjs/y-websocket/blob/master/src/y-websocket.js)
- [MDN — Web Locks API (Baseline March 2022)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [MDN — StorageManager.estimate() (Baseline September 2023)](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)
- [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Playwright — BrowserContext API + multi-tab pattern](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright — Pages and multi-page scenarios](https://playwright.dev/docs/pages)
- [Awareness Protocol (y-protocols/awareness)](https://docs.yjs.dev/api/about-awareness)
- Internal: `.planning/phases/27-crdt-foundation/27-RESEARCH.md` — § Pattern 2 (Web Locks election), § Pattern 10 schema (`doc_yjs_state.through_seq`)
- Internal: `.planning/phases/29-fabric-yjs-binding-per-user-undo/29-RESEARCH.md` — § "Per-Property LWW + Y.Map Merge Semantics" confirming OFFLINE-03 already solved
- Internal: `src/lib/collab/ydocLifecycle.js` — existing Web Locks election + BC update fan-out + REMOTE_BC_ORIGIN echo guard
- Internal: `src/lib/collab/storageFailureDetector.js` — existing QuotaExceededError detection
- Internal: `src/lib/collab/SupabaseYjsProvider.js` — existing exported `encodeUpdate` / `decodeAndApply` + `SOFT_PAYLOAD_CAP_BYTES = 600KB`
- Internal: `src/lib/collab/crdtAnnotationBridge.js` — existing per-property `fabricYMap.set(key, value)` per-property LWW
- Internal: `src/lib/collab/crdtDualWriteQueue.js` — existing `STUCK_THRESHOLD_MS=30000` + `hasPendingForUser` + `getStuckCount`
- Internal: `src/hooks/useDualWriteQueue.js` — existing 1Hz poll + stuck-banner signal
- Internal: `src/components/SyncStatusChip.jsx` + `src/utils/syncStatusViewModel.js` — existing chip + view model
- Internal: `supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql` — `doc_yjs_state` + `doc_yjs_updates` schema (already locked)

### Secondary (MEDIUM confidence)

- [Yjs Community — Clear document history and reject old updates (Page 2)](https://discuss.yjs.dev/t/clear-document-history-and-reject-old-updates/945) — confirms server-side compaction is the standard pattern; no "fully safe" local pruning for offline-first apps; informs Pitfall 5 (cold-load order)
- [Yjs Community — Best practice to sync across tabs/windows](https://discuss.yjs.dev/t/best-practice-to-sync-across-tabs-windows/903) — confirms BroadcastChannel update fan-out pattern (already used by Phase 27)
- [Yjs Community — Garbage Collection and Version Snapshotting](https://discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839)
- [electron/electron#16029 — Inconsistent reporting of offline storage quota](https://github.com/electron/electron/issues/16029) — informs Pitfall 4 (Electron quota semantics)
- [Chrome Developers — Estimating Available Storage Space](https://developer.chrome.com/blog/estimating-available-storage-space/)
- [BrowserStack — How to handle Multiple Windows in Playwright (2026)](https://www.browserstack.com/guide/playwright-multiple-tabs)
- [Checkly Docs — Handling Multiple Tabs with Playwright](https://www.checklyhq.com/docs/learn/playwright/multitab-flows/)

### Tertiary (LOW — informational only, not load-bearing)

- [rozek/y-lwwmap — alternative Y.Map with explicit LWW timestamps](https://github.com/rozek/y-lwwmap) — explicitly NOT recommended; Y.Map's native semantics already satisfy OFFLINE-03

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Yjs primitives + `y-indexeddb` internals + Web Locks + StorageManager.estimate all verified against official docs and source.
- Architecture: HIGH — All four new patterns either reuse existing Phase 27/28/29 code or apply documented browser-native APIs. No exotic patterns.
- Pitfalls (this phase's subset): HIGH — Pitfalls 1, 2, 3, 5, 7 are mechanically verifiable; Pitfalls 4, 6 are confirmed by external issue references + the existing Phase 27 stress-test design.
- Per-property LWW (OFFLINE-03): HIGH — Phase 29 already shipped this via `crdtAnnotationBridge.js`; no new work needed.
- Compaction strategy (success criterion 6): HIGH — Yjs `encodeStateAsUpdate` is stable; the `doc_yjs_state` / `through_seq` schema is in place; the only new piece is the atomic Postgres RPC.
- Multi-tab UX (success criterion 5): HIGH — Web Locks behavior is documented and Phase 27 already proves the election works under one round of Playwright; 100+ cycle stress is a test-side extension.
- Sync chip UX (OFFLINE-04): HIGH — chip component + view model + queueSize signal already exist; this phase changes copy strings only.
- IndexedDB-quota UX: MEDIUM — Browser thresholds (80%/95%) are textbook; Electron threshold (1GB/4GB absolute) is heuristic and should be validated post-Wave-0 UAT (Open Question 3).

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — Yjs ecosystem is stable; the only churn risk is a Yjs major version, which would be flagged by the existing license CI gate)
