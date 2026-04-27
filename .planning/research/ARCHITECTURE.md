# Architecture Research — v2.4 Multi-User Collaboration (CRDT Rebuild)

**Domain:** Real-time collaborative PDF annotation, retrofitted onto an existing single-user app
**Researched:** 2026-04-26
**Confidence:** MEDIUM-HIGH (Yjs ecosystem patterns: HIGH from official docs; integration specifics for this app's SVG/Fabric split: MEDIUM, validated against the existing source tree)

This document maps a CRDT collaboration layer onto the existing Survey-BetaSafeS2 codebase. The existing **SVG display + Fabric edit-on-demand** architecture is treated as load-bearing and immutable for this milestone — the CRDT layer is wrapped *around* it, not in place of it.

---

## 1. System Overview

### Where the new layer sits

```
┌──────────────────────────────────────────────────────────────────────┐
│  PRESENTATION (UNCHANGED — DO NOT TOUCH IN v2.4)                     │
│  ┌─────────────────────┐  ┌─────────────────────────────────────┐    │
│  │ SVGAnnotationLayer  │  │ FabricDrawingCanvas / Edit / Eraser │    │
│  │ (display, viewBox)  │  │ (mount-on-demand edit canvas)       │    │
│  └──────────┬──────────┘  └─────────────────┬───────────────────┘    │
│             │ reads JSON                    │ reads/writes JSON       │
└─────────────┼───────────────────────────────┼─────────────────────────┘
              │                               │
              ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  REACT STATE FAÇADE (UNCHANGED CONTRACT, NEW SOURCE)                 │
│  annotationsByPage   callouts   highlightAnnotations   selection     │
│  ▲                                                                    │
│  │ derived via useY(...) — useSyncExternalStore over Y.Doc           │
└──┼───────────────────────────────────────────────────────────────────┘
   │
┌──┴───────────────────────────────────────────────────────────────────┐
│  CRDT LAYER (NEW)                                                    │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐     │
│  │ Y.Doc per document   │   │ Awareness (ephemeral)            │     │
│  │  annotations: Y.Map  │   │  cursor, page, selection, tool   │     │
│  │   <id, Y.Map>        │   │  user (name, color, deviceId)    │     │
│  │  callouts:    Y.Map  │   └──────────────────────────────────┘     │
│  │   <id, Y.Map>        │                                            │
│  │  meta:        Y.Map  │   ┌──────────────────────────────────┐     │
│  │   docVersion, schema │   │ Y.UndoManager (per-origin)       │     │
│  └──────────┬───────────┘   │  origin = local clientId         │     │
│             │               └──────────────────────────────────┘     │
│             ▼                                                         │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐     │
│  │ y-indexeddb          │   │ Provider (transport)             │     │
│  │ (offline-first cache)│   │ Hocuspocus or HTTP+Realtime      │     │
│  └──────────────────────┘   └──────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────-┘
              │
┌─────────────┼─────────────────────────────────────────────────────────┐
│  PERSISTENCE (NEW SCHEMA, OLD SCHEMA RETAINED IN PARALLEL)           │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ doc_yjs_state (snapshots)│  │ doc_yjs_updates (append log)     │  │
│  │  document_id, state_vec, │  │  document_id, update bytea,      │  │
│  │  state bytea, updated_at │  │  client_id, ts, seq              │  │
│  └──────────────────────────┘  └──────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ document_annotations (LEGACY — still owns highlights, frozen    │ │
│  │ for non-highlights post-migration; one-way bridge during cutover│ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Status |
|---|---|---|
| `SVGAnnotationLayer.jsx` | Render annotations from React state. Reads `annotationsByPage` and `callouts` as plain JSON. | UNCHANGED. The display layer must not learn about Yjs. |
| `FabricDrawing/Edit/EraserCanvas.jsx` | Mount-on-demand mutable canvas. Emits commit-shaped Fabric JSON via existing callbacks. | UNCHANGED. Edits are still committed as Fabric JSON to React setters. |
| `App.jsx` state setters (`setAnnotationsByPage`, `setCallouts`) | The integration seam. After v2.4, these become **derived from Y.Doc**, not free-standing useState. | MODIFIED (one wire-up file, but the *contract* — the JSON shape — is preserved). |
| `useYDoc` (NEW) | Provides the Y.Doc for the currently open document. Owns lifecycle: create on open, destroy on close. Exposes `ydoc`, `awareness`, `provider`, `connectionState`. | NEW |
| `useAnnotationsCRDT` (NEW) | Subscribes to `annotations: Y.Map` and `callouts: Y.Map` via `useSyncExternalStore`, exposes the same `annotationsByPage` and `callouts` shape App.jsx already consumes. | NEW |
| `crdtAnnotationBridge.js` (NEW) | Pure module. Converts Fabric JSON ↔ Y.Map. One direction at a time, never both during a single transaction. | NEW |
| `crdtUndoManager.js` (NEW) | Wraps `Y.UndoManager`, scoped to local origin. Replaces the existing per-tool Fabric undo path. | NEW |
| `useAnnotationCloudSync.js` (LEGACY) | Currently owns push/pull for non-highlights via Supabase upserts. **DELETED** in v2.4 once cutover complete. | DELETED |
| `documentAnnotationService.js` (LEGACY) | Owns highlight rows. **STAYS** — highlights remain on the legacy path through v2.4, migrated in v2.5. | UNCHANGED |
| `cloudSyncMigration.js` (LEGACY) | One-time local→cloud Fabric-row migration. Replaced by `crdtBackfill.js`. | DEPRECATED post-cutover |

---

## 2. Y.Doc Placement in the React Tree

### Decision: a `YDocProvider` context at the document-open boundary, not at App root

Rationale: a Y.Doc is per-document. Mounting at App root forces destroy-and-recreate every time the user switches PDFs, which is the dominant navigation event in this app. Mounting at the boundary where `documentId` becomes non-null lets us treat the Y.Doc lifecycle as a hook driven by `documentId`, mirroring the current `useAnnotationCloudSync({ documentId })` shape.

```
<App>
  <DocumentRouter>           // resolves documentId from PDF open
    <YDocProvider docId={documentId} userId={userId}>
      <SyncfusionPDFContainer>
        <PageAnnotationLayer> // reads context via useYDoc + useAnnotationsCRDT
          <SVGAnnotationLayer />        // reads JSON shape, unchanged
          <FabricEditCanvas />          // reads/writes JSON shape, unchanged
        </PageAnnotationLayer>
      </SyncfusionPDFContainer>
    </YDocProvider>
  </DocumentRouter>
</App>
```

### Sharing between SVG display and Fabric edit

Critical constraint: **the SVG and Fabric layers must not learn about Yjs.** They consume `annotationsByPage` (per-page Fabric JSON arrays) and `callouts` (flat list) and emit commit-shaped JSON via setters. The `useAnnotationsCRDT` hook produces those exact shapes via `Y.Map.toJSON()` materialization, gated by `useSyncExternalStore` to avoid tearing.

**Read path:** `Y.Map.observeDeep` fires → external-store snapshot recomputed → `useAnnotationsCRDT` returns `{ annotationsByPage, callouts }` → SVG re-renders.

**Write path:** Fabric edit-canvas commits a JSON object → existing `setAnnotationsByPage(...)` callback is rewritten to call `crdtAnnotationBridge.applyFabricCommit(ydoc, fabricJson)` inside a Y transaction with `origin: localClientId`.

This preserves the existing Fabric/SVG split exactly. The only file that changes shape is the App.jsx wire-up where setters are bound — and even there, the *callbacks* preserve their signature.

---

## 3. Annotation → Y Type Mapping

### Each annotation = one Y.Map keyed by stable id

```
ydoc.getMap('annotations')     // Y.Map<string, Y.Map>
  ├── "ann_4f8c2..."  → Y.Map { id, type, pageNumber, fabric: Y.Map { left, top, ... }, meta: Y.Map { authorId, deviceId, createdAt, updatedAt } }
  ├── "ann_9a1e7..."  → Y.Map { ... }
  └── ...

ydoc.getMap('callouts')        // Y.Map<string, Y.Map>
  ├── "call_b3d10..." → Y.Map { id, pageNumber, anchor: Y.Map { x, y }, knee: Y.Map { x, y }, label, ... }
  └── ...

ydoc.getMap('meta')            // Y.Map
  ├── "schemaVersion" → "v2.4.0"
  └── "createdAt"     → 1714000000
```

### Why two top-level maps, not one

Callouts and Fabric annotations have meaningfully different shapes today (Fabric JSON vs `{anchor, knee, label}`) and different commit patterns (callouts are HTML-overlay-based pre-CALL-10; Fabric annotations are pure JSON). Keeping them in separate Y.Maps:
- mirrors the existing React state split (`annotationsByPage` vs `callouts`)
- lets us evolve the callout shape independently when CALL-10 lands
- means observers can subscribe to one map without churning on the other

After CALL-10 unifies callout rendering onto SVG, both maps still make architectural sense — they have different **identity semantics** (a callout's identity includes its anchor link to a Fabric shape; a pen stroke has no such link).

### Why per-annotation Y.Map, not per-page Y.Array

The existing `annotationsByPage` is a `{ [page]: { objects: Fabric[] } }` shape. The naive port is one Y.Array per page. **Don't do this** — it makes per-annotation operations (move, edit a single property) far harder to express as minimal CRDT updates and creates contention when two users edit different annotations on the same page. Instead, store annotations flat keyed by id and **derive `annotationsByPage`** in `useAnnotationsCRDT` by grouping on `pageNumber`. The grouping is O(n) on small n (a typical doc has <500 annotations) and runs once per change batch, not per render.

### Inside each annotation: shallow Y.Map of properties

Each annotation's Y.Map holds the Fabric properties as flat scalars (or one level of Y.Map for nested groups like callouts and counters). Pen-stroke `path` arrays go in as immutable JSON inside a single key — pen strokes are commit-once-then-edit-rarely; nested Y.Array for path points is overkill and would balloon the update size on every commit.

```
{
  id: "ann_4f8c2",
  type: "rect",            // Fabric type (used by SVG renderer dispatch)
  pageNumber: 6,
  fabric: {                // verbatim Fabric JSON, flat keys
    left: 100, top: 200, width: 80, height: 40,
    angle: 0, scaleX: 1, scaleY: 1, fill: "rgba(255,235,59,0.4)",
    stroke: "#000", strokeWidth: 2,
    data: { id: "ann_4f8c2", category: "egress", ... }
  },
  meta: {
    authorId: "user_abc", deviceId: "dev_def",
    createdAt: 1714000000, updatedAt: 1714000123,
    schemaVersion: "v2.4.0"
  }
}
```

The **outer** Y.Map enables atomic property-level merge (two users editing different properties of the same annotation merge cleanly). The **inner** `fabric` Y.Map is where Fabric edits land. The `meta` Y.Map is append-only metadata.

---

## 4. Fabric.js ↔ Y.Map Bridge

### One-directional translation at the commit boundary, never bidirectional during a drag

Fabric.js fires events at high frequency during drag (`object:moving` ~60Hz). Routing every tick into a Y transaction would saturate the awareness/sync channel. The current architecture **already** debounces this — Fabric edits live in the local mutable canvas and only commit on `mouseup`/blur/click-off. We preserve that boundary exactly.

### Read direction: Y.Map → Fabric (only on edit-canvas mount)

When `FabricEditCanvas` mounts to edit annotation `id`:
1. Read the current Y.Map snapshot for that id: `ydoc.getMap('annotations').get(id).toJSON()`
2. Hand the resulting Fabric JSON to Fabric.js `loadFromJSON` exactly as today
3. The mutable Fabric scene runs locally — no Y observers feed it during the edit session

If a remote user edits the same annotation while a local edit is open, **the local edit wins on commit** (last-write-wins at the property level via Y.Map's CRDT semantics, but the local user's choices are not interrupted mid-drag). Awareness UI surfaces that the remote user is editing the same shape — see §5.

### Write direction: Fabric commit → Y.Map (atomic transaction)

On `commit-and-unmount-fabric`:
```js
ydoc.transact(() => {
  const annMap = ydoc.getMap('annotations').get(id);
  const fabricMap = annMap.get('fabric');
  // Update only changed keys (computed via shallow diff vs. the map snapshot
  // captured at edit-canvas mount). DO NOT clear-and-set — that produces
  // larger update messages and breaks property-level merge.
  for (const key of changedKeys) fabricMap.set(key, newFabricJson[key]);
  annMap.get('meta').set('updatedAt', Date.now());
  annMap.get('meta').set('lastEditorId', userId);
}, /* origin = */ localClientId);
```

`origin: localClientId` is critical — `Y.UndoManager` uses it to scope undo to this user's edits.

### Create / delete

- **Create:** `ydoc.getMap('annotations').set(id, freshAnnotationYMap)` inside a transaction.
- **Delete:** `ydoc.getMap('annotations').delete(id)` inside a transaction. Y.Map handles tombstones; the SVG layer sees the id disappear from the materialized state and unmounts the shape.

### What the bridge module looks like

```js
// crdtAnnotationBridge.js — pure functions, no React, no Fabric instance
export function fabricJsonToYMap(ydoc, fabricJson, ctx) { /* build the Y.Map */ }
export function yMapToFabricJson(yMap)                  { return yMap.toJSON(); }
export function applyFabricCommit(ydoc, id, oldJson, newJson, ctx) { /* shallow diff + transact */ }
export function applyFabricCreate(ydoc, fabricJson, ctx)            { /* set new Y.Map */ }
export function applyFabricDelete(ydoc, id, ctx)                    { /* delete from map */ }
```

Pure functions are deliberate. They're trivially unit-testable without a React or Fabric runtime — the bridge is the most failure-prone piece, so isolating it pays off.

---

## 5. Awareness State

### Y.Awareness, not part of the Y.Doc

Awareness is **ephemeral** — it lives on the awareness CRDT, not in the persistent doc. It auto-cleans when a user disconnects.

### Local awareness fields

```js
awareness.setLocalStateField('user', {
  id: userId, name: displayName, color: deterministicColorFor(userId)
});
awareness.setLocalStateField('cursor', {
  pageNumber: currentPage, x: cursorX, y: cursorY  // PDF page coordinates
});
awareness.setLocalStateField('selection', {
  annotationId: selectedAnnId || null
});
awareness.setLocalStateField('tool', {
  active: 'pen' | 'rect' | 'select' | null
});
awareness.setLocalStateField('editingAnnotationId', editingId || null);
```

`editingAnnotationId` is the key one — it's how other users' UI knows to show "Alice is editing this rectangle" without blocking the local edit. It's also how the local edit can detect a contention situation (another user is mid-edit on the same annotation) and surface a soft warning in the mini-toolbar.

### Throttling

Cursor updates fire on `mousemove` — naive forwarding would be ~60Hz per user. Throttle to **30Hz** in production (33ms), **5Hz** for selection/tool/editingAnnotationId (those don't need to be smoother than `requestAnimationFrame`).

### Where awareness state is consumed

| Consumer | Reads awareness field | Renders |
|---|---|---|
| `RemoteCursorOverlay` (NEW) | `cursor` from all peers | SVG ghost cursor per peer, page-scoped |
| `PresenceAvatarsRow` (NEW; replaces `useDocumentPresenceList`) | `user` from all peers | Stacked avatars next to sync chip |
| `RemoteSelectionHighlight` (NEW) | `selection` from all peers | Coloured outline on annotations selected by others |
| `MiniToolbar` (MODIFIED) | `editingAnnotationId` from all peers | Soft warning when another peer is editing the same annotation |

The existing `document_presence` Postgres table and `useDocumentPresenceList` hook **become redundant** once awareness ships. Plan: keep the table during cutover, delete after v2.4 ships.

---

## 6. Supabase Transport — Decision Matrix

### Three options were on the table

| Option | What it is | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Supabase Realtime + binary blob in Postgres** (`y-supabase`-style) | Existing Supabase Realtime broadcasts updates; Postgres holds state vector + snapshot blob | Reuses existing Supabase Auth + RLS; zero new infra; matches current billing model | y-supabase is explicitly "not production-ready" per maintainer. Realtime broadcast wasn't designed for binary CRDT updates and has had reported "too many message events" issues at scale. | NOT RECOMMENDED |
| **B. Supabase as append-only update log + Realtime as notify channel** | Postgres `doc_yjs_updates` table with one row per update; Realtime fires on insert; client pulls new updates by seq | Reuses Supabase infra; fits existing RLS model; simple to reason about; survives offline (clients pull by seq on reconnect) | Higher write volume than blob-only; needs periodic compaction (collapse N updates into a snapshot); no automatic awareness channel — must reuse Realtime presence | RECOMMENDED for v2.4 |
| **C. Hocuspocus self-hosted Yjs server** | Standalone WebSocket server, Postgres for storage, Supabase Auth for JWT-gated auth handshake | Battle-tested; built-in awareness; built-in role-based read-only enforcement; Supabase Auth integration documented (`onAuthenticate` parses Supabase JWT) | New service to deploy, monitor, scale; new failure mode independent of Supabase outages; offline-first requires `y-indexeddb` regardless | RECOMMENDED for v2.5+ if scale demands it |

### Recommended: Option B for v2.4

Reasoning specific to this app:

1. **Billing model.** The app is a per-seat tool for engineering firms. Active concurrent collab sessions per document are typically 2–5, not 50. Hocuspocus's value (scaling to thousands of concurrent editors per doc) is overkill.

2. **Offline-first.** Engineers use this on job sites with flaky connectivity. The y-indexeddb provider already covers offline; the transport layer just needs to flush queued updates on reconnect. Append-only log fits this naturally — a client on reconnect asks "give me everything since seq N" and replays.

3. **RLS reuse.** The existing `document_collaborators` table + `user_can_access_document(doc_id, role)` function already gates read/write access per document. The new tables (`doc_yjs_updates`, `doc_yjs_state`) reuse the same gating — RLS does the work, no new auth logic on the transport.

4. **Migration cost.** Option B is ~400 LOC of new code and one `useYDoc` provider. Option C is that plus a Hocuspocus deployment, monitoring, and a fallback story when Hocuspocus is down but Supabase is up.

5. **Escape hatch.** If Option B hits a scaling wall, we swap the transport behind the same `useYDoc` interface. The Y.Doc, awareness, and bridge layers don't change — only the provider does. Cost of migration B→C is bounded.

### Schema for Option B

```sql
-- Append-only update log (the source of truth for deltas)
CREATE TABLE doc_yjs_updates (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,                -- Y.Doc clientID (per-tab)
  seq         BIGINT NOT NULL,              -- per-document monotonic
  update      BYTEA NOT NULL,               -- binary Yjs update
  origin      TEXT,                         -- userId / deviceId for audit
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON doc_yjs_updates (document_id, seq);

-- Periodic compaction snapshot (so new joiners don't replay the entire log)
CREATE TABLE doc_yjs_state (
  document_id   UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state         BYTEA NOT NULL,             -- encoded Y.Doc state
  state_vector  BYTEA NOT NULL,             -- for delta sync
  through_seq   BIGINT NOT NULL,            -- updates up to this seq are in `state`
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: same pattern as document_annotations — gated by user_can_access_document
ALTER TABLE doc_yjs_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_yjs_state   ENABLE ROW LEVEL SECURITY;
-- (Policies omitted for brevity — they mirror the existing 4-policy pattern.)
```

Compaction job: a Postgres function or scheduled edge function that periodically reads updates beyond `through_seq`, applies them to the snapshot, writes a new snapshot row, and either deletes or archives consumed update rows. v2.4 ships without compaction (acceptable for small docs); compaction is a v2.4.x follow-up.

---

## 7. Auth & RLS Translation

### Supabase Auth still gates every read/write

No new auth handshake on the transport. The Supabase JS client already attaches the user JWT to every request — including the Realtime subscription. The new tables (`doc_yjs_updates`, `doc_yjs_state`) get RLS policies that gate on `user_can_access_document(document_id, 'editor')` for INSERT/UPDATE/DELETE and `'viewer'` for SELECT. Existing helper function reused unchanged.

### Document-collaborator model stays put

`document_collaborators` (owner / editor / commenter / viewer) → translates to:
- **viewer:** can SELECT updates and snapshots, can read awareness, **cannot** insert updates. Y.Doc loaded read-only on client; the bridge guards writes.
- **commenter:** identical to viewer for v2.4 (no comment system yet — future milestone).
- **editor / owner:** full read + write of updates and snapshots; full awareness.

### What Hocuspocus would change (Option C reference)

If/when Option C ships, the auth handshake adds an `onAuthenticate(token)` server hook that verifies the Supabase JWT against the Supabase JWKS endpoint, looks up the user's role in `document_collaborators`, and sets `connection.readOnly = true` for non-editors. Documented pattern — reference: Emergence Engineering's Hocuspocus + Supabase guide. Roughly 100 LOC.

---

## 8. Legacy Highlights — Stay Out of the Y.Doc for v2.4

`highlightAnnotations` is a separate React state slice with its own legacy sync path through `documentAnnotationService.js` and dedicated columns (`color`, `opacity`, `name`, `notes`, `category_id`, `module_id`, `space_id`, `checklist_responses`, `ball_in_court_*`). The highlights schema is heavily survey-specific and is **read by the Excel sync subsystem** (`excelGraphService.js`, `excelSessionService.js`) — touching it would cascade into every survey export.

### Decision: highlights stay on the legacy path through v2.4

Rationale:
- v2.4 is already a major architectural lift. Folding highlights in would double the surface area and introduce Excel-sync risk.
- Highlights are the **least real-time-collaborative** annotation type — they're survey items with structured metadata, not free-form drawings. The pain point that justifies CRDT (concurrent free-form edits losing data) doesn't bite here.
- A v2.5 milestone migrates highlights into the Y.Doc as `ydoc.getMap('highlights')`, with a separate one-way bridge from the legacy table during cutover.

**Architectural cost:** the React state has three sources of truth (`annotationsByPage` ← Y.Doc, `callouts` ← Y.Doc, `highlightAnnotations` ← Supabase Realtime via legacy hook). Documented as a known seam; the SVG layer already handles all three uniformly.

---

## 9. Boot Sequence (Document Open)

```
1. User clicks PDF → documentId resolved
2. <YDocProvider> mounts → constructs new Y.Doc (in-memory)
3. y-indexeddb provider attaches → asynchronously hydrates Y.Doc
   from IndexedDB (offline-first; if there's a cached state, it shows
   immediately, even before the network round-trip)
   ╠═ HAZARD A: SVG layer mounting before y-indexeddb finishes hydration
4. Transport provider attaches → sends state vector to server, server
   sends back encoded state diff (or full snapshot if first load)
   ╠═ HAZARD B: server's snapshot conflicts with indexeddb's local
       snapshot from another device (e.g. user added marks on phone offline,
       opens laptop online — both have unsynced state). Y.Doc merges both
       deterministically; no special handling needed, but the user may
       briefly see annotations "appear" as the server delta lands.
5. Awareness provider attaches → broadcasts local user state, receives peers' states
6. SVG renders from current Y.Doc materialization
7. User starts an edit → FabricEditCanvas mounts, reads current Y.Map snapshot
8. Edit committed → Y.transact writes back to Y.Map
9. Local Y observer fires → React state recomputed → SVG re-renders
10. Transport provider broadcasts the update → peers' Y.Docs receive it
```

### Concurrency hazards & mitigations

**Hazard A — SVG renders empty during hydration.** `useAnnotationsCRDT` returns `{ annotationsByPage: null, callouts: null, isHydrating: true }` while y-indexeddb is loading. SVG layer treats null as "skip render" (matches existing `isHydrating`-from-cloud-sync check, just renamed). Once hydrated, switches to the materialized state.

**Hazard B — server delta arrives mid-edit.** The local user is editing annotation X in Fabric. Server delta updates annotation X from a remote peer. Resolution: Y.Map merges the remote update into the persistent state. The local Fabric canvas does **not** see it — Fabric is editing a *snapshot* taken at mount time, not a live observer. On commit, the local edit wins for any property the local user changed; remote changes to *other* properties survive (Y.Map property-level merge). Edge case: both users changed the same property. Local commit wins (last-write-wins with `updatedAt` tiebreaker logged in `meta`). Acceptable for v2.4; this is documented in PITFALLS.md.

**Hazard C — y-indexeddb writes during a Y.transact.** y-indexeddb subscribes to `update` events on the Y.Doc and writes asynchronously. Safe — writes happen post-transaction, doesn't block the React render. No mitigation needed.

**Hazard D — Auth token expiring mid-session.** Supabase JS client auto-refreshes access tokens. The Realtime channel survives refresh as of supabase-js v2.x. Validated. Failure mode: token *revoked* (user signed out elsewhere) → channel disconnects → provider goes into retry-with-backoff. Awareness drops, edits queue locally in y-indexeddb, replay on reconnect.

**Hazard E — Two tabs of the same user.** Each tab has its own Y.Doc clientID. Tabs sync via the transport like any other peer. Awareness shows the user as two presences (acceptable; Figma does the same). Cross-tab via BroadcastChannel is a v2.5 polish.

---

## 10. Undo/Redo

### Y.UndoManager scoped to local origin replaces Fabric's undo

```js
const undoManager = new Y.UndoManager(
  [ydoc.getMap('annotations'), ydoc.getMap('callouts')],
  { trackedOrigins: new Set([localClientId]) }
);
```

`trackedOrigins` is the key — it's how undo is per-user. Only operations originated by this user's client are tracked. A remote user's edits move through the doc but don't push onto this user's undo stack.

### What changes vs today

The current Fabric undo lives inside `useFabricCanvas` and the per-tool commit hooks (the existing `fabric-history`-style pattern). v2.4 **replaces** this — undo is now at the CRDT layer, not the Fabric layer. Reason: Fabric undo only knows about operations on the local Fabric canvas instance, which mounts and unmounts per edit. Cross-edit undo (undo my last action even if it was on a different annotation) is broken in the current model and gets fixed for free by Y.UndoManager.

Wrapping pattern:
- Existing `Cmd+Z` keyboard handler in App.jsx → call `undoManager.undo()`
- Existing `Cmd+Shift+Z` → `undoManager.redo()`
- Inside `FabricEditCanvas` during an open edit session, **local undo is disabled** — there's no "undo a sub-step of an in-progress edit" in this app. The Fabric edit canvas is a transactional unit; commit is the undo granularity.

### Capture stops & coalescing

- `captureTimeout` (default 500ms) coalesces rapid-fire transactions into one undo step. Default is fine for typing but the app's commits are already debounced at the Fabric layer, so each `commitFabric` produces one Y transaction → one undo step → matches user expectation.
- `stopCapturing()` called explicitly after each commit ensures multi-property edits in one drag don't split into many undo steps.

### Edge case: undoing a delete

Y.UndoManager handles tombstone resurrection automatically. No special handling for "undo the deletion of an annotation" — the Y.Map.delete is reversed and the annotation reappears with all properties intact.

---

## 11. Migration Path for Existing Rows

Six months of existing `document_annotations` rows must enter the new CRDT world without data loss.

### Strategy: one-time per-document backfill at first open under v2.4

```
On document open under v2.4 client:
  1. Check if doc_yjs_state row exists for this documentId.
     YES → load it as the initial Y.Doc state. Done.
     NO  → backfill:
       a. SELECT * FROM document_annotations WHERE document_id = X
            AND annotation_type IN <NON_HIGHLIGHT_TYPES>
       b. For each row, deserialize via existing
          deserializeRowToFabricObject (annotationTypeSerializers.js — REUSE)
       c. Build a fresh Y.Doc, populate ydoc.getMap('annotations') and
          ydoc.getMap('callouts') with one Y.Map per row
       d. Encode and INSERT into doc_yjs_state
       e. Mark the source rows with `migrated_to_crdt = TRUE` (new column)
          so they are not re-imported by a stale client
  3. Continue boot sequence from step 4 above.
```

### Why server-side, not client-side

The naive approach is "first client to open the doc under v2.4 does the import." This has a race condition — two clients open simultaneously, both run the import, both write to `doc_yjs_state` with conflicting initial Y.Doc client IDs. Solutions:

**Option α (RECOMMENDED):** A Postgres function `crdt_backfill_document(doc_id UUID)` called via RPC. Wrapped in a transaction with `SELECT ... FOR UPDATE` on the documents row. Does the backfill server-side, returns the encoded state. Client just inserts into `doc_yjs_state` if missing.

But — Y.Doc encoding is JS-only (yjs is npm, not pgsql). So Option α actually means: the first client that opens the doc grabs an advisory lock (`SELECT pg_try_advisory_lock(hashtext(doc_id))`), runs the backfill in JS, releases. Other clients waiting on the lock retry-and-find-state-now-exists. ~50 LOC of provider logic.

**Option β:** Cloud Function (Supabase Edge Function) does the backfill on document creation — but that doesn't cover the existing 6 months of data. Edge function on first-open-under-v2.4 with the same advisory-lock pattern works.

Either way: the source rows are kept (NOT deleted) as a recovery fallback for v2.4.0 → v2.4.x. Once we're confident no client is silently losing data, drop them in v2.5.

### Highlights are skipped

Backfill filters `annotation_type` = NON_HIGHLIGHT_TYPES (per existing `loadAllNonHighlightAnnotations`). Highlights stay on legacy path; see §8.

### Local-storage marks (the case `cloudSyncMigration.js` handles today)

After the first Y.Doc backfill, run a v2.4 equivalent of `cloudSyncMigration`:
```
For each pdfId in localStorage[annotationsByPage_*]:
  if there's a documentId mapping AND backfill has run for it:
    diff localStorage rows against current Y.Doc state
    for any local annotation NOT in the Y.Doc, write it as a new Y.Map
    mark the migration done with an updated key
    (DON'T delete localStorage — it's the offline-first cache now,
    handled by y-indexeddb going forward)
```

### Schema migration table

```sql
ALTER TABLE document_annotations ADD COLUMN migrated_to_crdt BOOLEAN DEFAULT FALSE;
CREATE INDEX ON document_annotations (document_id, migrated_to_crdt) WHERE NOT migrated_to_crdt;
```

After v2.4 ships and is verified, a maintenance job can mark all non-highlight rows `migrated_to_crdt = TRUE` for documents whose `doc_yjs_state` exists.

---

## 12. Build Order

Topological dependencies force this order:

### Phase A — CRDT round-trip in isolation (single user, no collab)

1. **YDocProvider + useYDoc**: bare Y.Doc lifecycle keyed on documentId. No transport. y-indexeddb only.
2. **crdtAnnotationBridge.js**: pure functions, fully unit-tested.
3. **useAnnotationsCRDT**: useSyncExternalStore over Y.Doc. Returns the same `{ annotationsByPage, callouts }` shape App.jsx already consumes.
4. **App.jsx wire-up**: replace the existing free-standing useState for these two slices with the hook output. Setters are rewired to call the bridge inside Y.transact.
5. **Disable** `useAnnotationCloudSync` behind a feature flag.

**Acceptance:** A user makes annotations, closes the tab, reopens. Annotations come back via y-indexeddb. SVG and Fabric edit work exactly as before. Zero regression on single-user UX.

**Why first:** every later phase depends on the bridge working. Shipping it without transport derisks the most failure-prone piece in isolation.

### Phase B — Backfill of existing rows

6. **crdtBackfill.js**: server-side advisory-locked import of `document_annotations` rows into Y.Doc. Hooked into YDocProvider's first-open path.
7. **doc_yjs_state schema migration**: new tables (no policies yet — single-user only).
8. **Local-storage migration shim**: equivalent to `cloudSyncMigration.js` for the v2.4 model.

**Acceptance:** A user with existing annotations from v2.3 opens a doc under v2.4. All annotations appear; no duplicates; localStorage marks are preserved.

**Why second:** Phase A has no production users — Phase B is what makes Phase A safe to deploy to existing users.

### Phase C — Multi-device single-user sync (transport, no collab UI)

9. **doc_yjs_updates schema + RLS policies** (full RLS, gated on document_collaborators).
10. **Custom Yjs provider** that wraps Supabase Realtime + INSERT-into-doc_yjs_updates pattern.
11. Hook the provider into YDocProvider.

**Acceptance:** Same user, two devices, edits made on device A appear on device B within ~1s. Echo-filter prevents the originating device from re-applying its own updates. Offline edits replay on reconnect.

**Why third:** transport without collab UI is testable as "my own annotations sync between my laptop and phone." If this works, multi-user collab is structurally identical — the only difference is the user_id on the other end.

### Phase D — Awareness (presence, cursors, selection)

12. **Awareness wired through the provider**: setLocalStateField for user, cursor, page, selection, tool, editingAnnotationId. Throttled.
13. **RemoteCursorOverlay** (new SVG component, page-scoped).
14. **PresenceAvatarsRow** (replaces useDocumentPresenceList).
15. **RemoteSelectionHighlight** (outline annotations selected by other peers).
16. **MiniToolbar contention warning** when editingAnnotationId collides.

**Acceptance:** Two users on the same doc see each other's cursors, page changes, selection. Edits from one are visible to the other within the transport latency.

**Why fourth:** awareness is real-time UX polish. It doesn't gate the data integrity of multi-user collab — that was settled in Phase C. Awareness is independently shippable and deferrable if Phase C runs long.

### Phase E — Y.UndoManager replaces Fabric undo

17. **crdtUndoManager.js**: wraps Y.UndoManager scoped to local origin.
18. **App.jsx Cmd+Z / Cmd+Shift+Z handlers** rewire to undoManager.
19. **Remove the existing fabric-history undo path** from useFabricCanvas and per-tool commit hooks.

**Acceptance:** Cmd+Z on user A only undoes user A's actions, even when user B is editing simultaneously. Cross-annotation undo (undo last action on annotation X, then last action on annotation Y) works correctly.

**Why fifth:** undo migration is the most behaviorally risky change for existing single-user UX (long-term users have muscle memory for the current undo behavior). Shipping last lets us roll back independently if user reports surface.

### Phase F — Decommission legacy non-highlight sync path

20. Delete `useAnnotationCloudSync.js`, `annotationCloudSync.js`, `cloudSyncMigration.js`, `cloudSyncQueue.js`.
21. Delete `useDocumentPresenceList.js` (replaced by awareness).
22. Drop the `document_presence` table in a follow-up migration (after a full release cycle of awareness in production).

**Acceptance:** Tree is clean of dual-sync code. Highlights remain on legacy path (intentional; v2.5 problem).

**Why last:** removal must follow proven-in-production. Don't delete the safety net before the parachute is verified.

### Build order summary

```
A (single-user CRDT)       — derisks the bridge
  → B (backfill)           — derisks the data migration
    → C (transport)        — derisks the sync protocol
      → D (awareness)      — adds collab UX
      → E (undo)           — replaces undo (parallel to D, ships independently)
        → F (cleanup)      — removes legacy paths
```

D and E can ship in either order or in parallel; they don't depend on each other. The strict prerequisite is A → B → C, then D/E in either order, then F.

---

## 13. Anti-Patterns (Specific to This Migration)

### Anti-Pattern 1: Per-page Y.Array for annotations

**What people do:** Mirror `annotationsByPage[page].objects` directly as `Y.Map<page, Y.Array>`.
**Why it's wrong:** Edits to a single annotation become array splice operations, which produce larger CRDT updates than property-level merge. Two users editing different annotations on the same page contend on the array.
**Do this instead:** Flat `Y.Map<id, Y.Map>` with derived `annotationsByPage` grouping in the React hook.

### Anti-Pattern 2: Bidirectional Fabric ↔ Y observer during a drag

**What people do:** Subscribe a Fabric canvas to Y.Map updates so remote edits show up live during local editing.
**Why it's wrong:** Fabric's mutable instance fights with Y's transaction model; conflict resolution becomes ambiguous; UI flickers if the remote update lands mid-drag.
**Do this instead:** One-direction-at-a-time. Y → Fabric only on edit-canvas mount. Fabric → Y only on commit. Awareness handles "another user is editing this" UX.

### Anti-Pattern 3: Rolling your own awareness via Postgres rows

**What people do:** Continue using `document_presence` rows + `useDocumentPresenceList` polling for cursor positions.
**Why it's wrong:** Postgres-backed presence has 30s staleness and saturates RLS read load. Y.Awareness is purpose-built for this — sub-100ms latency, zero DB writes, auto-cleanup.
**Do this instead:** Use Y.Awareness via the same provider as the Y.Doc. Drop the `document_presence` table.

### Anti-Pattern 4: Storing pen-stroke point arrays as Y.Array

**What people do:** Pen strokes have hundreds of {x,y} points; modeling each as a Y.Array element seems "more granular."
**Why it's wrong:** Pen strokes are commit-once-edit-rarely. Granular CRDT structure for points balloons the update size by 10–100x with zero collaborative benefit (no two users edit the same pen stroke's interior).
**Do this instead:** Pen-stroke `path` is an opaque JSON blob inside the annotation's Y.Map. The annotation's *position, scale, rotation* are mergeable scalars; the stroke geometry is atomic.

### Anti-Pattern 5: Hocuspocus on day one

**What people do:** Reach for the "production" sync server immediately because Yjs docs feature it heavily.
**Why it's wrong:** Adds operational complexity (a service to deploy, scale, and monitor) before scale demands it. Splits the auth model — JWT verification on Hocuspocus *and* RLS on Postgres for non-Yjs data.
**Do this instead:** Phase C lands a thin Supabase-Realtime-backed provider. If/when scale forces it, swap providers behind the same `useYDoc` interface; the rest of the app doesn't notice.

---

## 14. Integration Points Summary

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| Supabase Auth | Existing JWT, attached automatically by supabase-js to all requests including the new Yjs transport. | No change. Token refresh handles expiry automatically. |
| Supabase Realtime | Notify channel for new `doc_yjs_updates` rows. Client pulls by seq on receipt. | Reuses existing per-document channel pattern from `useAnnotationCloudSync`. |
| Supabase Postgres | New tables: `doc_yjs_updates` (append log), `doc_yjs_state` (snapshot). RLS gated by existing `user_can_access_document`. | Existing `document_annotations` table preserved during cutover, deprecated for non-highlights post-v2.4. |
| y-indexeddb | Browser IndexedDB persistence for the Y.Doc. Standard Yjs provider, no custom code. | Becomes the primary local persistence; localStorage paths deprecated. |
| Electron renderer | Shares the same Y.Doc lifecycle as browser. IndexedDB exists in Electron renderer; works unchanged. | No special handling. |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| App.jsx ↔ useAnnotationsCRDT | Hook returns `{ annotationsByPage, callouts, isHydrating }`. App.jsx setters call bridge. | The contract is identical to today; only the implementation moves. |
| useAnnotationsCRDT ↔ Y.Doc | `observeDeep` + `useSyncExternalStore`. Snapshot recomputed on every change batch. | Avoid React tearing via useSyncExternalStore. |
| Y.Doc ↔ FabricEditCanvas | Snapshot-on-mount, commit-on-unmount via crdtAnnotationBridge. **No live observer during edit.** | Preserves existing Fabric/SVG split. |
| Y.Doc ↔ SVGAnnotationLayer | Indirectly via useAnnotationsCRDT → React state → SVG props. SVG never knows about Y. | Display layer remains pure-functional w.r.t. JSON. |
| Y.Awareness ↔ presence UI | New components subscribe to awareness `change` events. | Replaces `useDocumentPresenceList`. |
| Y.UndoManager ↔ App.jsx | Cmd+Z/Cmd+Shift+Z keyboard handlers. | Replaces existing per-tool undo. |
| Bridge ↔ Y.transact | Every mutation through the bridge wraps in `ydoc.transact(fn, localClientId)`. | `localClientId` is the undo-scope key. |

---

## 15. Confidence & Sources

**HIGH confidence (Yjs ecosystem fundamentals — official docs):**
- Y.Map / Y.Doc / observeDeep / transact API
- Y.Awareness API and ephemeral semantics
- Y.UndoManager trackedOrigins-based per-user scoping
- y-indexeddb provider behavior

**MEDIUM confidence (community-validated patterns):**
- useSyncExternalStore for Y.Doc → React (react-yjs library implements this, multiple production apps use it)
- Hocuspocus + Supabase Auth integration (one well-documented blog post; battle-tested elsewhere but not in this exact stack)
- Append-only update log + Realtime notify pattern (standard in non-Yjs CRDT work; sound but not a copy-paste reference)

**LOW confidence (this app's specific tradeoffs):**
- Migration of 6 months of `document_annotations` rows without race conditions — needs validation in Phase B
- Performance of useSyncExternalStore + observeDeep on a doc with 500+ annotations — needs benchmark in Phase A; expected fine, but not measured
- Whether y-indexeddb in Electron renderer behaves identically to browser — should, but not verified in this codebase

### Sources

- [Yjs Documentation — Awareness & Presence](https://docs.yjs.dev/getting-started/adding-awareness)
- [Yjs Documentation — Y.UndoManager](https://docs.yjs.dev/api/undo-manager)
- [Yjs Documentation — Y.Map](https://docs.yjs.dev/api/shared-types/y.map)
- [react-yjs: useSyncExternalStore + observeDeep pattern](https://github.com/nikgraf/react-yjs)
- [Tag1 — Why awareness is essential for collaborative applications](https://www.tag1consulting.com/blog/yjs-deep-dive-part-3)
- [Hocuspocus + Supabase Auth integration guide](https://emergence-engineering.com/blog/hocuspocus-with-supabase)
- [y-supabase provider (reference, NOT recommended for production)](https://github.com/AlexDunmow/y-supabase)
- [Hocuspocus GitHub](https://github.com/ueberdosis/hocuspocus)
- [PowerSync — Postgres + Yjs CRDT pattern](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync)
- Existing codebase audit: `src/hooks/useAnnotationCloudSync.js`, `src/services/annotationCloudSync.js`, `src/services/documentAnnotationService.js`, `src/services/cloudSyncMigration.js`, `src/services/annotationTypeSerializers.js`, `supabase/migrations/2024–2026 *.sql`

---

*Architecture research for: v2.4 Multi-User Collaboration*
*Researched: 2026-04-26*
