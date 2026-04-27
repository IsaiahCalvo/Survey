# Pitfalls Research — v2.4 Multi-User Collaboration (CRDT Rebuild)

**Domain:** Adding Yjs-style CRDT multi-user editing to an existing single-user PDF annotation app (Fabric.js 5.5.2 + Supabase + Electron + 6 months of legacy rows)
**Researched:** 2026-04-26
**Confidence:** HIGH for Yjs/Supabase mechanics (verified against official docs and known issues), MEDIUM for app-specific integration assumptions (informed by the v2.3 codebase audit + the simple-sync post-mortem in PROJECT context)

> **Read this first:** the previous simple-sync system bled data because of (a) two parallel write paths re-tagging non-highlight rows as highlights, (b) hydrate replaces being mistaken for user erases, (c) concurrent rehydrate races clobbering `lastByPageRef`, (d) multi-tab queue draining without coordination, (e) a 1-second verify wait window where user drawing got wiped, and (f) reused session-ids across documents. **Every pitfall below assumes those failure modes are still latent in the app's muscle memory** and the new system must defend against them by construction, not by convention.

---

## Critical Pitfalls (data loss class)

### Pitfall 1: Migration partial-state leaves cloud holding the old Fabric-JSON rows AND a Y.Doc that thinks they don't exist

**What goes wrong:**
We migrate the 6-month-of-rows by reading existing `annotations` rows, building a Y.Doc, and writing it as a binary blob. But existing clients are still on the old code path, still writing Fabric-JSON rows. For every minute the rollout takes, new old-format rows arrive that aren't in the new Y.Doc, and every Y.Doc-aware client immediately thinks "these don't exist, the user must have erased them" and either ignores them or — worse, given history — issues deletes. The bleeding-data pattern from simple-sync repeats with a new face.

**Why it happens:**
A single source of truth flip-day is the seductive default. Reality: clients update over hours/days, mobile/Electron auto-update lag exists, and users keep tabs open for weeks. There is *always* a double-write window. If you don't design for it, the migration is a data-loss event by definition.

**How to avoid:**
- **Two-phase migration.** Phase A: dual-write era — every new annotation writes BOTH the Fabric-JSON row (legacy column) AND a CRDT update (new column). Old clients read the legacy column and see new annotations from new clients. New clients read the CRDT column. Reads never bleed across.
- **Generation seal.** When the user's account hits "all known clients are >= v2.4.0", flip a `migrated_at` column on the document. After that, writes go CRDT-only. A client running < v2.4.0 reading a sealed document gets a "please update" gate, NOT a silent half-document.
- **No "diff between cloud and local means delete" logic anywhere in the migration code path.** Migrations replace, never reconcile. The old simple-sync diff-based delete-detection is what killed it. Do not bring that pattern into the migration.
- **Idempotent migration.** Each row has a stable `client_anno_id` from the legacy column. The Y.Map key for the migrated annotation MUST be `client_anno_id`. If the migration runs twice on overlapping data, the second run is a no-op — same key, same value, Y.Map.set with deep-equal value is harmless.
- **One-way valve.** Once a document is sealed-migrated, the legacy column is read-only. A trigger or RLS policy enforces this at the database level, not at the application level.

**Warning signs:**
- During staged rollout, one user reports "my annotations from yesterday are gone" — STOP the migration immediately. This is the simple-sync failure recurring.
- A diff between Fabric-JSON row count and Y.Map size grows over time during dual-write era — clients are dropping writes on one path.
- Sentry shows `migration_replay_*` events firing more than once per (user, document, version) tuple — idempotency is broken.

**Severity:** CRITICAL — direct data loss across paying customers' billed work product
**Phase to address:** **Phase 1 (CRDT foundation)** designs the dual-column schema. **Phase 4 (migration)** owns the rollout playbook. **Phase 5 (cutover)** owns the seal.

---

### Pitfall 2: y-indexeddb multi-tab corruption — same Y.Doc, two tabs, doubled updates and replay drift

**What goes wrong:**
Two tabs in the same Electron window (or the user opens the desktop app while a stale browser tab is open against the same Supabase project) both load the same document, both instantiate `IndexeddbPersistence` against the same `Y.Doc.guid`, both flush updates to the same IndexedDB store. y-indexeddb has a **known, documented bug** where multiple `IndexeddbPersistence` instances pointed at one Y.Doc duplicate updates (yjs/y-indexeddb#25). On reload, the doc replays each update twice, deletions race insertions, and the document silently drifts.

**Why it happens:**
- IndexedDB has no transaction isolation across tabs.
- y-indexeddb's persistence layer assumes one instance per document, which holds in single-page apps but fails in tabs/windows/Electron-renderer-with-side-tabs.
- The previous simple-sync system already exhibited multi-tab queue-drain duplication. This is the same disease, new symptom.

**How to avoid:**
- **Web Locks API election.** Before instantiating `IndexeddbPersistence`, take a `navigator.locks.request("y-doc-{docId}", { mode: "exclusive" }, async () => { ... })`. Only the lock-holding tab attaches y-indexeddb. Other tabs receive updates via BroadcastChannel from the lock-holder. When the lock-holder closes, the next tab election runs and one tab promotes itself.
- **One Y.Doc instance per (browser-process, document) pair.** Hold it in a module-scoped registry keyed by docId. Re-using the same Y.Doc across React mounts is correct; constructing a new one per mount is the bug.
- **Fail loud on duplicate-instance attempts.** In dev mode, throw if a second `IndexeddbPersistence` is constructed for a Y.Doc that already has one. In prod, log and degrade to in-memory-only for the loser.
- **Per-document Y.Doc, not per-app.** Don't reuse a single Y.Doc with sub-types for many PDFs — that's the "one Y.Doc accumulates 10K annotations over a year" performance trap (Pitfall 7). One Y.Doc per PDF document, identified by the immutable PDF storage ID, never the user's session-id.

**Warning signs:**
- IndexedDB store size grows linearly with tab opens, not with edits.
- Annotations appear, vanish, and reappear during reload.
- Counter-intuitive: undo restores deleted state that "should have been" already deleted — that's a duplicated delete being re-applied.

**Severity:** CRITICAL — silent data corruption, exactly matches the simple-sync failure class
**Phase to address:** **Phase 1 (CRDT foundation)** sets the lock + registry pattern. **Phase 6 (multi-tab hardening)** stress-tests it with two-tab Playwright scenarios.

---

### Pitfall 3: The Y.Doc-vs-RLS mismatch — RLS blocks the row but the CRDT update is already applied locally

**What goes wrong:**
User A and User B are collaborators on document D. RLS is configured "users can read documents shared with them." User B is removed from the share. Old code path: server denies the read, cleanly handled. New code path: User B's Y.Doc is already populated locally (in IndexedDB!) and they're still applying observed updates from a stale realtime subscription. The RLS revoke at the database does nothing for the data already on User B's disk. Worse: User B continues *writing* updates locally, and queuing them. When the queue tries to flush, the writes are denied — but User B's local UI shows their work as committed. A sales rep loses an hour of redlines and never knows.

**Why it happens:**
**RLS protects rows. CRDTs protect convergence.** They're orthogonal. RLS treats every operation as discrete; CRDTs treat every operation as part of an ongoing local-first session. The old single-user model implicitly assumed `read denied = nothing on disk`, which was true for stateless reads. CRDT changes that assumption to false.

**How to avoid:**
- **Permission revocation = forced local wipe.** The realtime channel emits a `permission_revoked` event for User B's session. Client-side, on receipt: destroy the Y.Doc, clear y-indexeddb for that doc, navigate the user away, and surface "You no longer have access to this document. Any unsaved local changes have been discarded."
- **Server-side Y.Doc validator.** Every CRDT update arriving at the server is run through a permission check based on the *current* RLS state, not the state at subscribe time. Reject silently? No — emit `update_rejected` back to the client with a reason. This requires a server-component (Hocuspocus or a custom Postgres function).
- **No "write-ahead optimism" for permission-gated state.** The local user can edit, but the UI shows a "syncing" indicator until the server has accepted the update. If rejected, roll back the Y.Doc (apply the inverse update from a snapshot taken pre-write).
- **Documents have an explicit owner field separate from share state.** RLS for shared collaborators, ownership for super-permissions like delete-document or change-permissions. Yjs has no concept of either; it's purely application-layer.

**Warning signs:**
- A removed collaborator's Sentry shows "update rejected" entries 24+ hours after revocation — they're still trying to sync stale local writes.
- Two users who shouldn't share a document see each other's awareness cursors — the realtime channel is leakier than RLS.
- Any test where Account A revokes Account B's access and B's local UI continues showing the document as editable is a failing test.

**Severity:** CRITICAL — security boundary violation in a paid commercial app
**Phase to address:** **Phase 2 (transport + auth)** owns server-side validator. **Phase 3 (Yjs <-> Fabric binding)** owns the client-side rollback path. **Phase 8 (sharing UI)** owns the revocation UX.

---

### Pitfall 4: Echo loop — Yjs observer fires Fabric event fires Yjs observer

**What goes wrong:**
Local user drags a rectangle. Fabric `object:modified` event fires. Handler writes new `left/top/width/height` into Y.Map. Y.Map observer (which the same client has registered, because that's how remote updates render) fires. Observer sets `obj.set({ left, top, width, height })` on the Fabric object. Fabric `object:modified` fires again. Handler writes again. Y.Map observer fires again. Loop. CPU pegs at 100%, the document doubles in update history every frame, IndexedDB explodes, app freezes.

**Why it happens:**
The Yjs binding pattern requires distinguishing local-applied updates from remote-observed updates. The standard guard is **transaction origin**: writes from local Fabric events tag `transaction.origin = fabricLocalOrigin`. The Y.Map observer checks the event's transaction origin and skips applying when origin is local. **If you forget the origin tag, or if you forget the guard, you get an infinite loop.** Yjs has documented this exact failure mode (`discuss.yjs.dev/t/infinite-loop-of-updates-caused-in-rare-situation-with-react/1121`).

Compounding factor unique to this app: Fabric.js 5.5.2 fires `object:modified` *during* programmatic `set()` calls under some circumstances (it's noisier than 6.x). The guard must be defensive.

**How to avoid:**
- **Mandatory transaction origin pattern.** All local writes go through a single helper:
  ```js
  yDoc.transact(() => {
    yMap.set(annoId, snapshot);
  }, /* origin */ { source: 'local-fabric', userId, deviceId, ts: Date.now() });
  ```
  All Y.Map observers MUST start with: `if (event.transaction.origin?.source === 'local-fabric') return;`. This is enforced via lint rule, not just convention.
- **Mute Fabric events while applying remote updates.** When a remote observer is applying state to Fabric, set a module-scoped `applyingRemote = true` flag, and the Fabric `object:modified` handler short-circuits when true. Reset to false after the apply completes (in a microtask, not a setTimeout — setTimeout is the simple-sync verify-wait bug all over again).
- **Don't observe-deep on the entire Y.Map.** Observe at the per-annotation Y.Map level. A change to anno A should not fire observers for anno B. This both reduces echo blast radius and helps performance.
- **Smoke test with a "draw 1000 strokes" loop.** If CPU stays under 30% and IndexedDB grows linearly (not quadratically), the echo guard works. If it explodes, you have a leak.

**Warning signs:**
- DevTools Performance tab shows an infinite stack of `Y.Map.observe -> Fabric.set -> object:modified -> Y.Map.set -> Y.Map.observe`.
- The same annotation has 100+ updates in its Y.Doc history but the user only edited it once.
- IndexedDB size grows during *idle* time (when the only thing happening is observers reapplying their own writes).

**Severity:** CRITICAL — app freeze + storage exhaustion. Will be discovered the moment a real user drags a shape.
**Phase to address:** **Phase 3 (Yjs <-> Fabric binding)**. This is THE critical correctness invariant of that phase. The phase's acceptance criteria must include: "Given user drags a rectangle, when object:modified fires, then exactly one Y.Map.set occurs and exactly zero remote-observer fires re-trigger Fabric set on the same object."

---

### Pitfall 5: The 1-second verify wait window — repeated, in CRDT clothing

**What goes wrong:**
The simple-sync system had a 1-second wait between reading and verifying cloud state, during which user drawing was wiped. The naive Yjs equivalent: a "rehydrate from server snapshot" step that takes ~1 second on slow networks, during which any local edit is silently overridden when the server snapshot arrives. The same family of bug, new transport.

**Why it happens:**
On reconnect/refresh/initial-load, the natural sequence is:
1. Open Y.Doc (empty)
2. Apply local IndexedDB updates (instant)
3. Connect to realtime
4. Receive server's encoded state-as-update
5. Apply it

If the user starts drawing between step 2 and step 5, AND if the developer naively does `Y.applyUpdate(doc, serverSnapshot)` *replacing* state instead of *merging*, you wipe the user's in-flight edit. The CRDT itself is fine with merging — but if the developer used a non-CRDT pattern like "set state to server response," they've turned a CRDT into a last-writer-wins overwriter.

Compounding: y-websocket / Hocuspocus default behavior on initial sync is `applyUpdate`, which IS the merge-correct path. But custom Supabase-realtime transports, hand-rolled, get this wrong. Given this app is going custom-realtime (Supabase, not y-websocket), the risk is unusually high.

**How to avoid:**
- **Always `applyUpdate`, never `applyUpdateV2` and never replace.** `applyUpdate(yDoc, update)` is associative and commutative — the user's local edits AND the server's snapshot can arrive in any order and the result is the same.
- **No "wait for server before allowing edits" gating.** Local-first means local IS the truth until the server contradicts via a real CRDT update. The user can edit immediately on app open.
- **No `yDoc = new Y.Doc()` after init.** Tearing down and rebuilding the Y.Doc to "refresh from server" is the simple-sync verify-wait pattern wearing a Yjs costume. Banned.
- **Encode awareness state separately.** `awareness` (cursors, selections, presence) goes through `awarenessProtocol`, NOT through Y.Doc updates. Don't conflate them.
- **Capture pre-rehydrate snapshot for forensic recovery.** Before any large-scale `applyUpdate`, snapshot the doc state so a regression can be diff'd. Drop the snapshot after 5 minutes if no anomaly is reported.

**Warning signs:**
- A user reports "my redline disappeared right after the app loaded" — the verify-wait bug is back.
- Logs show `applyUpdate` is followed within <2 seconds by a delete-set-overlap with what the user just drew.
- Any code path that constructs `new Y.Doc()` outside of the initial app boot is a smell.

**Severity:** CRITICAL — direct data loss, simple-sync regression
**Phase to address:** **Phase 1 (CRDT foundation)** establishes the "applyUpdate-only, never replace" rule. **Phase 2 (transport + auth)** verifies the Supabase-realtime adapter respects it.

---

### Pitfall 6: Fabric.js 5.5.2 object identity drift — Yjs key is stable, Fabric reference isn't

**What goes wrong:**
Yjs identifies an annotation by its Y.Map key (`annoId`, a uuid). Fabric.js 5.5.2 identifies an object by its in-memory reference. When a remote update arrives modifying anno X, the Yjs observer needs to find Fabric object X to update it. The naive lookup is `canvas.getObjects().find(o => o.annoId === X)`. This is O(n) per update and worse: Fabric's mount/unmount-per-edit-session pattern (this app's v2.0 Phase 10/11 architecture) means the Fabric object for X may not even exist right now — the user is in SVG-display mode for that anno. The observer applies a no-op, but believes it succeeded. Next time the user enters edit mode for anno X, the local Fabric reconstructs from Y.Doc (correct). But during the gap, a *third* user observed the change and applied it to *their* Fabric — so two clients converge while one silently desyncs from its own SVG layer.

**Why it happens:**
This app is unusual. Most Yjs+canvas-library examples assume always-mounted canvases. Here, SVG is the display truth and Fabric mounts only during edit. The Yjs observer doesn't know which mode you're in. The SVG renderer reads from where? — and that's the architectural question Phase 3 must answer cleanly, because answering it badly creates a third bleeding-data path.

**How to avoid:**
- **Y.Doc is the source of truth. SVG renders FROM Y.Doc. Fabric edit canvas is a temporary mutable mirror that writes BACK TO Y.Doc.**
- **Stable annotation IDs in the Y.Map.** Key is uuid. Fabric objects' `data.annoId` is set on construction and never mutated. SVG `<g id="anno-{annoId}">` mirrors. Lookups across all three layers use the same key.
- **No reliance on Fabric object reference identity for sync.** Build a per-mount registry: `Map<annoId, FabricObject>` populated on mount, cleared on unmount. Observer first asks the registry; if absent, queues the update for next-mount.
- **The Yjs observer for an edit session is scoped: it observes only the anno being edited, not the full doc.** When edit ends, the observer detaches. This eliminates the "Fabric object doesn't exist" branch entirely for non-edit annotations — for those, only the SVG renderer is observing.
- **Reconciliation on mount.** When entering edit mode for anno X, read fresh state from Y.Doc and rebuild the Fabric object from scratch. Don't trust any cached Fabric object — Yjs has been the truth for the entire pre-mount window.

**Warning signs:**
- Two users edit the same shape simultaneously, one user's view "snaps back" when they leave edit mode — Y.Doc had the truth but Fabric was caching stale.
- An annotation rendered correctly in SVG but appears in a wrong position when you double-click to edit — the SVG-to-Fabric handoff is reading from the wrong source.
- Memory grows over a session as edit sessions leak Fabric references in the registry — the unmount cleanup is incomplete.

**Severity:** HIGH — silent visual desync; users don't lose data but lose trust
**Phase to address:** **Phase 3 (Yjs <-> Fabric binding)**. This phase MUST own the registry and the SVG-from-Y.Doc data flow. The DO NOT CHANGE list MUST exclude only the files this phase explicitly owns.

---

## High-Severity Pitfalls (data corruption / silent UX divergence)

### Pitfall 7: Per-user UndoManager scope footguns — "undo" undoes someone else's work

**What goes wrong:**
User A erases a stroke. User B undoes. B's undo reverts A's erase. A's erase is now back as a stroke. But it was *A's* stroke originally. From A's perspective, "I deleted that, why is it back?" From B's perspective, "I undid my last action, why did a stroke I didn't draw appear?" Both users see ghost-state. Each thinks the other is editing without permission. Trust is destroyed.

**Why it happens:**
Default `Y.UndoManager` tracks all changes to its scope, regardless of origin. Per-user undo requires explicitly setting `trackedOrigins: new Set([myUserOriginObject])` so the manager only stacks reverse-ops for this user's transactions. The construction is one line. The footgun is forgetting that line and using the default constructor — a default UndoManager is "everybody's undo," which is approximately never what the user wants in collab.

Yjs documents this clearly (docs.yjs.dev/api/undo-manager: "by specifying trackedOrigins you can selectively specify which changes should be tracked"). The trap is that the tutorial example often doesn't show the multi-user scoping because the tutorial is single-user.

**How to avoid:**
- **One UndoManager per (user, document) pair, constructed with `trackedOrigins: new Set([myOrigin])`.** The origin is a stable identifier — `userId` is fine. Same-user multi-tab uses the same origin (that's the user's identity).
- **What about "I want to undo this collaborator's mistake"?** Don't. That's a permission/admin operation, not undo. If product wants it, it's a separate "revert annotation" flow gated on permissions, not the undo stack.
- **Capture timeout behavior.** Yjs UndoManager merges edits within `captureTimeout` (default 500ms) into one undo step. For drawing (where Fabric fires many `object:modified` events during a drag), this is what you want. But it means the *first* drag after a 500ms pause starts a new step — design the UI's "undo button" to make this discoverable.
- **UndoManager must observe the SAME Y.Map the binding writes to.** Observing at the wrong scope means undo no-ops because there are no reverse-ops for the things that were modified.
- **Test: A draws, B draws, A undoes — only A's stroke reverts.** This is the canonical test, and it must be in the Playwright suite for Phase 3.

**Warning signs:**
- "Why did my undo bring back somebody else's deleted stroke?" — origin scoping is wrong.
- "Why did my undo do nothing?" — UndoManager is observing the wrong scope, or `trackedOrigins` is filtering out the user's origin (e.g., the binding writes `{ source: 'local-fabric' }` but UndoManager tracks `{ userId }` — they don't match).

**Severity:** HIGH — UX-breaking; will surface in the first multi-user demo
**Phase to address:** **Phase 3 (Yjs <-> Fabric binding)**. AC: per-user undo isolation verified by Playwright two-user scenario.

---

### Pitfall 8: Author + device + timestamp metadata forgotten on undo / redo

**What goes wrong:**
Operation 1: User A draws stroke X with metadata `{ userId: A, deviceId: A1, ts: 100 }`. Operation 2: User A erases stroke X with metadata `{ userId: A, deviceId: A1, ts: 200 }`. User A undoes. The undo is *itself* a transaction — what's its metadata? If you forgot to set it, the undo's transaction origin is `null` or some default and the activity log records "stroke X reappeared, author: unknown, time: ?". The activity log is now lying.

Worse case: User A does the undo while connected from a different device (mobile). The undo transaction's metadata defaults to whatever you set on the UndoManager construction. If that's the device the original op came from, the activity log claims A1 acted at ts=now, when actually A2 acted. Forensics is broken.

**Why it happens:**
Undo/redo in Yjs runs as `transact(() => applyReverseOp(), origin)`. The `origin` is a parameter you pass at undo time, not at op-creation time. Most tutorials show `undoManager.undo()` with no origin — and that's the bug.

**How to avoid:**
- **Wrap UndoManager calls with origin tagging:**
  ```js
  function userUndo() {
    yDoc.transact(() => undoManager.undo(), {
      source: 'local-undo',
      userId: currentUser.id,
      deviceId: currentDevice.id,
      ts: Date.now(),
    });
  }
  ```
  Same for `redo`.
- **The Yjs origin is the canonical metadata — DO NOT also stash it inside the Y.Map values.** Putting `userId` into the value duplicates info and creates drift when undos revert values but not metadata. The activity log derives from transaction origins, not from value fields.
- **Activity log = `update` event listener that captures `(update, origin)` pairs.** The log is built from origin metadata. For an undo, origin says it was an undo, by user A on device A2 at time T. That's the truth.
- **Wall clock vs Yjs internal clock — be explicit.** Yjs's logical clock is for ordering, not display. The user-facing "Isaiah deleted at 3:45 PM" timestamp is wall-clock from origin metadata. The internal Yjs clock decides convergence. Don't mix them.

**Warning signs:**
- Activity log shows "unknown user" entries adjacent to known-user undo events.
- Activity log has perfectly consistent timestamps that are all impossibly close together — clients are using one client's clock for all entries.
- Forensic report request "what did Isaiah delete on Tuesday" can't be answered because origin tagging was sparse.

**Severity:** HIGH — accountability is lost; this app's industrial users WILL eventually need an audit trail for an insurance claim or change-order dispute
**Phase to address:** **Phase 3 (Yjs <-> Fabric binding)** sets the origin pattern. **Phase 7 (activity log + presence)** consumes it.

---

### Pitfall 9: Clock drift across devices — wall-clock timestamps disagree, ordering reverses

**What goes wrong:**
Origin metadata includes `ts: Date.now()`. User A on device with clock skewed +30 minutes draws stroke X at "3:30 PM A-clock = actual 3:00 PM". User B at correct time draws stroke Y at 3:15 PM. Activity log displays "Isaiah drew X at 3:30 PM, then Bob drew Y at 3:15 PM" — but Y was drawn FIRST. Causality looks reversed. If A and B's strokes interact (B's eraser deletes A's stroke), the log shows the deletion happening before the creation.

Yjs's CRDT convergence is unaffected — it uses logical clocks, not wall clocks, for that. But the activity log, which uses wall clocks for human display, lies.

**Why it happens:**
Wall clocks drift. NTP synchronization isn't enforced on consumer devices. Electron desktop apps especially can run on machines with manually-set clocks (engineers in remote field offices, locked-down laptops without NTP). Mobile is more reliable but still has timezone drama.

**How to avoid:**
- **Server timestamp is the canonical timestamp for the activity log.** Client sends origin with `clientTs: Date.now()`. Server-side hook on update receipt rewrites/augments to `serverTs: Date.now()` and stores both. Display uses serverTs. ClientTs is kept only for forensic "this client's clock claimed X."
- **Hybrid logical clock for ordering.** If you need cross-user causal ordering for the activity log (as opposed to just display), use a hybrid logical clock per origin: `(serverTs, lamportCounter)`. Yjs's internal clock handles convergence; the activity log clock handles "what happened in what order."
- **Show timezone in the UI.** "Isaiah drew at 3:30 PM PDT" not "Isaiah drew at 3:30 PM" — engineers collaborate across continents.
- **Reject updates with clientTs >5 minutes off serverTs.** Either ban (likely too strict) or warn "your device clock is off." The simple-sync system had no such check; one stale-clock device polluted the cloud and nobody noticed for weeks.

**Warning signs:**
- Activity log timestamps go backwards across users.
- Two users in a Zoom watching each other annotate disagree about who acted first.
- Server logs show clientTs values from "future" events (clock ahead) or "past" events (clock behind).

**Severity:** HIGH — log integrity; legal/insurance evidence value of the log destroyed
**Phase to address:** **Phase 7 (activity log + presence)** owns the canonical-server-ts pattern.

---

### Pitfall 10: Y.Doc grows forever — 10K annotations + 1 year + GC-disabled-for-snapshots = unusable

**What goes wrong:**
Y.Doc by default keeps a complete history of operations. With GC enabled, deleted-content payloads are reclaimed but the deletion records (the deleteSet) remain. With snapshot/version-history features (which an audit-trail product likely wants), GC must be DISABLED entirely or you lose the ability to restore old versions.

Production data: a Yjs document with GC disabled and ~75KB of live content has been observed to grow to 5MB+ on disk. For the same content size, GC-on Yjs is ~10% the disk cost. Now multiply by a year of edits on a busy document and you have a 50–500MB Y.Doc per PDF, transferred-on-load, written-on-every-edit.

In this app's context: a master mechanical drawing PDF gets daily redlines for a 12-month project. Without a strategy, the Y.Doc bloats until y-indexeddb hits the IndexedDB quota (Chrome: 60% of disk, Electron usually 1/3 free space, but quotas vary), the load takes 30+ seconds, and the realtime subscription transfers a 100MB blob over websocket — Supabase realtime caps payload at 1MB by default.

**Why it happens:**
The trade-off is fundamental: history-rich Y.Doc vs lean Y.Doc, pick one. New developers see "GC reduces size, snapshots require GC off" and believe they get to have both. They don't.

**How to avoid:**
- **Decide upfront: lean working doc + separate snapshot store.** The live Y.Doc has GC ENABLED. Periodic snapshots (`Y.encodeStateAsUpdateV2`) are written to a separate `document_snapshots` Postgres table with `(documentId, snapshotAt, blob)` columns. The user-facing version history reads from snapshots, not from the live doc's history.
- **Snapshot cadence: every N updates OR every M minutes, whichever first.** For active editing, ~50 updates / 10 minutes. For idle, hourly. Trigger via a server-side debounce so 1000 clients don't all snapshot the same doc.
- **Compact on load.** When loading a Y.Doc with > 10K updates in history, the server merges them via `Y.mergeUpdates(updates)` and sends a single compacted blob. This is exactly the technique PowerSync documents.
- **Soft cap on Y.Doc size.** Refuse new writes (with user-visible "this document is full, please archive and start a new one") at, say, 20MB encoded Y.Doc. This limit must exist or the failure mode is "app freezes on load forever."
- **Per-PDF Y.Doc, not per-account.** Stated above (Pitfall 2) but reinforced here: a single Y.Doc accumulates. Bound the accumulation by sharding at the natural boundary (one PDF = one Y.Doc).
- **Consider Y.Doc deletion vs archiving.** When a user "deletes" all annotations on a PDF, do you delete the Y.Doc (lose history) or mark it tombstoned (keep history)? Default to tombstoned + snapshot-frozen. Add an explicit hard-delete admin action for compliance/GDPR requests.

**Warning signs:**
- App load time grows non-linearly with document age.
- IndexedDB usage report shows individual y-doc rows >5MB.
- Supabase realtime errors with "payload too large" when a new client subscribes — initial sync exceeded 1MB.
- y-indexeddb writes happen on every edit but the DB store size grows by KB per write — operations are accumulating rather than compacting.

**Severity:** HIGH — performance cliff that's invisible in dev and catastrophic at year-old documents
**Phase to address:** **Phase 1 (CRDT foundation)** sets the snapshot architecture. **Phase 6 (multi-tab hardening)** stress-tests with synthetic 10K-update docs.

---

### Pitfall 11: Awareness state and Y.Doc state confused — cursors in document history

**What goes wrong:**
A naive implementation puts user cursor positions, selection rectangles, or "currently editing X" markers into the Y.Doc itself (e.g., `yDoc.getMap('cursors').set(userId, {x, y})`). This:
- Creates a Y.Doc update for every mousemove (thousands per minute).
- Persists cursor positions in y-indexeddb (useless on next load).
- Bloats history (every cursor move is in the undo stack).
- Triggers UndoManager to track cursor moves as undo-able operations.

The user undoes their last drawing — instead, they undo a cursor move. Or worse: the document is now 200MB of cursor history.

**Why it happens:**
The Yjs awareness protocol is a separate API (`y-protocols/awareness`) and not all tutorials clarify when to use it. Developers new to Yjs see "Y.Map for shared state" and lump everything in.

**How to avoid:**
- **Hard rule: any state that should NOT survive a refresh goes through `Awareness`, not `Y.Doc`.** Cursors, selections, "Bob is currently editing", typing indicators — all awareness.
- **Awareness is local-only by default, syncs ephemerally over the same channel.** No persistence, no history, no GC concerns.
- **Awareness state has a TTL.** When a user disconnects, their awareness entry is cleared automatically. Y.Doc state has no concept of "user left, clear their data."
- **Per-PDF awareness scope.** Awareness lives on the per-document Y.Doc instance. When you switch PDFs, you switch awareness clients. Don't try to maintain a global "all online users on all PDFs" awareness — that's a different protocol.
- **UndoManager scope EXCLUDES awareness.** Construct UndoManager pointed at specific Y.Map roots. Awareness isn't on the Y.Doc, so it's automatically excluded — but if you ever conflate them, undo will break.

**Warning signs:**
- IndexedDB grows rapidly during an idle session where users are just hovering.
- Undo doesn't undo what the user expected — it reverts a cursor or selection.
- Cursor positions persist after a refresh, showing collaborators "in" positions they're no longer in.

**Severity:** HIGH — both performance and UX correctness
**Phase to address:** **Phase 7 (activity log + presence)** owns the awareness boundary.

---

## Medium-Severity Pitfalls (stale UI, ergonomic, integration friction)

### Pitfall 12: Y.Map vs Y.Array for the per-page annotation collection — wrong choice forces a rewrite later

**What goes wrong:**
Choosing Y.Array for the per-page annotation list seems natural ("a list of annotations"). But Y.Array's identity is positional. To update annotation X, you find its index and set it — and the index changes when other users insert/delete. You either store an `id` and do linear search per update (slow at scale, racy across clients), or you accept that "edit annotation at index 3" is meaningless across users.

Y.Map keyed by uuid sidesteps this entirely. But Y.Map has no order. If you need draw-order (z-index), you store a `zIndex` field on each value and sort in the renderer.

**Why it happens:**
"List = Array" is the default mental model. CRDT lists are subtly different from in-memory lists.

**How to avoid:**
- **Per-page annotations: Y.Map<annoId, Y.Map<field, value>>.** Outer map keyed by uuid. Inner map for the annotation's fields (so individual field updates create small deltas, not full-object replaces).
- **Z-index handled via fractional indexing.** Don't store integer z-index — concurrent z-index changes by two users become a merge conflict ("both want z=5"). Use string fractional indices (e.g. `"0|hzzzzz:"`) à la Figma. Library: `fractional-indexing` on npm. Insert between A and B = lexicographic mid-string. No conflicts.
- **Y.Array is correct for unbounded immutable append-only logs** (like the activity log itself, if you choose to put it in CRDT — though see Pitfall 13, you probably shouldn't).
- **Test the choice on day 1.** Build a `Y.Map<id, Y.Map>` toy and a `Y.Array` toy, simulate two clients editing the 50th item simultaneously, confirm the Map version converges cleanly.

**Warning signs:**
- "Which annotation is being edited?" requires linear scan in the renderer — wrong type chosen.
- Two users insert at the same z-index and one's insert gets overwritten — z-index needs fractional indexing.
- Sync churn on every edit is full-doc-size, not delta-size — you're using Y.Map but storing whole-object values, not field-level Y.Map values.

**Severity:** MEDIUM — annoying but recoverable mid-implementation
**Phase to address:** **Phase 1 (CRDT foundation)** sets the schema. **Phase 3 (Yjs <-> Fabric binding)** stress-tests during integration.

---

### Pitfall 13: Activity log stored inside the Y.Doc → unbounded history → see Pitfall 10

**What goes wrong:**
Treating the activity log as a `Y.Array` of "{user, action, ts, annoId}" entries inside the Y.Doc creates a CRDT-managed log that:
- Grows forever, opaquely, alongside the actual document content.
- Gets transferred on every initial sync.
- Has merge semantics that don't matter for a log (logs are append-only by definition; CRDT add complexity without benefit).
- Is hard to query — "show me all of Isaiah's deletions on Tuesday" requires scanning the entire array client-side.

**Why it happens:**
"Everything in the Y.Doc" is appealing for consistency. It's wrong for logs.

**How to avoid:**
- **Activity log lives in Postgres, not in the Y.Doc.** Server-side, hook on each Y.Doc update event, extract origin metadata, write a row to `activity_log (id, document_id, user_id, device_id, op_type, anno_id, server_ts, client_ts, summary_json)`. Postgres indexes on `(document_id, server_ts)` and `(user_id, server_ts)` make queries instant.
- **Server is the only writer.** Clients don't write to activity_log directly; clients can't forge entries. RLS allows reads of entries for documents the user has access to.
- **Y.Doc origin metadata is the only source of truth for log contents.** Don't try to derive "what happened" from diffing Y.Doc states — origins tell you directly.
- **Garbage collect the log on a separate cadence.** Drop entries >12 months by default. Make this configurable per workspace for compliance use cases.
- **Materialized "last 24 hours" view per document.** Cheap query for the "recent activity" sidebar UI.

**Warning signs:**
- "Show all activity on this document" query is slow.
- Activity log entries are missing for some types of operations — you forgot to set origin on those code paths (e.g., the Liang-Barsky callout auto-route from v2.3 fires modifications without origin tagging).

**Severity:** MEDIUM — ergonomic + scaling, fixable by moving the log out of Y.Doc
**Phase to address:** **Phase 7 (activity log + presence)**.

---

### Pitfall 14: Hocuspocus vs custom Supabase-realtime adapter — a multi-month detour either way

**What goes wrong:**
**Hocuspocus path:** add a new node service, deploy it on Fly.io / Railway / Vercel-incompatible because it's stateful, configure Postgres persistence, wire auth from Supabase JWTs, add a sticky-session load balancer when scaling. 4-8 weeks of infra work. License is MIT (good). Cost is real (a small Hocuspocus instance is $20-50/month, more at scale).

**Custom Supabase-realtime path:** Supabase realtime is broadcast/presence-oriented, not protocol-aware. Yjs needs server-side state (initial sync = "give me the current encoded state"). You either build a Postgres function that holds Y.Doc state per document and applies updates server-side (complex, latency-sensitive), or accept a "client-mesh" model where the first connected client snapshots and serves to newcomers (vulnerable to that client disconnecting mid-sync). Either is a custom protocol layer, weeks of work, and the team needs to maintain it.

The trap is choosing without realizing the magnitude of either. The previous simple-sync system was simple — collab is not. There is no "use what we have, add CRDT" button.

**Why it happens:**
Wishful estimation. The marketing promise of "Yjs is just a library" obscures that real-time sync at production grade is server infrastructure.

**How to avoid:**
- **Decide before Phase 2.** This is a fork in the road. Possible answers:
  - **(A) Hocuspocus self-hosted.** Pay for the infra, get a known-good protocol. Authoritative server. Recommended if collaboration is a core feature for the next 2+ years.
  - **(B) Tiptap Cloud (managed Hocuspocus).** $50–500/month depending on doc count. Zero infra. Vendor lock for collab, but collab can be ripped out without breaking single-user.
  - **(C) Supabase realtime + custom protocol.** Cheapest infra-wise but most engineering. Recommend ONLY if Phase 2 includes a 4-week timebox to prototype and a fallback to (A) if it doesn't work.
  - **(D) Liveblocks / Partykit.** Managed alternatives. Liveblocks has Yjs adapter, is paid, well-supported.
- **Document the decision in `STACK.md` with a one-page rationale.**
- **Don't choose (C) because "we already have Supabase."** Realtime collab is a different shape of problem from CRUD-with-realtime-broadcasts.

**Warning signs:**
- Phase 2 estimate is "1 sprint" — that's wishful.
- The team starts implementing (C) without prototyping initial-sync correctness — you'll discover the gap at week 6.
- Realtime payloads exceed 1MB on initial-sync — your protocol layer doesn't compact and Supabase will start dropping messages.

**Severity:** MEDIUM in pure terms but phase-impactful — the wrong choice extends the milestone by 2+ months
**Phase to address:** **Phase 2 (transport + auth)**. The phase MUST start with a 1-week comparison spike before committing.

---

### Pitfall 15: Supabase Postgres column type wrong — TEXT for binary CRDT updates corrupts data

**What goes wrong:**
Y.Doc updates are `Uint8Array`. Storing in a `TEXT` column requires encoding (base64). Supabase JS client handles bytea round-trips imperfectly in some versions (especially older). Trying to JSON.stringify a Uint8Array silently produces `{"0":1,"1":2,...}` — an unusable object, not a binary blob.

Symptom: you write what you think is an update, you read it back, `Y.applyUpdate(doc, readBack)` throws "invalid update" or — worse — appears to succeed but the doc is wrong.

**Why it happens:**
JS doesn't have a native Buffer/binary type that auto-serializes. Uint8Array's JSON behavior is the bug magnet.

**How to avoid:**
- **`bytea` column type.** Postgres native binary. The Supabase JS client returns `Uint8Array` directly, no base64 dance.
- **If `bytea` round-trip fails (older client or specific Supabase config),** explicit base64 encode/decode at the client boundary, with a util module that's the ONLY place that touches the binary boundary. One module, fully tested.
- **Schema: `document_snapshots (id, document_id, snapshot_at, content bytea, content_size_bytes int, encoding_version smallint)`.** The `encoding_version` lets you migrate to v2 update encoding later without breaking old reads.
- **Test round-trip in CI.** Encode a Y.Doc, push to Postgres, read back, decode, compare to original. This is a 10-line test that catches the entire class of bug.
- **NEVER `INSERT ... VALUES (jsonb_build_object('content', $1))` with binary $1.** That's the classic foot-shoot.

**Warning signs:**
- Y.applyUpdate throws on data that came back from Supabase.
- `content_size_bytes` doesn't match `length(content)` server-side — encoding pipeline has corruption.

**Severity:** MEDIUM — discovered immediately in dev if you test, hides in prod if you don't
**Phase to address:** **Phase 1 (CRDT foundation)** sets schema; **Phase 2 (transport + auth)** sets the I/O pipeline.

---

### Pitfall 16: RLS on bytea blobs — sequential scans, slow reads, no index helps

**What goes wrong:**
Putting RLS on the `document_snapshots` table is correct for security. But if the RLS policy is `EXISTS (SELECT 1 FROM document_shares WHERE document_id = document_snapshots.document_id AND user_id = auth.uid())`, every read scans `document_shares`. With 100K shares and 10M snapshots, this is sequential per read.

Compounding: bytea columns can be large (1-5MB per snapshot). Postgres TOAST kicks in. Each row read pulls the TOAST table. Now your "fetch latest snapshot" query reads from main + TOAST + does an EXISTS subquery. P99 latency suffers.

**Why it happens:**
RLS is correct in spirit but Postgres-naive. New developers slap a policy on without checking the explain plan.

**How to avoid:**
- **Index `document_shares (user_id, document_id)`. Index `document_snapshots (document_id, snapshot_at DESC)`. RLS subquery becomes index-only.**
- **Materialize `user_documents` denorm.** A materialized view of `(user_id, document_id, role)` refreshed on share changes. RLS reads from materialized view. Trade some staleness (refresh debounce of 5s) for predictable latency.
- **Don't RLS the snapshot bytea directly. RLS the `documents` table; foreign-key snapshots to it.** If you can read the document row, you can read its snapshots. Single RLS check per query path.
- **Don't store auxiliary data alongside binary.** Keep `(metadata)` and `(content)` in separate tables if metadata RLS needs to be cheap. Snapshot-fetch becomes "check metadata access, then fetch content by id."
- **Run `EXPLAIN ANALYZE` on the snapshot fetch query before merging Phase 2.**

**Warning signs:**
- Initial sync takes seconds even on small docs.
- Supabase logs show the snapshot query at the top of "slowest queries."
- RLS-enabled query plan shows a Seq Scan on `document_shares`.

**Severity:** MEDIUM — won't be noticed in dev (small data) but breaks at first multi-tenant scale
**Phase to address:** **Phase 2 (transport + auth)**. AC: snapshot fetch <50ms p99 with realistic share-table size.

---

### Pitfall 17: Schema evolution — a new annotation field breaks old clients

**What goes wrong:**
v2.4.0 ships with `arrowStyle: 'classic' | 'thin' | 'thick'`. v2.5.0 adds `arrowStyle: 'classic' | 'thin' | 'thick' | 'reverse-arrow'`. v2.4.0 client receives an update with `arrowStyle: 'reverse-arrow'`, doesn't render it (falls back to classic? throws? renders blank?). The Y.Doc itself is fine — it stores the value. The bug is in the consumer code that didn't account for unknown values.

CRDT property: schema can evolve in Yjs because Y.Doc stores values byte-faithfully. But your code's interpretation can't evolve.

**Why it happens:**
Single-user apps don't have version-skew across simultaneously-running clients. Multi-user does, especially with auto-update.

**How to avoid:**
- **Forward-compatible enum handling.** Every enum read is `arrowStyle in KNOWN_STYLES ? arrowStyle : 'classic'` (default to a safe fallback). Never `switch (arrowStyle) { case 'classic': ... default: throw }`.
- **Field additions are always optional.** Old clients see undefined → use default. New clients write the new field; old clients that re-save preserve the field as opaque (Y.Map preserves unknown keys naturally if you do per-field merges, which you should).
- **Field renames are forbidden.** Rename = delete old + add new = two operations + migration. Do schema additions instead.
- **`schemaVersion` on each document.** New clients can detect "this doc was last edited by an older schema, may need backfill." But don't gate on it — a v2.4 client should still cooperate with a v2.4 doc.
- **Client version check on connect.** If the document was created or last edited by a strictly-newer-major-version, warn the user "some features in this document may not display correctly until you update."
- **Test with two-version-skew Playwright.** Run v2.4 and v2.5 against the same doc, verify both can edit and see each other's changes (with some features potentially absent on v2.4).

**Warning signs:**
- After a release, users on the old version report "blank annotation appears" — schema evolution wasn't forward-compatible.
- The Y.Doc has fields the current code doesn't know about — old clients SHOULD pass them through, but if the code re-builds the value object instead of preserving unknown keys, the field is lost on the next save.

**Severity:** MEDIUM — recoverable but user-visible
**Phase to address:** **Phase 1 (CRDT foundation)** sets the schema-versioning convention.

---

## Lower-Severity Pitfalls (ergonomic, recoverable)

### Pitfall 18: Awareness flicker on rapid disconnect/reconnect

**What goes wrong:**
User's wifi blips. Awareness disconnects. After 30 seconds, awareness times out and removes the user's cursor. User reconnects. Cursor reappears. To other users, the user "left and came back" three times in a minute. Cursor flicker is annoying; a chat-like "Bob joined" / "Bob left" notification spammed three times is worse.

**Why it happens:**
y-protocols/awareness has a default ~30s timeout. Reconnects reset the local awareness state, which broadcasts as "new client."

**How to avoid:**
- **Persist client_id across reconnects within the same browser session.** Don't generate a new awareness client_id per WS connection.
- **UI debounce on join/leave events.** Show "Bob is here" only after 5 seconds of stable presence; show "Bob left" only after 60 seconds of absence.
- **Cursor smoothing.** Render cursor with CSS transition; on awareness update, set new position; the transition smooths the apparent jump.

**Severity:** LOW — UX polish
**Phase to address:** **Phase 7 (activity log + presence)**.

---

### Pitfall 19: IndexedDB quota exceeded on Electron — silent failure

**What goes wrong:**
Electron's IndexedDB quota varies by platform and configuration. On user machines with full SSDs, quota can be very small (Electron has historically had `1/3 of free space` but inconsistencies are documented in `electron/electron#16029`). y-indexeddb writes fail silently in some configurations, succeed in others — the test machine works, the user's machine doesn't.

When y-indexeddb fails to persist, the user sees nothing wrong until they refresh — at which point local edits are gone.

**Why it happens:**
- IndexedDB API throws QuotaExceededError; y-indexeddb catches it (or doesn't, depending on version).
- Electron's quota reporting is unreliable.
- The Y.Doc continues operating in-memory just fine, masking the persistence failure.

**How to avoid:**
- **Wrap y-indexeddb writes in error handlers that surface UI.** "Local storage is full. Your work is not being saved locally — please ensure you have a network connection to save to the cloud."
- **Periodic quota check.** `navigator.storage.estimate()` reports usage and quota. If usage > 80% of quota, warn user.
- **Compact y-indexeddb store on load.** y-indexeddb has a `mergeUpdates` step but it's not aggressive. Run `Y.encodeStateAsUpdate -> Y.applyUpdate to fresh doc -> persist` periodically to flatten history.
- **Fallback to memory-only mode.** If y-indexeddb fails, run with in-memory-only Y.Doc + aggressive cloud sync. UX is "you must be online" but at least no silent failure.

**Severity:** LOW-MEDIUM — affects a small % of users but devastating when it hits
**Phase to address:** **Phase 6 (multi-tab hardening)** owns the persistence-failure UX.

---

### Pitfall 20: One-Y.Doc-per-browser-session vs per-tab — wrong scope leaks data across documents

**What goes wrong:**
Developer creates a singleton Y.Doc at app boot, calls it `currentDoc`, and reuses it when the user switches PDFs. Annotations from PDF A bleed into PDF B because the Y.Doc was never reset (just rewired to a different transport). Or: the Y.Doc IS reset, but observers from PDF A's components are still attached, firing on PDF B's data.

**Why it happens:**
Y.Doc lifecycle is manual. React lifecycle is automatic. They're not aligned. The simple-sync system reused session-id across documents — same family of bug.

**How to avoid:**
- **Y.Doc instance keyed by document-id, in a registry. `getOrCreateDoc(documentId)` returns existing or creates fresh.**
- **On switching PDFs, the OLD Y.Doc's observers are detached (React effect cleanup), but the Y.Doc itself stays in the registry.** Fast resume on switch-back.
- **`destroy()` only when memory pressure forces eviction.** Y.Doc.destroy() is permanent — don't call it on every PDF switch.
- **No `currentDoc` global. Always lookup by id.** `appState.currentDocumentId` is the only mutable; everything else derives.
- **Tag every observer with the doc-id it's bound to. Never reuse an observer across docs.**

**Severity:** LOW (caught early in dev) but if it ships, LOOKS like data corruption
**Phase to address:** **Phase 1 (CRDT foundation)** sets the registry pattern.

---

### Pitfall 21: Y.Doc destroyed mid-transaction → corrupted state

**What goes wrong:**
User clicks "close PDF" while a long Yjs transaction (say, paste 500 annotations) is in progress. Naive code: `yDoc.destroy()` is called. The transaction was holding internal state. A second-later async write tries to use that state. Throws. Worse: in some versions, the post-destroy state is partially written to y-indexeddb, leaving the document unloadable on next open.

**Why it happens:**
Y.Doc.destroy() is sync, transactions can have async boundaries (especially when bound to providers).

**How to avoid:**
- **Never destroy a Y.Doc while it has in-flight transactions.** Wrap teardown in `await pendingTransactionsComplete(); yDoc.destroy();`.
- **Provider close before doc destroy.** `provider.disconnect()` or `provider.destroy()` first; this lets it flush. Then `yDoc.destroy()`.
- **No destroy on PDF switch (per Pitfall 20). Destroy only on app close, where it's the last thing to happen.**

**Severity:** LOW — rare, but creates unrecoverable corrupt docs when it hits
**Phase to address:** **Phase 1 (CRDT foundation)** sets the lifecycle pattern.

---

### Pitfall 22: AGPL contagion via transitive dependency

**What goes wrong:**
Yjs itself is MIT (verified, see Sources). But a transport like `y-redis` could be GPL/AGPL (it's not — currently MIT). A future provider might be. A bundle audit reveals the app is now subject to GPL terms; the Stripe-billed product is technically out of license compliance.

**Why it happens:**
License audits are afterthoughts. New deps get added without checking.

**How to avoid:**
- **License manifest in CI.** `license-checker --excludePackages '...' --failOn 'GPL;AGPL'` in the build step.
- **Allow-list of licenses.** MIT, ISC, BSD, Apache-2.0. Anything else requires explicit waiver.
- **Audit at every Yjs ecosystem dep addition.** y-websocket, y-protocols, y-indexeddb, y-leveldb, etc. — verify each.

**Severity:** LOW (Yjs ecosystem is overwhelmingly MIT) but commercially fatal if it hits
**Phase to address:** **Phase 1 (CRDT foundation)** sets the license-check CI gate.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use Y.Map but stuff whole-object JSON values | Fast to ship, looks like the old model | Every field edit syncs the whole annotation, history bloats 10x | **Never** for the live working set; OK for write-once read-only fields |
| Skip transaction origins on internal helpers | Less boilerplate | Activity log gaps, undo scope leakage, echo loops | **Never** — origin tagging is a correctness invariant |
| Single Y.Doc for everything (whole workspace) | One subscription, easier to reason about | Unbounded growth, all-users-see-everything by default, scale ceiling at ~50K updates | **Never** — shard by natural boundary (PDF) |
| Disable garbage collection "for safety" | Snapshot/version-history "just works" | 10x storage, 10x sync payload, eventual unrecoverable bloat | Only in conjunction with explicit periodic snapshot extraction (Pitfall 10) |
| Rely on Supabase realtime DB-changes for CRDT sync | Reuses existing infra | Per-row JSON broadcasts can't carry binary updates efficiently; payload limits hit; backpressure not respected | **Never** for CRDT sync; OK for high-level metadata broadcasts (presence, doc list refresh) |
| Use the same UndoManager for all users in a session | Simpler API | Users undo each other's work; trust destroyed | **Never** in collab |
| Skip server-side timestamp authoritative source | Skip a server hook | Activity log lies when client clocks drift | **Never** — server-authoritative timestamps are mandatory |
| Trust client-provided author metadata | Less server work | Forgery / impersonation attack surface | **Never** — server reads `auth.uid()`, never trusts a client-supplied userId |
| Migrate all rows in one batch script | "Get it over with" | Multi-hour Postgres lock; clients on old code-path during migration write rows that get lost | **Never** — see Pitfall 1, dual-write era is mandatory |
| Test only with two browser tabs on same machine | Fast iteration | Real-world failure modes (NAT, slow network, real clock skew, real disconnects) never surface | OK for unit-level binding tests; **never sufficient** for shipping |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Yjs ↔ Fabric.js 5.5.2** | Wire `object:modified` directly to `Y.Map.set` in both directions | Origin-tagged transactions + `applyingRemote` flag mute (Pitfall 4); registry-based annoId↔FabricObject lookup (Pitfall 6) |
| **Yjs ↔ React** | Re-create Y.Doc on every render | Stable Y.Doc held in `useRef` or module registry; observers in `useEffect` with cleanup |
| **Yjs ↔ Supabase Postgres** | Store updates as TEXT or JSONB | `bytea` column; explicit content_size_bytes for monitoring (Pitfall 15) |
| **Yjs ↔ Supabase Realtime** | Broadcast every Y.Doc update as a JSON realtime payload | Use a server-side authoritative provider (Hocuspocus or custom Postgres-function relay) — Supabase realtime alone isn't enough (Pitfall 14) |
| **Yjs ↔ Supabase RLS** | One RLS policy on snapshot bytea table with subquery | Index materialized view of user-document access; RLS the parent `documents` row, FK from snapshots (Pitfall 16) |
| **Yjs ↔ Electron renderer** | Treat as identical to browser | Verify IndexedDB quota; handle quota errors with UI; check Electron-specific race conditions on app exit (Pitfall 19, 21) |
| **Yjs ↔ existing localStorage `annotationsByPage`** | Replace localStorage with Y.Doc directly | Migrate via the dual-write Phase A pattern (Pitfall 1); keep localStorage as a fallback/replay buffer for the migration window |
| **Yjs ↔ existing Fabric mount/unmount per edit** | Try to keep Fabric mounted always for sync | Keep current SVG-display + Fabric-edit-only model; SVG renders FROM Y.Doc, Fabric writes TO Y.Doc on object:modified (Pitfall 6) |
| **Awareness ↔ Y.Doc** | Put cursors in Y.Doc | Awareness lives on `awarenessProtocol`, NEVER in Y.Doc (Pitfall 11) |
| **UndoManager ↔ multi-user origins** | Default UndoManager construction | Pass `trackedOrigins: new Set([userOrigin])` (Pitfall 7) |
| **Stripe license gate ↔ collab feature** | Gate at UI render time only | Server-side enforcement of "is this user's plan eligible to share this doc?" before a share row is created; client can't bypass |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Y.Doc grows unbounded with GC off | Load time scales with edit count, IndexedDB bloat | Periodic snapshot extraction + Y.Doc compaction (Pitfall 10) | Around 10K–50K updates per doc, or 6–12 months of daily edits |
| `observeDeep` on root Y.Map | Entire app re-renders on any annotation change | Per-annotation observers, not root-level (Pitfall 4) | Around 100+ annotations on a page |
| Fabric `object:modified` echoing through Y.Doc | CPU pegged, IndexedDB grows during idle | Origin-tag guards, `applyingRemote` flag (Pitfall 4) | Immediately on first drag |
| Storing whole-object Y.Map values (not field-level) | Sync payload large per edit | Y.Map values are themselves Y.Maps; field-level deltas (Pitfall 12) | Around 50+ concurrent edits/second on a busy doc |
| Awareness state in Y.Doc | y-indexeddb grows during cursor movement | Use awarenessProtocol exclusively (Pitfall 11) | Within minutes of presence going live |
| Initial sync without compaction | Multi-second app load on busy docs | Server compacts on send; soft cap on payload size | Around 5MB encoded Y.Doc, hits Supabase realtime 1MB limit hard |
| RLS subqueries on snapshot bytea | Slow snapshot fetches at multi-tenant scale | Materialized view + indexes (Pitfall 16) | Around 100K shares + 1M snapshots |
| One Y.Doc per workspace (not per PDF) | Everything-bleeds-to-everyone, scale ceiling | Per-PDF Y.Doc, registry pattern (Pitfall 10, 20) | Around 50 PDFs in workspace |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trust client-supplied `userId` in transaction origin | User A can forge actions as User B in activity log | Server reads `auth.uid()` from JWT, overwrites client-supplied userId on receipt; client-supplied stored as `client_claimed_user_id` only for forensic comparison |
| Awareness data unprotected | Removed collaborator can still see live cursors of remaining users | Server-side awareness filtering: do not relay awareness updates to clients without current document access; on revoke, force-close their awareness channel |
| Y.Doc snapshot leak via direct table read | A user with read-only doc access reads snapshot bytea and reverse-engineers private fields | RLS on snapshots = RLS on parent documents; never expose snapshots table directly to non-server clients |
| Unrestricted `applyUpdate` from any client | Malicious client sends crafted update that includes deletions of all annotations | Server-side update validation: parse update before applying, reject if it deletes content owned by users not currently online (or simply: only owners can do bulk-deletes; collaborators can edit but not bulk-revert) |
| AGPL/GPL transitive dep in Stripe-billed product | License compliance violation, potential lawsuit | License manifest in CI (Pitfall 22) |
| RLS bypass via Yjs sub-doc smuggling | Attacker creates Y.Doc that contains a Y.Doc subdocument referencing another user's doc-id | Server validates subdoc references against permission table on every applyUpdate |
| Activity log injection | Client sends fabricated origin metadata claiming "deleted by Isaiah" when not Isaiah | Server overwrites userId/deviceId from auth context; client-claimed values are forensic-only |
| Replay attack — old update applied to roll back state | Yjs's CRDT property means re-applying old updates is idempotent — UNLESS you have an "apply-once" assumption elsewhere | Idempotency assumed; but signed updates with monotonic per-client counters detect replay-from-different-client |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual indication of sync state | User doesn't know if their work is saved | Per-annotation sync indicator (gray dot=local-only, green=synced, red=failed); document-level "syncing/synced/offline" status in toolbar |
| Cursor flicker on every reconnect | Distraction, "is the app broken?" feel | Smooth presence transitions (Pitfall 18) |
| Undo restores other users' deleted work | Confusion, "ghost annotations" appearing | Per-user undo scope (Pitfall 7) |
| Silent permission revocation | User keeps editing for hours, loses all work | Hard wipe on revocation with explicit modal (Pitfall 3) |
| No "who's here right now" indicator | User doesn't know if they're alone or being watched | Awareness-driven avatar stack in the document header |
| Activity log shown chronologically with bad timestamps | "Wait, why does this say Bob deleted *before* I drew it?" | Server-authoritative timestamps (Pitfall 9) |
| Conflict resolution UX hidden | When two users edit the same property simultaneously, last-write wins silently — feels arbitrary | Visual indicator when a remote edit overrides a local one mid-flight; one-button "revert" if user disagrees |
| Sharing dialog UX assumes Yjs semantics | "I shared, why don't they see it?" — share record exists but Y.Doc isn't subscribed yet | Optimistic UI: show "sharing..." until receiving party's awareness pings the doc (proves they're connected) |

---

## "Looks Done But Isn't" Checklist

- [ ] **CRDT foundation:** Often missing the dual-write migration plan — verify `.planning/research` and `.planning/phases` include explicit Phase A/B migration steps (Pitfall 1)
- [ ] **Yjs ↔ Fabric binding:** Often missing the origin-guard test — verify Playwright includes a 1000-stroke draw loop that asserts no echo (Pitfall 4)
- [ ] **Multi-user undo:** Often missing the cross-user isolation test — verify "A draws, B draws, A undoes, only A's stroke reverts" is in the test suite (Pitfall 7)
- [ ] **Awareness:** Often missing the verification that awareness is NOT in Y.Doc — verify `yDoc.toJSON()` does not contain cursor positions (Pitfall 11)
- [ ] **Activity log:** Often missing the server-authoritative timestamp — verify activity_log rows have `server_ts` populated for every entry, not just `client_ts` (Pitfall 9)
- [ ] **Permission revocation:** Often missing the local-state-wipe — verify removed-collaborator scenarios in Playwright include a state assertion that local IndexedDB is cleared (Pitfall 3)
- [ ] **Snapshot extraction:** Often missing the periodic compaction — verify a doc with 1000+ updates gets compacted in CI (Pitfall 10)
- [ ] **License compliance:** Often missing the CI gate — verify `license-checker` runs in build, fails on AGPL/GPL (Pitfall 22)
- [ ] **Multi-tab safety:** Often missing the Web Locks election — verify two-tab Playwright scenario doesn't duplicate updates in IndexedDB (Pitfall 2)
- [ ] **Schema evolution:** Often missing the forward-compat tests — verify v(N) and v(N+1) clients can edit the same doc simultaneously (Pitfall 17)
- [ ] **Server-side validator:** Often missing the rejection-on-revoked-permission path — verify a removed collaborator's update gets rejected with a clear reason (Pitfall 3)
- [ ] **Origin metadata coverage:** Often missing on internal-helper code paths — grep for `yDoc.transact` / `yMap.set` and verify EVERY call has an origin (Pitfall 4, 8)
- [ ] **Y.Doc per PDF:** Often regresses to "shared workspace doc" mid-implementation — verify there's exactly one Y.Doc per PDF in the registry, no global doc (Pitfall 10, 20)
- [ ] **Activity log query performance:** Often skipped until late — verify `EXPLAIN ANALYZE` of "show activity for doc X by user Y in last 24h" is index-only (Pitfall 13, 16)
- [ ] **Initial sync payload size:** Often only tested on small docs — verify with synthetic 5K-update doc that initial sync stays under 1MB (Supabase limit) (Pitfall 14, 16)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Migration partial-state (Pitfall 1) | HIGH | Halt rollout. Restore documents from pre-migration backups (must exist). Re-run migration with idempotency verified. Communicate to affected users. |
| Multi-tab corruption (Pitfall 2) | MEDIUM | Compact each user's y-indexeddb store via background job. Snapshot from server is authoritative; client local state is rebuilt from snapshot. Force-refresh affected clients. |
| Permission leak (Pitfall 3) | HIGH (legal/security) | Audit log of which clients received which updates. Notify affected document owners. Force re-auth + local-wipe on all affected clients. |
| Echo loop (Pitfall 4) | MEDIUM | Hotfix the missing origin guard. Y.Doc itself is bloated — run server-side compaction on affected docs. Push compacted state to clients. |
| 1-second verify wipe (Pitfall 5) | HIGH | Restore affected docs from server snapshots (server should have older state). Hotfix the offending code path. |
| Object identity drift (Pitfall 6) | LOW | Force re-render from Y.Doc on next edit-mode entry. Client-side fix only. |
| Cross-user undo (Pitfall 7) | LOW | UndoManager with proper trackedOrigins; restart session to apply. |
| Author metadata gaps (Pitfall 8) | MEDIUM | Activity log entries with missing origins are flagged "unknown author." Backfill if possible from cross-referenced timestamps. |
| Clock drift (Pitfall 9) | LOW | Display warnings; do not retroactively rewrite log timestamps. Document the discrepancy. |
| Y.Doc bloat (Pitfall 10) | MEDIUM | Server-side compaction job. Force re-sync on clients after compaction. |
| Awareness in Y.Doc (Pitfall 11) | MEDIUM | Compact Y.Doc, drop cursor entries. Migrate to awareness protocol. |
| Wrong Y.Map vs Y.Array (Pitfall 12) | HIGH (mid-implementation) | Migrate via Yjs document migration pattern (drain to JSON, re-encode into new schema). Coordinate flag-day. |
| Activity log in Y.Doc (Pitfall 13) | HIGH | Extract log entries to Postgres via one-time job. Strip log data from Y.Doc. Compact. |
| Wrong transport choice (Pitfall 14) | HIGH | This is why Phase 2 must include the spike. If chosen wrong post-Phase-2, accept multi-month delay. |
| Wrong column type (Pitfall 15) | LOW (early) / MEDIUM (after data) | ALTER TABLE; data migration. Acceptable if caught in dev. |
| RLS performance (Pitfall 16) | LOW | Add indexes; no data corruption. |
| Schema evolution break (Pitfall 17) | LOW | Hotfix forward-compat handling. No data lost; just rendering issues. |
| Quota exceeded (Pitfall 19) | LOW | Compact y-indexeddb. Communicate quota to user. |
| Y.Doc destroyed mid-tx (Pitfall 21) | LOW-MEDIUM | Restore Y.Doc from server snapshot. Log incident; investigate root cause. |
| AGPL contagion (Pitfall 22) | HIGH (commercially) | Remove offending dep, find replacement. May require feature reduction. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Severity | Prevention Phase | Verification |
|---------|----------|------------------|--------------|
| 1. Migration partial-state | CRITICAL | **Phase 1** (schema design) + **Phase 4** (rollout) + **Phase 5** (cutover) | Dual-write era smoke test; idempotent re-run test |
| 2. y-indexeddb multi-tab | CRITICAL | **Phase 1** (lock/registry) + **Phase 6** (stress test) | Two-tab Playwright scenario; IndexedDB linear-growth check |
| 3. Y.Doc-vs-RLS mismatch | CRITICAL | **Phase 2** (server validator) + **Phase 3** (client rollback) + **Phase 8** (sharing UX) | Permission-revoke Playwright scenario with local-wipe assertion |
| 4. Echo loop | CRITICAL | **Phase 3** (binding) | 1000-stroke draw loop, CPU & IndexedDB monitoring |
| 5. 1s verify wipe | CRITICAL | **Phase 1** (applyUpdate-only rule) + **Phase 2** (transport adapter) | Mid-flight-edit-during-rehydrate Playwright |
| 6. Object identity drift | HIGH | **Phase 3** (binding registry) | Multi-user edit-same-shape Playwright |
| 7. Per-user undo scope | HIGH | **Phase 3** (UndoManager origins) | A-draws-B-draws-A-undoes test |
| 8. Author metadata on undo | HIGH | **Phase 3** (origin pattern) + **Phase 7** (log consumption) | Activity log assertion: every entry has userId/deviceId/serverTs |
| 9. Clock drift | HIGH | **Phase 7** (server timestamps) | Two-machine-skewed-clock test |
| 10. Y.Doc grows forever | HIGH | **Phase 1** (snapshot architecture) + **Phase 6** (compaction job) | Synthetic 10K-update doc load time |
| 11. Awareness in Y.Doc | HIGH | **Phase 7** (awareness boundary) | `yDoc.toJSON()` has no cursor data assertion |
| 12. Y.Map vs Y.Array | MEDIUM | **Phase 1** (schema) | Concurrent same-position-edit convergence test |
| 13. Activity log in Y.Doc | MEDIUM | **Phase 7** (Postgres log) | Activity log query performance test |
| 14. Hocuspocus vs custom | MEDIUM | **Phase 2** (decision spike) | 1-week prototype results documented |
| 15. Wrong column type | MEDIUM | **Phase 1** (schema) + **Phase 2** (I/O) | Round-trip CI test |
| 16. RLS bytea performance | MEDIUM | **Phase 2** (indexes + materialized view) | EXPLAIN ANALYZE p99 <50ms |
| 17. Schema evolution | MEDIUM | **Phase 1** (versioning convention) | Two-version-skew Playwright |
| 18. Awareness flicker | LOW | **Phase 7** (presence UX) | Reconnect-debounce manual UAT |
| 19. IndexedDB quota | LOW-MEDIUM | **Phase 6** (persistence-failure UX) | Quota-exceeded error path test |
| 20. Y.Doc per session leak | LOW | **Phase 1** (registry) | PDF-switch leak test |
| 21. Destroy mid-tx | LOW | **Phase 1** (lifecycle) | Forced-close-during-paste test |
| 22. AGPL contagion | LOW | **Phase 1** (CI license gate) | `license-checker` build step |

**Suggested phase ordering reading this matrix:**

1. **Phase 1 — CRDT Foundation:** Schema (Y.Map field-level, per-PDF Y.Doc registry, snapshot architecture), Yjs MIT confirmed, license CI gate, dual-column DB schema, applyUpdate-only rule, lifecycle pattern. Defends against pitfalls 1, 2, 5, 10, 12, 15, 17, 20, 21, 22.
2. **Phase 2 — Transport + Auth + Server Validator:** Hocuspocus-vs-custom decision spike, server-side update validator, RLS + indexes + materialized view for snapshots. Defends against pitfalls 3, 14, 16. Verifies Phase 1's I/O pipeline.
3. **Phase 3 — Yjs ↔ Fabric Binding:** Origin-tag transactions, applyingRemote guard, per-user UndoManager, registry-based annoId↔FabricObject lookup, edit-session-scoped observers. Defends against pitfalls 4, 6, 7, 8.
4. **Phase 4 — Migration (Phase A: dual-write era):** Old code keeps writing legacy rows, new code dual-writes legacy + CRDT. Reads always pick one path. Defends against pitfall 1.
5. **Phase 5 — Migration (Phase B: cutover):** Per-document seal flag; sealed docs are CRDT-only. Old clients gated to update. Defends against pitfall 1.
6. **Phase 6 — Multi-tab + Persistence Hardening:** Web Locks election test, IndexedDB quota UX, periodic Y.Doc compaction job, Playwright multi-tab stress. Defends against pitfalls 2, 10, 19.
7. **Phase 7 — Activity Log + Presence:** Awareness protocol (cursors, selections, "Bob is here"), server-authoritative activity log in Postgres, server timestamps, presence UX polish. Defends against pitfalls 8, 9, 11, 13, 18.
8. **Phase 8 — Sharing UX + Permission Revocation:** Share dialog, permission-revoke flow with hard local wipe, server-rejection of revoked-user updates. Defends against pitfall 3.

Phase 3 is the highest-risk single phase (4 critical/high pitfalls converge on the binding layer); allocate accordingly.

---

## Sources

**Yjs official documentation:**
- [Y.UndoManager — Yjs Docs](https://docs.yjs.dev/api/undo-manager) — origin tagging, trackedOrigins for per-user undo (HIGH confidence)
- [Y.Map — Yjs Docs](https://docs.yjs.dev/api/shared-types/y.map) — Y.Map field semantics (HIGH)
- [Document Updates — Yjs Docs](https://docs.yjs.dev/api/document-updates) — applyUpdate, encodeStateAsUpdate, mergeUpdates (HIGH)
- [Working with Shared Types — Yjs Docs](https://docs.yjs.dev/getting-started/working-with-shared-types) — JSON-mutation warning (HIGH)
- [License — Yjs Docs](https://docs.yjs.dev/license) — MIT license confirmed (HIGH)

**Yjs ecosystem issues / community:**
- [yjs/y-indexeddb#25 — duplicate updates with multiple IndexeddbPersistence](https://github.com/yjs/y-indexeddb/issues/25) — multi-tab corruption (HIGH)
- [Yjs Community — Infinite loop of updates with React](https://discuss.yjs.dev/t/infinite-loop-of-updates-caused-in-rare-situation-with-react/1121) — echo loop class (HIGH)
- [Yjs Community — Capturing who authored last change](https://discuss.yjs.dev/t/capturing-who-authored-last-change/837) — origin metadata pattern (HIGH)
- [Yjs Community — Migrating data to YJS, optimizing storage](https://discuss.yjs.dev/t/migrating-data-to-yjs-optimizing-storage/2748) — migration size patterns (HIGH)
- [Yjs Community — Without real clocks, how can the order of offline changes be known?](https://discuss.yjs.dev/t/without-real-clocks-how-can-the-order-of-offline-changes-be-known/2189) — logical-clock semantics (HIGH)
- [yjs/yjs#324 — Misleading reference to Lamport Timestamp](https://github.com/yjs/yjs/issues/324) — clock terminology clarification (MEDIUM)
- [Yjs Community — Garbage Collection and Version Snapshotting](https://discuss.yjs.dev/t/garbage-collection-and-version-snapshotting/1839) — GC vs snapshot trade-off (HIGH)
- [Palanikannan blog — Yjs Snapshots in Production](https://www.palanikannan.com/blogs/yjs-snapshots-part-5-production) — production GC-disabled growth observations (MEDIUM)

**Supabase + CRDT:**
- [Supabase Realtime Limits — Supabase Docs](https://supabase.com/docs/guides/realtime/limits) — 1MB payload limit (HIGH)
- [PowerSync blog — Postgres and Yjs CRDT](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync) — bytea storage pattern, batching (MEDIUM)
- [supabase/pg_crdt — experimental CRDT extension](https://supabase.com/blog/postgres-crdt) — Supabase's own CRDT exploration (MEDIUM)
- [Supabase Discussion #6344 — Realtime with Multiplayer](https://github.com/orgs/supabase/discussions/6344) — community guidance on combining Realtime + CRDT (MEDIUM)
- [AlexDunmow/y-supabase](https://github.com/AlexDunmow/y-supabase) — early-stage Supabase Yjs provider, "rough edges, API likely to change" (LOW — informational only)

**Hocuspocus:**
- [ueberdosis/hocuspocus](https://github.com/ueberdosis/hocuspocus) — official Hocuspocus repo (HIGH)
- [Velt blog — Yjs WebSocket Server Guide 2025](https://velt.dev/blog/yjs-websocket-server-real-time-collaboration) — production scaling challenges (MEDIUM)
- [Hocuspocus Docs](https://tiptap.dev/docs/hocuspocus/getting-started/overview) — official docs (HIGH)

**IndexedDB / Electron:**
- [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — quota model (HIGH)
- [electron/electron#16029 — Inconsistent reporting of offline storage quota](https://github.com/electron/electron/issues/16029) — Electron-specific quota issues (HIGH)
- [RxDB — IndexedDB Max Storage Size Limit](https://rxdb.info/articles/indexeddb-max-storage-limit.html) — practical guidance (MEDIUM)
- [pesterhazy gist — Pain and anguish of using IndexedDB](https://gist.github.com/pesterhazy/4de96193af89a6dd5ce682ce2adff49a) — known cross-tab IndexedDB issues (HIGH — community-curated)
- [pesterhazy gist — Offline-first browser apps and multiple tabs](https://gist.github.com/pesterhazy/a840a21000b67cc5b7e601fdc91b9e18) — Web Locks API election pattern (HIGH)

**License:**
- [GNU AGPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) — AGPL terms (HIGH)
- [FOSSA — Open Source Software Licenses 101: AGPL](https://fossa.com/blog/open-source-software-licenses-101-agpl-license/) — commercial implications (HIGH)

**Project-internal sources:**
- `.planning/PROJECT.md` — current architecture, v2.0/v2.1/v2.2/v2.3 context, Fabric.js 5.5.2 lock-in, SVG-display + Fabric-edit-only model
- `~/.claude/projects/-Users-isaiahcalvo-Desktop-Survey-BetaSafeS2/memory/architecture_annotation_system.md` — detailed annotation system architecture
- Simple-sync post-mortem (in milestone_context) — 7 documented failure modes that the new system MUST defend against by construction

---

*Pitfalls research for: v2.4 Multi-User Collaboration (CRDT Rebuild)*
*Researched: 2026-04-26*
*Confidence: HIGH for Yjs/Supabase/IndexedDB mechanics, MEDIUM for app-specific integration assumptions*
