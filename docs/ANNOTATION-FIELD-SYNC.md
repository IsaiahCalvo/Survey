Written: 2026-09-24 10:15

# Per-field sync for annotation marks (store version 2)

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
annotations[storageKey] = Y.Map {
  p: <page number>,
  o: Y.Map { ...the mark's fields... }
}
```

Inside `o` (`src/services/annotationMarkStore.js`):

* every plain-object value is a nested Y.Map, all the way down (`data`,
  `meta`, a callout's `data.legacyCallout` and its `style`, ...). Yjs resolves
  each key on its own, so two people changing different keys both keep them;
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

`annoMeta.annotationStoreVersion = 2` marks a converted document.

## Writes

`writeAnnotationMark(doc, key, page, next, { base, echoVersions })` writes
only the keys that differ between `base` and `next` (the Undo diff:
`diffAnnotationFields`), and only when the stored value differs, inside the
caller's transaction. No base = make the stored mark equal `next`. Creating a
mark sets the whole nested map. Deleting deletes the whole entry, so a delete
wins over a concurrent field edit (and a field edit never brings a deleted
mark back).

Every writer goes through it: the viewer capture (`syncByPageToDoc`), the
eraser-lane stable-base edit (`applyByPage`), the erase commit and counter
renumber Undo (`annotationEraseTransaction.js`), the callout meta migration,
and the conversion.

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

## Conversion (one time)

`convertLegacyAnnotationEntries` rewrites every v1 `{ p, o }` entry as a nested
map and stamps the version. Entries without a usable page/object are dropped
(owner accepted losing unreadable old data). `useAnnotationDoc` runs it on
open (and on late role resolution), writable roles only, like the other
durable repairs. Until then the store still reads v1 entries, and a v1 entry
is rewritten only for a real change: a viewer re-projecting identical marks
never writes. Two screens converting the same document at the same moment
each write the same content, so whichever map Yjs keeps is identical.

Older builds are unsupported. They cannot read nested marks, and an old
build's capture deletes marks it cannot read. Every device must update.

## Offline edits reach peers that are already open

Open peers only receive WAL rows (realtime inserts + catch-up), never
snapshots. An update whose WAL append failed and that a gap-repair checkpoint
then covered used to be settled by the snapshot alone, so already-open peers
never saw it until they reopened. `settleSnapshotCoveredRecords` now queues
each such update for a live re-send (`queueLiveResend`): the exact bytes under
the same writer id and sequence (the append RPC returns the existing row for
an exact replay, so this is idempotent). The re-send runs right away, again
when realtime re-subscribes after a reconnect, with backoff on failure, and
once more on close. A permission denial or sequence collision drops it (the
snapshot still carries the edit for every later open).

## Cross-doc copies in the sync layer

A Y type lives in one doc, so the permission-rollback projection, rebased
staging, and legacy IndexedDB recovery copy values with
`copyDurableMapValue` (syncs nested maps key by key, rebuilds missing ones).
Rebased staging collects changed ROOT keys with
`rootKeysChangedByTransaction`, because a field edit changes
`annotations[key].o`, not the root map.

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

## Limits

* Same field, concurrent: last writer wins (per key). The rare case of three
  or more concurrent writers on a nested bag (e.g. `knee.x`/`knee.y`) can mix
  keys from two writers; linked groups never mix.
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
* The live re-send queue is in memory: if the tab closes before the re-send
  lands, open peers get the edit when they reopen (from the snapshot).
