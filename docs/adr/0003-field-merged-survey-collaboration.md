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

## Current rollout boundary

The model, checked reader, journal namespace, sync handle and viewer update
interface are implemented for explicit model-2 bundles. Tests use independent
Yjs documents and separate local device stores; remote service edges remain
test adapters. This is not live two-user or cross-device release proof.

The database migration defines versioned transport and model checks. Model-2
source, preparation and publication functions remain private and ungranted.
The existing page-replacement client rejects model 2 before saving an intent or
uploading bytes, and rejects a model-2 target before installation. No document
upgrades itself on open.

Before rollout, finish and test versioned source-byte and archive operations,
publication retries and revocation, survey-aware erase/undo/restore, and browser
performance on large documents. Audit space fields such as sidebar expansion
separately from shared region content before enabling a migration; copying a
legacy whole record does not establish that every field belongs to the team.
Keep the original data and existing model-1
paths intact. Live Microsoft 365 work remains out of scope for this batch.

## References

- [Yjs shared types and JSON mutation caveats](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Yjs map and deep observation](https://docs.yjs.dev/api/shared-types/y.map)
