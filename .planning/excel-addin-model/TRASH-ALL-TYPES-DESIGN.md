# KAL-313 Phase 1 — Trash / History / Restore: All Annotation Types
_Design doc. Read-only research pass. Author: Claude, 2026-06-11._
_Required by PLAN-EXCEL-SECURITY-V1.md step 10 before the role-based permission flip (step 11)._

---

## 0. Why This Doc Exists

Step 10 of PLAN-EXCEL-SECURITY-V1.md:

> "Extends the markers' 30-day trash + History restore to shapes, ink, callouts, text, regions. Gets its own short design doc BEFORE build: per-type restore payload shape, retention, interaction with bulk delete and the collaborative doc, and tests — not a copy-paste of the marker mechanism."

The permission flip (step 11) enables editors and owners to delete each other's annotations. That only ships safely if every deleted object is restorable for 30 days. The marker mechanism is the reference, but each other type has structural differences that change the design.

---

## 1. Reference: How Survey Markers Do It Today

**Evidence files:** `src/services/surveyMarkerHistory.js`, `src/services/surveyMarkerTrash.js`, `src/services/surveyMarkerTrashStore.js`, `supabase/migrations/20260524090000_document_history_events.sql`.

### 1a. Delete-time capture

`buildSurveyMarkerDeleteHistoryRow` (surveyMarkerHistory.js:50-88) writes a row to `document_history_events` with:
- `event_type: 'survey_marker_deleted'`
- `payload.restoreAction: { type: 'surveyMarker', markerId, pageNumber, surveyMarker: <full marker object> }`
- `is_undoable: true`
- The full marker object (geometry, name, notes, entity, page, bounds, checklist answers, color, template link)

That `payload.restoreAction` is what `handleRestoreHistoryActivity` (PDFViewer.jsx:21654) dispatches on. The History panel renders a Restore button when `payload.restoreAction` is present.

### 1b. Tombstone store

`surveyMarkerTrashStore.js` writes a per-`pdfId` localStorage key `surveyMarkerTrash:<pdfId>`. Each tombstone is `{ marker, deletedAt, deletedBy, origin, reason }`. Retention sweep runs on document open (`purgeExpired`, PDFViewer.jsx:9616-9625). This is **device-local**.

### 1c. Why markers got away with localStorage

Survey markers were the only type with scheduled deletion (Excel sync import). There was no shared-document concern at the time; the doc had one user. A device-local trash was acceptable because the person doing the delete was the same person doing the restore, on the same machine.

### 1d. The gap for standard annotation deletes (shapes, ink, text)

Standard annotation deletes flow through `buildAnnotationHistoryAction` → `pushLocalAnnotationHistoryAction` → `pushHistoryDebugEvent('local_annotation_history_added', ...)`. That event is recorded to `document_history_events` by `buildHistoryEventRowFromDebugEvent` (documentHistoryService.js:202-244). **That row never sets `payload.restoreAction`** — the `summarizeHistoryActionForLog` spread only includes type, annotationId, pageNumber, objectDelta. The History panel cannot offer Restore on these rows today. KAL-48 revision restore exists but is coarse (full document snapshot, owner-only) and does not fill this gap.

---

## 2. What Must Be Captured at Delete Time — Per Type

### 2a. Standard annotations: shapes (rect/circle/line/polygon/polyline), ink (path), text (textbox/i-text)

**Storage today:** `annotationsByPage[page].objects[]` as Fabric JSON. DB: `document_annotations` rows with `annotation_data.fabricObject`. Type mapped via `FABRIC_TYPE_TO_DB_TYPE` (annotationTypeSerializers.js:45-58).

**Restore payload must capture:**
- `fabricObject`: the full Fabric JSON object as it existed at delete time — geometry (`left`, `top`, `width`, `height`, `angle`, `scaleX`, `scaleY`), style (`stroke`, `strokeWidth`, `fill`, `opacity`, `strokeDashArray`, path `d` array for ink), and `data` fields (`id`, `authorId`, `authorName`, `createdAt`, `lastEditedAt`, `type` for counters)
- `pageNumber`: integer page the object lived on
- `index`: z-order index in the objects array (from `buildAnnotationHistoryAction` — already captured in `annotation.index`)
- `annotationId`: the object's `id` field
- `annotationType`: DB type string (`ink`, `square`, `circle`, `line`, `freetext`, etc.)

**Key insight:** `buildAnnotationHistoryAction` at `deleted.length === 1` already produces `{ type: 'fabric:delete', pageNumber, annotationId, annotation: <full Fabric object>, index }` (annotationLocalHistory.js:200-207). The restore action for the History panel is literally `invertAnnotationHistoryAction` of that — `{ type: 'fabric:create', pageNumber, annotationId, annotation, index }`. That inverted action is already what `applyAnnotationHistoryAction` uses in `handleRestoreHistoryActivity` (PDFViewer.jsx:21702-21717). **The geometry is already computed; we just need to embed it as `payload.restoreAction` in the history event.**

For **bulk deletes** (fabric:batch), each deleted object in `batch.deleted[]` needs its own restore entry. See section 5 on per-operation grouping.

### 2b. Callouts

**Storage today:** Separate `callouts[]` state slice. Normalized 0–1 coordinates (`anchor.x`, `anchor.y` as page fractions). Synced as a coarse whole-list meta blob via `useAnnotationDoc`'s `getMeta/setMeta('calloutsList')`. NOT in `annotationsByPage`. (ANNOTATION-UNIFORMITY-AUDIT.md, CD-1, CD-3.)

**Restore payload must capture:**
- The full callout object as it was: `{ id, pageNumber, anchor: {x, y}, tail: {x, y}, text, style: {borderColor, fillColor, lineThickness, ...}, createdBy, createdAt, authorName }`
- `anchor` and `tail` are already in the 0–1 normalized coordinate system — restore re-inserts them into `callouts[]` at those same coordinates; no conversion needed
- `pageNumber` for History panel display and page-navigation on restore

**Restore apply path (new):** Re-insert the callout into `callouts[]` via `setCalloutsIfPersistedChanged(prev => [...prev, callout])`. The callout gets a new `restoredAt` stamp; its ID is kept (collision handling in section 4c).

**Structural complication:** Callouts are a whole-list blob. There is no per-object CRDT; restoring one callout re-inserts it into the next blob write, which is last-write-wins. In a live collab session, a concurrent callout edit between the delete and the restore could be overwritten by the restore's setMeta write. This is the same risk that exists today for any callout edit in collab. Acceptable for V1 given the 30-day window is not typically exercised during active collab; document the risk.

**Open question for Isaiah (OQ-1):** Should callout restore wait for KAL-81 (callout unification into `annotationsByPage`) so it rides the same path as shapes? KAL-81 would let callouts use the same fabric:create restoreAction shape. V1 without KAL-81 requires a parallel `type: 'callout'` restore branch. Recommendation: implement V1 with the parallel branch now (step 11 cannot wait for KAL-81), then delete the branch as part of KAL-81.

### 2c. Regions

**Storage today:** Nested inside `spaces[].assignedPages[].regions[]`. NOT in `annotationsByPage`. Each region: `{ regionId, pageId, shapeType: 'rectangular'|'polygon', operation: 'add'|'subtract', coordinates: [flat x/y pairs], sourceRegions?, originCenter? }`. Synced as a coarse whole-spaces-array blob via `useAnnotationDoc`'s `setMeta('spaces', spaces)`. No `createdBy` field exists on regions today. (REGION-ARCHITECTURE-AUDIT.md, CRIT-5.)

**Restore payload must capture:**
- The full region object: `{ regionId, pageId, shapeType, operation, coordinates, sourceRegions?, originCenter? }`
- The `spaceId` the region belonged to — needed for restore insertion point
- `pageNumber` (same as `pageId`) for History panel
- `spaceName` (human-readable label from the space, for the history summary)

**Structural complications:**
1. **No `createdBy` on regions today.** The design doc for step 11 requires knowing who deleted whose region. Before trash can be implemented, `createdBy: userId` must be stamped on region creation in RST (REGION-ARCHITECTURE-AUDIT.md CRIT-5). This is a **prerequisite** for the region slice, not optional.
2. **Space may be deleted or edited between delete and restore.** If the parent space is deleted, restoring the region has nowhere to go. If another user edited the space's assignedPages between delete and restore, the restore must merge, not overwrite. The restore handler must check whether the target `(spaceId, pageId)` still exists in the live `spaces` state. If the space is gone: surface "Space no longer exists — region cannot be restored" in the UI. If the space/page exists but the assignedPage has changed: re-insert the region into `assignedPages[pageId].regions[]` by appending (not replacing).
3. **Coarse blob collision:** Same last-write-wins collab risk as callouts. Acceptable for V1.
4. Regions are NOT annotation objects; they do not flow through `document_history_events` today. Recording region deletions there is new territory and the right call (see section 3).

---

## 3. Where Tombstones Live — Recommended: `document_history_events`

### 3a. Option A: Extend localStorage (marker pattern)

Keep per-device tombstones keyed by `pdfId`. Simple, no migration. Already battle-tested for markers.

**Why this is not acceptable for the other types:** The permission flip enables cross-user deletion. An editor deletes an owner's annotation on Device A. The owner wants to restore it on Device B. localStorage is invisible across devices. The audit trail ("who deleted whose what") is unenforceable from localStorage. The 30-day retention sweep runs only if the same user opens the same document on the same device. This fails the V1 multi-device and audit coupling requirements.

**Why markers got away with it:** Markers were only deleted by Excel sync (the same machine doing the syncing) or by the document owner. The restore was always by the same party on the same device. That assumption breaks the moment step 11 opens cross-user deletion.

### 3b. Option B: New dedicated trash table

A `document_trash_entries` table with `(document_id, object_id, object_type, payload, deleted_by, deleted_at, expires_at)`. Explicit 30-day expiry via a Supabase scheduled function or on-open sweep. Full RLS.

Advantages: explicit, type-safe, easy to query for a "Trash" view.
Disadvantages: a second table that duplicates most of what `document_history_events` already does (document_id, user_id, annotation_id, payload, occurred_at). The History panel already reads from `document_history_events`; adding a second table creates two surfaces to keep in sync.

### 3c. Option C: Extend `document_history_events` with new event types (RECOMMENDED)

Emit one `document_history_events` row per deleted object (or per operation — see section 5) with:
- A new `event_type` per type: `annotation_deleted` (shapes/ink/text), `callout_deleted`, `region_deleted`
- `payload.restoreAction` carrying the full restore data (same pattern as `survey_marker_deleted`)
- `payload.deletedBy` / `user_id` for audit coupling
- `is_undoable: true` so the History panel shows a Restore button

The `client_event_id` uniqueness constraint prevents duplicates. The existing 30-day retention sweep can be a migration adding `expires_at` or a Postgres scheduled job filtering on `occurred_at < NOW() - INTERVAL '30 days'` for these event types. The existing `DELETE` policy (owner-only) governs purge.

**Why this wins:**
- Multi-device: `document_history_events` is Supabase-backed, cross-device, cross-user-visible (RLS: collaborators read, editors insert, owners delete).
- Audit coupling: the event row IS the audit entry — `user_id` is the deleter, `annotation_id` identifies the object, `payload.restoreAction` carries the restore payload. "Who deleted whose what" is a single SELECT.
- No new table, no new UI surface for V1 (History panel already exists, already reads these rows).
- 30-day retention: add a `DELETE FROM document_history_events WHERE event_type IN ('annotation_deleted', 'callout_deleted', 'region_deleted') AND occurred_at < NOW() - INTERVAL '30 days'` scheduled job (or a new migration adding an `expires_at` column and a partial index + retention sweep function).

**Migration needed:** A new migration adding the three new `event_type` values is not strictly needed (the column is `TEXT NOT NULL`, not an enum) — but the retention sweep function should be added. No schema change beyond the sweep. Optionally add an index on `(document_id, event_type, occurred_at)` for the trash-view query pattern.

### 3d. localStorage layer stays as a write-through cache

The existing `LOCAL_HISTORY_STORAGE_KEY` localStorage cache in `documentHistoryService.js` already mirrors Supabase rows locally for offline read. Restore events written to Supabase will be cached locally on write. The localStorage layer becomes a fallback, not the primary store — same as it is today for survey marker history events (which also call `recordDocumentHistoryEvent`).

---

## 4. Restore Semantics — Per Type

### 4a. Shapes / ink / text

**Restore apply path** (already partially wired, PDFViewer.jsx:21699-21717):
```
handleRestoreHistoryActivity →
  applyAnnotationHistoryAction(current, restoreAction) →  // restoreAction.type === 'fabric:create'
  handleSaveAnnotations(pageNumber, nextPage, { source: 'history:restore-deleted-annotation' })
```

**ID collision on restore:** The `annotationId` from the original object is preserved in the restoreAction. `applyAnnotationHistoryAction` re-inserts the object by id. If an object with the same id already exists in `annotationsByPage[page]` (e.g., the user re-created an object with the same id, which is unlikely since ids are UUIDs), `applyAnnotationHistoryAction`'s `buildIdMap` → insert path would duplicate it. **Mitigation:** Before restoring, check `annotationsByPage[page].objects` for an existing object with `id === restoreAction.annotationId`. If found, treat as a no-op (already exists) and return `{ ok: false, reason: 'restore-noop' }`.

**Page that no longer exists:** If `annotationsByPage[pageNumber]` is absent (page was deleted from the PDF — unlikely in practice), re-create the page entry: `{ objects: [restoredObject] }`. This is safe since `setAnnotationsByPage` creates page keys on demand.

**Z-order on restore:** The `index` field in the restoreAction records where the object was in the array. `applyAnnotationHistoryAction` currently re-appends (places at end). For V1, appending to end is acceptable — the object reappears visually and Fabric repaints. Preserving original z-order is a follow-up refinement.

**Interaction with undo stack:** Restore via History panel should NOT be undone by Cmd+Z into the pre-restore state (it would re-delete). `handleSaveAnnotations` with `source: 'history:restore-deleted-annotation'` already adds a new history entry. This is correct — the undo stack entry is "add this object" and Cmd+Z removes it again. That is the right behavior (Cmd+Z undoes the restore, not the original delete).

### 4b. Callouts

**Restore apply path (new):**
```
handleRestoreHistoryActivity →
  restoreAction.type === 'callout' →
  setCalloutsIfPersistedChanged(prev => [...prev, { ...callout, restoredAt: now }])
```

**ID collision:** Same UUID uniqueness guarantee as shapes. Check `callouts.find(c => c.id === callout.id)` before restoring; no-op if found.

**Collab / blob race:** The `setMeta('calloutsList', callouts)` write happens on the next `setCallouts` trigger. In a live session with concurrent editors, the last writer wins. Accept for V1.

**Page that changed:** Callout coordinates are 0–1 normalized; they stay valid regardless of page layout changes. Restore always succeeds at the geometry level.

### 4c. Regions

**Restore apply path (new):**
```
handleRestoreHistoryActivity →
  restoreAction.type === 'region' →
  check spaces for (spaceId, pageId):
    - space missing → return { ok: false, reason: 'region-space-deleted' }
    - space/page present → handleSpaceUpdate(spaceId, { assignedPages: [
        ...existing,
        { pageId, regions: [...existingRegions, restoredRegion] }
      ]})
```

**Space deleted between delete and restore:** Return `{ ok: false, reason: 'region-space-deleted' }`. History panel shows "Cannot restore — the space this region belonged to has been deleted."

**Space edited (page regions changed) between delete and restore:** The restore appends the region to the current `regions[]` for that `(spaceId, pageId)`. The user may see the region overlapping new geometry. Acceptable — they can delete it again.

**Region that was in a space that was later recreated with the same name:** The `spaceId` UUID is the lookup key, not the name. If a space was deleted and a new space with the same name was created, they have different UUIDs. Restore fails with `region-space-deleted`.

---

## 5. Bulk Delete — Per Operation Grouping

**Recommendation: one trash entry per operation, with per-object payloads embedded.**

**Rationale:** The Phase-35 bulk-delete plan (`buildBulkDeletePlan`, bulkDeletePlan.js) already groups a selection into a single user action. The undo toast says "N annotations deleted" and offers one undo. Mapping that to N separate history rows would create N separate Restore buttons in the History panel, each restoring one object at a time — confusing for a bulk delete of 20 shapes.

**Recommended event shape for a bulk delete:**
```json
{
  "event_type": "annotations_bulk_deleted",
  "annotation_id": null,
  "page_number": null,
  "payload": {
    "actionType": "bulk-delete",
    "deletedBy": "<userId>",
    "count": 5,
    "objects": [
      { "annotationId": "...", "pageNumber": 3, "restoreAction": { "type": "fabric:create", ... } },
      { "annotationId": "...", "pageNumber": 3, "restoreAction": { "type": "fabric:create", ... } },
      ...
    ]
  },
  "is_undoable": true
}
```

The History panel renders a single "Deleted 5 annotations — Restore" row. `handleRestoreHistoryActivity` iterates `payload.objects` and calls `handleSaveAnnotations` once per page (grouping objects by page for efficiency).

**Payload size concern:** 5 Fabric objects at ~2KB each = ~10KB. The `MAX_PAYLOAD_CHARS = 12000` limit in `trimPayload` (documentHistoryService.js:14) can be exceeded for large bulk deletes. **Mitigation:** Raise the limit for `annotations_bulk_deleted` events (or store oversized payloads in Supabase Storage with a pointer). For V1, set a per-operation soft cap of 50 objects in the bulk trash row; beyond 50, split into multiple rows keyed by a shared `batchId` field.

**Mixed-type bulk delete (shapes + callouts):** When Phase-35 `handleBeginBatchDelete` fires for a mixed selection (callouts + shapes — handled by the batch coordinator at PDFViewer.jsx:10253), emit one `annotations_bulk_deleted` event that embeds both type-tagged restoreAction objects. The restore handler dispatches each sub-action to the appropriate restore path by `restoreAction.type`.

**Single-delete:** Emit the same `annotation_deleted` / `callout_deleted` / `region_deleted` event (one object, one row). No threshold.

---

## 6. UI Surface — Recommended V1

**Use the existing History panel, not a separate Trash view.**

The History panel (already exists, shows events from `document_history_events`) renders a Restore button for any row where `payload.restoreAction` is non-null. Today that only fires for survey markers. Extending it to shapes/callouts/regions requires no new panel — just the `payload.restoreAction` to be populated correctly.

**What V1 adds to the History panel:**
- Rows with `event_type IN ('annotation_deleted', 'callout_deleted', 'region_deleted', 'annotations_bulk_deleted')` show as "Deleted [type] on page N — Restore"
- Restore button behavior: same as survey marker restore — calls `handleRestoreHistoryActivity` which dispatches by `restoreAction.type`
- 30-day window: rows older than 30 days are purged (no Restore button shown once purged)

**Deferred to V2:** A dedicated Trash view ("Recently Deleted") showing only restorable items, filterable by type and page. The History panel serves both purposes for V1.

---

## 7. Audit Coupling

**Requirement from PLAN-EXCEL-SECURITY-V1.md step 10:** "every cross-user delete (post-flip) must reference its trash entry so 'who deleted whose what' is answerable."

The `document_history_events` row IS the audit entry. The coupling is the `client_event_id` — unique per `(document_id, client_event_id)`. The audit record contains:
- `user_id`: the deleter (set at INSERT time via `auth.uid()`)
- `annotation_id`: the deleted object's ID
- `payload.deletedBy`: mirrors `user_id` (belt-and-suspenders for the audit query)
- `payload.restoreAction.annotation.data.authorId`: the original author (captured in the Fabric object's `data` fields)
- `event_type`: the kind of delete
- `occurred_at`: timestamp

Query for "who deleted whose what": `SELECT user_id, annotation_id, payload FROM document_history_events WHERE document_id = $1 AND event_type IN ('annotation_deleted', ...) ORDER BY occurred_at DESC`.

The immutable-audit requirement from step 10 is satisfied by the existing `document_history_events` RLS: INSERT allowed for editors (`user_id = auth.uid()`), DELETE allowed only for owners. The audit entry itself cannot be deleted by the deleter — only the document owner can. For the step 10 immutable-audit slice, consider removing the owner DELETE policy for these specific event types (or making them non-deletable via a trigger), matching the spirit of the immutable Excel audit journal from step 5.

**Open question for Isaiah (OQ-2):** Should annotation-delete history rows (the restorable ones) be owner-deletable or fully immutable? If an owner deletes a history row, the trash entry is gone and restore is lost. Recommendation: keep the owner DELETE policy for V1 (low risk — owner deliberately managing their history), revisit for V2 if the audit requirement hardens.

---

## 8. Interaction with Existing Undo / KAL-48 Revision Restore

### 8a. Cmd+Z (local annotation undo) vs. History Restore

Local undo (Cmd+Z) works in-session and is limited to the session's undo stack depth (100 entries). It does not survive reload. The History panel restore works post-reload, post-session, and across devices. They are complementary, not competing.

No change needed to the undo stack for this feature.

### 8b. KAL-48 revision restore gap

`kal48_restore_revision` (kal48_document_revisions.sql) restores the full `document_annotations` table (all Fabric objects). It is owner-only, coarse, and destroys the current live state (saving a pre-restore revision first). It covers shapes, ink, text, and callouts (via the `document_annotations` table) but NOT regions (which live in `spaces` meta, not `document_annotations`) and NOT the per-object granularity the History panel needs.

KAL-48 is a "nuke and restore" fallback. The per-object trash is the precision tool. They coexist without conflict.

### 8c. Phase-35 undo toast

The Phase-35 undo toast (bulkDeletePlan + `enqueueUndoToast`) does a client-side snapshot restore via `setAnnotationsByPage` (PDFViewer.jsx:16631-16643). It fires immediately after the delete and auto-dismisses in a few seconds. This is the first-line undo; the History panel is the 30-day fallback. The toast-based restore does NOT write a new history event (it directly mutates state). The History panel row persists regardless. If the user undoes via toast, the History panel row still shows; clicking Restore a second time would re-add the object again. **Mitigation:** After a toast-based undo succeeds, emit a `annotations_restore_via_toast` event or tombstone the original delete row's `is_undoable = false`. For V1, the simpler approach: the restore is idempotent (if the object already exists by id, the restore path returns no-op). Document the expected behavior: double-restoring has no visible effect.

---

## 9. Test Plan — Per Type and Role Matrix

### 9a. Shapes / ink / text

| Test | What to verify |
|---|---|
| Single delete → History row appears with Restore button | `event_type='annotation_deleted'`, `payload.restoreAction.type='fabric:create'`, `annotation_id` matches |
| Restore single → object reappears on correct page at correct geometry | Pixel-match or bounding-box check |
| Restore after reload (session gone) | Supabase row survives; restore applies from DB payload |
| Restore after 30 days (fast-forward `occurred_at`) | Row purged, Restore button absent |
| Bulk delete 3 shapes → one history row, Restore restores all 3 | `event_type='annotations_bulk_deleted'`, `payload.objects.length=3` |
| ID collision (object re-created before restore) | Restore returns no-op, no duplicate |
| Cross-user: editor deletes owner's shape, owner restores | `user_id=editorId`, `payload.restoreAction.annotation.data.authorId=ownerId`, restore adds back |

### 9b. Callouts

| Test | What to verify |
|---|---|
| Delete callout → `callout_deleted` history row with full callout object in `payload.restoreAction` | |
| Restore → callout reappears at correct page, correct normalized coords | |
| Restore after reload | Supabase row survives; `setCalloutsIfPersistedChanged` fires |
| Concurrent collab: editor A deletes, editor B edits another callout, owner restores | Restore appends correctly; no collab clobber of unrelated callouts |
| Cross-user: editor deletes owner's callout | `canModify` gate passes (after KAL-125); history row written with deleter's `user_id` |

### 9c. Regions

| Test | What to verify |
|---|---|
| Region delete in RST → `region_deleted` history row | Requires `createdBy` stamping prerequisite |
| Restore → region re-appended to correct `(spaceId, pageId)` | |
| Restore when space is deleted → graceful `region-space-deleted` error | |
| Restore when space has new regions → region appended, no old region overwritten | |
| Cross-user: editor deletes owner's region | `createdBy` must be present for ownership gate; stamping prerequisite |

### 9d. Role matrix (applies to all types, required before step 11 ships)

| Actor | Object owner | Delete allowed | Trash row written | Restore by | Restore succeeds |
|---|---|---|---|---|---|
| Owner | Own | Yes | Yes (user_id=owner) | Owner | Yes |
| Owner | Editor's | Yes (post-flip) | Yes (user_id=owner) | Owner or Editor | Yes |
| Editor | Own | Yes | Yes (user_id=editor) | Editor | Yes |
| Editor | Owner's | Yes (post-flip) | Yes (user_id=editor) | Owner or Editor | Yes |
| Viewer | Any | No — `canModify` rejects | No | N/A | N/A |

RLS: The existing `"Editors can create own document history events"` INSERT policy (`user_id = auth.uid()`) covers editors inserting trash rows for their own deletes and cross-user deletes (user_id is always the deleter). SELECT: all collaborators. DELETE: owner only.

---

## 10. Prerequisites (Must Ship Before Region Trash Slice)

1. **`createdBy` stamping on region creation** (REGION-ARCHITECTURE-AUDIT.md CRIT-5). Without it, region ownership cannot be determined, so the delete audit entry cannot identify the original author and the ownership gate for step 11 has nothing to check. This is a one-field add in RST (`handleMouseUp` at RST:1225, RST:1269) plus threading `userId` prop into RST from PDFViewer (~line 26618).

2. **KAL-125 callout ownership gate** (CD-5 from ANNOTATION-UNIFORMITY-AUDIT.md). Already partially addressed (KAL-125 2026-06-10 hoisted `canModify` check into `handleDeleteSelectedCallouts`). Verify the context-menu delete in PAL.jsx:4346 is also gated before the callout trash slice ships.

---

## 11. Open Questions for Isaiah

**OQ-1 (Callout timing):** Should callout restore wait for KAL-81 (unification into `annotationsByPage`) so it uses the same `fabric:create` restore path as shapes? The V1 plan implements a parallel `type: 'callout'` restore branch. KAL-81 would collapse it. Recommendation: implement V1 branch now, delete it during KAL-81. But if KAL-81 is < 2 sprints away, waiting is cleaner. Isaiah's call on KAL-81 timeline.

**OQ-2 (Immutability of delete audit rows):** Should `annotation_deleted` / `callout_deleted` / `region_deleted` history rows be owner-deletable (current RLS) or permanently immutable? If an owner clears their history, the restore window closes. For most users this is unlikely to matter; for audit compliance (step 10's explicit mention of immutable audit) it may need to be locked. Recommend locking these specific event types via a Postgres trigger in the same migration that adds the retention sweep.

**OQ-3 (Bulk trash payload size cap):** The design proposes a 50-object soft cap per bulk trash row with `batchId` splitting beyond that. Is 50 the right number, or should we cap by payload bytes instead? The `trimPayload` 12KB limit suggests ~6 medium Fabric objects; we may need to raise `MAX_PAYLOAD_CHARS` for trash rows specifically or store oversized payloads in Supabase Storage. Need Isaiah's call on acceptable payload size vs. a storage pointer indirection.

**OQ-4 (Regions restore UX when space is deleted):** When a region's parent space is gone, the History panel could show a greyed-out "Space deleted — cannot restore" entry vs. silently not showing the Restore button. Which is more useful? The greyed-out approach requires the restore handler to communicate the failure reason back to the panel UI, which currently just calls `handleRestoreHistoryActivity` and checks `ok`. Minor UI work but better transparency.

---

## 12. Slice Plan for KAL-313 Phase 2

_These are the proposed build slices, ordered by dependency and risk. Each slice is independently shippable._

| Slice | Scope | Dependencies | Risk | Effort |
|---|---|---|---|---|
| **S1 — Foundation** | Add `payload.restoreAction` to `local_annotation_history_added` debug event for single-delete `fabric:delete` actions; wire `buildHistoryEventRowFromDebugEvent` to pass it through; add `annotation_deleted` event_type path in `handleRestoreHistoryActivity`. Migration: add retention sweep function for annotation-delete event types. | None beyond marker mechanic (already exists) | Low | Small |
| **S2 — Shapes/ink/text single-delete restore** | Wire S1 into `pushLocalAnnotationHistoryAction`: for `fabric:delete` actions, embed `invertAnnotationHistoryAction(action)` as `restoreAction` in the `local_annotation_history_added` event. History panel Restore button fires `handleRestoreHistoryActivity`. Tests: single-delete, post-reload restore, role matrix for shapes. | S1 | Low | Small |
| **S3 — Bulk delete restore** | Emit `annotations_bulk_deleted` row in `handleRequestBulkDelete`'s `wrappedRunDelete`, capturing all deleted objects' restoreActions. Restore handler iterates `payload.objects`. Tests: bulk 3+, mixed-type bulk (shapes + callouts). | S1, S2 | Medium | Medium |
| **S4 — Callout delete restore** | Add `callout_deleted` event_type. In `handleDeleteSelectedCallouts`, capture the deleted callouts before the `setCalloutsIfPersistedChanged` filter and emit a history row with `restoreAction.type = 'callout'`. Add `type: 'callout'` branch in `handleRestoreHistoryActivity`. Tests: single callout, post-reload, collab. | S1, KAL-125 gate confirmed | Medium | Small |
| **S5 — Region createdBy stamping (prerequisite)** | Add `createdBy: userId` to region creation in RST (RST:1225, RST:1269). Thread `userId` prop into RST from PDFViewer (~line 26618). No trash logic yet. | None | Low | Tiny |
| **S6 — Region delete restore** | Add `region_deleted` event_type. In RST's `handleDeleteSelected`, emit a history row before the `setRegions` filter, capturing `{ regionId, pageId, spaceId, spaceName, region }`. Add `type: 'region'` branch in `handleRestoreHistoryActivity` with space-existence check. Tests: restore succeeds, space-deleted failure, role matrix. | S1, S5 | Medium | Medium |
| **S7 — Audit hardening** | Add Postgres trigger or policy amendment to prevent owner DELETE on `annotation_deleted` / `callout_deleted` / `region_deleted` rows (make them immutable). Add `(document_id, event_type, occurred_at)` index for trash-view query. Migration. | S1–S6 | Low | Small |
| **S8 — History panel UI polish** | Show type-specific labels in Restore confirmation ("Restore ink stroke on page 3?"). Show greyed-out "Space deleted — cannot restore" for OQ-4 if Isaiah chooses that UX. | S1–S6 | Low | Small |

**Recommended ship order:** S1 → S2 → S4 → S5 → S3 → S6 → S7 → S8. Shapes and callouts unblock step 11 fastest; bulk and regions follow. S7 can ship in parallel with S5 once S1-S4 are merged.

---

_End of design doc. All claims verified at source file:line. Open questions marked OQ-N for Isaiah's decisions before phase 2 planning._

---

## Decisions (Isaiah, 2026-06-11)

- **OQ-1 RESOLVED: ship the callout parallel branch NOW.** Callout trash/restore does not wait for KAL-81 unification; the parallel branch is deleted when unification lands. (Keeps the permission flip unblocked.)
- **OQ-2 RESOLVED by governing plan:** delete-audit rows are permanently immutable (trigger blocks owner DELETE) — PLAN-EXCEL-SECURITY-V1.md step 5 governs.
- **OQ-3 RESOLVED (technical call):** 50-object soft cap with batchId splitting; no payload-size raise, no storage pointers in V1.
- **OQ-4 RESOLVED: greyed-out + reason.** Orphaned region entries stay visible with Restore disabled and "its space was deleted — restore the space first."
