# Phase 29: Fabric ↔ Yjs Binding + Per-User Undo — Research

**Researched:** 2026-04-28
**Domain:** Yjs CRDT bindings for an existing Fabric.js + SVG annotation editor (one-direction-at-a-time bridge, per-user `Y.UndoManager`, React `useSyncExternalStore` integration)
**Confidence:** HIGH for the locked architecture (carry-forward from `.planning/research/`); HIGH for `Y.UndoManager` semantics (verified in source); MEDIUM for the exact debounce-collapse heuristic (planner picks; benchmark-driven)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**What "one undo" means**
- One Cmd+Z = one whole logical user action (drawing a stroke, dragging A→B, color change), not one fired commit. Many `object:modified` events collapse into a single undo step. Pattern reference: Figma, Google Docs.
- Typing in a text annotation: one Cmd+Z reverts to the **last word boundary (whitespace)**, not per-keystroke.
- One eraser swipe that wipes 5 strokes restores **all 5 in one Cmd+Z**.
- Mid-drag Cmd+Z (mouse still down): **cancel the drag, snap back to drag-start, ignore the keystroke; no Y write occurs**.

**Undo history scope**
- View **jumps to the page where the change is** if Cmd+Z reaches a different page.
- History is **fresh per document open** (no cross-session persistence). Matches Figma / Google Docs / Notion.
- History capped at **100 actions per session per user** (oldest drops). Matches Figma defaults.
- Empty-undo-stack press is **silent** (no toast, no flash, no message).

**Undo surfaces**
- Cmd+Z / Ctrl+Z (Mac/Win) for undo, Cmd+Shift+Z / Ctrl+Shift+Z for redo. Existing keyboard handler at `App.jsx:~10934` rewires the body of `handleUndo` (`~16472`) and `handleRedo` (`~16547`) to call into the per-user undo manager.
- Existing **Home-tab Undo / Redo buttons** at `App.jsx:~28191 / ~28213` rewired to the same manager (no new chrome).
- Native **Electron Edit > Undo / Edit > Redo** menu items wired explicitly to the manager via IPC, NOT via synthesized keydown.
- **No right-click context menu entry** for Undo / Redo.

**Two-people-one-shape behavior**
- Drag tug-of-war: while local mouse is down, local drag wins on local screen; remote drag updates buffered until release; LWW with `meta.updatedAt` resolves on release. Pattern: Figma's local-drag priority.
- Per-property merge on the same shape (COLLAB-03): color (mine) and position (theirs) both land via per-property LWW. No conflict modal.
- Color/property change by collaborator: **instant snap**, no animated transition.
- Local selection follows a shape that a collaborator drags (selection ring rides along).

**Deletion-during-interaction toast**
- "Removed by [name] — Restore? Yes / No" toast surfaces ONLY when local user was actively interacting (selected / dragging / scaling / edit-canvas open / right-click menu open) at the moment of remote delete.
- Outside those states: silent delete, no toast.
- Toast is **sticky** (no auto-dismiss). Reuses Phase 27 `<StorageFailureBanner>` shape with new `code='annotation_remote_deleted'` copy variant + two equal-weight inline action links (Restore / Dismiss).
- **Yes** → annotation comes back with `meta.authorId` + `meta.createdAt` preserved (UNDO-03 semantics); restore propagates to all collaborators.
- **No / X** → toast dismisses, deletion stands.
- Mid-edit deletion: local edit canvas / drag / resize cancels immediately; X disappears; toast appears.
- Stack max 3 visible; 4th+ collapse into "and N more removed".

**Awareness signal (Phase 29 minimal lane)**
- Subtle per-user **colored outline** around any annotation a remote collaborator currently has open in their edit canvas. Color is **server-assigned, stable per session**; same color reused by Phase 33's cursor pill / presence list.
- Phase 29 ships ONLY this outline. No cursor pill, no presence list, no name labels (those are Phase 33).
- Outline is informational, not a permission gate (local user can still click in).

**Per-user undo across collaborator activity**
- Layered strokes: A draws S, B draws T on top; A undoes → only S removed; T unaffected (UNDO-02).
- Collaborator deleted my shape: if not interacting → silent + Cmd+Z does nothing for the deleted target; if interacting → toast surfaced (use the toast, not Cmd+Z).
- Resurrect race: if A deleted X and B's edit on X landed during the propagation window, Cmd+Z resurrects X with **most recent property values** (B's edit included); `meta.authorId` + `meta.createdAt` stay original (UNDO-03).
- Offline → online undo: A drew offline, B drew online during the gap; A reconnects; A's Cmd+Z still removes only A's stroke. Undo manager doesn't care about timing — it cares about action ownership.

**Bridge mechanics (architectural, locked)**
- **One direction at a time.** Y → Fabric only on edit-canvas mount (initial state hydration). Fabric → Y only on commit (`object:modified` + create + delete). The `applyingRemote` guard flag prevents Y → Fabric → Y echo.
- **Origin tags on every transaction:** `{ source: 'local-fabric', userId, deviceId, sessionId, clientID, serverTs }` — extends the Phase 28 origin payload with `source: 'local-fabric'` so the undo manager's `trackedOrigins` filter is unambiguous.
- **Per-mount registry:** `Map<annoId, FabricObject>` populated when the edit canvas mounts, cleared when it unmounts. Bridge looks up by stable `annoId`, never by Fabric internal handle.
- **No echo loop:** roadmap success criterion 1 — drawing 1000 strokes keeps CPU under 30%, IndexedDB grows linearly. Verified by automated test.

### Claude's Discretion

- Exact debounce/throttle window for buffering remote drag updates while local mouse-down drag holds (ballpark a few hundred ms; planner picks based on benchmark feel).
- Visual treatment of the awareness outline beyond the locked 2px solid / 4px offset / opacity 0.7 in `29-UI-SPEC.md` — minor adjustments allowed.
- Exact algorithm for collapsing many `object:modified` events into one logical undo step (likely "session-of-modifications" bounded by selection change or mousedown/mouseup; `captureTimeout` as backstop).
- Whether the per-mount registry lives inside `useAnnotationsCRDT` or in a sibling hook.
- Whether the eraser-swipe-as-one-undo behavior reuses the existing eraser session model or introduces a new bracketing primitive.
- Web (non-Electron) Edit-menu fallback: browsers have no app menu, so web users get keyboard + Home-tab buttons only.
- Exact Electron menu role/accelerator declarations needed to make Edit > Undo route to the per-user undo manager.

### Deferred Ideas (OUT OF SCOPE)

- Customizable hotkeys / keybindings settings panel — post-v2.4 unless promoted.
- Cursor pill, presence list, "X is editing" name label, click-to-jump activity, avatar chips — Phase 33.
- Activity log writes (server-side authoritative log of every CRDT update) — Phase 33.
- Migration dual-write era + cutover seal — Phases 30 & 31.
- Right-click Undo / Redo entries — explicitly rejected.
- Animated transitions for remote color / position updates — explicitly rejected.
- Lock-the-shape (busy / first-claim-wins) drag model — explicitly rejected.
- Periodic Y.Doc compaction, BroadcastChannel cross-tab sync, two-tab Playwright stress — Phase 32.
- Sharing UX + 4-role permission UI + decommission of legacy `useAnnotationCloudSync` — Phase 34.
- Highlights — stay on legacy through v2.4. Phase 29 binds non-highlight annotations only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COLLAB-02 | Concurrent edits to two different annotations on same page never collide | `Y.Map<id, Y.Map>` flat schema (already locked in Phase 27) — per-annotation Y.Maps mean two different annos = two different keys = no contention. Property-level merge inside each annotation Y.Map. See § Per-Property LWW + Y.Map Merge Semantics. |
| COLLAB-03 | Concurrent edits to same annotation merge per-property LWW (timestamp tiebreak in `meta.updatedAt`) | Y.Map's CRDT semantics: `set(key, value)` is per-key LWW by Yjs's logical clock. Phase 29 layers `meta.updatedAt` (wall-clock) ON TOP for human-readable display tiebreak — does not affect convergence. See § Per-Property LWW + Y.Map Merge Semantics. |
| UNDO-01 | Cmd+Z undoes own most recent action | `Y.UndoManager` constructor: `new Y.UndoManager([yMapAnnotations, yMapCallouts], { trackedOrigins: new Set([userId]) })`. Origin matching is `Set.has(origin)` — see § Per-User Undo Scoping. |
| UNDO-02 | Undo never erases collaborator work | Same `trackedOrigins` mechanism — remote transactions carry the remote user's origin (which is NOT in our local Set), so they never enter our undo stack. Pitfall 7 mitigation. |
| UNDO-03 | Undo restores original creation user + timestamp (tombstone resurrection) | Y.UndoManager handles tombstone resurrection automatically: undo of `Y.Map.delete(id)` re-installs the entire Y.Map value, all nested Y.Map keys included (`meta.authorId`, `meta.deviceId`, `meta.createdAt`). See § Tombstone Resurrection Mechanics. |
| UNDO-04 | Cmd+Shift+Z redoes own undone action | `undoManager.redo()` — same trackedOrigins gating. Redo never touches remote ops because remote ops never entered the undo stack to begin with. |
</phase_requirements>

---

## Summary

Phase 29 binds the existing Fabric.js edit canvas + SVG display layer to the Phase 27 Y.Doc through a **one-direction-at-a-time bridge** (Y → Fabric only at edit-mount; Fabric → Y only at commit) and a **per-user `Y.UndoManager`** scoped to a stable user identity via `trackedOrigins`. The phase ships three new pure modules (`crdtAnnotationBridge.js`, `crdtUndoManager.js`, `useAnnotationsCRDT.js`), one tiny new awareness component (`CollaboratorOutlineOverlay.jsx`), one copy variant on the existing `<StorageFailureBanner>`, and surgical waivers for `App.jsx` (rewire `handleUndo` / `handleRedo` bodies + Electron menu wiring) and `FabricEditCanvas.jsx` (rewire `object:modified` to call the bridge instead of `setAnnotationsByPage`). All other Always-Protected files stay byte-identical.

The four critical pitfalls converging in this phase are independently solved by canonical Yjs primitives that already exist — there is no novel research left to do, only careful application of established patterns. Echo loops are killed by **origin-tagged transactions + a microtask-scoped `applyingRemote` flag + observers that short-circuit on `transaction.origin?.source === 'local-fabric'`**. Identity contracts are honored by **a per-edit-mount `Map<annoId, FabricObject>` registry** that the bridge consults instead of doing O(n) Fabric scans. Per-user undo is scoped by **`trackedOrigins: new Set([userId])`** where the origin's `userId` field IS the local user's identity (not the per-session `clientID`). Tombstone resurrection is **a built-in Y.UndoManager behavior** — undoing a `Y.Map.delete` re-installs the value with all nested fields intact (verified by Yjs source + multiple production users).

The hardest unsolved problem in this phase is **collapsing many `object:modified` events into one logical undo step** so a drag from A→B is one Cmd+Z, not 60. Yjs's `captureTimeout` (default 500ms) is the natural backstop, but the cleaner pattern is **explicit `stopCapturing()` calls at logical boundaries** (mousedown opens a capture window, mouseup + a `stopCapturing()` call closes it). The planner picks the exact bracketing strategy based on Fabric event ordering — research below recommends a path.

**Primary recommendation:** Use **stable `userId` (a string) as the origin's identity field for `trackedOrigins`**, not `clientID` (which is per-Y.Doc-instance and changes when the Y.Doc is destroyed/recreated). Build the bridge as **pure functions** with no React/Fabric instance imports so unit tests can run in Node without DOM. Wire the `applyingRemote` guard via a **module-scoped flag reset in a microtask** (Promise.resolve().then), NOT setTimeout — setTimeout is the simple-sync verify-wait bug wearing CRDT clothing. Use **per-annotation Y.Map observers**, NOT root-level `observeDeep`, for the read path's React subscription so anno A changing does not re-render the entire annotation set.

---

## Standard Stack

### Core (already installed in Phase 27 — Phase 29 ships ZERO new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yjs` | `^13.6.30` (verified `npm view yjs version` 2026-04-28) | CRDT engine + `Y.UndoManager` (built-in, no extra package) | Industry standard for collaborative apps. `Y.UndoManager` is part of core. MIT. ~10kB gzipped. Reference equality on `trackedOrigins` Set verified in source (`src/utils/UndoManager.js` afterTransactionHandler). |
| `y-protocols` | `^1.0.7` | Awareness protocol (used in Phase 33; Phase 29 only consumes the awareness surface Phase 28 mounted) | Phase 27 already installed for forward compat. |
| `y-indexeddb` | `^9.0.12` | Local persistence (Phase 27 mounted; Phase 29 doesn't touch) | Already wired in `ydocLifecycle.js`. |

### Supporting (REUSE — already in dependency tree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` | `^18.2.0` | `useSyncExternalStore` is part of React 18 core | The canonical React-Yjs bridge — no `react-yjs` package needed; the hook is a 30-LOC pattern Phase 29 hand-rolls. |
| `fabric` | `5.5.2` (LOCKED — do NOT upgrade to 6.x per CLAUDE.md) | Edit-canvas runtime | Bridge calls `obj.set(...)` and reads `obj.toJSON(CUSTOM_PROPS)` to/from the bridge — same surfaces FabricEditCanvas already uses. |

### Anti-installs (do NOT add)

- `y-react`, `react-yjs` — not needed. The `useSyncExternalStore + observeDeep` pattern is ~30 LOC and the existing `react-yjs` package on npm is unmaintained (last update >18 months). Hand-rolled is more maintainable than another supply-chain dependency.
- `@hocuspocus/provider` — Phase 28 chose Supabase Realtime; Hocuspocus uninstalled at Plan 28-04 close.
- Any new awareness library — Phase 28's transport already exposes the awareness surface; Phase 29 consumes one field (`editingAnnotationId`).

**Installation:** none. Phase 29 ships zero `npm install` commands.

**Version verification:** `npm view yjs version` returns `13.6.30` as of 2026-04-28; `package.json` carries `^13.6.30`. ✅ aligned.

---

## Architecture Patterns

### Recommended File Structure (NEW files this phase ships)

```
src/
├── lib/collab/
│   ├── crdtAnnotationBridge.js   # NEW — pure module, no React/Fabric imports
│   ├── crdtUndoManager.js        # NEW — Y.UndoManager wrapper
│   └── (existing Phase 27/28 modules — unchanged)
├── hooks/
│   ├── useAnnotationsCRDT.js     # NEW — useSyncExternalStore over Y.Doc
│   └── (existing hooks — unchanged)
└── components/collab/
    ├── CollaboratorOutlineOverlay.jsx  # NEW — sibling SVG overlay
    └── (existing Phase 27/28 components — extended only via copy variant)
```

### Pattern 1: Origin-tagged transactions (Pitfall 4 + 7 + 8 mitigation)

Every Fabric → Y write goes through a single helper that produces an origin matching the Phase 28 schema. Adding `source: 'local-fabric'` distinguishes Phase 29 writes from Phase 28's `'local'` (auth bridge writes) and the BroadcastChannel `'remote-bc'` / Realtime `'remote-realtime'` sentinels.

```js
// Source: extends src/lib/collab/originBuilder.js (Phase 28, lines 39-66)
import { buildOrigin } from '@/lib/collab/originBuilder';

function buildLocalFabricOrigin({ userId, deviceId, sessionId, clientID }) {
  // Pattern: extend the Phase 28 base shape with source: 'local-fabric'.
  // The base buildOrigin() already returns a frozen object with source: 'local'.
  // We wrap it with a discriminated source so the undo manager + observer guards
  // can both check `origin?.source === 'local-fabric'` unambiguously.
  return Object.freeze({
    ...buildOrigin({ userId, deviceId, sessionId, clientID }),
    source: 'local-fabric',
  });
}

// All bridge writes:
ydoc.transact(() => {
  yMapAnnotations.get(annoId).get('fabric').set('left', newLeft);
  yMapAnnotations.get(annoId).get('fabric').set('top', newTop);
  yMapAnnotations.get(annoId).get('meta').set('updatedAt', Date.now());
  yMapAnnotations.get(annoId).get('meta').set('lastEditorId', userId);
}, /* origin */ buildLocalFabricOrigin({ userId, deviceId, sessionId, clientID }));
```

### Pattern 2: `applyingRemote` guard (Pitfall 4 mitigation, defensive layer)

The origin guard above is the primary defense. The `applyingRemote` flag is the **secondary belt** — it short-circuits Fabric `object:modified` while the bridge is mid-application of a remote update, in case Fabric.js 5.5.2 fires `object:modified` during a programmatic `obj.set()` call (it does, in some shape configurations).

```js
// crdtAnnotationBridge.js
let applyingRemote = false;

export function isApplyingRemote() { return applyingRemote; }

export function applyYUpdateToFabric(yMap, annoId, registry) {
  const obj = registry.get(annoId);
  if (!obj) return;  // not currently mounted — SVG layer will read on next render
  applyingRemote = true;
  try {
    const fabricSnapshot = yMap.get(annoId)?.get('fabric')?.toJSON();
    if (!fabricSnapshot) return;
    obj.set(fabricSnapshot);
    obj.setCoords();
  } finally {
    // CRITICAL: microtask, not setTimeout. setTimeout is the simple-sync verify-wait bug.
    Promise.resolve().then(() => { applyingRemote = false; });
  }
}

// In FabricEditCanvas.jsx (waiver site):
canvas.on('object:modified', (e) => {
  if (isApplyingRemote()) return;  // belt — origin guard is the suspenders
  applyFabricCommit(yDoc, yMapAnnotations, e.target, originPayload);
});
```

### Pattern 3: Per-mount registry `Map<annoId, FabricObject>` (Pitfall 6 mitigation)

```js
// useAnnotationsCRDT.js (or sibling hook — Claude's discretion)
const registryRef = useRef(new Map());

useEffect(() => {
  // On edit-canvas mount: walk Fabric scene, populate registry.
  if (!editCanvas) return;
  const reg = registryRef.current;
  for (const obj of editCanvas.getObjects()) {
    const annoId = obj.data?.id ?? obj.data?.annoId;
    if (annoId) reg.set(annoId, obj);
  }
  return () => reg.clear();  // unmount: clear
}, [editCanvas]);

// Bridge consumes the registry, never does canvas.getObjects().find(...).
// O(1) lookup instead of O(n) scan.
```

### Pattern 4: `useSyncExternalStore + observeDeep` for tear-free React reads

```js
// useAnnotationsCRDT.js
import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useYDoc } from '@/hooks/useYDoc';

export function useAnnotationsCRDT() {
  const ydoc = useYDoc();
  const snapshotRef = useRef(null);

  const subscribe = useCallback((callback) => {
    if (!ydoc) return () => {};
    const yMap = ydoc.getMap('annotations');
    const handler = (events) => {
      // Recompute snapshot ONLY when annotations actually changed.
      // observeDeep fires for any nested change (per-property edit on any anno).
      snapshotRef.current = null;  // invalidate
      callback();
    };
    yMap.observeDeep(handler);
    return () => yMap.unobserveDeep(handler);
  }, [ydoc]);

  const getSnapshot = useCallback(() => {
    if (!ydoc) return EMPTY_SNAPSHOT;
    if (snapshotRef.current) return snapshotRef.current;
    // Materialize via toJSON. Group by pageNumber to match the existing
    // annotationsByPage shape SVGAnnotationLayer consumes.
    const yMap = ydoc.getMap('annotations');
    const byPage = {};
    for (const [id, annoYMap] of yMap.entries()) {
      const json = annoYMap.toJSON();
      const page = json.pageNumber;
      if (!byPage[page]) byPage[page] = { objects: [] };
      byPage[page].objects.push({ ...json.fabric, data: { id, ...json.fabric.data } });
    }
    snapshotRef.current = byPage;
    return byPage;
  }, [ydoc]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

**Why `useSyncExternalStore`:** React 18 concurrent rendering can call `getSnapshot` multiple times during a single render. Without `useSyncExternalStore`'s tear-prevention, two reads in the same render could see different values (one before, one after a Y.Doc transaction). The hook guarantees consistency.

**Why memoize via `snapshotRef`:** without memoization, every render runs the full O(n) `toJSON` materialization. With the ref, materialization runs only when `subscribe`'s callback fired (i.e., when Y.Doc actually changed). At 1000 annotations, this is the difference between sub-ms reads and 5–10ms reads.

**Why `observeDeep` and not per-annotation `observe`:** the SVG layer reads ALL annotations on the current page. Per-annotation observers would mean N subscriptions for N annotations — fine for 50, painful for 500. `observeDeep` on the root annotations Y.Map is one subscription that fires once per transaction batch, with all events delivered together. Performance trap (Pitfall: `observeDeep` re-rendering everything) is mitigated by the **memoized snapshot** + the fact that React only re-renders changed components.

### Pattern 5: `Y.UndoManager` with stable-userId `trackedOrigins`

```js
// crdtUndoManager.js
import * as Y from 'yjs';

export function createUndoManager({ ydoc, userId, captureTimeout = 500 }) {
  // CRITICAL: trackedOrigins matches via Set.has(origin) — reference equality.
  // We use a primitive STRING (userId) so reference equality works across
  // origin-builder calls (string interning makes `'user_abc' === 'user_abc'`
  // always true regardless of when the strings were constructed).
  // userId is stable across sessions; clientID is NOT (changes on each Y.Doc reconstruct).
  // Pitfall 7 mitigation.
  const undoManager = new Y.UndoManager(
    [ydoc.getMap('annotations'), ydoc.getMap('callouts')],
    {
      trackedOrigins: new Set([userId]),
      captureTimeout,
      // deleteFilter: optional — restrict which deletes get tombstone-resurrected.
      // Default behavior (no filter) restores everything, which is what UNDO-03 requires.
    }
  );
  return undoManager;
}

// CRITICAL: every ydoc.transact() that should be undoable MUST pass userId AS the origin
// (or as the userId field of an origin object — see below for which way).
```

**The reference-equality gotcha:** The Yjs source-code check is:

```js
this.trackedOrigins.has(transaction.origin) ||
(transaction.origin && this.trackedOrigins.has(transaction.origin.constructor))
```

(verified in `yjs/src/utils/UndoManager.js`, function `afterTransactionHandler`)

This means if you pass `origin = buildOrigin({ userId: 'abc', ... })` (a frozen object), `trackedOrigins.has(origin)` returns `false` because the Set was constructed with the **string** `userId='abc'`, not the object. **Two paths forward:**

- **Path A (RECOMMENDED):** make the origin itself the `userId` string. Pros: simplest reference-equality story; string interning guarantees `'abc' === 'abc'`. Cons: loses the rich payload (`deviceId`, `sessionId`, `clientID`) that the Phase 28 origin builder produces — but Phase 29 doesn't need those for undo scoping; AUTH-01 already lives in the **Y.Map values** (`meta.authorId` etc.), not in the transaction origin. The transport layer already has its own attribution path via `doc_yjs_updates.origin` column written by the postgres-trigger validator.
- **Path B:** keep the rich-object origin AND add the `userId` constructor-class to `trackedOrigins`. Cons: requires using a class/constructor, not a frozen literal. Adds a layer of indirection. Not recommended unless we want UndoManager to track multiple origin-like classes uniformly.

**Phase 29 plan recommendation:** **Path A.** Origin for `crdtAnnotationBridge.applyFabricCommit` becomes a richer object (`{ source: 'local-fabric', userId, deviceId, sessionId, clientID, serverTs }`) for the **observer guards** (echo-loop short-circuit reads `origin?.source === 'local-fabric'`), but the **UndoManager** is constructed with `trackedOrigins: new Set([userId])` and the transact call passes `userId` as a SECOND, parallel "undo-scope-origin" via... wait, that doesn't work either — `transact()` only takes one origin.

**Resolution (post-research):** the cleanest pattern is to make the origin object equality-detectable AND have `userId` as a property:

```js
// One origin object per (user, source) tuple, frozen and reused.
// The bridge memoizes the origin per-user so reference equality holds across all transacts.
const memoizedOriginByUser = new Map();
function getLocalFabricOrigin(userId, deviceId, sessionId, clientID) {
  let origin = memoizedOriginByUser.get(userId);
  if (!origin) {
    origin = Object.freeze({ source: 'local-fabric', userId, deviceId, sessionId, clientID });
    memoizedOriginByUser.set(userId, origin);
  }
  return origin;
}

// UndoManager construction:
const undoManager = new Y.UndoManager(
  [ydoc.getMap('annotations'), ydoc.getMap('callouts')],
  { trackedOrigins: new Set([getLocalFabricOrigin(userId, deviceId, sessionId, clientID)]) }
);

// Now every transact uses the SAME memoized origin object:
ydoc.transact(() => { ... }, getLocalFabricOrigin(userId, deviceId, sessionId, clientID));
// And trackedOrigins.has(origin) === true (reference equality holds).
```

This is the canonical pattern used by Tiptap, Liveblocks, and the Yjs community-thread examples — memoize one origin per (user, source) and reuse the reference everywhere. **The undo manager construction MUST receive the same origin reference that subsequent `transact()` calls pass.** The planner must enforce this with a single helper that owns the memoization.

### Pattern 6: Wrap `undoManager.undo()` / `.redo()` with a fresh origin

Per Pitfall 8: the undo transaction itself has an origin. If unset, the activity log can't attribute the undo. Yjs documents this — wrap calls:

```js
function userUndo(undoManager, ydoc, originPayload) {
  ydoc.transact(() => undoManager.undo(), {
    ...originPayload,
    source: 'local-undo',
    ts: Date.now(),
  });
}
function userRedo(undoManager, ydoc, originPayload) {
  ydoc.transact(() => undoManager.redo(), {
    ...originPayload,
    source: 'local-redo',
    ts: Date.now(),
  });
}
```

**BUT:** `'local-undo'` is NOT in `trackedOrigins` — so the undo transaction itself does not get pushed onto the undo stack as a new operation, which is what you want (undoing an undo is `redo()`, not "undo the undo as a new tracked op").

### Anti-Patterns to Avoid

- **`observeDeep` on `ydoc` itself** (root) — fires for ANY change in the entire document. Use `observeDeep` on the specific Y.Map (`annotations`) to bound the blast radius.
- **Calling `Y.applyUpdate(ydoc, snapshot)` to "refresh" state** — the simple-sync verify-wait bug rewearing CRDT clothes. Y.Doc updates merge; never replace.
- **Bidirectional Fabric ↔ Y observer during a drag** — Fabric mutable + Y observer in same loop = echo. One direction at a time, ALWAYS.
- **Per-page Y.Array of annotations** — already locked AGAINST in Phase 27; reinforced here. Flat `Y.Map<id, Y.Map>`.
- **Default `Y.UndoManager` constructor** — tracks all origins, including remote. `trackedOrigins: new Set([...])` is mandatory.
- **`undoManager.undo()` without an origin wrap** — activity log loses attribution (Pitfall 8).
- **Re-creating the origin object for each transact call** — breaks reference equality with `trackedOrigins`. Memoize.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-user undo isolation | Custom action history with userId tagging + manual undo loop | `Y.UndoManager` with `trackedOrigins: new Set([userId])` | Yjs ships ~600 LOC of CRDT-correct undo internals (handles tombstone resurrection, item-by-item history, capture timeouts, redo stack). Replicating means reimplementing CRDT inverse-op semantics — a 6-month task. |
| Tombstone resurrection (UNDO-03) | Custom "restore deleted annotation" with `meta` re-population | `Y.UndoManager.undo()` of a `Y.Map.delete` | Yjs handles this automatically. The Y.Map value is restored intact, including all nested Y.Map keys. Verified by Yjs test suite + production users (Tiptap, Liveblocks). |
| React subscription to Y.Doc | Manual `useState` + `useEffect` + manual `observe` | `useSyncExternalStore + observeDeep` | React 18 concurrent rendering can re-run `getSnapshot` mid-render — without `useSyncExternalStore`, you get tearing (one render observes pre-update state, another observes post). Pattern is canonical (react-yjs library, Tiptap, multiple production apps). |
| Echo-loop prevention | Custom flag + try/finally with setTimeout reset | Origin tag + microtask reset | Origin tags ARE the documented Yjs pattern. setTimeout is the simple-sync verify-wait bug. Microtask reset (Promise.resolve().then) is correct. |
| Per-property LWW for COLLAB-03 | Custom timestamp comparison + manual conflict resolution | `Y.Map.set(key, value)` for each changed property | Y.Map is per-key LWW by Yjs's internal logical clock. The `meta.updatedAt` timestamp is for HUMAN-readable display, NOT for convergence. Yjs's clock decides convergence. |
| Origin-class identification | Custom binding class + instanceof checks | Frozen literal object memoized per-user | Cleaner. The Yjs `trackedOrigins` Set check IS reference equality, no classes needed. |
| Annotation identity across SVG / Fabric / Y.Map | Custom Fabric-object-by-attribute lookup with O(n) scan | `Map<annoId, FabricObject>` registry populated on edit-canvas mount | O(1) lookup vs O(n) scan. Cleared on unmount, eliminating the "Fabric object doesn't exist" branch entirely. (Pitfall 6 canonical mitigation.) |

**Key insight:** Phase 29 has very little new architecture work. The pitfalls converge here because four canonical Yjs primitives must all work correctly TOGETHER — not because the primitives are missing. The plan should focus on rigorous **wiring** (origin shape, registry lifecycle, observer subscription/unsubscription) and **verification** (1000-stroke echo-loop test, two-user isolation test, tombstone resurrection test), not on inventing new abstractions.

---

## Common Pitfalls

### Pitfall 4: Echo loop (Pitfall converging in Phase 29 — CRITICAL)

**What goes wrong:** Local Fabric `object:modified` → bridge writes `Y.Map.set(...)` → Y observer fires → bridge applies state to Fabric via `obj.set(...)` → Fabric `object:modified` fires AGAIN → infinite loop. CPU pegs at 100%, IndexedDB explodes, app freezes.

**Why it happens:** The standard Yjs binding pattern requires **distinguishing local-applied updates from remote-observed updates**. The transaction origin IS that distinction. Forget the origin tag, or forget the observer guard, and you're in the loop.

**How to avoid (defense in depth):**
1. **Mandatory origin tag** — every `ydoc.transact(fn, origin)` carries the memoized `local-fabric` origin object. Lint rule: grep for any `ydoc.transact(` without a second argument. Plan should ship a Wave 0 lint test.
2. **Observer short-circuit** — every Y.Map observer's first line: `if (event.transaction.origin?.source === 'local-fabric') return;`. Phase 28's `SupabaseYjsProvider` already follows this convention; Phase 29 extends it to bridge-internal observers.
3. **`applyingRemote` belt** — second-line defense. Module-scoped boolean reset in a microtask. Catches any case where Fabric.js 5.5.2 fires `object:modified` during a programmatic `obj.set()` (it does, occasionally, on shapes with `strokeUniform: true` or when transformations are dirty).
4. **Per-annotation observer scope** (NOT root `observeDeep`) — observe the specific Y.Map being edited, detach when edit ends. Eliminates the "Fabric object doesn't exist" branch for non-edit annotations entirely.
5. **Smoke test: 1000 strokes draw loop.** CPU < 30%, IndexedDB grows linearly. Roadmap success criterion 1.

**Warning signs:** DevTools Performance tab shows infinite stack of `Y.Map.observe → Fabric.set → object:modified → Y.Map.set → Y.Map.observe`. Same annotation has 100+ updates in Y.Doc history but user only edited it once. IndexedDB grows during idle time.

### Pitfall 6: SVG/Fabric/Y.Doc identity contract (CRITICAL)

**What goes wrong:** Yjs identifies annotations by stable Y.Map key (`annoId`, uuid). Fabric identifies objects by in-memory reference. SVG identifies by `<g id="anno-{annoId}">` attribute. If any layer drifts, edits land on the wrong object, or land in /dev/null.

**How to avoid:**
- **Y.Doc is source of truth.** SVG renders FROM Y.Doc (via `useAnnotationsCRDT`). Fabric edit canvas is a temporary mutable mirror that writes BACK TO Y.Doc.
- **Stable annotation IDs.** Key is uuid. Fabric `obj.data.annoId` set on construction, never mutated. SVG `<g id="anno-{annoId}">` mirrors. All three layers use the same key.
- **Per-mount registry** (Pattern 3 above). On edit-canvas mount: walk Fabric scene, populate `Map<annoId, FabricObject>`. On unmount: clear. Bridge consults the registry — never `canvas.getObjects().find(...)`.
- **Reconciliation on mount.** When entering edit mode for anno X, read FRESH state from Y.Doc and rebuild the Fabric object from scratch. Don't trust any cached Fabric object — Y.Doc may have moved on.
- **Per-annotation Yjs observer scoped to edit session.** Observes only the anno being edited. When edit ends, detaches.

**Warning signs:** Two users edit the same shape simultaneously, one user's view "snaps back" when they leave edit mode. Annotation rendered correctly in SVG but appears wrong-positioned when double-clicked to edit. Memory grows over a session as edit sessions leak Fabric references.

### Pitfall 7: Per-user undo erasing collaborator work (CRITICAL)

**What goes wrong:** User A erases stroke. User B undoes. B's undo reverts A's erase (because UndoManager tracks all origins by default). Trust destroyed.

**How to avoid:**
- **One UndoManager per (user, document), constructed with `trackedOrigins: new Set([userIdOrigin])`.** Origin is a stable identifier — `userId` is fine. Same-user multi-tab uses the same origin (same userId).
- **Memoize the origin object** so reference equality holds with `trackedOrigins.has(origin)`. (Pattern 5 above.)
- **UndoManager observes the SAME Y.Map the bridge writes to.** Construct: `new Y.UndoManager([ydoc.getMap('annotations'), ydoc.getMap('callouts')], {...})`. If you observe the wrong Y.Map, undo no-ops.
- **Canonical test: A draws, B draws, A undoes — only A's stroke reverts.** Playwright two-user scenario. Required for phase verification.

**Warning signs:** "Why did my undo bring back somebody else's deleted stroke?" — origin scoping wrong. "Why did my undo do nothing?" — UndoManager observing wrong scope, or origin object reference drift.

### Pitfall 8: `applyingRemote` guard pattern (HIGH — adjacent to Pitfall 4)

**What goes wrong:** Even with origin tags, Fabric.js 5.5.2 occasionally fires `object:modified` during a programmatic `obj.set()` (e.g., when `strokeUniform: true` triggers internal recalculation). The bridge thinks it's a local edit and writes to Y.Map. Echo without origin protection.

**How to avoid:**
- **Module-scoped `applyingRemote` boolean.** Set true before the bridge applies a remote update; reset to false in a microtask after.
- **`object:modified` handler short-circuit:** `if (isApplyingRemote()) return;` as the FIRST line.
- **Microtask reset (`Promise.resolve().then`), NOT setTimeout.** setTimeout-based resets are the simple-sync verify-wait bug pattern — they introduce a window where local edits are silently dropped if they fire during the timeout.
- **try/finally to ensure reset even on exception** — bridge crash should not leave the flag stuck true.

**Warning signs:** First Fabric edit after a remote update doesn't propagate to Y.Map (the flag was stuck true). Or: echo loop returns intermittently when shapes have transform-dirty state.

### Pitfall (additional context-sensitive): clientID is per-session, NOT per-user

**What goes wrong:** Developer wires `trackedOrigins: new Set([ydoc.clientID])`. This works in dev (single tab, single user). On reload, `ydoc.clientID` changes (verified: Yjs docs explicitly state "It should not be reused across sessions"). After reload, the user's previous-session edits appear in the doc but their NEW UndoManager doesn't track them — because the new clientID is different.

**Worse:** in multi-tab, each tab has its OWN clientID. Tab A's UndoManager doesn't track Tab B's edits, even though they're the same user. Cmd+Z in Tab A does nothing for an edit just made in Tab B.

**How to avoid:**
- **Use stable `userId` (Supabase auth.uid()) as the origin identity, NOT clientID.** Same-user multi-tab uses the same userId, so undo works across tabs (within the bounds of CONTEXT.md's "fresh per document open" decision — undo is reset on every Y.Doc reconstruct, but within one open session both tabs share the same UndoManager origin scope).
- **clientID is still needed in the origin payload** for the postgres-trigger validator's audit trail (Phase 28's `doc_yjs_updates.origin` column) — but it's NOT the undo-scoping field.

**Warning signs:** Reload → Cmd+Z does nothing for stuff just edited. Open second tab → first tab's undo no longer covers second tab's edits.

### Pitfall (CONTEXT.md-driven): mid-drag Cmd+Z must cancel WITHOUT writing to Y

**What goes wrong:** User mouse-down drags a shape from A toward B. At pixel X, presses Cmd+Z. If the Cmd+Z calls `undoManager.undo()` while the drag is still in progress, the bridge has not yet committed (Fabric → Y commit fires on `object:modified` at mouseup). UndoManager has nothing to undo for this drag. But the Cmd+Z still pops the previous action off the stack, undoing something the user didn't intend to undo.

**How to avoid:**
- **Detect mid-drag state.** Fabric tracks `canvas.__activeObject?.__corner` and `canvas.__panning` (or similar internal flags); cleaner is to track our own `isDragging` flag set on `mouse:down` and cleared on `mouse:up`.
- **If `isDragging`**: cancel the drag (snap back to drag-start), swallow the Cmd+Z, do NOT call `undoManager.undo()`.
- **Drag-start position preservation:** snapshot the Fabric object's `{left, top}` on `mouse:down`. On Cmd+Z mid-drag, set them back; reset coords.

**Warning signs:** "I tried to cancel my drag with Cmd+Z and it undid my LAST action instead of cancelling."

### Pitfall (UI-SPEC-driven): per-word undo in text annotations

**What goes wrong:** User typing in a Fabric Textbox. Default Y.UndoManager `captureTimeout=500ms` collapses many keystrokes into one undo step. But CONTEXT.md decides ONE Cmd+Z = back to the last whitespace boundary, NOT the whole text and NOT one keystroke.

**How to avoid:**
- **Hook the Fabric Textbox `text:changed` event.** On every text change, check the most recent character: if whitespace (space, tab, newline), call `undoManager.stopCapturing()`. This forces the next text edit to start a NEW capture window, which becomes the undo boundary.
- **Edge case:** user types "the quick brown" — three captures (one per space). Cmd+Z removes "brown", leaves "the quick ". Matches Word/Google Docs/Notion.
- **`captureTimeout` interaction:** set captureTimeout to a high value (~5s) so the only collapse boundary is `stopCapturing()` calls, not time-based. Otherwise a slow typist breaks word boundaries by pausing.

### Pitfall (UI-SPEC-driven): eraser-swipe-as-one-undo

**What goes wrong:** One eraser swipe wipes 5 strokes. Each stroke deletion is a separate `Y.Map.delete(annoId)` call. Default UndoManager: 5 separate undo steps — Cmd+Z restores 1 stroke, Cmd+Z again restores another, etc.

**How to avoid:**
- **Wrap the entire eraser swipe in ONE `ydoc.transact()`.** All 5 deletes happen in one transaction. UndoManager treats it as one logical operation. Cmd+Z restores all 5.
- **Eraser session boundary:** eraser tool's `mouse:down` opens the transact; `mouse:up` closes it. All deletions within the swipe land in one transaction.
- **NOTE:** the existing FabricEraserCanvas (Phase 10) already has a "session" concept. Plan should investigate whether to extend it to wrap the Y.Doc transact, or wire a new boundary at the bridge.

---

## Code Examples

### Example 1: Bridge `applyFabricCommit` (the hot path)

```js
// src/lib/collab/crdtAnnotationBridge.js — pure module
// Source: extends ARCHITECTURE.md §4 + originBuilder.js conventions
import * as Y from 'yjs';

let applyingRemote = false;
export const isApplyingRemote = () => applyingRemote;

/**
 * Apply a Fabric commit (object:modified or create or delete) to the Y.Doc.
 *
 * Echo-loop defense:
 *   1. Origin tag with source: 'local-fabric' — Y observers short-circuit.
 *   2. applyingRemote guard (caller responsibility) — Fabric handler short-circuits if mid-apply.
 *
 * Pitfall 4 + 6 + 7 + 8 mitigations:
 *   - Origin includes userId so trackedOrigins.has(userIdOrigin) holds reference equality.
 *   - Per-property set() for property-level merge (COLLAB-03 LWW).
 *   - meta.updatedAt + meta.lastEditorId for human-display tiebreak.
 *   - meta.authorId + meta.deviceId + meta.createdAt set on CREATE only — never overwritten on edit (UNDO-03).
 *
 * @param {Y.Doc} ydoc
 * @param {Y.Map} yMapAnnotations  // ydoc.getMap('annotations')
 * @param {object} fabricObject     // Fabric instance
 * @param {object} originPayload    // memoized frozen origin object (Pattern 5)
 * @param {object} ctx              // { userId, deviceId, sessionId, clientID }
 */
export function applyFabricCommit(ydoc, yMapAnnotations, fabricObject, originPayload, ctx) {
  const annoId = fabricObject.data?.id ?? fabricObject.data?.annoId;
  if (!annoId) {
    console.warn('[crdtAnnotationBridge] Fabric commit without annoId — dropped');
    return;
  }

  const fabricJson = fabricObject.toJSON([
    'data', 'strokeUniform', /* ...other CUSTOM_PROPS the existing FabricEditCanvas uses */
  ]);

  ydoc.transact(() => {
    let annoYMap = yMapAnnotations.get(annoId);
    if (!annoYMap) {
      // CREATE path — never invoked from object:modified, only from new-annotation flows.
      annoYMap = new Y.Map();
      const fabricYMap = new Y.Map();
      const metaYMap = new Y.Map();
      yMapAnnotations.set(annoId, annoYMap);
      annoYMap.set('id', annoId);
      annoYMap.set('type', fabricJson.type);
      annoYMap.set('pageNumber', fabricObject.pageNumber);
      annoYMap.set('fabric', fabricYMap);
      annoYMap.set('meta', metaYMap);
      // CREATE-only metadata (UNDO-03 invariants):
      metaYMap.set('authorId', ctx.userId);
      metaYMap.set('deviceId', ctx.deviceId);
      metaYMap.set('createdAt', Date.now());
    }
    const fabricYMap = annoYMap.get('fabric');
    const metaYMap = annoYMap.get('meta');

    // Per-property writes — DO NOT clear-and-set. Each set() is one mergeable op.
    for (const key of Object.keys(fabricJson)) {
      // Skip keys that didn't change (caller passes diff'd JSON, OR we shallow-diff here).
      const prev = fabricYMap.get(key);
      if (deepEqual(prev, fabricJson[key])) continue;
      fabricYMap.set(key, fabricJson[key]);
    }

    // Edit-only metadata (LWW tiebreak for human display):
    metaYMap.set('updatedAt', Date.now());
    metaYMap.set('lastEditorId', ctx.userId);
  }, originPayload);
}

export function applyFabricDelete(ydoc, yMapAnnotations, annoId, originPayload) {
  ydoc.transact(() => {
    yMapAnnotations.delete(annoId);
    // Y.UndoManager.undo() of this delete will restore the entire Y.Map value
    // including authorId/deviceId/createdAt — UNDO-03 satisfied automatically.
  }, originPayload);
}

/**
 * Apply a remote Y.Map update to the local Fabric edit-canvas object (if mounted).
 * Sets applyingRemote=true to mute Fabric's object:modified during the apply.
 */
export function applyYUpdateToFabric(yMapAnnotations, annoId, registry) {
  const obj = registry.get(annoId);
  if (!obj) return;  // not currently in edit canvas — SVG layer reads on next render
  const annoYMap = yMapAnnotations.get(annoId);
  if (!annoYMap) {
    // Remote delete. If we have a local Fabric object for it, the parent component
    // (FabricEditCanvas) handles the cancellation + toast surfacing.
    return;
  }
  const fabricSnapshot = annoYMap.get('fabric').toJSON();

  applyingRemote = true;
  try {
    obj.set(fabricSnapshot);
    obj.setCoords();
    obj.canvas?.requestRenderAll();
  } finally {
    Promise.resolve().then(() => { applyingRemote = false; });
  }
}
```

### Example 2: Y.UndoManager wrapper with stable user origin

```js
// src/lib/collab/crdtUndoManager.js
// Source: docs.yjs.dev/api/undo-manager + verified source-code reference equality semantics
import * as Y from 'yjs';

const memoizedOriginByUser = new Map();

/**
 * Returns a memoized frozen origin object for a given user. Reference equality holds
 * across all calls with the same userId — REQUIRED for Y.UndoManager.trackedOrigins.has(origin).
 */
export function getLocalFabricOrigin({ userId, deviceId, sessionId, clientID }) {
  let origin = memoizedOriginByUser.get(userId);
  if (!origin) {
    origin = Object.freeze({ source: 'local-fabric', userId, deviceId, sessionId, clientID });
    memoizedOriginByUser.set(userId, origin);
  }
  return origin;
}

/**
 * Build a per-user UndoManager. Only transactions originated with the SAME memoized origin
 * (getLocalFabricOrigin called with the same userId) are tracked.
 *
 * History is fresh per Y.Doc mount (CONTEXT.md decision: no cross-session persistence).
 * Capped at 100 actions (CONTEXT.md decision: matches Figma defaults).
 */
export function createUndoManager({ ydoc, userId, deviceId, sessionId, clientID, captureTimeout = 500, historyCap = 100 }) {
  const origin = getLocalFabricOrigin({ userId, deviceId, sessionId, clientID });
  const undoManager = new Y.UndoManager(
    [ydoc.getMap('annotations'), ydoc.getMap('callouts')],
    {
      trackedOrigins: new Set([origin]),
      captureTimeout,
    }
  );

  // Cap history at 100 (CONTEXT.md). Y.UndoManager doesn't have a native cap; we trim manually
  // by listening to stack-item-added.
  undoManager.on('stack-item-added', () => {
    while (undoManager.undoStack.length > historyCap) {
      undoManager.undoStack.shift();
    }
  });

  return { undoManager, origin };
}

/**
 * User-pressed Cmd+Z. Wraps undoManager.undo() with an origin so the activity log
 * (Phase 33) knows this was an undo by user X on device Y at time T.
 */
export function userUndo(ydoc, undoManager, ctx) {
  // 'local-undo' is NOT in trackedOrigins, so this transact() doesn't push a new
  // op onto the undo stack — it only triggers the inverse-op for the popped item.
  ydoc.transact(() => undoManager.undo(), {
    source: 'local-undo',
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    clientID: ctx.clientID,
    ts: Date.now(),
  });
}

export function userRedo(ydoc, undoManager, ctx) {
  ydoc.transact(() => undoManager.redo(), {
    source: 'local-redo',
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    sessionId: ctx.sessionId,
    clientID: ctx.clientID,
    ts: Date.now(),
  });
}
```

### Example 3: useAnnotationsCRDT hook

```js
// src/hooks/useAnnotationsCRDT.js
import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useYDoc } from './useYDoc';

const EMPTY_BY_PAGE = Object.freeze({});

export function useAnnotationsCRDT() {
  const { ydoc, isHydrating } = useYDoc();
  const snapshotRef = useRef(EMPTY_BY_PAGE);

  const subscribe = useCallback((callback) => {
    if (!ydoc) return () => {};
    const yMapAnno = ydoc.getMap('annotations');
    const yMapCallouts = ydoc.getMap('callouts');

    const handler = () => {
      // Invalidate cached snapshot so next getSnapshot recomputes.
      snapshotRef.current = null;
      callback();
    };

    // observeDeep on each top-level Y.Map separately (NOT on ydoc itself).
    // observeDeep batches all events per transaction, so handler fires once per transact().
    yMapAnno.observeDeep(handler);
    yMapCallouts.observeDeep(handler);

    return () => {
      yMapAnno.unobserveDeep(handler);
      yMapCallouts.unobserveDeep(handler);
    };
  }, [ydoc]);

  const getSnapshot = useCallback(() => {
    if (!ydoc) return EMPTY_BY_PAGE;
    if (isHydrating) return EMPTY_BY_PAGE;
    if (snapshotRef.current) return snapshotRef.current;

    // Materialize Y.Map -> { [pageNumber]: { objects: [...] } }
    const yMapAnno = ydoc.getMap('annotations');
    const byPage = {};
    yMapAnno.forEach((annoYMap, id) => {
      const json = annoYMap.toJSON();
      const page = json.pageNumber;
      if (!byPage[page]) byPage[page] = { objects: [] };
      byPage[page].objects.push({
        ...json.fabric,
        data: { id, ...(json.fabric?.data ?? {}) },
        // Phase 29 augments with meta surfaced for awareness:
        __meta: json.meta,
      });
    });
    snapshotRef.current = Object.freeze(byPage);
    return byPage;
  }, [ydoc, isHydrating]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

### Example 4: FabricEditCanvas commit-path waiver (surgical)

```js
// src/components/FabricEditCanvas.jsx — NARROW WAIVER (commit path only)
// BEFORE (current code):
canvas.on('object:modified', () => {
  // ... existing logic ...
  onEditCommitRef.current(updatedAnnotationsJSON);
});

// AFTER (Phase 29 wiring):
canvas.on('object:modified', (e) => {
  // Echo-loop defense: short-circuit if bridge is mid-applying remote update.
  if (isApplyingRemote()) return;

  // Mid-drag Cmd+Z cancellation already handled at the keyboard handler — by the time
  // object:modified fires, the drag has completed (mouseup), so this is the natural commit point.

  applyFabricCommit(ydoc, ydoc.getMap('annotations'), e.target, originPayload, ctx);

  // EXISTING logic for in-Fabric updates that must persist beyond the bridge — preserved.
});

// All other code in this file: BYTE-IDENTICAL.
//   - container-aware sizing path: preserved (CLAUDE.md 2026-03-22 rule)
//   - single-name fontFamily path: preserved (CLAUDE.md 2026-04-08 rule)
//   - zoomGeneration signal handler: preserved (CLAUDE.md zoom rule)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-yjs` npm package | Hand-rolled `useSyncExternalStore + observeDeep` | React 18 ships `useSyncExternalStore` (2022) | One less dependency; pattern is canonical and 30 LOC. |
| `Y.UndoManager` with `clientID` origin | `Y.UndoManager` with stable `userId` origin (memoized frozen object) | Yjs docs (2024+) explicitly note clientID is per-session | Per-user undo survives page reloads + cross-tab. |
| `setTimeout` reset for echo guard | `Promise.resolve().then` microtask reset | Yjs community thread `discuss.yjs.dev/t/.../1121` (verify-wait pattern recognized) | Eliminates the silent-edit-loss window. |
| Default `captureTimeout=500ms` for all undo | Mix: 500ms for general edits + explicit `stopCapturing()` at logical boundaries (whitespace in text, mouseup for drag, eraser-session-end) | Custom-per-app pattern documented across Tiptap / Liveblocks | Per-word undo for text, per-action undo for drags, per-swipe for eraser. |
| `observeDeep(ydoc)` (root) | `yMap.observeDeep()` per top-level Y.Map | Yjs PITFALLS-doc canonical guidance | Bounds blast radius; avoids spurious re-renders for unrelated changes. |

**Deprecated/outdated:**
- `react-yjs` package — 18+ months stale on npm; useSyncExternalStore is the canonical pattern.
- `clientID` as undo-scope identifier — works in dev, fails on reload; userId is correct.
- Bidirectional Fabric ↔ Y observer during drag — strictly an anti-pattern (echo + tearing).

---

## React Integration

### Subscribe / unsubscribe lifecycle

The hook's `subscribe` function is called once per `useSyncExternalStore` mount, and the returned cleanup is called once per unmount or `ydoc` change. Subscriptions go through `observeDeep` on the top-level Y.Maps (`annotations`, `callouts`) — NOT on the root Y.Doc, NOT per-annotation.

**Why per-Y.Map (not per-annotation):** the React tree above SVG renders ALL annotations on the visible page. A change to anno A must trigger a re-render so SVG can pick it up. Per-annotation observers would mean N subscriptions for N annotations — manageable for 50, painful at 500+. `observeDeep` on the parent Y.Map is one subscription that batches all per-anno events into one fire per transaction.

**Why memoize the snapshot via `snapshotRef`:** without memoization, `getSnapshot` runs the full `toJSON` materialization on EVERY render — even renders not triggered by Y.Doc changes (parent re-renders, prop changes, etc.). With the ref, materialization runs once per Y.Doc transaction batch. At 1000 annotations the difference is 5–10ms per render vs sub-ms.

**Tearing prevention:** `useSyncExternalStore` calls `getSnapshot` BOTH at the start and end of a render to detect mismatch. If a Y.Doc transaction lands mid-render (concurrent rendering can be paused), the second call returns the post-transaction snapshot, React detects the tear, and aborts + retries. Without `useSyncExternalStore`, you get one component rendering with pre-state and another with post-state — visual inconsistency.

### Hydration coordination

- Phase 27's `useYDoc` exposes `isHydrating` (true while y-indexeddb is loading from disk). `useAnnotationsCRDT` returns `EMPTY_BY_PAGE` while `isHydrating=true`. SVG layer treats empty as "skip render" (matches the existing pattern).
- Once `isHydrating=false`, hook materializes the snapshot.
- `EMPTY_BY_PAGE` is a frozen module-level constant so reference equality during hydration prevents spurious re-renders.

### Per-mount registry interactions

- The `Map<annoId, FabricObject>` registry lives **outside** `useAnnotationsCRDT` because the hook is read-only. The registry is populated by `FabricEditCanvas` on mount via `useEffect`. Plan picks the exact home: a sibling hook (`useFabricRegistry`) or co-located inside the bridge module exporting `getRegistry()`.
- The registry is consumed by the bridge's `applyYUpdateToFabric` function (called from per-annotation observer in the edit-canvas component when a remote update lands during an active edit).

---

## Performance Patterns

| Pattern | Why | Threshold |
|---------|-----|-----------|
| Per-annotation Y.Map (NOT per-page Y.Array) | Field-level deltas instead of array splices. Two users editing different annos = no contention. | All annotations |
| Pen-stroke `path` as opaque JSON inside Y.Map (NOT Y.Array of points) | Pen strokes are commit-once-edit-rarely. Granular CRDT for points balloons updates 10-100x. | All pen strokes |
| Memoized snapshot (via `snapshotRef`) | Avoid O(n) `toJSON` on every render | 100+ annotations |
| `observeDeep` per top-level Y.Map (NOT root) | Batches per-transaction; bounds blast radius | 50+ annotations |
| Microtask reset for `applyingRemote` (NOT setTimeout) | Eliminates silent-edit-loss window | Always |
| Memoized origin object (one per user) | Reference equality for `trackedOrigins.has(origin)` | Always |
| Eraser swipe = ONE `ydoc.transact()` | One undo step for one logical action | Always |
| Word-boundary `stopCapturing()` for text | Per-word undo (CONTEXT.md decision) | Text annotations |
| 1000-stroke smoke test in CI | Catch echo loops before user does | Required for phase verification |

**Expected performance at 1000 annotations:**
- Snapshot materialization: 5-10ms (acceptable; runs only on Y.Doc change, not per render)
- Single property edit: <1ms (Y.Map.set + observer fan-out + memoized snapshot invalidate)
- Echo-loop test: CPU < 30%, IndexedDB linear growth (success criterion 1)

**At 10K annotations (year-old document):** snapshot materialization grows to 50-100ms, which IS user-visible. **Mitigation deferred to Phase 32** (snapshot memoization + per-page lazy materialization). Phase 29 does NOT need to optimize for 10K — Phase 27/28's compaction strategy keeps the live Y.Doc at < 1K updates.

---

## Pitfall-by-Pitfall Mitigation Checklist

| Pitfall | Severity | Mitigation in Phase 29 | Verification |
|---------|----------|------------------------|--------------|
| **4: Echo loop** | CRITICAL | (a) Origin tag `source: 'local-fabric'` on every transact; (b) observer guard `if (origin?.source === 'local-fabric') return;` first line; (c) `applyingRemote` belt with microtask reset; (d) per-annotation observer scope, NOT root observeDeep | 1000-stroke smoke test: CPU < 30%, IndexedDB linear growth, exactly one Y.Map.set per object:modified, zero re-applies. Roadmap success criterion 1. |
| **6: Identity contract** | HIGH | (a) Stable annoId uuid across SVG / Fabric `obj.data.annoId` / Y.Map key; (b) per-mount registry `Map<annoId, FabricObject>` populated on edit-canvas mount, cleared on unmount; (c) bridge consults registry, never `canvas.getObjects().find(...)`; (d) reconciliation on mount: read fresh state from Y.Doc, rebuild Fabric object from scratch | Two-user same-shape edit test: leave edit mode, verify no "snap back". Memory-leak test: 100 mount/unmount cycles, verify no Fabric reference accumulation. |
| **7: Per-user undo erases collaborator work** | HIGH | (a) `Y.UndoManager` with `trackedOrigins: new Set([memoizedUserOrigin])`; (b) `userId` (stable string or memoized frozen object) as origin identity; (c) observe the same Y.Maps the bridge writes to (`annotations` + `callouts`); (d) wrap `undo()`/`redo()` with origin tag for activity log | Canonical Playwright test: A draws, B draws, A undoes — only A's stroke reverts. Required for phase verification. |
| **8: applyingRemote guard** | HIGH | (a) Module-scoped boolean; (b) try/finally ensures reset on exception; (c) microtask reset (Promise.resolve().then), NOT setTimeout; (d) Fabric `object:modified` handler short-circuits if true | Test: trigger remote update during local idle, verify Fabric doesn't echo. Test: trigger remote update during local active drag — verify drag wins, remote buffers. |

---

## Open Questions / Risks

### Q1: Cross-page undo navigation timing

**What we know:** CONTEXT.md says "view jumps to the page where the change is" when Cmd+Z reaches a different page. UndoManager.undo() pops one item and applies the inverse op synchronously. The Y.Map change fires the observer, snapshot invalidates, React re-renders.

**What's unclear:** at what exact point does the page-jump fire? Before the Y change applies (so user sees the page transition then the change), or after (so the user briefly sees "nothing happened" on current page, then jumps)?

**Recommendation:** **page-jump triggers BEFORE the Y change applies**, by reading the popped UndoItem's affected anno's `pageNumber` BEFORE calling `undo()`. UndoManager exposes `undoStack[undoStack.length - 1]` so we can peek. If the affected anno is on a different page, navigate first, then call `undo()`.

### Q2: How to detect the popped action's page from the UndoStack item

**What we know:** Y.UndoManager.undoStack items carry `deletions` and `insertions` Sets internally. The structure is documented but undocumented for stable consumption.

**What's unclear:** is the structure stable enough across Yjs minor versions to read in production?

**Recommendation:** **read at construction time**. Build a side-cache: when `stack-item-added` fires on the UndoManager, inspect the item, derive the affected pageNumber(s) by reading the Y.Map values touched, store `{ stackItemId: pageNumber }`. On undo, look up the popped item's pageNumber in the cache. Decouples our code from internal Yjs structures.

### Q3: Mid-drag remote update — what does the local user see?

**What we know:** CONTEXT.md says "while local user has mouse down dragging, local drag wins on local screen; remote drag updates buffered until release."

**What's unclear:** during the drag, is the local Fabric scene live-painting against the remote update at all? Or is the bridge fully muted?

**Recommendation:** **fully muted during local drag.** The local Fabric scene paints from the local user's drag input only; bridge's `applyYUpdateToFabric` is a no-op for the actively-dragged annoId until `mouse:up`. On release: apply remote update; LWW resolves via meta.updatedAt tiebreak.

### Q4: Ordering of `stopCapturing()` calls vs Fabric event timing

**What we know:** Fabric fires `mouse:up` → optionally `selection:cleared` → `object:modified`.

**What's unclear:** does `stopCapturing()` need to fire before, between, or after these? If after `object:modified`, the next user action's transact lands on a fresh capture window, which is what we want.

**Recommendation:** **call `stopCapturing()` from the bridge's `applyFabricCommit`**, right after the transact returns. This guarantees that the captured operation is the just-committed one, and the next operation starts a new window.

### Q5: Electron menu IPC channel design

**What we know:** Electron's `Menu.buildFromTemplate` exposes `click` handlers that fire in the main process. To call `undoManager.undo()` (which lives in the renderer), we need IPC.

**What's unclear:** new IPC channel name, payload shape, whether to pass through `webContents.send` or a custom channel.

**Recommendation:** new channel `app:edit-menu-undo` and `app:edit-menu-redo`. Main fires `webContents.send(channel)`; renderer's `useEffect` in `App.jsx` (or sibling hook) listens via `ipcRenderer.on(channel, () => userUndo(...))`. Web fallback: no menu, keyboard + button only. Planner picks the file home for the IPC wiring code (likely a small new file `electron-main/menu.js` or extension of an existing main-process bootstrap).

### Q6: What happens if the same user opens two tabs and presses Cmd+Z in tab A?

**What we know:** memoized origin per-userId. Both tabs share userId → both transacts use the same origin. UndoManager in each tab tracks BOTH tabs' edits (because both carry the same user origin).

**What's unclear:** is this what we want? Tab B's edits show up in Tab A's undo stack — pressing Cmd+Z in Tab A undoes a Tab B edit.

**Discussion:** CONTEXT.md decides "history is fresh per document open" — implying per-tab undo history is acceptable. But same-user-multi-tab is a real scenario. Two paths:
- **Path 1 (matches CONTEXT.md):** each tab has its own UndoManager that tracks the local tab's edits only, NOT cross-tab. Origin includes per-tab `sessionId`; `trackedOrigins: new Set([origin])` filters by the FULL origin reference, so Tab A's UndoManager doesn't track Tab B's edits (different origin object — same userId but different sessionId).
- **Path 2 (cross-tab undo):** trackedOrigins matches by userId only, so any tab's edit by this user is undoable from any tab. Different mental model.

**Recommendation:** **Path 1.** Matches Figma (each tab is its own undo scope). Simpler to reason about. The trade-off (no cross-tab undo for the same user) is acceptable — same-user-multi-tab is a niche case (CONTEXT.md awareness section already accepts that two-tab same-user shows as two presences).

**Implementation:** memoize origin by `(userId, sessionId)` tuple, not just userId. Each tab gets a new sessionId on Y.Doc mount. UndoManager constructed with that tuple's origin.

### Q7: What's the exact `captureTimeout` value?

**What we know:** Yjs default is 500ms. CONTEXT.md says one logical action = one undo (drag = one undo). Fabric `object:modified` fires once per drag (at mouseup).

**What's unclear:** if a user drags A→B, releases (object:modified fires, transact happens), then drags A→C 200ms later, does the second drag merge into the same undo step (because 200ms < 500ms captureTimeout)?

**Recommendation:** **explicit `stopCapturing()` after every commit.** This makes captureTimeout effectively irrelevant — every Fabric commit produces ONE undo step, regardless of timing. captureTimeout still fires for cases where stopCapturing is missed, as a safety net.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node --test` for unit (matches Phase 27/28 convention) + Playwright for two-client integration |
| Config file | `package.json` test scripts (existing); Playwright config at `playwright.config.mjs` (existing) |
| Quick run command | `npm test -- tests/phase29/` (per-test existsSync skip-guards flip skip→green as plans land) |
| Full suite command | `npm test && npm run test:e2e -- tests/phase29-e2e/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COLLAB-02 | Concurrent edits to two different annos on same page never collide | unit + e2e | `node --test tests/phase29/concurrentDifferentAnnos.test.mjs` + `npx playwright test tests/phase29-e2e/two-clients-different-annos.spec.mjs` | ❌ Wave 0 |
| COLLAB-03 | Concurrent same-anno edits per-property LWW | unit + e2e | `node --test tests/phase29/concurrentSameAnno.test.mjs` (asserts both color+position survive when each user changes one property) + `npx playwright test tests/phase29-e2e/two-clients-same-anno.spec.mjs` | ❌ Wave 0 |
| UNDO-01 | Cmd+Z undoes own most recent action | unit + e2e | `node --test tests/phase29/undoLocalScope.test.mjs` (memoized origin reference equality + UndoManager.undo() reverses last transact) + `npx playwright test tests/phase29-e2e/single-user-undo.spec.mjs` | ❌ Wave 0 |
| UNDO-02 | Undo never erases collaborator work | unit + e2e (CRITICAL) | `node --test tests/phase29/undoTwoUserIsolation.test.mjs` (A draws via origin_A, B draws via origin_B, A's UndoManager.undo() leaves B's work intact) + `npx playwright test tests/phase29-e2e/two-clients-undo-isolation.spec.mjs` | ❌ Wave 0 |
| UNDO-03 | Undo of delete restores original creation user + timestamp | unit | `node --test tests/phase29/undoTombstoneResurrection.test.mjs` (CREATE → set meta.authorId/createdAt → DELETE → undo → assert meta.authorId/createdAt preserved) | ❌ Wave 0 |
| UNDO-04 | Cmd+Shift+Z redoes own undone action without affecting collaborators | unit + e2e | `node --test tests/phase29/redoLocalScope.test.mjs` + `npx playwright test tests/phase29-e2e/single-user-redo.spec.mjs` | ❌ Wave 0 |
| **No echo loop** (Pitfall 4 / Roadmap success criterion 1) | 1000 strokes, CPU < 30%, IndexedDB linear, exactly one Y.Map.set per object:modified | unit + e2e | `node --test tests/phase29/echoLoopGuard.test.mjs` (mock Fabric event surface; assert observer guard short-circuits + applyingRemote belt fires) + `npx playwright test tests/phase29-e2e/1000-strokes-stress.spec.mjs` (live CPU + IndexedDB measurement) | ❌ Wave 0 |
| **Identity contract** (Pitfall 6) | annoId stable across SVG / Fabric / Y.Map; registry cleared on unmount | unit | `node --test tests/phase29/identityContract.test.mjs` (mount edit canvas → registry has annoId → unmount → registry empty; lookup returns same object before unmount; lookup returns undefined after) | ❌ Wave 0 |
| **Mid-drag Cmd+Z cancellation** (CONTEXT.md decision) | Drag cancels, snaps back, NO Y.Map write | unit + e2e | `node --test tests/phase29/midDragCancel.test.mjs` (mock drag state, fire Cmd+Z, assert no transact) + `npx playwright test tests/phase29-e2e/mid-drag-cancel.spec.mjs` | ❌ Wave 0 |
| **Per-word undo for text** (CONTEXT.md) | Cmd+Z reverts to last whitespace boundary, not whole text or per-keystroke | unit + e2e | `node --test tests/phase29/perWordUndo.test.mjs` (simulate text:changed events with whitespace, assert stopCapturing called at boundaries) + `npx playwright test tests/phase29-e2e/text-per-word-undo.spec.mjs` | ❌ Wave 0 |
| **One-press eraser-swipe undo** (CONTEXT.md) | One swipe wiping 5 strokes restores all 5 in one Cmd+Z | unit + e2e | `node --test tests/phase29/eraserSwipeUndo.test.mjs` (eraser session wraps 5 deletes in one transact) + `npx playwright test tests/phase29-e2e/eraser-swipe-undo.spec.mjs` | ❌ Wave 0 |
| **Tombstone-resurrection author preservation** (UNDO-03 detail) | Undo of delete restores `meta.authorId`, `meta.deviceId`, `meta.createdAt` exactly | unit | `node --test tests/phase29/tombstoneAuthorPreservation.test.mjs` | ❌ Wave 0 |
| **Resurrect race** (CONTEXT.md) | A deletes; B's edit landed before delete propagated; A's undo resurrects with B's edit included; meta.authorId/createdAt original | unit | `node --test tests/phase29/resurrectRace.test.mjs` (advanced — Y.Doc clones for two clients, race the orderings) | ❌ Wave 0 |
| **Empty undo stack silent** (CONTEXT.md) | Cmd+Z on empty stack: no toast, no flash, no UI change | e2e | `npx playwright test tests/phase29-e2e/empty-undo-silent.spec.mjs` | ❌ Wave 0 |
| **applyUpdate-only invariant preserved** (Phase 27 carry-over) | No `Y.applyUpdate` outside transport providers; no `new Y.Doc()` outside registry | unit (grep) | `npm run test:applyupdate-invariant` (existing Phase 27 test extended to cover Phase 29 new files) | ✅ existing, extend |
| **Cross-page undo navigation** (CONTEXT.md) | Undo of action on different page jumps view to that page first, then applies undo | e2e | `npx playwright test tests/phase29-e2e/cross-page-undo.spec.mjs` | ❌ Wave 0 |
| **Remote-deletion-during-interaction toast** | Toast surfaces only when local user is selected/dragging/scaling/edit-open/menu-open | e2e | `npx playwright test tests/phase29-e2e/remote-delete-toast.spec.mjs` (5 scenarios: each interaction state + outside-state silent case) | ❌ Wave 0 |
| **Per-user awareness outline** | Remote user opens edit canvas on shape Y → local screen shows outline in remote user's stable color | e2e | `npx playwright test tests/phase29-e2e/awareness-outline.spec.mjs` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/phase29/` (unit suite, < 30s)
- **Per wave merge:** `npm test && npx playwright test tests/phase29-e2e/` (full suite, ~2-5 min)
- **Phase gate:** Full suite green + 1000-stroke stress test passes + applyUpdate-only invariant green before `/gsd:verify-work 29`

### Wave 0 Gaps

All test files are new — Phase 29 ships its full test scaffolding in Wave 0 following the Phase 27/28 per-test existsSync skip-guard pattern (the scaffolds flip skip→green as later plans land their production modules). Required scaffolds:

- [ ] `tests/phase29/concurrentDifferentAnnos.test.mjs` — COLLAB-02
- [ ] `tests/phase29/concurrentSameAnno.test.mjs` — COLLAB-03 (per-property LWW)
- [ ] `tests/phase29/undoLocalScope.test.mjs` — UNDO-01 (memoized-origin reference equality)
- [ ] `tests/phase29/undoTwoUserIsolation.test.mjs` — UNDO-02 (canonical pitfall 7 test)
- [ ] `tests/phase29/undoTombstoneResurrection.test.mjs` — UNDO-03 (delete-undo restores meta)
- [ ] `tests/phase29/redoLocalScope.test.mjs` — UNDO-04
- [ ] `tests/phase29/echoLoopGuard.test.mjs` — Pitfall 4 (origin guard + applyingRemote belt)
- [ ] `tests/phase29/identityContract.test.mjs` — Pitfall 6 (registry lifecycle)
- [ ] `tests/phase29/midDragCancel.test.mjs` — CONTEXT.md mid-drag cancellation
- [ ] `tests/phase29/perWordUndo.test.mjs` — CONTEXT.md per-word undo
- [ ] `tests/phase29/eraserSwipeUndo.test.mjs` — CONTEXT.md one-swipe-one-undo
- [ ] `tests/phase29/tombstoneAuthorPreservation.test.mjs` — UNDO-03 author/device/createdAt invariant
- [ ] `tests/phase29/resurrectRace.test.mjs` — CONTEXT.md resurrect race scenario
- [ ] `tests/phase29-e2e/two-clients-different-annos.spec.mjs` — COLLAB-02 e2e
- [ ] `tests/phase29-e2e/two-clients-same-anno.spec.mjs` — COLLAB-03 e2e
- [ ] `tests/phase29-e2e/single-user-undo.spec.mjs` — UNDO-01 e2e
- [ ] `tests/phase29-e2e/two-clients-undo-isolation.spec.mjs` — UNDO-02 e2e (canonical)
- [ ] `tests/phase29-e2e/single-user-redo.spec.mjs` — UNDO-04 e2e
- [ ] `tests/phase29-e2e/1000-strokes-stress.spec.mjs` — Pitfall 4 stress
- [ ] `tests/phase29-e2e/mid-drag-cancel.spec.mjs` — CONTEXT.md mid-drag e2e
- [ ] `tests/phase29-e2e/text-per-word-undo.spec.mjs` — CONTEXT.md text e2e
- [ ] `tests/phase29-e2e/eraser-swipe-undo.spec.mjs` — CONTEXT.md eraser e2e
- [ ] `tests/phase29-e2e/empty-undo-silent.spec.mjs` — CONTEXT.md silent empty
- [ ] `tests/phase29-e2e/cross-page-undo.spec.mjs` — CONTEXT.md cross-page jump
- [ ] `tests/phase29-e2e/remote-delete-toast.spec.mjs` — CONTEXT.md "Restore?" toast
- [ ] `tests/phase29-e2e/awareness-outline.spec.mjs` — CONTEXT.md per-user outline

Framework install: none needed — `node --test` and Playwright already in dependency tree from Phases 27/28.

---

## Recommendations for Plan Structure

### Suggested 5-plan decomposition across 3 waves

**Wave 0 — Test scaffolds + skeletons (zero src/ changes):**
- **Plan 29-01: Wave 0 — test scaffolds + module skeletons.** All 26 test files above as `existsSync`-guarded skip scaffolds. Module skeletons for `crdtAnnotationBridge.js`, `crdtUndoManager.js`, `useAnnotationsCRDT.js`, `CollaboratorOutlineOverlay.jsx` (each empty-export placeholder + JSDoc contract spec). Zero src/ functional changes. Establishes the "pattern" for downstream plans following Phase 27/28 convention.

**Wave 1 — Pure modules (parallelizable):**
- **Plan 29-02: `crdtAnnotationBridge.js` + memoized origin pattern + applyingRemote guard.** Pure module, no React/Fabric instance. Implements `applyFabricCommit`, `applyFabricCreate`, `applyFabricDelete`, `applyYUpdateToFabric`, `getLocalFabricOrigin` (memoized), `isApplyingRemote`. Test scaffolds 29-01 flip skip→green for: echoLoopGuard, identityContract (registry parameter contract), tombstoneAuthorPreservation. **Zero waivers — pure module.**
- **Plan 29-03: `crdtUndoManager.js` + `userUndo` / `userRedo` wrappers + history cap.** Pure module wrapping `Y.UndoManager`. Test scaffolds flip green for: undoLocalScope, undoTwoUserIsolation, redoLocalScope, undoTombstoneResurrection (the latter exercises the bridge from 29-02 in Y.Map.delete + UndoManager.undo() composition — depends on 29-02 landing first OR runs in parallel using a stub bridge). **Zero waivers — pure module.**

**Wave 2 — React integration + edit-canvas wiring:**
- **Plan 29-04: `useAnnotationsCRDT` hook + per-mount registry hook + `App.jsx` waiver (Cmd+Z + Cmd+Shift+Z + Home-tab buttons rewire + Electron Edit menu wiring).** `useSyncExternalStore + observeDeep` over `annotations` + `callouts` Y.Maps. New hook for per-mount registry (or co-located in bridge module — Claude's discretion). App.jsx narrow waiver: rewire `handleUndo` (~16472) + `handleRedo` (~16547) bodies to call `userUndo` / `userRedo`; rewire Home-tab Undo button (~28191) and Redo button (~28213) — same handlers, no new chrome; Electron menu IPC wiring (new tiny file under electron-main/, scope per planner). **App.jsx narrow waiver. Cross-page-undo navigation logic lives here.**

**Wave 2 (parallel-with-29-04 OR sequential):**
- **Plan 29-05: `FabricEditCanvas.jsx` commit-path waiver + bridge integration + mid-drag cancellation + per-word undo + eraser-swipe-as-one-undo.** Surgical waiver on `FabricEditCanvas.jsx` rewiring the `object:modified` handler to call `applyFabricCommit` instead of `setAnnotationsByPage`. Container-aware sizing + single-name fontFamily + zoomGeneration signal preserved (verified by waiver scope check). Per-word `stopCapturing()` on whitespace in text. Eraser-swipe transact bracketing (extends existing eraser session OR new boundary primitive). Mid-drag Cmd+Z cancellation (drag-start position snapshot + cancel logic). **FabricEditCanvas.jsx narrow waiver.**

**Wave 2 (independent, parallel):**
- **Plan 29-06: `CollaboratorOutlineOverlay.jsx` + `<StorageFailureBanner>` `annotation_remote_deleted` copy variant + multi-toast stack + restore-with-meta-preservation logic.** New `CollaboratorOutlineOverlay.jsx` sibling SVG overlay reading awareness `editingAnnotationId` from Phase 28's transport. Extends `<StorageFailureBanner>` with new `code='annotation_remote_deleted'` + `onRestore` / `onDismiss` props per UI-SPEC. Toast host (existing banner host slot inside YDocProvider OR new `<BannerStack>` — planner picks per UI-SPEC §3). "Restore" button calls a bridge fn that recreates the annotation with original `meta.authorId` / `meta.createdAt` preserved. Detects local-interaction state (selected / dragging / scaling / edit-open / menu-open) to gate the toast. **No App.jsx waiver — overlay mounts inside the existing Phase 27 YDocProvider boundary; toast extends the existing banner host slot Phase 27/28 already mounted.**

### Why this decomposition

- **Wave 0 unblocks all downstream plans** — every plan writes against an `existsSync`-guarded test that flips green when the production module lands. Same Phase 27/28 convention.
- **Wave 1 plans (29-02 + 29-03) parallelize** — pure modules with no React/Fabric dependencies, independent file lanes. Plan 29-03 has a soft dependency on 29-02 (the tombstone-resurrection unit test exercises the bridge), but the dependency is testable via stub.
- **Wave 2 (29-04 + 29-05 + 29-06) parallelize** — three independent wiring lanes. 29-04 owns `App.jsx` + the read hook; 29-05 owns `FabricEditCanvas.jsx` + the write path; 29-06 owns the remote-delete toast + awareness outline. Combined unit + e2e suite verifies all three integrate.
- **App.jsx and FabricEditCanvas.jsx waivers are surgical and independent** — no overlap. Each plan's waiver scope is narrow enough to verify diff-by-diff.
- **All Always-Protected files except the two waivered ones stay byte-identical** — verified by `git diff --stat` at phase close.

### Wave dependency graph

```
Wave 0: 29-01 (scaffolds)
        ├──> Wave 1: 29-02 (bridge) ──┐
        │              + 29-03 (undo) │  (parallelizable)
        │                             v
        └──> Wave 2: 29-04 (hook + App.jsx) ──┐
                   + 29-05 (FabricEditCanvas) │  (parallelizable)
                   + 29-06 (toast + outline)  │
                                              v
                  Phase 29 verify + reconcile
```

---

## Sources

### Primary (HIGH confidence)

- **Yjs source** — `src/utils/UndoManager.js` `afterTransactionHandler` function (verified `trackedOrigins.has(origin) || trackedOrigins.has(origin.constructor)` reference-equality check via direct GitHub fetch).
- **Yjs Documentation — Y.UndoManager** [docs.yjs.dev/api/undo-manager](https://docs.yjs.dev/api/undo-manager) — constructor signature, captureTimeout default 500ms, stopCapturing() semantics, three options (captureTimeout / trackedOrigins / deleteFilter).
- **Yjs Documentation — Y.Doc** [docs.yjs.dev/api/y.doc](https://docs.yjs.dev/api/y.doc) — clientID is per-session, "should not be reused across sessions" (CRITICAL — drives userId-as-undo-origin recommendation).
- **Yjs Documentation — Y.Map (observeDeep)** [docs.yjs.dev/api/shared-types/y.map](https://docs.yjs.dev/api/shared-types/y.map) — observeDeep fires once per transaction batch with array of YEvents.
- **react-yjs canonical pattern** [github.com/nikgraf/react-yjs](https://github.com/nikgraf/react-yjs) — useSyncExternalStore + observeDeep + .toJSON() snapshot. Note: package itself is unmaintained; Phase 29 hand-rolls the 30-LOC pattern instead.
- **Internal: `.planning/research/PITFALLS.md`** — pitfalls 4, 6, 7, 8 fully documented (already digested for Phase 27/28 research).
- **Internal: `.planning/research/ARCHITECTURE.md`** — §4 Fabric ↔ Y.Map bridge, §10 Y.UndoManager scoping, §13 Anti-patterns.
- **Internal: `.planning/research/SUMMARY.md` + `STACK.md`** — locked Yjs trio (^13.6.30), per-user undo via trackedOrigins.
- **Internal: Phase 27 `27-RESEARCH.md`** — Yjs primary docs already digested; applyUpdate-only invariant; Web Locks + IndexeddbPersistence; per-doc Y.Doc registry.
- **Internal: Phase 28 `28-RESEARCH.md` + `28-CONTEXT.md`** — origin payload `{ source, userId, deviceId, sessionId, clientID, serverTs }`; SupabaseYjsProvider echo guard via `origin?.source === 'remote-realtime'`; postgres-trigger validator on `doc_yjs_updates`.
- **Existing src — `src/lib/collab/originBuilder.js`** — Phase 28 buildOrigin helper; REMOTE_REALTIME_ORIGIN + REMOTE_BC_ORIGIN sentinels; reference-equality echo-guard pattern.
- **`npm view yjs version`** — confirmed `13.6.30` is current at registry (matches `package.json` ^13.6.30).

### Secondary (MEDIUM confidence — verified against primary sources)

- **Yjs Discuss — UndoManager best practice** [discuss.yjs.dev/t/how-to-use-undomanager-in-best-practice/1340](https://discuss.yjs.dev/t/how-to-use-undomanager-in-best-practice/1340) — community example using string `'track'` as origin; confirms primitive types work.
- **Yjs GitHub Issue 273** — multi-source undo merging behavior; informs the `stopCapturing()` recommendation.

### Tertiary (LOW confidence — flagged for plan-time validation)

- **No external benchmark numbers for `observeDeep` at 1000 annotations** — Phase 29 must measure during the 1000-stroke stress test in CI; expected sub-30% CPU per ARCHITECTURE.md §13 anti-pattern note, but unverified at this exact scale in this exact code shape.
- **Cross-tab undo behavior with same userId, different sessionId** — recommendation Path 1 (per-tab scope via origin tuple) is canonical Figma behavior; not verified against Yjs production reference.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Yjs trio already installed, version verified, locked by Phase 27.
- Architecture (one-direction-at-a-time bridge + memoized origin + per-mount registry): HIGH — locked by ARCHITECTURE.md, verified against Yjs source.
- Pitfall mitigations: HIGH — all four pitfalls have canonical Yjs primitives; mitigations verified in source.
- React integration (useSyncExternalStore + observeDeep): HIGH — canonical pattern with multiple production references.
- Per-word undo / eraser-swipe / mid-drag cancel exact algorithms: MEDIUM — pattern recommendations are sound but exact wiring is planner discretion (Claude's Discretion items in CONTEXT.md).
- Electron menu IPC channel design: MEDIUM — pattern is canonical Electron, exact channel name + file home is planner discretion.
- Plan decomposition (5 plans / 3 waves): HIGH — mirrors Phase 27/28 successful structure; surgical waivers are independent lanes.

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (Yjs is mature/stable; valid for 30 days. Re-verify if Yjs ships ^13.7.x or React ships 19.x with breaking useSyncExternalStore semantics.)

---

## RESEARCH COMPLETE
