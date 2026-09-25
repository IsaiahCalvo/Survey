Written: 2026-09-24 10:15 (revised 2026-09-24 11:30 after reviews A and B; "Opening fast" added 2026-09-24 19:45)

# Per-field sync for annotation marks (store version 3)

Replaces the 2026-09-23 dual-format design (base object + field registers +
repair passes; kept for reference at git tag
`reference/field-sync-dual-format-attempt`). Owner ruling 2026-09-24: there
are no users besides the owner, so there is no compatibility with older builds
and only one storage format.

## Problem

The durable store (`src/services/annotationDocStore.js`, Y.Doc map
`annotations`) held each mark as ONE plain value `{ p, o }`. Yjs resolves
concurrent `set`s on a key last-writer-wins on the whole value, so when A
changed a mark's colour while B changed its size, one change was lost. The
same loss hit field-level Undo when the other person's edit was still in
flight, and drag/slider frames written as whole marks overwrote a
collaborator's concurrent change.

## Layout

```
marks[storageKey] = Y.Map {
  p: <page number>,
  o: Y.Map { ...the mark's fields... }
}
```

Marks live in a NEW root map, `marks`. The map's name is the store version
(v3); nothing else is stamped. The old whole-object `annotations` map is left
untouched in every document for the reference build, and this build never
writes it. It reads it once per document: marks drawn on older builds are
carried into `marks` by a one-time carry-over (w28, see "Marks drawn on older
builds" below). Everything else in the
document is unchanged and shared: eraser lanes, deletion tombstones, survey
markers, meta (spaces, callout list), the erase outbox.

Inside `o` (`src/services/annotationMarkStore.js`):

* every plain-object value is a nested Y.Map, all the way down (`data`,
  `meta`, a callout's `data.legacyCallout` and its `style`, ...). Yjs resolves
  each key on its own, so two people changing different keys both keep them;
* a field whose own name starts with `#` or `\` is stored with a `\` in
  front, so it can never be mistaken for a linked-group key;
* these stay ONE stored value, exactly as field-level Undo treats them
  (`annotationLocalHistory.js`):
  * arrays (`points`, `path`, `quads`, a callout's drawn `objects`);
  * `ANNOTATION_ATOMIC_FIELD_PATHS` (`data.textRange`, `data.textRangeModel`);
  * a linked field group (`getAnnotationLinkedFieldGroup`, shared with Undo):
    a point shape's geometry (`points`/`path` + position/size/transform) or a
    text markup's range + drawn box. It is stored under one key
    (`#pointGeometry` / `#textMarkup`) holding `{ 'left': .., 'data.quads': .. }`,
    so two concurrent corner drags can never leave one person's points with
    the other's box.

## Writes

`writeAnnotationMark(doc, key, page, next, { base, echoVersions })` writes
only the keys that differ between `base` and `next` (the Undo diff:
`diffAnnotationFields`), and only when the stored value differs, inside the
caller's transaction (a standalone call is its own single transaction). No
base = make the stored mark equal `next`. Creating a
mark sets the whole nested map. Deleting deletes the whole entry, so a delete
wins over a concurrent field edit (and a field edit never brings a deleted
mark back).

Every writer goes through it: the viewer capture (`syncByPageToDoc`), the
eraser-lane stable-base edit (`applyByPage`), the erase commit and counter
renumber Undo (`annotationEraseTransaction.js`), and the callout meta
migration.

## Which fields the viewer changed (capture)

The viewer pushes its whole render state after every change. Writing every
field that differs from the document would put back a collaborator's change
the screen has not painted yet, so the capture compares each mark with what
the viewer had, never with the document (`createViewerCaptureState`, kept per
open handle):

* The viewer's own copy from the previous capture, or the newest copy the
  store handed it, is untouched: nothing is written.
* Any other object is intent (an edit, an Undo, a revert). Its base is the
  copy it was made from: normally the viewer's previous copy. An edit written
  as `{ ...older, left }` keeps the older copy's nested objects (`data`,
  `meta`) by reference, so when every shared nested object belongs to one
  older copy of that mark, the edit was made from it (a drag rebuilding each
  frame from its drag-start object) and only what differs from THAT copy is
  written. Otherwise a frame would put back a collaborator's change painted
  mid-drag.
* Echo: a changed field whose value equals a copy handed to the viewer since
  its previous capture is the screen repainting a collaborator's value inside
  an edited object (a drag frame built from the latest state). It is not
  written back, so it can never overwrite a newer value. The window is one
  capture: the hook reads the document inside its React state update, so the
  capture right after that render sees every copy it painted. Older equal
  values are the user's own choice and are written.
* A mark is deleted only if the viewer had it at the previous capture and no
  longer has it. A mark the viewer never painted is never deleted.
* A mark the viewer knew that is gone from the document was deleted by
  someone else: an edit to it is not written (delete wins) and the screen
  drops it.
* After writing, marks whose stored value differs from the viewer's copy (the
  viewer was behind on another field) come back as `reconcile` swaps.
  `useAnnotationDoc` applies them only where the screen still holds the exact
  object the capture saw (`annotationReconcile.js`), so a newer local edit is
  never overwritten.

Remote updates repaint the screen from a fresh read taken when React applies
the update (not when the notification fired), so a local edit captured in
between is never painted over by an older copy.

A gesture that saves a whole page copied earlier cannot be told apart from a
deliberate revert by value, so the gestures save only their own marks.
`mergeDraggedMarksOntoPage` (`src/utils/dragCommitMerge.js`) writes each
dragged mark's own change (drag start → last frame) onto the page as it is at
release. It is used by polygon/polyline corner drags, counter Shift-orbit, and
group rotate/resize (`useSVGInteraction.js`).

Editors work the same way. The text box and callout text editors build their
result from the object captured when editing STARTED; `mergeEditOntoCurrent`
writes only what the edit changed (edit start → result, ignoring float tails
from geometry the callout editor re-derives from page pixels) onto the mark as
it is at commit. A move or restyle a collaborator made while the user typed
survives; a mark deleted meanwhile is not brought back
(`TextEditOverlay.jsx`, the callout commit in `PDFViewer.jsx`).

## Reads

`readAnnotationEntry(doc, key)` returns a plain `{ p, o }` with identity
normalized (map key promoted into `data.id`). It is cached per mark and
rebuilt only when that mark changed: a `beforeObserverCalls` listener walks
each transaction's changed types up to their root key. That runs before any
observer, so nothing can read a stale mark; reads inside an open transaction
bypass the cache. `docToByPage` builds the page lists from the cache, then
applies eraser lanes and counter numbering as before. When the viewer's own
object equals what it just wrote, the cache adopts it (no re-render, no
key-order churn). `readRawAnnotationEntry` (uncached, not normalized) is for
compare-and-swap checks (the erase commit).

## The PDF's own embedded annotations

The owner accepted losing their own old markup, not the markup that ships
inside the PDF file. Older builds imported a PDF's embedded annotations into
the old `annotations` map and stamped `documents.embedded_import_completed_at`,
so that column can no longer gate the import. The gate is now a marker in the
document's Y.Doc meta, `embeddedImportedIntoMarks`, written only by this store
version (`src/utils/embeddedImportGate.js`, the import effect in
`PDFViewer.jsx`):

* The first EDITOR open of a document on this build imports the PDF's
  embedded annotations into `marks` once; viewers (and a role not resolved
  yet, unless the user owns the document) never write — the PDF's own layer
  still shows for them.
* Ids are the PDF annotation's own id (else page + position in the file), so
  two editors opening at the same moment both import the same keys with the
  same content and Yjs keeps one of each (verified live: two identical
  imports, 9 marks, no duplicates).
* Deletion tombstones (shared by every build) are honoured: an embedded
  annotation deleted in any build is not brought back.
* The marker is written only after every imported mark is in the store (a tab
  closed mid-import retries next open), and once written, deleting an
  imported mark is final.
* The server column is still stamped for the reference build.
* w27 (2026-09-24): a page pdf.js cannot read at all is skipped by the
  importer while the rest imports. If the file lists markup the app imports
  on that page (or its raw index could not be built, e.g. no raw bytes), the
  marker is held back and the attempt recorded in meta
  `embeddedImportIncomplete` `{ attempts, pages }`; the next open retries
  (present marks are skipped by id, deleted ones are tombstoned). After 3
  attempts (one per time a screen opens the document) the marker is written
  with `incompletePages`: that page's markup is then not imported (recorded
  and logged only, the user is not told), so a page that always fails cannot
  make every open re-parse the file. A single annotation the converter
  cannot read is not retried; it is only logged.
* "In the store" means this screen's document. The marker is a later write
  by the same screen as the marks it imported, and Yjs applies one writer's
  changes in order, so a peer holds the marker back until those marks have
  arrived (see the split-row section below).

What an open of a document edited by older builds shows: the PDF's own
markup (re-imported) plus marks made on this build, plus (w28) the marks
drawn with an older build, carried over once (next section). The
home list thumbnail is a per-browser cache; one captured by an older build
still shows those old marks until the document is opened on this build
(it is refreshed ~2.5 s after the open). Seen on "Package 2 - Rev 4 -- IC.pdf"
(w27): its page-1 red marks (a rectangle, pen strokes, counters, text) were
drawn with an older build; the PDF file itself has markup only on pages 6-11.

## Marks drawn on older builds (w28, 2026-09-24)

The owner saw the cost of dropping them ("Package 2 - Rev 4 -- IC.pdf": 12
marks on page 1, 3 pen strokes on page 11 no longer showed) and wants them
back. `src/services/legacyMarksCarryOver.js` copies them into `marks` once
per document; `useAnnotationDoc` runs it on a writable open.

* Marks the user drew: carried under their OLD key, so a mark keeps its id,
  its eraser lanes (shared by every build, keyed by storage key) and its
  counter numbering. Written through `writeAnnotationMark`, the same writer
  as any new mark; the read side normalizes identity exactly as the old read
  did, so every type reads back with the same fields
  (tests/legacyMarksCarryOver.test.mjs; Package 2's 15 and all 3,071 old
  entries round-trip equal). A key already in `marks` is never written.
* The PDF file's own markup (`isPdfImported`, `pdfAnnotationId`,
  `pdfAnnotationType`, or the same under `data`; paste clones drop all of
  them) is left to the embedded import above, which re-imports the file's
  markup and honours tombstones. Older builds keyed some of those
  differently (Package 2: 886 of 3,056 under the bare PDF id, the new import
  uses `pdf-appearance:<id>:layer:0`), so carrying them would draw them twice.
* Except a PDF mark the user EDITED on the old build
  (`pdfImportedEditState: 'edited'`; Package 2 has 3: one resized, two partly
  erased). Once the embedded import has run, the old edited fields replace
  the re-imported copy's fields under the copy's key and identity, but only
  while that copy is untouched since the import (exactly one copy, not
  stamped edited, no eraser lane). A copy the user deleted (tombstone) stays
  deleted; with no copy and no tombstone the old edited mark is carried
  under its old key. Unedited PDF marks the new importer did not recreate
  (a page it could not read, `incompletePages`, or one annotation its
  converter dropped) are NOT carried: which layer shows such a page's
  markup is the importer's call (w27), and carrying could draw it twice.
  Package 2 has none.
* Nothing is deleted from either map; the old map is only read.
* Each batch (~192 KB of mark JSON, one transaction) first writes a record of
  the old keys it handles (`legacyMarksCarriedBatch:<client>:<clock>` in
  annoMeta), then the marks. The record has the lower clocks, so any screen
  that holds a carried mark also holds its record, and a recorded key is
  never handled again: a carried mark deleted later stays deleted even if
  the marker row has not landed yet (review A). The WAL split cuts any
  update over 256 KB into chained parts as for any edit.
* The marker `legacyMarksCarriedIntoMarks` (annoMeta) is written in its own
  transaction after everything is handled; with it present nothing is
  scanned again. It is held back while edited PDF marks wait for the
  embedded import. A document with no old user-drawn or edited PDF marks
  gets no writes and no marker.
* When: after realtime has caught up following the subscribe, plus a random
  0-1.5 s (also after the import pass), then re-checked (another screen's carry-over that already landed
  is seen first). If the embedded import has not run yet, it waits for THIS
  screen's import pass (its marker or "incomplete" record, written locally):
  the import saves whole pages built from what the screen held a moment
  earlier and would paint over a carry-over published meanwhile. A marker
  from another screen is not a trigger (that screen carries after its own
  import). After 60 s without a local pass it carries anyway. The marks
  appear a moment after the document opens.
* Viewers and an unresolved role never write; the next writable open (or
  the role resolving to writable) does it. Until then a viewer does not see
  the old marks.
* Paint order: a page paints in store order, which after a reload follows
  the writer, not the time (Yjs rebuilds a map writer by writer). The
  reference build behaved the same way: loading Package 2 it painted the
  page-11 strokes underneath the PDF's markup (positions 0-2 of 260).

Limits: two screens carrying the same document at the same moment each
create the mark's map; Yjs keeps one, so an edit or delete made on the other
screen's copy in the short window before the two see each other is lost (a
deleted mark comes back once). The timing rules above make this need two
opens within about a second. Same class as two editors running the embedded
import at once. A true single writer would need a server-side claim. An
edited PDF mark's replace writes every field; if another screen moves that
re-imported copy in the same short window, the two merge key by key and the
mark can land in the wrong place until someone moves it again. A PDF mark the
new importer split into several layers is not replaced (ambiguous); its old
edit is dropped (Package 2 has none). With a permission rollback in play the
sync layer re-encodes changes; it copies meta first so the carry record
still comes before the marks. Marks
an older build writes after the carry-over are not carried (older builds are
unsupported).

## Older builds

Unsupported. They read and write only the old `annotations` map, so they
neither see nor touch new marks, and this build neither sees nor touches
theirs. Every device must update.

## No save is huge (w26, 2026-09-24)

Opening "Package 2 - Rev 4 -- IC.pdf" (3,055 embedded ink marks) ran the
embedded import as one transaction per page, so one WAL row per page: 0.8 to
8.8 MB (17.9 MB in all). The old whole-object store made the same rows at
0.8 to 7.9 MB (16.3 MB): the per-field layout adds ~10%, the bulk is the
imported ink itself (source appearance geometry, path, outline polygons).
Realtime could not carry those rows, a 1,000-row tail read that included
them hit the statement timeout (the document could not open), and the
database went unhealthy.

* `enqueueAppend` cuts any update over 256 KB (`WAL_UPDATE_MAX_BYTES`) into
  parts (`src/services/annotationUpdateSplit.js`), each its own row and
  client_seq, queued back to back. Parts are runs of whole structs, cut at
  the start of a new root entry where possible (a peer applying them one by
  one sees whole marks), with the delete set on the last part. Applying the
  parts in order gives exactly the whole update's state; Yjs holds a part
  back until the earlier parts of the same client arrived, so a later row
  (the embedded-import marker) is never visible without every part before
  it. The Package 2 import is now 74 rows, the largest 256 KB. A part is
  re-checked after an unfinished mark is carried into it; only a single
  value bigger than the budget can make a part larger (one value cannot be
  cut). Each part depends on the part before it (and a deletion on the
  record holding what it deletes), so no part reaches the log ahead of an
  earlier part that failed. A denial on some parts after earlier parts were
  accepted asks for a full history reset.
* Tail, catch-up and snapshot-refresh reads page 16 rows and, when a page
  times out, retry after a short wait with a quarter of the rows down to one
  (`readWalRowsAfter`), aborting the abandoned request. The smallest working
  size is remembered per document (and in localStorage), so a reopen does
  not repeat the failing big read. Other failures are not retried smaller.
* A Realtime row that arrives without its data (over the message limit) or
  fails to apply turns sync red and is read back from THAT row on, with
  backoff, unless a reconnect catch-up is already doing it; sync turns green
  only once it is in.
* The 40-row checkpoint does not stop the append queue while more rows are
  queued behind it; the debounced checkpoint runs once the queue is empty.
  Checkpoint uploads get ~3 s more per MB (capped at 60 s). The outbox
  encodes its accepted-state checkpoint only when it actually compacts.
* A failed open no longer leaves the page covered: hydration becomes
  `unavailable` (nothing imports or writes), the PDF shows read-only (the
  same layer a viewer gets, so nothing drawn can be lost), and the open is
  retried with backoff: 2 s doubling to 60 s, 8 tries (`useAnnotationDoc`).

Still large: the checkpoint of such a document is one row (~4.3 MB gzipped
for Package 2; the old format was ~3.75 MB). Splitting checkpoints needs a
schema change. Recovery for a document that already has oversized rows:
`scripts/w26-reset-document-annotation-store.mjs` (dry run by default).

## Opening fast (w29, 2026-09-24)

"Package 2 - Rev 4 -- IC.pdf" (3,071 marks: a ~21 MB store, a ~6 MB
snapshot row on the wire) showed its marks 6-10 s after the open started; the
first page sat under the grey loading cover all that time. Now:

* The marks paint early (`openAnnotationDoc({ onPreview })`, display only):
  from this device's saved copy (the outbox's clean checkpoint) before any
  network, and from the cloud snapshot as soon as it is applied to the live
  doc. `useAnnotationDoc` sets hydration `{ ready: false, source: 'preview' }`;
  the first page then shows the PDF and the marks with a see-through blocker
  instead of the grey cover (`annotationHydrationGate.js`,
  `isFirstVisibleAnnotationPagePreviewing`), and the document is read-only
  (the body layer 'unavailable' uses) until hydration is ready, because
  nothing drawn then could be saved. Nothing imports or writes until the
  real hydrate, which replaces the preview. An empty store never seeds
  itself from a preview; what the viewer held before the first preview is
  kept across failed-open retries of the same document.
* The saved copy records which snapshot row it contains
  (`snapshotIdentity` = at_seq, writer_id, writer_epoch; the RPC's CAS makes
  writer_epoch strictly increase, so the triple names one row). An open that
  has it reads only the row's identity; if unchanged, the ~6 MB body is not
  downloaded or applied again (the tail after at_seq is still read). A
  snapshot this handle writes becomes the saved copy (stored as-is when the
  outbox still holds only what the bytes contain, merged otherwise), so the
  owner's own reopen also skips it. Any mismatch or failed identity read
  downloads the row as before.
* Compaction fast path: the outbox stores the accepted state as-is instead of
  merging two ~20 MB updates when its checkpoint is the one the caller loaded
  or last wrote (checkpoint `token`) and every stored record is one the
  caller already applied.
* Work removed from every open: the second publish pass when the live doc
  already equals the accepted state (same Yjs snapshot), the empty legacy
  IndexedDB merge (and opening that database when the browser lists it as
  absent), the probe copy when the local copy holds no new structs and only
  deletions staged already has, a second full encode for the staged seed, the
  staged copy of the saved checkpoint (staged is seeded from acceptedDoc), and
  the frozen copy of the IndexedDB doc (it is used directly until
  reconciliation; a rotation first freezes a real copy).
* The writer-sequence and snapshot reads start with the open, in parallel with
  IndexedDB, and the open yields between its heavy steps so the PDF page and
  input get turns.

## Live sync latency (w30, 2026-09-24)

The owner drew a pen stroke in one tab on "Package 2 - Rev 4 -- IC.pdf" and
it took ~8-10 s to show in the other. Measured hop by hop
(`agent-cli/sync-latency-probe.mjs`, opt-in trace `src/services/syncTrace.js`):
the sender encoded the whole staged doc (17.7 MB) on every edit (~165 ms)
before queueing; a 4.5 MB gzipped checkpoint was uploaded 1.2 s after every
stroke (~5 s each) and held the document lock, so the next stroke's WAL insert
waited (seen: 1.8 s); every 40th row the append queue itself waited for that
upload; the row then took 0.2-0.6 s through Postgres Changes; and each change
ran two full JSON.stringify passes over every mark on both screens (fixed by
w29). Result before: 0.4 s on a small document, 1-2.7 s on Package 2, far more
while checkpoints piled up.

What changed:

* No per-edit checkpoint. A record carries no checkpoint; the repair
  checkpoint a failed append (or a gap) needs is rebuilt on demand:
  `localPrefixThrough` merges the pending, non-refused local records up to that
  record (plus its split siblings) and `encodeRepairCheckpoint` adds the
  accepted state, which only grows. Outbox replay does the same (it used to
  checkpoint the whole staged doc, which already held later edits).
* The 40-row compaction checkpoint runs off the append queue
  (`state.compactionChain`, encoding the accepted state only); `drain()` still
  waits for it. With a durability gap it stays inline as before.
* The checkpoint debounce grows with the checkpoint's gzipped size: 1.2 s for
  a small document, ~4 s per MB, at most 30 s (Package 2: ~18 s). The WAL row
  is what makes an edit durable; the checkpoint only shortens reopen.
* A realtime row that changes nothing on this screen (its own echo) no longer
  re-renders the page list.
* Live previews (`src/services/annotationLiveBus.js`). Each small local edit
  that only adds (48 KB or less, no deletions) is broadcast as it is made, on
  a private Realtime Broadcast channel `anno-live:<document id>`, under its WAL
  row's key (writer id, client_seq). A receiver accepts one only if it is
  self-contained: every struct it points at is its own, it touches only the
  marks map, and it adds marks this screen does not hold. That is a brand-new
  mark; an edit of an existing mark waits for its row. It is decoded in a
  throwaway doc (seeded with a placeholder for the sender's earlier clocks) and
  shown BESIDE the document: `getLivePreviewByPage()`, merged by
  `useAnnotationDoc`. It never enters the Y.Doc, so nothing can build on it,
  persist it, checkpoint it or send it back; `applyByPage` and
  `applyEraserMutation` drop preview marks (and expired ones, in case an Undo
  brings one back) that the doc does not hold. Every preview object carries a
  `__surveyLivePreview` flag, so ANY copy of one (a JSON clone in the display
  cache or a Save backup that seeds a reopened empty store, an Undo snapshot, a
  re-keyed duplicate) is recognised and dropped; if the doc holds that mark by
  then, the copy stands for the mark as last delivered (nothing written,
  nothing deleted) and the screen is swapped back to it (an edit made on a
  preview is never shown as saved). Eraser envelopes are cleaned the same way;
  an erase intent that involves a preview in any way (target, history or side
  effect) is cancelled as a conflict, as it was before previews existed. A
  paste of a preview drops the flag (it is the user's own new mark). A key
  another preview already announced is refused. A preview leaves when its row
  is applied (the real mark then comes from the doc) or after 20 s. Receivers
  cap previews per writer (50 a second) and in total (200).
* The channel is private: only people who can open the document may listen,
  and only its editors may send, while it is unlocked
  (`supabase/migrations/20260924230000_live_preview_channel_policies.sql`,
  NOT applied yet). Without those policies the join is refused; the app backs
  off (one join a minute per document) and every edit uses the log path. A dev build can measure
  on a public topic with localStorage `survey:livePreviewPublicChannel` = `1`.

Measured after (two headless tabs, this machine, prod database; paint = the
frame that shows the stroke on the other screen): small document 40-130 ms,
Package 2 70-110 ms with previews (same profile and separate profiles alike);
0.3-0.6 s on the log path alone (no channel policies).

Limits (w30; the first one is lifted by w32, next section): an edit of an existing mark (move, recolour, erase, delete) still
arrives with its WAL row (~0.3-0.7 s). A stroke edited on another screen in
the ~0.3 s before its row lands is shown as drawn (the edit is not written: it
was made on a preview). A preview's counter number is computed on its own
until its row lands. A refused stroke shows elsewhere for up to 20 s, and an
export, print or survey-data upload made in that window includes it. Realtime
checks the channel policies when a screen joins, so a lock or role change
takes effect on previews at the next join (the WAL still refuses at once, and
a refused sender stops broadcasting). The receive cap is per announced writer
id, which a document editor could vary.

Reviews: two adversarial passes (plus a check of the fixes). The first found
that previews applied INTO the Y.Doc let local edits depend on structs the log
might never accept, and let refused content be laundered back through rebase
mode or saving repairs; that design was replaced by the display-only overlay
above. The second found a checkpoint clearing a refusal's red status (fixed:
a compaction that finishes after a refusal cannot mark the handle healthy),
preview copies written through cached lists, duplicates or eraser lanes
(fixed: the flag and envelope cleaning), and a replayed recovery record not
repainting (fixed: it repaints when accepted). A third pass on those fixes
found an erase's history effect still carrying a preview into the erase
outbox (fixed: such a gesture is cancelled), the flag riding into pastes and
into edits finished after the row landed (fixed: paste strips it; the screen
is swapped back), and any checkpoint (not only compaction) turning a refusal
green (fixed: every snapshot result carries the refusal generation it
started under). Still open (low): erasing a counter while a same-series
preview counter is on screen cancels as a conflict.

## Live edits and live ink (w32, 2026-09-25)

w30 made a NEW mark show elsewhere in ~50-150 ms. Every other change (move,
resize, recolour, partial or whole erase, delete) still waited for its WAL
row (~0.3-0.7 s), and a pen stroke appeared on the other screen only after
the pen lifted. Now, on the same private channel `anno-live:<doc>`:

* **Edits (v2 message, `src/services/annotationLiveOverlay.js`).** Any
  small local edit that changes how a mark looks is broadcast, keyed by the
  edit's WAL row (writer id + client_seq) like a v1 preview:
  `{ v: 2, w, s, e: [...] }`, one entry per mark it touched: `{ k, p, s, u }`
  = only the top-level fields that changed (`s`) or went away (`u`),
  measured against the mark as the sender last sent it or was last handed
  it; `{ k, p, o }` = the whole mark when that is smaller; `{ k, d: 1 }` =
  gone. The mark is what `materializeAnnotationKeys` builds (stored fields +
  eraser lanes, the same code docToByPage uses, now shared as
  `applyEraserLanesToObject`). A pure addition of whole new marks still goes
  as v1 (Yjs bytes); a lane-only change (partial erase) no longer sends a v1
  message every receiver dropped. Over 32 KB of JSON or 64 marks: the row
  only.
* **Receiver.** Validated (key = the mark's own id; a patch cannot change
  identity; incoming live flags stripped; over 64 KB refused), rate-capped
  with v1 (50/s per writer, 200 in flight), ignored once its row (or a later
  row of that writer) is in. A patch is applied onto the mark as this screen
  shows it; with nothing to apply it to, the entry waits for its row. Shown
  BESIDE the document: `handle.withLiveOverlays` (used by `useAnnotationDoc`)
  replaces the mark in place (z-order kept) or hides it; an edit of a mark
  this screen does not hold is not shown (no resurrection). Newest message
  per mark wins. An overlay leaves when its row is applied (kept while Yjs
  holds that row back), its marks leave when a later row of the same writer
  changes them, after 12 s, or when the channel closes. Screen updates are
  batched to one per frame.
* **Never written.** Every overlay object carries `__surveyLiveEdit` = a
  token naming the message and mark. The capture (`applyByPage`,
  `applyEraserMutation`, `commitEraseIntent`) takes overlays back out
  (`stripLiveEditObjects`):
  * an untouched overlay copy (or its counter-number copy) is replaced by
    the copy of the mark the document last handed the screen: nothing is
    written; a mark an overlay hides is put back for the capture, so hiding
    is never captured as this screen deleting it;
  * an edit the user made ON an overlay copy is written as only the user's
    own change onto the document's copy (`mergeEditOntoCurrent`), the screen
    is swapped to what was saved and that mark's overlay is dropped (the
    other change shows when its row lands) — UNLESS it would write a field
    the other screen's in-flight edit changed (dragging a stroke someone is
    partly erasing, moving a mark someone is moving): then it is not
    applied and the screen goes back to the saved mark (review A: otherwise
    the other screen's unsaved erase was baked into the mark);
  * an eraser gesture planned on an overlay copy is not applied to that mark
    (`commitEraseIntent` cancels as a conflict, the page-mutation path drops
    that mark's entry);
  * a flagged copy of a mark the document no longer holds (an Undo of a
    delete made while an overlay showed it), or one spread into a mark with
    another id, is an ordinary object without the flag: the capture's own
    rules decide (a mark deleted by someone else stays deleted). A paste
    strips the flag. A copy renumbered by a page insert/delete here stays on
    this screen's page.
* **Live ink (v3 message, `src/services/annotationLiveStrokes.js`).** While
  a pen or highlighter stroke is drawn, the new points go out at most every
  125 ms (≤ 8 messages a second per drawing screen, w34 review: Realtime
  caps a whole project at 100 messages/s on Free, 500 on Pro, and each
  broadcast is delivered to every other screen; nothing while the pen is
  still): `{ v: 3, w, g: stroke id, p, t, c, sw, i, pts, f?, x? }`. The
  stroke id is the id the finished mark gets. A stroke that ends inside the
  first 125 ms sends nothing extra (its v1 preview covers it). Other screens
  draw a ghost polyline (`LiveStrokeGhosts`, inside the page SVG, looks like
  the local in-progress stroke, no pointer events, not an annotation) until
  the finished mark is on screen (its preview or its row) plus 120 ms so it
  never blinks, on cancel, 20 s after the pen lifted, or 10 s after the last
  points. Lost messages are joined straight. Caps: 4,000 points per ghost,
  24 ghosts. One sender and one ghost list per document (the app keeps
  several documents mounted).
* **Alone = silent.** A screen sends NO live message (v1, v2 or v3) unless
  it knows another screen has the document open. Two signals, either is
  enough: Realtime Presence on the live channel (one entry per screen; needs
  `supabase/migrations/20260925120000_live_channel_presence_policies.sql`,
  NOT applied; without it the track is refused and the channel still
  works), and a tiny hello on the channel itself that needs no policy: a
  joining screen says hello, each screen that hears a new hello answers
  once, a leaving screen says bye (2-3 messages per screen that opens, none
  while idle). A person working alone costs zero live messages (was one
  preview per stroke). If a hello is lost, that pair falls back to the saved
  row (~0.5 s) until one of them opens the document again.
* The saved-row path itself was already direct: capture ~4 ms after the
  input, enqueue in the same tick, the WAL insert starts ~15-20 ms later
  (after the local outbox write), the receiver applies a row as it arrives.
  The rest (~0.2-0.6 s) is the database insert plus Postgres Changes, which
  the live messages now hide.

Measured (headless, this machine, prod, small document, two separate
profiles; from the frame the actor's own screen shows the change to the
frame the other screen does; before = w30 main, measured from pointer-up):
new stroke 37-98 ms [41-172], and the ink starts growing ~33 ms after the
pen touches down [only after the pen lifted]; move 37 ms [365-628];
recolour 48-67 ms [498-557]; partial erase 23-25 ms [410-430]; whole erase
18-30 ms, before the eraser lifts [166-651]; delete 32-35 ms [435-532].
Three profiles drawing at once for 20 s (45 strokes): every stroke on every
screen, all converged, median 62 ms, p90 143 ms, max 161 ms.

Realtime cost (billed messages sent by the actor → delivered to the other
screen; WAL rows, REST/RPC calls, bytes and checkpoints are unchanged): a
~0.5 s stroke 1 → 8 sent (7 ink + 1 preview); move, recolour, delete 0 → 1;
partial erase 1 → 1 (was a wasted v1); whole erase 0 → 2-3. Alone: 0 for
everything. Three people drawing non-stop: ~45 billed messages/s for the
whole project (sent + delivered), under Free's 100/s; a fourth and fifth
non-stop drawer would approach it (each extra screen adds its own ink and
receives everyone's).

Limits: an overlay that arrives while the receiver's copy of the mark is
behind shows the sender's changed fields early, and a patch applied onto
that older copy can show a mix until the rows land (display only). A
counter overlay keeps this screen's number until the row lands. Exports,
prints and survey uploads made in the ~0.5 s window include what the
screen shows. An edit made on a mark while another screen is changing the
same fields of it is not applied (the user redoes it after ~0.5 s). A mark
hidden by a delete overlay is put back on its old page number if this
screen renumbers pages in that ~0.5 s. An editor can make other screens
show made-up content or hide a mark for up to 12 s at a time (only editors
may send on the channel; nothing is saved). Edits over the budget (>32 KB,
e.g. a very long partly erased stroke) arrive with their row only.

Reviews: two adversarial passes (write safety; delivery, ordering and
cost) plus a check of the fixes. Found and fixed: an edit on an overlay copy
could save the other screen's unsaved erase into the mark; an Undo of a
delete made on an overlay copy was lost; page renumbering moved an overlaid
mark back; live ink was global (could go out on another document's
channel); counter overlays were treated as edits; a stroke ghost could
vanish before a slow row; older overlays were dropped on any later row of
the writer (rows are not always in order); presence failures were
permanent; per-message full-document re-reads on receivers; no
receive-side size cap.

## Offline edits reach peers that are already open

Open peers only receive WAL rows (realtime inserts + catch-up), never
snapshots. An update whose WAL append failed and that a gap-repair checkpoint
then covered used to be settled by the snapshot alone, so already-open peers
never saw it until they reopened. `settleSnapshotCoveredRecords` now queues
each such update for a live re-send (`queueLiveResend`): the exact bytes under
the same writer id and sequence (the append RPC returns the existing row for
an exact replay, so this is idempotent). The re-send runs right away, again
when realtime re-subscribes after a reconnect, with backoff on failure, and
once more on close. It is bounded: an update over ~900 KB (Realtime's
Postgres-changes payload limit is ~1 MB) is never re-sent, and one that fails
is given up after 6 tries, or at once on a payload-too-large, permission or
sequence-collision answer. The snapshot still carries it for every later open.

What this does NOT cover: an edit made offline in a tab that is closed right
after reconnecting, before any checkpoint (or re-send) lands, reaches others
only when that device opens the document again (its local copy is replayed
then); already-open peers see it at that point, not before.

## Cross-doc copies in the sync layer

A Y type lives in one doc, so the permission-rollback projection, rebased
staging, and legacy IndexedDB recovery copy values with
`copyDurableMapValue` (syncs nested maps key by key, rebuilds missing ones).
Rebased staging collects changed ROOT keys with
`rootKeysChangedByTransaction`, because a field edit changes
`marks[key].o`, not the root map.

## Measured (Node, this machine)

* Drag frame on a 5,000-mark page: 2.6–3.3 ms per frame, 40 bytes per rect
  frame (two numbers). Polyline frame: 606 bytes (its geometry group is one
  value, and is still smaller than the old whole-mark write).
* Recolour all 5,000 marks: 90–107 ms, 113 KB of updates.
* List rebuild of 5,000 marks: 9–19 ms cold, 3–6 ms warm, 2–3 ms after one
  remote change.
* Snapshot size costs more: 5,000 rects are 1.0 MB → 1.9 MB raw (38 KB →
  267 KB gzipped); 5,000 200-point pen strokes are 11.7 → 12.4 MB raw (175 →
  383 KB gzipped). Applying a 5,000-rect snapshot takes 88 ms (was 25 ms).
  A document edited by older builds also still carries its old
  `annotations` map, untouched.

## Limits

* Same field, concurrent: last writer wins (per key). The rare case of three
  or more concurrent writers on a nested bag (e.g. `knee.x`/`knee.y`) can mix
  keys from two writers; linked groups never mix.
* A nested bag that did NOT exist when the mark was created and is then added
  by two people at the same moment (each creating it) keeps only one person's
  bag: Yjs cannot merge two new maps under one key. Bags present at creation
  (`data`, `meta`, a callout's `legacyCallout` and `style`, ...) are created
  with the mark and never re-created, so this only affects bags a feature adds
  later (e.g. a line's `data.midpoint`, where one whole value is the right
  result anyway).
* Survey Markers are unchanged: each marker is still one whole record in its
  own map (last writer wins per marker).
* A callout's drawn `objects` array is one value derived from
  `data.legacyCallout`. After two people change different callout fields the
  merged `legacyCallout` is right (the screen, export and print draw from
  it), but the stored `objects` are one person's projection until the next
  re-projection (any callout edit, or the next open with measured page sizes).
* Echo filter: a user deliberately setting a field to exactly the value a
  collaborator's change delivered in the same render is not written (the
  document already holds that value unless a third change raced it).
* A gesture that deep-clones a stale page and saves it whole still puts back
  what changed since the copy was taken; the known ones are fixed at the
  source (see above).
* Deleting a mark discards a collaborator's concurrent edits to it (delete
  wins). Undo of the delete restores the deleter's copy.
* The live re-send queue is in memory and bounded (see above): if the tab
  closes before the re-send lands, or the update is too large or keeps
  failing, open peers get the edit when they reopen.
* Marks drawn on older builds are carried over once (w28, above); edits an
  older build makes after that are not.
