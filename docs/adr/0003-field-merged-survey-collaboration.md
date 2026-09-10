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
sequence. This is now implemented through the existing outbox settlement
interface. A handle tracks the exact persisted sequence, so a duplicate is a
no-op but a contradictory known sequence fails before another outbox write.
Compacted identities remain fenced. Memory and IndexedDB tests cover receipt
ordering, retirement, immutable fields and repeat compaction with delete sets;
a checked-handle test covers a stale callback after WAL-first compaction.

A later full-app browser run kept offline Undo through reconnect and checked
reopen without the immutable-receipt or replay-status warnings. It took the
snapshot-only path: three WAL rows, two snapshots, no queued local writes, and
two rendered markers after reopen. The fixture's `inspect()` reports only its
WAL-built document, not stored snapshot contents; its one-marker summary is not
the checked reader's projection. The browser also reused its local clean
IndexedDB evidence, so this browser run proves local reopen, not server-only
recovery. A separate integration test blocks the WAL request before execution,
checks that the WAL head and row count remain unchanged and that WAL-built state
still lacks the undone marker, then applies the checked reader's update to a
fresh detached document. That document recovers Undo from the stored snapshot
without local outbox evidence. Releasing the WAL request then enriches the exact
receipt. This is synthetic-backend proof, not real SQL or live-cloud proof.
Simulated offline transport retries remain expected warnings.

Snapshot-only accepted records retain exact evidence even before a WAL sequence
can be added. If the append never succeeded, current replay does not revisit that
accepted record, so this retained data has no proven global storage bound.

Local compaction now replaces eligible snapshot-only receipts with a
strict, versioned proof: exact immutable metadata and ordered dependencies, plus
SHA-256 and byte length for each of the update and checkpoint byte fields. It
keeps the accepted checkpoint itself. Newly compacted sequence-known rows keep
the prior accepted-key-only representation. Snapshot-only rows remain full rows
unless their raw byte fields exceed the encoded proof and added accepted-key
cost by a fixed safety margin. This is a conservative local cost estimate, not a
measurement of the browser's physical disk use. Unknown receipt shapes retain
their full rows;
historical accepted keys without proof remain one-way fences. Hashing belongs
outside the transaction, with the exact current row checked again before atomic
proof insertion and row deletion. Normal settlement does not hash bytes unless
it needs to check a late reply against an already compacted proof.

Do not add background WAL replay just to reclaim these local bytes. The append
SQL allows client-sequence gaps but rejects an older missing sequence once that
writer has a later accepted sequence. Code `23505` can mean either that stale
sequence or a different-byte exact-key collision; transport does not preserve
enough detail to treat it as harmless. Exact snapshot-accepted evidence must
survive that ambiguity, with an unresolved warning retained across reopen until
an exact verified success clears it. No accepted row may be downgraded to pending
or discarded merely because that late reply failed.

This receipt patch passed local tests and independent review. Compact proof
metadata still grows with edit count, and checkpoint merging still loads the
accepted state. It is not a global storage bound or a substitute for the capacity
and history-archive gates above.

The first proof-for-every-model-2-row draft was rejected: a small-row measurement
produced roughly 99 KB of proof JSON for 100 sequence-known rows, where the prior
code kept only accepted keys. Removing repeated byte fields does not by itself
prove a storage improvement. Normal sequence-known compaction and tiny
snapshot-only rows therefore need separate before/after checks.

The late-conflict test also exposed missing production rules in its synthetic
backend: snapshot writes need exact-retry handling, the current WAL frontier, an
exact expected snapshot base and an increasing writer epoch. Writer sequence
reads must return the maximum accepted client sequence, not a count of rows.
The fixture now enforces these rules. Do not replace a same-handle
dependent edit with an independent peer edit to make the test pass. Acceptance
requires a fresh checked server read and a new local database to recover both
edits, plus a separate original-database reopen to retain the unresolved warning.
Repeated runs on pinned source confirmed an intermittent fresh-read failure.
Review found that snapshot bytes were captured before queueing, but the queued
write later read the mutable WAL sequence and expected snapshot base. Old bytes
could therefore be submitted under a newer frontier and pass server CAS. The
fix now seals bytes, WAL sequence and the complete expected-base tuple together
when enqueued. Every conflict-refresh retry also seals its refreshed base
with the rebased bytes. The deterministic queue test waits for the fixture RPC
to commit, holds delivery of its result, and publicly reads the stored snapshot
before advancing the next edit. Both that test and the original same-handle
flow recover both edits through a fresh checked read and a new local database.

Final local verification on 2026-09-10: the full `npm test` run completed with
6,961 tests (6,865 passed, 96 skipped, zero failed or cancelled) across 696 files.
`npx vite build` passed with the existing large-chunk warning. The eight receipt
reconciliation tests passed in ten fresh processes on pinned source; independent
review repeated those checks. In the in-app browser, an offline Undo survived
reconnect, flush and reopen with both markers present and no queued edits. The
exact fixture data was removed afterward. That browser check uses native local
storage and a synthetic backend, not live SQL or live multi-user service access.

A paired memory-adapter measurement against `af9cc652` used 100 tiny
sequence-known receipts, three warmups and twelve interleaved samples per
version. Both versions retained an estimated 14,380 bytes, 100 accepted keys,
zero proofs and zero full rows. Median settlement-plus-compaction time was
23.086 ms before and 22.682 ms after, with overlapping ranges. This supports no
small-row storage regression in that fixture, not a broad speed or browser
latency claim. For 100 larger snapshot-only receipts, estimated retained bytes
fell from 1,693,040 to 921,842. These estimates count raw bytes and encoded
metadata; they do not measure physical IndexedDB disk use.

An older checked bundle can also age while local storage opens. A snapshot-only
change may keep the same WAL head, while a later WAL delta depends on that newer
snapshot. WAL-tail catch-up alone cannot repair every such stale bootstrap. A
new public-handle test reproduced the dependent-tail failure on `799ce02c`.
The source patch removes the stale annotation-bootstrap reader: opening a
handle reads a fresh, actor-bound snapshot plus a tail fixed to that response's
WAL head. The checked bundle still fixes document, actor, generation and content
model and supplies the verified immutable PDF. No PDF acquisition is repeated,
and a failed fresh annotation read must not fall back to bundle or local bytes.
Every generated-document `SUBSCRIBED` event, including the initial join, now
requests a full checkpoint refresh to close the missed-signal interval after
hydration. Legacy document behavior stays unchanged.

Final verification on 2026-09-10: `npm test` completed across 697 files with
6,965 tests (6,869 passed, 96 skipped, zero failed or cancelled). The targeted
stale-open and bootstrap tests passed 16/16, and independent review repeated
them in five fresh processes. The final production build passed with the
existing large-chunk warning. Source and core tests remained frozen during the
full run; the dev-only harness was separately built and browser-tested.

The native-browser test closes the old handle, commits AppShell unmount, purges
only the fixture document's local state, then reads a checked bundle before
publishing a newer snapshot at the same WAL head. It reopens that stale bundle,
without another checked reader call. Two consecutive runs moved the left marker
from x=72 to x=132 and back to x=72. Both reported the expected position, two
markers, zero queued edits, zero local revision and WAL head 0 with zero rows;
snapshot writes increased from 0 to 1 to 2. The first moved position was also
checked in the rendered viewer. No matching generation/outbox/scope/replay
errors appeared. Exact fixture data was removed and the tab closed afterward.
This is native local-storage plus synthetic-backend evidence, not live-cloud,
live multi-user or cross-device proof.

This is a correctness fix with an explicit network cost, not an egress gain.
With the current contract, acquisition reads one full annotation snapshot,
handle hydration reads another, and initial realtime join reads a third. Each
pass also reads its fixed WAL tail. Without realtime there are two full snapshot
reads. The descriptor-only confirmation cannot distinguish a newer snapshot at
the same WAL head. Moving subscription earlier would require a buffered opening
phase and a proven ready-state contract; it must not make offline opening depend
on realtime success. The next efficiency step is an access-checked conditional
snapshot response that proves an exact snapshot identity unchanged before reuse
of verified accepted bytes. Until that contract is implemented and tested, keep
the extra annotation traffic explicit and keep rollout gated.

On the reviewed source, a public model-2 fixture measured three handle-open RPCs
(writer sequence, snapshot, fixed tail) and two additional RPCs on initial join
(snapshot, fixed tail). Counting UTF-8 JSON response `data` only, the tiny
fixture used 7,574 bytes at open and 7,386 bytes at join. A snapshot with a
deterministic 131,072-character pseudo-random base64 field used 201,749 bytes at
open and 201,554 bytes at join. These figures exclude acquisition, request
bodies, headers and transport framing and do not measure latency. The handle
path did not call checked PDF acquisition. Repeated annotation bytes remain a
measured cost to remove, not a claimed optimization.

The proposed conditional read must compare the exact checkpoint sequence,
writer identity and epoch, encoding and SHA-256 under the existing shared
document lock, after actor/generation/model access checks. It returns the same
atomic WAL head with either a verified unchanged identity or full changed
snapshot bytes. An unchanged response may reuse only the reader's private
verified bundle or an installed server-verified accepted prefix, never mutable
public bytes or optimistic/local-cache state. The snapshot tables do not store
a digest column, but checked open already computes and verifies a digest; the
conditional path can reuse that rule without a schema digest migration. Keep
the new RPC private and default-off until disposable PostgreSQL tests prove
scope, ACL, snapshot-only changes, fixed-tail races and exact response handling.
This conditional contract is a proposal, not an implemented saving.

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

## Deferred no-op projection shortcut

A proposed fast path compared fully normalized state before mutation planning.
It kept input validation, fresh peer reads and frozen results; review also added
a guard so malformed order arrays would still take the existing repair path.
The shortcut was then removed because paired measurements showed a cost for
updates that change data, contrary to the requested no-regression constraint.

The local fixture had 1,000 markers with 20 responses each, plus 250 spaces,
1,000 assigned pages and 1,000 regions. An interleaved same-process comparison
against checkpoint `2bfa3733`, with two warmups and 11 measured samples, showed
about 40% faster marker no-ops but 5.7% slower marker changes. Restricting the
shortcut to spaces restored marker performance, but that run measured space
no-ops 34.4% faster and space changes 4.3% slower. A separate structural-comparison
trial showed no clear gain and was also removed.

These are synthetic module measurements, not browser or production results.
No timing assertions were added to CI. Additional tests preserve the no-op,
input-clone, malformed-state, order-repair and peer-freshness contracts, but the
original core implementation remains in place. Large-document update cost is
still a rollout gate; do not claim a shipped speed gain from these trials.

## References

- [Yjs shared types and JSON mutation caveats](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Yjs map and deep observation](https://docs.yjs.dev/api/shared-types/y.map)
