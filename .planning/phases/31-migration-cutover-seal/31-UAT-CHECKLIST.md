# Phase 31 — Manual UAT Checklist

_Written: 2026-05-01 04:14 (planner) — to be executed by user 2026-05-01_

This is the hands-on UAT for Phase 31 (Migration Cutover Seal). Each numbered
step below is **one observable action** with **one yes/no expectation**. Walk
the steps in order, one at a time. Reply with the result of each step before
moving to the next — do not pre-run multiple steps in a single session pass.

## Test PDFs

- **SE-011** — the 512-row test doc.
- **Package 2 - Rev 4 -- IC.pdf** — the 21K-row test doc.

## Setup

Dev server should already be running at http://localhost:5173/ (auto-login is
wired via `.env.development.local`; never log in manually).

---

## Acceptance Criteria Mapping

The 7 CONTEXT.md acceptance criteria map to UAT steps as follows:

| AC | Given/When/Then summary | Covered by step(s) |
| --- | --- | --- |
| AC-1 | 500+ legacy doc backfills + cutover_completed_at set + Y.Doc populated on first open | 1, 2, 3, 4, 5 |
| AC-2 | Single annotation save < 1s + zero document_annotations writes + Y.Map updated <200ms | 8, 9, 10, 11 |
| AC-3 | Delete < 200ms locally + Y.Map removes entry + zero DELETE on document_annotations | 14, 15, 16 |
| AC-4 | New annotation carries stable UUID matching Y.Map key | 19, 20 |
| AC-5 | Kill switch off → zero upsertAnnotationsByPage calls + log line absent | 9, 10 |
| AC-6 | Sync failure → CRDT queue flushes cleanly without legacy fallback on reconnect | 22, 23 |
| AC-7 | Offline edits persist on reload (IndexedDB + reconnect) | 25, 26 |

Kill-switch panic rollback (CONTEXT.md Risk and Rollback section) is covered
by steps 28–32.

---

## Section A — SE-011 first-open backfill round-trip (AC-1, AC-7)

### Step 1
Open SE-011 in a fresh browser tab pointing at http://localhost:5173/.
**Expected:** the doc loads.
**Reply:** yes / no.

### Step 2
On the SE-011 tab, look at the page area. Count or eyeball whether the
existing annotations are rendered.
**Expected:** all pre-existing annotations appear (500+ rows visible). The
page is not blank.
**Reply:** yes / no.

### Step 3
On the SE-011 tab, look at the corner sync chip (status indicator).
**Expected:** the chip is NOT red and shows no failure state. The storage
banner is NOT visible.
**Reply:** yes / no.

### Step 4
Open DevTools → Network tab → filter by `documents`. Watch for the next
~5 seconds.
**Expected:** there is exactly one `UPDATE` (PATCH) request to the
`documents` table that mentions `cutover_completed_at` in the body.
**Reply:** yes / no.

### Step 5
In Supabase Studio (or via psql), run:
`SELECT id, cutover_completed_at FROM documents WHERE id = '<SE-011 doc id>';`
**Expected:** `cutover_completed_at` is a non-NULL timestamp (not NULL).
**Reply:** yes / no, and paste the timestamp value.

### Step 6
DevTools → Application → Local Storage → look at the keys for
http://localhost:5173/.
**Expected:** key `pdf_app_legacy_bulk_upsert` is NOT present (default off).
**Reply:** yes / no.

### Step 7
DevTools → Console → search/filter for the literal string
`cutover-complete hydrate — reading from Y.Doc`.
**Expected:** the log line is NOT yet present (this is the first open;
backfill ran on this open, the Y.Doc-only hydrate kicks in on subsequent
opens). NOTE if you reload the page on this same tab and re-check, the
line SHOULD appear on the second open.
**Reply:** yes / no for the first-open absence.

---

## Section B — SE-011 single-annotation save round-trip (AC-2, AC-5)

### Step 8
On the SE-011 tab, switch to the counter tool and click once on page 6 to
drop a counter pin.
**Expected:** the pin appears within 200ms locally.
**Reply:** yes / no.

### Step 9
DevTools → Console → search for the literal log line
`[CloudSync][push] upsertAnnotationsByPage start`.
**Expected:** the log line is ABSENT (kill switch is off so the legacy bulk
path does not run).
**Reply:** yes / no.

### Step 10
DevTools → Network tab → filter by `document_annotations`.
**Expected:** ZERO `INSERT` / `UPDATE` requests to `document_annotations`
fired for the new pin. (CRDT-only writes.)
**Reply:** yes / no.

### Step 11
Watch the corner sync chip after the pin is dropped.
**Expected:** the chip flips to "syncing..." then "synced" within ~2 seconds.
**Reply:** yes / no.

### Step 12
Reload the SE-011 tab.
**Expected:** the new counter pin from step 8 is still present after reload.
**Reply:** yes / no.

### Step 13
After the reload in step 12, DevTools → Console → search for
`cutover-complete hydrate — reading from Y.Doc`.
**Expected:** the log line IS now present (second open of a sealed doc reads
state directly from the Y.Doc snapshot, skipping the legacy SELECT).
**Reply:** yes / no.

---

## Section C — SE-011 delete round-trip (AC-3)

### Step 14
On the SE-011 tab, right-click the counter pin from step 8 and select Delete.
**Expected:** the pin disappears within 200ms locally.
**Reply:** yes / no.

### Step 15
DevTools → Network tab → filter by `document_annotations`.
**Expected:** ZERO `DELETE` requests fired against `document_annotations`.
**Reply:** yes / no.

### Step 16
Reload the SE-011 tab.
**Expected:** the counter pin is still gone (delete persisted via Y.Doc).
**Reply:** yes / no.

---

## Section D — Package 2 large-doc backfill (AC-1 at scale)

### Step 17
Open Package 2 - Rev 4 -- IC.pdf in a fresh tab.
**Expected:** the doc loads. Initial PDF rendering may take a few seconds,
but no 60-second statement timeout fires and the storage banner does NOT
appear in red.
**Reply:** yes / no.

### Step 18
On the Package 2 tab, eyeball whether the existing 21K+ annotations render
across pages (sidebar count or page-6 visual check).
**Expected:** all pre-existing annotations are present.
**Reply:** yes / no.

---

## Section E — ID-at-creation stamping (AC-4)

### Step 19
On any open doc, switch to the counter tool, drop a fresh pin.
DevTools → Console → run:
```javascript
Object.values(window.__lastSavedAnnotationsByPage || {})
  .flatMap(p => p.objects || [])
  .filter(o => o?.data?.type === 'counter')
  .slice(-3)
  .map(o => o.data.id)
```
**Expected:** each id is a UUID-format string (8-4-4-4-12 hex), not undefined
and not a `counter-<timestamp>-<rand>` legacy string.
**Reply:** yes / no, paste the array.

### Step 20
Reload the page.
**Expected:** the same UUIDs from step 19 are still present after reload
(Y.Doc snapshot keys on these stable ids).
**Reply:** yes / no.

---

## Section F — Package 2 single-annotation save (AC-2 at scale)

### Step 21
On the Package 2 tab, add a callout (any tool — pen, text, or shape callout
works for this check).
**Expected:** save completes in under 1 second; the corner sync chip flips
to "synced" within ~2 seconds; no red banner.
**Reply:** yes / no.

---

## Section G — Sync failure CRDT-flush smoke (AC-6)

### Step 22
On the SE-011 tab, DevTools → Console → run
`window.__crdtForceLegacyFail = true;` then add an annotation and wait
~30 seconds.
**Expected:** the storage banner appears with the `sync_queue_stuck`
variant (Phase 30 contract preserved).
**Reply:** yes / no.

### Step 23
DevTools → Console → run `window.__crdtForceLegacyFail = false;` then add
another annotation.
**Expected:** the new annotation syncs cleanly (banner clears or resolves
on next save), no fallback to the legacy bulk path.
**Reply:** yes / no.

---

## Section H — Offline-then-reconnect persistence (AC-7)

### Step 24
On the SE-011 tab, DevTools → Network tab → set throttling to "Offline".
**Expected:** the tab is now offline.
**Reply:** yes / no.

### Step 25
While offline, add a counter pin and a drawing stroke. Then reload the
page (still offline).
**Expected:** both edits are still present after the offline reload
(IndexedDB persistence).
**Reply:** yes / no.

### Step 26
DevTools → Network tab → switch throttling back to "No throttling" /
"Online". Wait ~5 seconds.
**Expected:** the queued edits flush to the cloud cleanly; the corner
sync chip transitions to "synced".
**Reply:** yes / no.

### Step 27
Reload the page (online now).
**Expected:** the offline edits from step 25 are still present after the
online reload.
**Reply:** yes / no.

---

## Section I — Kill-switch panic rollback

### Step 28
DevTools → Application → Local Storage → for http://localhost:5173/ set:
key `pdf_app_legacy_bulk_upsert` value `true`.
**Expected:** the key is now visible in localStorage.
**Reply:** yes / no.

### Step 29
Reload the SE-011 tab.
**Expected:** the page reloads, doc loads as normal.
**Reply:** yes / no.

### Step 30
Add an annotation, then DevTools → Console → search for
`[CloudSync][push] upsertAnnotationsByPage start`.
**Expected:** the legacy log line IS now present (kill switch re-engaged
the legacy bulk-upsert path).
**Reply:** yes / no.

### Step 31
DevTools → Network tab. Look at requests fired by the save in step 30.
**Expected:** there is BOTH a write to `document_annotations` (legacy bulk
upsert) AND a CRDT-side write. Phase 30 dual-write behavior is preserved as
a panic rollback.
**Reply:** yes / no.

### Step 32
DevTools → Application → Local Storage → delete the
`pdf_app_legacy_bulk_upsert` key. Reload the page. Add another annotation.
**Expected:** the legacy log line from step 30 is ABSENT again (kill switch
off → post-cutover behavior restored). Network tab shows no
`document_annotations` write.
**Reply:** yes / no.

---

## Sign-off

- [ ] All 32 steps above passed.
- [ ] Issues noted (write below):
      _________________________________________________
      _________________________________________________
      _________________________________________________
- [ ] All clear — Phase 31 ready for VERIFICATION.md + RECONCILIATION.md.

User: ___________
Date: ___________
