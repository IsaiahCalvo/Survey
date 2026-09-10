---
status: accepted direction; contract and implementation in progress
---

# Field-merged survey collaboration

Shared survey edits belong in the existing actor-scoped Yjs outbox, authorized
annotation log and checked generation snapshots. Do not create another mutable
JSON save path to solve collaboration conflicts. Legacy sidecars remain preserved
migration input; they cannot acknowledge a failed annotation-log write.

## Current evidence

`surveyCollaborationConflictBaseline.test.mjs` uses real Yjs updates and the
current annotation store. Starting from one marker, actor A adds checklist answer
A and actor B adds answer B. Both update delivery orders retain only B's whole
marker, including after a cold snapshot reopen. A space rename likewise loses to
another actor's whole-space-array update. Different marker IDs merge correctly.
These are legacy v1 characterization tests, not proof of a fix.

## Decision

Use a versioned shared survey model with separate conflict units for independent
work. Keep linked fields together: an entity assignment's ID, name and appearance
must not come from different concurrent assignments. Page and geometry changes
must not produce a marker on one page with another placement's bounds. Checklist
answers use their stable response identities. Spaces, page membership and regions
need stable identities rather than whole-array replacement.

The same-field conflict rule must be deterministic in either delivery order.
Deletion must not revive an item when an older offline edit arrives. Undo, restore,
concurrent creation, ordering and page replacement need explicit tested semantics;
they cannot be inferred from a generic recursive JSON merge.

## Compatibility and privacy

- Keep existing documents on their current model until an explicit checked
  generation transition publishes a verified baseline.
- Enforce the model at the database read/write contracts, not a UI flag alone.
  An older whole-record writer must not append or checkpoint an upgraded document.
- Preserve current generation, account, role, lock and revocation checks; retry
  receipts must remain bound to the original document, generation and writer.
- Keep document entity lists and survey definitions in their existing immutable
  document-owned records. Do not copy personal views, template libraries, Excel
  links or sync settings into shared survey metadata.
- Local files remain local. This decision does not upload or migrate any file.
- Preserve source bytes, raw legacy data and unsent edits until the transition and
  recovery paths are proved. No live migration or feature enablement is authorized
  by this decision record alone.

## Version and write interface

The immutable generation stores `content_model_version` independently of the
transport envelope version and snapshot compression version. Model 1 names the
existing representation; model 2 names this survey representation. New transport
calls require and echo the exact model. Existing protocol calls remain model 1
only; they never gain a retry fallback into model 2.

The shared model owns explicit initialization, materialization and marker/space
update methods. An updater runs once against a detached copy of the latest shared
projection, before any React state update. Validate and prepare the complete
change before writing: a Yjs transaction batches notifications but does not roll
back earlier writes when a later validation throws. An invalid change must emit
no update and leave the document unchanged.

Marker, space, page membership and region records have incarnation identities.
Child keys include their parent's incarnation, so edits to removed parents stay
hidden. Explicit restore uses a new incarnation; it cannot revive stale children.
Ordering is a separate whole-list intent, while changes to a list's contents stay
independent. Materialization ignores deleted IDs and uses a stable order for live
IDs absent from the last ordering intent.

## Required proof

Independent checklist edits and edits to different spaces must survive both
delivery orders, duplicate delivery, snapshot plus tail replay and cold reopen.
Tests must cover entity assignment versus checklist edits, same-field conflicts,
deletion versus edit, undo/restore, delayed React updates, offline receipt failure,
revocation, account changes and old-client rejection. Page replacement must retain
the model and its conflict units while changing only the intended page addresses.

Measure encoded update bytes for one answer change in a large marker and one
space change in a large list. Reapplying an unchanged projection must create no
update. Passing model tests alone is insufficient: the real store, sync handle,
viewer projection, SQL contract and generation transform must use the model.
Keep cloud flags off until those paths and live release gates have passed.

## Local payload checkpoint

A synthetic test using real Yjs encoding compared the old and new models. One
answer change in a marker with 1,000 checklist answers encoded 50,884 bytes in
model 1 and 64 bytes in model 2. One name change in a list of 250 spaces encoded
35,336 bytes in model 1 and 65 bytes in model 2. These are update payloads, not
measured network traffic, storage totals or Supabase bill savings. Exact sizes
depend on the fixture and encoding state.

The smaller edits have a cost: more keys and lifecycle records in the baseline,
and work to rebuild a view from those records. Keep read costs, snapshot size,
deleted-record retention and local journal work in the test scope. A smaller
update alone does not prove that the full path is faster or cheaper.

A local Node checkpoint with 2,000 small markers took 109–136 ms per single-answer
update and 22–25 ms per view rebuild across five runs. This is not a browser
latency claim. The whole-projection update interface still has a measurable CPU
cost; incremental reads and scoped changes remain candidates after correctness
and the connected save path are proved.

## Saved-state limits

The current limits do not form one end-to-end budget:

- Survey erase history has a local admission limit of 4,096 records and 16 MiB
  of its stored JSON values. It does not count other shared roots, Yjs structure
  and deletion data, the WAL, or the encoded full state.
- Model-2 WAL rows are raw Yjs updates. Full checkpoints are gzip-compressed Yjs
  state updates. The model-2 SQL append and snapshot functions do not yet limit
  the bytes written.
- SQL update reads return at most 1,000 rows and aim for 16 MiB per page, but an
  oversized first row is still returned. This is not a row-size limit.
- Checked open and live generation bootstrap allow at most 64 MiB for a stored
  checkpoint, its expanded state, the expanded checkpoint plus raw WAL tail, and
  the final encoded state. They allow at most 1,000 update pages by default.
- Source capture allows at most 10,000 rows and a 16 MiB JSON body across all
  source domains. It base64-encodes annotation bytes and retains the full
  generation WAL history, not only the tail after a snapshot. Raw annotation
  bytes therefore have an absolute ceiling below 12 MiB before metadata and
  other source data use the same budget. Snapshot creation does not prune WAL.
- The transform accepts at most 16 MiB of source JSON, 64 MiB of decoded source
  data, and 10,000 source rows. Its direct output check is 64 MiB, but replacement
  preparation and SQL publication both cap the new baseline plus legacy state
  and state vector at 16 MiB. Replacement plan JSON is capped at 64 MiB.

The 16 MiB local history limit is thus neither a publication limit nor a global
merged-state limit. Two offline peers can each pass it and later merge beyond it;
enough peers can cross the 64 MiB read limit. A normal marker value can also make
one update too large because value depth and node-count checks do not cap string
bytes. Keep model-2 rollout gated. Do not describe this local check as storage,
publication, or offline-merge safety.

## Remaining capacity and recovery gates

The following work is proposed and is not implemented:

1. Limit each newly inserted model-2 WAL row to the SQL page bound and each stored
   checkpoint to the checked-open bound. Apply a new-row check after exact receipt
   lookup so an older accepted write can still return its lost-success receipt.
2. Put model-2 append behind a trusted server path. At a fixed generation and WAL
   head, reconstruct the checked state, apply the proposed update, reject missing
   Yjs dependencies, and measure the exact encoded result against the 64 MiB read
   bound. A private SQL append must compare the expected head while holding the
   existing document lock. On a race, rebuild from the new head; never trust a
   client-supplied size or snapshot claim.
3. Measure publishability through the same source capture and replacement
   transform used for publication. The exact 16 MiB body/output and 10,000-row
   checks are authoritative. A warning threshold may start an early refresh, but
   no fixed local percentage can prove safety for offline peers or other source
   domains.
4. If a merged update would exceed the checked-read bound, perform no server
   write. Freeze the handle in a capacity-recovery state while retaining the exact
   staged snapshot and actor-scoped IndexedDB outbox. Do not treat capacity as a
   final permission rejection, delete pending bytes, or replay them into another
   generation.
5. Refresh through the existing checked source, archive, prepare and publication
   contract under the document lock. Carry every valid erase-history record into
   the new baseline. Writes accepted before source capture belong to that source;
   retired-generation receipts remain exact; later pending work stays bound to
   its old generation.
6. Recover offline work by rebuilding the old accepted state plus its pending
   updates, deriving a survey-level change, and applying checked model-2 plans to
   the new generation. Do not apply raw Yjs updates across generations. Keep
   conflicts and their exact bytes available for review.
7. A merged document whose live state or valid undo history cannot fit the
   publication bound cannot be made safe by silent history eviction. Keep it
   readable and recovery-only. Before rollout can support that case, add an
   immutable, access-checked history archive with a digest and generation/frontier
   receipt, and make Undo read that archive. Until then, reject new erase history
   before ordinary writes and retain all existing valid Undo data.

## Current rollout boundary

The model, checked reader, journal namespace, sync handle and viewer update
interface are implemented for explicit model-2 bundles. Core tests now cover a
mixed erase transaction, per-marker erase history, Undo and Redo conflicts, and
WAL plus cold-snapshot replay. A full-app browser route on localhost port 5221,
with a synthetic backend and real Yjs, IndexedDB and checked reader, has proved:

- Cold baseline counts remain intact and opening emits no WAL write.
- A normal full-stroke erase changes the marker count from two to one; toolbar
  Undo restores two and Redo returns to one.
- A second run erases, performs Undo while offline, and retains two local markers
  with one queued write while the server remains at one. Reconnect flushes the
  queue. A strict reopen reports `baselineSemanticMatch: true`, two markers, one
  ordinary annotation, one space, one region, an empty queue, four WAL rows and
  two snapshots.

The offline browser window also logged snapshot-protocol retries; these are
expected while its write backend is unavailable. A real-outbox fixture reproduced
the old-handle replay-status warning: snapshot coverage first settles the exact
pending write as accepted without a sequence, then the concurrent WAL reply adds
the sequence. The immutable-receipt check rejects that added evidence, and the
catch path tries to move an accepted row back to pending. Data and strict reopen
remain correct in the reproduction, but settlement must still allow the same
evidence to advance monotonically from a missing sequence to its verified
sequence. That fix remains a rollout gate.

The database migration defines versioned transport and model checks. Model-2
source, preparation and publication functions remain private and ungranted.
The disposable PostgreSQL harness has proved the private full-worker path for
explicit model-1-to-model-2 and model-2-to-model-2 source, archive, preparation,
publication and checked reopen. It also covers exact retry and revocation rules
and keeps model-1 behavior intact. No document upgrades itself on open.

This is local synthetic-backend proof, not a deployed, live-cloud, live two-user,
or cross-device result. Source and app rollout flags remain off. Before rollout,
prove region erase, trash-panel restore, the global capacity and recovery gates
above, and browser performance on large documents. Audit space fields such as
sidebar expansion separately from shared region content before enabling a migration;
copying a legacy whole record does not establish that every field belongs to the
team. Keep the original data and existing model-1 paths intact. Live Microsoft
365 work remains out of scope for this batch.

## References

- [Yjs shared types and JSON mutation caveats](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Yjs map and deep observation](https://docs.yjs.dev/api/shared-types/y.map)
