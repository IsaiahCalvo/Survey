# Callout Persistence Audit — 2026-06-06

**Scope:** Definitively confirm or refute that callouts are fully persisted by
the NEW engine (annotationDocStore / annotationDocSync / useAnnotationDoc) and
no longer touch the OLD engine (documentAnnotationService / annotationCloudSync
/ document_annotations table).

---

## 1. Where Callouts Are Created/Edited and Where State Lives

**Creation/Edit sites:** Callouts are created and edited inside `PDFViewer.jsx`.
The React state slice is `const [callouts, setCallouts] = useState([])` declared
at line 3306. A guarded setter `setCalloutsIfPersistedChanged` (line 3309)
wraps `setCallouts` so only persisted-field changes trigger re-renders.

A `calloutsRef` (line 921) mirrors the state synchronously; it is used in
history snapshots at line 9708 (`callouts: JSON.parse(JSON.stringify(calloutsRef.current || []))`),
in the history restore at line 9744 (`setCalloutsIfPersistedChanged(restoredCallouts)`),
and in the overlay render loop at line 1955 (`callouts: proxyCallouts`).

**Data shape:** Each callout is a document-level object (`{ id, pageNumber, anchor, knee, label, ... }`).
It does NOT live inside `annotationsByPage`. Callouts are a separate flat array
keyed only by `pageNumber` for render filtering.

---

## 2. Does the NEW Engine Capture Callout Changes?

**YES — with complete evidence.**

### Storage location in the Y.Doc

Callouts are stored in `doc.getMap('annoMeta')` (the `META_MAP` constant in
`src/services/annotationDocStore.js` line 23) under a stable string key
`'calloutsList'` (the `CALLOUTS_KEY` constant in `src/hooks/useAnnotationDoc.js`
line 20). They are NOT stored in `doc.getMap('annotations')` (the per-annotation
flat map). This is the explicit document-level coarse-value path:

- **Write:** `setMetaValue(doc, 'calloutsList', calloutArray, 'local')`
  (annotationDocStore.js line 54–59). The function does a full JSON compare
  (`stableStringify`) and emits a Yjs update ONLY when the value actually
  changed.
- **Read:** `getMetaValue(doc, 'calloutsList')` → `doc.getMap('annoMeta').get('calloutsList')`
  (annotationDocStore.js line 46–48).

### Capture effect in useAnnotationDoc.js

Lines 115–120 are the callout capture effect:

```js
// Capture callout changes (coarse whole-list; no-op when unchanged).
useEffect(() => {
  const h = handleRef.current;
  if (!h || !readyRef.current) return;
  h.setMeta(CALLOUTS_KEY, callouts);
}, [callouts]);
```

Every time `callouts` changes in React, `handle.setMeta('calloutsList', callouts)`
fires — which calls `setMetaValue` in the store, which calls `doc.transact()`
only when the value differs. That Yjs update is then picked up by the
`doc.on('update', ...)` observer in `annotationDocSync.js` (lines 152–167) and
appended to the `annotation_updates` WAL and scheduled for a snapshot to
`annotation_snapshots`.

### Hydration path

On open (useAnnotationDoc.js lines 74–89):

```js
const storeCallouts = handle.getMeta(CALLOUTS_KEY);
const hasCallouts = Array.isArray(storeCallouts) && storeCallouts.length > 0;

if (count > 0 || hasCallouts) {
  // Durable store wins — paint from it.
  if (count > 0) setAnnotationsByPage(storeByPage);
  if (hasCallouts) setCallouts(storeCallouts);
} else {
  // Empty store: seed it with whatever the viewer already holds.
  const curCallouts = calloutsRef.current;
  if (Array.isArray(curCallouts) && curCallouts.length > 0)
    handle.setMeta(CALLOUTS_KEY, curCallouts);
}
```

**Callouts come back exclusively from the new engine's snapshot+tail on reopen.**
The `hydrateDoc` function (annotationDocStore.js lines 180–189) applies the
snapshot bytes then the tail of `annotation_updates` rows — the `annoMeta` map
is part of the Y.Doc state, so `calloutsList` is restored through the exact same
path as `annotations` map entries.

### Remote-change propagation

When a remote op arrives (annotationDocSync.js line 317, `notifyChange(state)`),
the listener in useAnnotationDoc.js (lines 67–72) reads the `annoMeta` map:

```js
handle.onChange((byPage) => {
  setAnnotationsByPage(byPage);
  const c = handle.getMeta(CALLOUTS_KEY);
  if (Array.isArray(c)) setCallouts(c);
});
```

This surfaces callout updates from other devices into React state.

---

## 3. Does Any Old-Engine Path Still Read or Write Callouts?

### useAnnotationCloudSync — DISABLED, but code path still exists

In `PDFViewer.jsx` lines 15654–15663, `useAnnotationCloudSync` is called with
`enabled: false, hydrateEnabled: false`:

```js
} = useAnnotationCloudSync({
  documentId: pdfFile?.id || null,
  ...
  callouts,
  setCallouts,
  enabled: false,
  hydrateEnabled: false
});
```

The hook's comment at line 15648 is explicit: *"Legacy cloud sync — its annotation
HYDRATE + PUSH are retired by the Yjs source-of-truth rebuild (kept inert here
only for its status return)".*

**Effect of `enabled: false`:**
- The hydrate effect (line 1016): guarded by `if (!hydrateEnabled || ...)` — does not run.
- The callout push effect (line 2332): guarded by `if (!enabled || ...)` — does not run.
- The realtime subscription effect (line 2766): guarded by `if (!enabled || ...)` — does not subscribe.
- The queue drain effect (line 3313): guarded by `if (!enabled || ...)` — does not run.

No old-engine callout read or write executes at runtime.

### documentAnnotationService.js

Zero callout references. The service is survey-marker-only; callouts were never
wired into it.

### annotationCloudSync.js (old engine service)

`upsertCallouts` (lines 344–383) writes to `document_annotations` (the old
engine table). But this function is only called from within `useAnnotationCloudSync`,
which is now `enabled: false`. There are no other call sites.

The `subscribeToAllNonSurveyMarkerAnnotations` subscription (which has callout
realtime callbacks `onCalloutInsert`, `onCalloutUpdate`, `onCalloutDelete`) is
also inside `useAnnotationCloudSync` and gated by `enabled: false` — it never
subscribes.

### YDocProvider.jsx

Zero callout references in the file. YDocProvider is a Phase 27–31 CRDT provider
that owns the `phase30Ydoc` for `annotationsByPage` and the `callouts` Y.Map
within that same doc. However this Y.Map is `phase30Ydoc.getMap('callouts')` —
DIFFERENT from the new engine's `annoflat:<documentId>` Y.Doc
`doc.getMap('annoMeta').get('calloutsList')`. YDocProvider's callouts Y.Map is
only written by `fanOutCrdtForCallouts` inside `useAnnotationCloudSync`, which
is disabled.

### snapshotStore.js

`writeByPageSnapshot` / `readByPageSnapshot` (snapshotStore.js lines 103, 139)
handle `{ byPage, callouts }`. This is the row-sourced fast-open snapshot written
by `useAnnotationCloudSync`'s hydrate path — again gated by `hydrateEnabled: false`.
The new engine's snapshot path (annotationDocSync.js `writeSnapshot`) uses the
Y.Doc state directly via `Y.encodeStateAsUpdate(doc)` which includes `annoMeta`.
The snapshotStore is NOT part of the new engine path for callouts.

### crdtBackfill.js

Backfill reads callout rows from `document_annotations` using
`NON_HIGHLIGHT_TYPES_FOR_BACKFILL` (which includes `'callout'` at line 50), but
imports them via `deserializeRowDefensive` + `applyFabricCreate` into
`ydoc.getMap('annotations')` (line 659, the `phase30Ydoc`). This is the
Phase 27–31 legacy-CRDT migration path. It does NOT write to the new engine's
`annoflat:<id>` Y.Doc `annoMeta` map.

---

## 4. Hydrate Path — Where Callouts Come From on Reopen

On reopen, callouts come from the **new engine only**:

1. `openAnnotationDoc` in annotationDocSync.js calls `loadFromBackend` (line 149).
2. `loadFromBackend` applies the gzip-compressed `annotation_snapshots` row via
   `Y.applyUpdate(doc, bytes, 'hydrate')` (line 200). The snapshot encodes the
   full Y.Doc state as `Y.encodeStateAsUpdate(doc)` — including `annoMeta`.
3. Then it replays the `annotation_updates` tail rows (lines 205–221).
4. `useAnnotationDoc.js` then reads `handle.getMeta('calloutsList')` (line 75)
   and calls `setCallouts(storeCallouts)` if non-empty (line 81).

Old-engine hydration (`loadAllNonSurveyMarkerAnnotations`) is bypassed at
`enabled: false` in `useAnnotationCloudSync`.

---

## 5. Callout Data Shape and Y.Doc Structure

Callouts are stored as a **document-level JSON blob** in the `annoMeta` Y.Map:

```
doc.getMap('annoMeta').get('calloutsList')
  → Array<{ id, pageNumber, anchor, knee, label, ... }>
```

They are **NOT** per-page entries in the `annotations` Y.Map. The contrast with
regular annotations:

| | Regular annotations | Callouts |
|---|---|---|
| Y.Map | `doc.getMap('annotations')` | `doc.getMap('annoMeta')` |
| Key | stable annotation id | `'calloutsList'` (one key) |
| Value | `{ p: pageNumber, o: fabricObject }` | `Array<calloutObject>` (full list) |
| Diff | per-annotation minimal diff | coarse whole-list replace (idempotent: JSON compare) |
| Per-page? | Yes | No (filtered by `pageNumber` at render time) |

The `setMetaValue` idempotency guard (stableStringify on both old and new value)
ensures no spurious Yjs update is produced when the list is re-set to the same
state.

---

## 6. Dual-Write Risk Assessment

**No active dual-write exists at runtime.** Evidence:

1. `useAnnotationCloudSync` is the only hook that calls `upsertCallouts` and the
   Phase 30 `fanOutCrdtForCallouts`. Both are inside effects guarded by
   `if (!enabled ...)` — and `enabled: false` is hardcoded in the `PDFViewer.jsx`
   call site (line 15662).
2. `useAnnotationDoc` is the only active persistence hook for callouts. It writes
   to `annotation_updates` / `annotation_snapshots` via the Y.Doc.
3. No other file calls `upsertCallouts` at a live call site.
4. The `phase30Ydoc.getMap('callouts')` (Phase 27–31 CRDT Y.Doc) and
   `doc.getMap('annoMeta').get('calloutsList')` (new engine Y.Doc) are in
   SEPARATE Y.Docs keyed differently (`<uuid>` vs `annoflat:<uuid>`). Even if
   the Phase 30 path were re-enabled, it would not interfere with the new
   engine's `annoMeta` path.

**Residual risk (not currently active):**
- If `enabled` is ever changed back to `true` in `useAnnotationCloudSync`'s
  call site, callouts will be written to BOTH `document_annotations` (old)
  AND `annotation_updates`/`annotation_snapshots` (new) simultaneously, and
  the old-engine hydrate would race the new-engine hydrate on open.
- The crdtBackfill path imports legacy callout rows into the Phase 27–31
  CRDT Y.Doc's `annotations` map (not the new engine's `annoMeta`), so
  migrated documents that cut over via Phase 31 backfill do NOT have their
  callouts in the new engine's `annoMeta`. After cutover, callout rehydration
  falls through the old-engine Supabase durable snapshot path
  (`loadCloudWithEmptyVerify`), which does populate `setCallouts` from
  `document_annotations` rows. The new engine's `annoMeta` for callouts is
  then captured by `useAnnotationDoc`'s callout capture effect after those
  callouts land in React state. **This is an indirect bootstrap, not a
  true dual-write.**

---

## 7. No Roundtrip Harness Coverage for New-Engine Callouts

`agent-cli/yjs-roundtrip.mjs` tests the `annotationsByPage` (annotations map)
path end-to-end against the real backend but does **not** exercise
`handle.setMeta('calloutsList', [...])` or the `annoMeta` round-trip.
The existing tests in `tests/annotationDocStore.test.mjs` cover
`getAnnotationsMap`, `syncByPageToDoc`, `hydrateDoc`, etc., but do NOT import
or test `getMetaValue` / `setMetaValue`.

This means the callout capture/hydrate path in the new engine is code-reviewed
and wired correctly but has **no automated end-to-end proof** equivalent to the
annotations round-trip.

---

## VERDICT

**FULLY ON THE NEW ENGINE — with a coverage gap.**

The callout persistence path has been correctly migrated:

- **Capture:** `useAnnotationDoc.js` line 119 calls `h.setMeta('calloutsList', callouts)` on every `callouts` state change. This writes to `doc.getMap('annoMeta')`, which is serialized into `annotation_updates` and `annotation_snapshots` by `annotationDocSync.js`.
- **Hydration:** On open, callouts are loaded from the Y.Doc snapshot+tail via `handle.getMeta('calloutsList')` and passed to `setCallouts`.
- **Old engine:** `useAnnotationCloudSync` is hardcoded `enabled: false, hydrateEnabled: false`. None of its callout push (`upsertCallouts`), hydrate, or realtime subscription effects execute.
- **No dual-write at runtime.** The `document_annotations` table is not written by any currently-active callout path.

**Dual-write risk: LOW but not zero.** Re-enabling `useAnnotationCloudSync` at the PDFViewer call site would immediately create a dual-write. The `enabled: false` guard is the only thing standing between the old and new callout persistence paths.

**Coverage gap:** `annoMeta`/`calloutsList` round-trip is not covered by any
automated test or agent-cli scenario. Recommend adding a `handle.setMeta` /
`handle.getMeta` test case to `tests/annotationDocStore.test.mjs` and a
`setMeta` assertion to `agent-cli/yjs-roundtrip.mjs`.
