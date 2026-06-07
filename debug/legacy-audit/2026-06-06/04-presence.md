# Presence System — Legacy Audit Trace
_2026-06-06 · read-only investigation_

---

## 1. The Presence Data Model

### Postgres table: `document_presence`
Created in `supabase/migrations/20241230000002_create_document_annotations.sql` (line 95).

```sql
CREATE TABLE IF NOT EXISTS document_presence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_type     TEXT NOT NULL DEFAULT 'app'
                        CHECK (client_type IN ('app', 'excel', 'web')),
    display_name    TEXT,
    current_page    INTEGER,
    cursor_position JSONB,   -- { x, y, pageNumber }  (written but not yet rendered client-side)
    selected_annotation_id TEXT,
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, user_id, client_type)
);
```

A presence record captures: **who** (user_id, display_name = email), **where**
(current_page, cursor_position JSONB, selected_annotation_id), **which device
kind** (client_type), and **when last active** (last_seen).

There is NO separate heartbeat timestamp — `last_seen` doubles as both the
heartbeat column and the freshness sentinel. Rows older than 2 minutes are
treated as stale.

### Storage: hybrid — Postgres row + Supabase Realtime WAL
The row is persisted (durable in Postgres) but treated as ephemeral by the
application: stale rows are ignored client-side after 2 min, and each
unsubscribe calls DELETE. The table is added to `supabase_realtime` publication
so WAL change events stream to subscribers in real-time
(`supabase/migrations/20241230000002_create_document_annotations.sql` line 236).

`REPLICA IDENTITY FULL` was applied in
`supabase/migrations/20260426000000_replica_identity_full_for_annotations.sql`
(line 21), which is why DELETE events carry the full old row in `payload.old` —
enabling the client to identify which roster slot to drop.

### RLS
Multiple migration iterations hardened the RLS policies:
- Original policies (20241230000002): owner-only SELECT; viewer INSERT/UPDATE.
- Corrected (20250103000001): relaxed SELECT to collaborators too.
- Fixed again (20260215183000): added LEFT JOIN path for documents without a
  project_id so solo documents don't 403 on upsert.

### Note: separate `survey_presence` table
`supabase/migrations/20241230000001_create_survey_realtime_tables.sql` defines a
legacy `survey_presence` table scoped to `survey_sessions`. That is the older
session-based collaboration model. All current presence reads/writes in the live
app code reference `document_presence`, not `survey_presence`. The latter appears
unused by the current React code stack.

---

## 2. Every WRITE call site

All writes go through `updateDocumentPresence` in
`src/services/documentAnnotationService.js` (line 555).

### Write 1 — Document open / initial handshake
**File:** `src/PDFViewer.jsx`
**Lines:** 15074–15078 (immediate path) and 15049–15053 (deferred path when an
interaction-perf window is active).

Triggered inside the `loadAnnotationsFromSupabase` effect that fires when
`pdfFile?.id` or `user?.id` changes (effect dep array at line 15137). This is
the first write after a new document is opened. It sends:
```js
{
  clientType: 'app',
  displayName: user.email || user.user_metadata?.full_name || 'Anonymous',
  currentPage: coercePageNumber(pageNumRef.current) || pageNum
}
```
On success it flips `documentSyncEnabled` true (gates annotation sync).
On failure it calls `handlePresenceFailure` which may auto-disable cloud sync
for the session.

### Write 2 — Page navigation
**File:** `src/PDFViewer.jsx`
**Line:** 15712.

A dedicated `useEffect` keyed on `[..., pageNum, ...]` (line 15749 dep array).
Fires on every page change **only after** the initial handshake succeeded
(`initialPresenceSucceededRef.current === true`). Sends the same payload as
Write 1 but with the updated `currentPage: pageNum`. If an interaction-perf
window is active the write is deferred by the same mechanism (line 15735).

There is NO separate heartbeat interval — page-change writes are the only
heartbeat. A user sitting on one page without navigating sends no heartbeat
beyond the initial open write. This means last_seen ages out after 2 minutes
of inactivity, which is the designed stale cutoff.

### Payload written each time (all call sites identical)
```js
{
  document_id: documentId,
  user_id: userId,
  client_type: 'app',
  display_name: <email or full_name or 'Anonymous'>,
  current_page: <page number>,
  cursor_position: null,           // never populated by the app today
  selected_annotation_id: null,    // never populated by the app today
  last_seen: new Date().toISOString()
}
```

`cursor_position` and `selected_annotation_id` columns exist in the schema but
are always `null` in practice. Live cursor tracking is not implemented; the
current feature is "who is viewing this document" (page-level), not per-pixel
cursor position.

---

## 3. Every READ / subscribe call site

### Service layer
**`src/services/documentAnnotationService.js`**

- `getDocumentPresence(documentId)` (line 600): `SELECT *` from
  `document_presence` WHERE `document_id = X` AND `last_seen >= now() - 2min`.
  Called once on channel subscription (seed) and on every reconnect re-sync.

- `subscribeToDocumentPresence(documentId, onPresenceEvent, { onSubscribed })`
  (line 650): opens a Supabase channel named `document-presence:<documentId>`,
  listens to `postgres_changes` event `*` on `document_presence` filtered by
  `document_id`. On each event, normalises payload into `{ type, row, prevRow }`
  and calls `onPresenceEvent`. Calls `onSubscribed` when status becomes
  `SUBSCRIBED` (and implicitly on reconnect since Supabase retries yield new
  `SUBSCRIBED` callbacks).

### Hook layer
**`src/hooks/useDocumentPresenceList.js`** (full file, 133 lines)

- Calls `subscribeToDocumentPresence` first, then seeds via `getDocumentPresence`
  when `onSubscribed` fires. Events that arrive during the in-flight seed are
  buffered and replayed afterward.
- Maintains a `Map` keyed by presence row `id` (falls back to composite
  `document_id|user_id|client_type` if id is absent). Applies each delta
  (`INSERT`/`UPDATE` upsert; `DELETE` remove) incrementally via
  `applyPresenceEvent` from `presenceRoster.js`.
- 30-second local maintenance interval ages out stale rows client-side (no
  network) — only runs if tab is visible.
- 3-second seed fallback fires if the channel never reaches SUBSCRIBED (e.g.
  realtime unavailable), so the list still paints from a plain SELECT.

### Pure roster logic
**`src/hooks/presenceRoster.js`** (125 lines)

Pure functions: `applyPresenceEvent`, `seedRoster`, `ageOutRoster`,
`rosterFromMap`, `rostersEqual`. Monotonic guard: incoming event older than
the row already in the map is silently dropped (prevents stale reconnect
replay from overwriting fresh data).

### Consumer: PDFViewer
**`src/PDFViewer.jsx` line 15687:**
```js
const documentPresenceList = useDocumentPresenceList({
  documentId: pdfFile?.id || null,
  enabled: cloudSyncActive   // operational flag, not just entitlement
});
```
At line 24816, `documentPresenceList` is published as `presence` in the
left-rail API object to `PDFSidebar`.

### Consumer: PDFSidebar → PresenceAvatars
**`src/PDFSidebar.jsx` lines 568–575:**
```jsx
<PresenceAvatars
  presence={presence}
  currentUserId={currentUserId}
  currentUserEmail={currentUserEmail}
  currentUserDisplayName={currentUserDisplayName}
  enabled
  compact={isCollapsed}
/>
```

### Consumer: PresenceAvatars
**`src/components/PresenceAvatars.jsx`** (300 lines)

Deduplicates the presence array by `user_id` (keeping the most recently-seen
row per user across `client_type` variants). Renders up to 3 overlapping
avatar circles + a "+N" overflow pill. Stable per-user color derived from
`user_id` hash. Hover tooltip shows email; overflow popover lists all viewers.
Shown only when `cloudSyncEnabled` is true (outer `PDFSidebar` guard at line
550) and when `enabled` prop is passed.

---

## 4. Cleanup / Leave Path

**`src/PDFViewer.jsx` line 15124:**
```js
removeDocumentPresence(documentId, user.id, 'app');
```

This is the cleanup function of the `loadAnnotationsFromSupabase` effect (the
same effect that does Write 1). It fires when:
- The component unmounts (tab close, navigation away from the PDF).
- `pdfFile?.id` changes (user opens a different document — the cleanup for the
  old document fires before the new document's effect runs).
- `user?.id` changes (sign-out).

`removeDocumentPresence` (line 623 in `documentAnnotationService.js`) issues a
hard DELETE filtered by `(document_id, user_id, client_type)`. This is a clean
leave — the WAL DELETE event propagates to all other subscribers' channels and
their roster maps drop the key immediately.

Unclean disconnect (browser kill, network loss before cleanup runs): the row
stays in Postgres but ages out locally on all clients within 2 minutes via the
maintenance interval + freshness cutoff. No server-side cleanup (no Postgres
trigger or cron removes stale rows) — the table accumulates ghost rows. Stale
row accumulation is harmless for query correctness (the 2-min cutoff in
`getDocumentPresence` filters them), but the table will grow unboundedly
without a periodic vacuuming job.

---

## 5. Dependency on Old `document_annotations` Infrastructure

**Presence is ALREADY fully decoupled from the annotation sync infrastructure.**

Evidence:

| Dimension | Presence | Annotation sync (old) |
|---|---|---|
| Supabase table | `document_presence` | `document_annotations` |
| Realtime channel name | `document-presence:<id>` | (Supabase WAL sub via `subscribeToDocumentAnnotations`) |
| Service module | `documentAnnotationService.js` (shared file, but **separate exported functions**) | `documentAnnotationService.js` (different functions) |
| New engine (`annotationDocSync.js`) | **Not referenced at all** | Will replace the old write path |
| Y.js / CRDT | None | Core mechanism |
| `annotation_updates` op-log | Never touched | Core mechanism |

The four presence functions (`updateDocumentPresence`, `removeDocumentPresence`,
`getDocumentPresence`, `subscribeToDocumentPresence`) share the same file with
annotation functions but share no runtime state — they make independent Supabase
calls against a separate table via a separate Realtime channel. Replacing the
annotation engine (old `document_annotations` → new `annotationDocSync.js`
Y.js op-log) requires zero changes to the presence layer.

---

## 6. Gaps, Risks, and Recommendation

### Identified gaps

1. **No heartbeat beyond page navigation.** A user reading a single page for
   more than 2 minutes disappears from all other viewers' presence lists
   (last_seen ages out). The initial open write is the last update until the
   user changes pages or the document is re-opened.

2. **Stale-row accumulation in Postgres.** No server-side TTL or cron purges
   rows older than 2 minutes. The filter in `getDocumentPresence` hides them
   but they accumulate indefinitely. Low urgency (table is tiny) but worth a
   scheduled DELETE or trigger.

3. **`cursor_position` / `selected_annotation_id` columns are dead weight.**
   Both are declared in the schema and expected by the upsert but always written
   as `null`. If per-pixel cursor tracking is never shipped these columns waste
   storage and mislead future readers.

4. **No multi-tab awareness.** If a user opens the same document in two tabs,
   both upsert the `(document_id, user_id, 'app')` row (same UNIQUE key).
   The second tab silently overwrites the first. The two tabs fight for that
   row's `current_page`. This is unlikely in practice but not guarded.

### Recommendation: **keep presence as-is (option A) — no migration needed**

**Reason:** Presence is architecturally independent of the annotation engine
today. It lives on its own table (`document_presence`), its own Realtime
channel (`document-presence:<id>`), and its own service functions. The new
engine (`annotationDocSync.js`) uses the `annotation_updates` op-log with Y.js
CRDT semantics — a write-ahead log of CRDT ops is the wrong primitive for an
ephemeral, write-wins, last-seen-heartbeat system like presence. Migrating
presence onto the new engine's Realtime channel would couple two unrelated
concerns and lose the decoupled design that already exists.

The Supabase `postgres_changes` WAL approach it uses is perfectly suited:
ephemeral (no durability required), low volume (only page-change writes), and
already working. Moving to Supabase's dedicated `track` / `untrack` Presence
API (option B) would reduce latency slightly and eliminate the stale-row
accumulation problem, but the current design already handles stale detection
client-side and the latency difference is imperceptible for an avatars-in-a-rail
feature.

**Short-term action items (optional hardening, not migration):**
- Add a 60-second heartbeat interval so users reading a single page stay visible
  (low cost: one upsert/min, no schema change).
- Add a Postgres function/cron to DELETE `document_presence` rows where
  `last_seen < now() - interval '10 minutes'` to prevent table bloat.

**Migration verdict:** Presence requires **no changes** during the Syncfusion
removal / pdf.js cutover or the `annotationDocSync.js` migration. It is safe to
ignore for phases 36–37 and beyond.

---

## Confidence

**High.** All four presence functions were read in full source. All call sites
in `PDFViewer.jsx` were traced directly. The hook (`useDocumentPresenceList.js`)
and roster logic (`presenceRoster.js`) were read in full. The new engine
(`annotationDocSync.js`) was confirmed to have zero presence references. All
relevant migrations were read. The only uncertainty is whether any unreachable
code paths (e.g. the legacy `survey_presence` table from the older session model)
are exercised by code not found in the `src/` tree — that table appears fully
orphaned from the current app code stack.
