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

Document entity definitions are shared document data. Personal favorites, palette
display order and the selected tool are private user preferences. Shared IDs,
names and definitions let collaborators interpret the same annotations and
produce consistent exports. Making those definitions private would let the same
document mean different things to different users. Sharing every palette setting
would instead let one user's tool choices disrupt another user's work.

Changing a shared definition needs the document's edit permission and a checked,
versioned write; a personal palette change must not rewrite shared definitions.
Personal template libraries stay private unless explicitly copied into a document.
This is the target ownership rule, not permission to merge legacy per-user lists
silently or enable a live migration before conflicts and recovery are tested.

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

The row-level write limits below are implemented locally. The following work
remains required before rollout:

1. Put model-2 append behind a trusted server path. At a fixed generation and WAL
   head, reconstruct the checked state, apply the proposed update, reject missing
   Yjs dependencies, and measure the exact encoded result against the 64 MiB read
   bound. A private SQL append must compare the expected head while holding the
   existing document lock. On a race, rebuild from the new head; never trust a
   client-supplied size or snapshot claim.
2. Measure publishability through the same source capture and replacement
   transform used for publication. The exact 16 MiB body/output and 10,000-row
   checks are authoritative. A warning threshold may start an early refresh, but
   no fixed local percentage can prove safety for offline peers or other source
   domains.
3. If a merged update would exceed the checked-read bound, perform no server
   write. Extend the write-admission pause to aggregate validation, retaining the exact
   staged snapshot and actor-scoped IndexedDB outbox. Do not treat capacity as a
   final permission rejection, delete pending bytes, or replay them into another
   generation.
4. Refresh through the existing checked source, archive, prepare and publication
   contract under the document lock. Carry every valid erase-history record into
   the new baseline. Writes accepted before source capture belong to that source;
   retired-generation receipts remain exact; later pending work stays bound to
   its old generation.
5. Recover offline work by rebuilding the old accepted state plus its pending
   updates, deriving a survey-level change, and applying checked model-2 plans to
   the new generation. Do not apply raw Yjs updates across generations. Keep
   conflicts and their exact bytes available for review.
6. A merged document whose live state or valid undo history cannot fit the
   publication bound cannot be made safe by silent history eviction. Keep it
   readable and recovery-only. Before rollout can support that case, add an
   immutable, access-checked history archive with a digest and generation/frontier
   receipt, and make Undo read that archive. Until then, reject new erase history
   before ordinary writes and retain all existing valid Undo data.

The next trusted-admission slice must preserve retry ordering. Probe exact
historical receipts before reconstruction, including the existing retired/revoked
retry policy, and repeat that lookup under the commit lock before current-scope
and head checks. Exact bytes return the accepted receipt; collisions remain
`23505`. A genuinely new write reconstructs at a fixed head and retries from a
fresh head after `40001`.

Keep the final encoded-state capacity limit separate from worker memory, gzip
expansion, replay-input and time budgets. Exhausting a worker budget is not proof
that the logical document exceeds capacity. Current readers also limit expanded
checkpoint plus raw tail bytes; a new write must not leave a read-safe final
state behind an unreadable replay chain. A trusted append may need to publish
its compact checked checkpoint atomically, or report a maintenance need. This
server path remains planned, private and disabled; it is not implemented by the
row-limit migration below.

The aggregate-admission work now has an agreed contract. A server-only module
will probe exact receipts before reading any checkpoint, reconstruct one fixed
head, validate the proposed update and measure the complete encoded result.
Every new admission carries the exact source checkpoint identity as well as its
head: another writer can replace a checkpoint without advancing the head. The
private commit must reject either kind of stale source. Ordinary small writes
leave the checkpoint alone; only an explicit maintenance request or a replay
budget that requires compaction produces a replacement checkpoint, committed
atomically with the new WAL row. No full checkpoint upload is required for every
small edit.

The private receipt/commit functions derive the actor from `auth.uid()` and gain
no public or service-role grants in this step. The production trusted caller and
its authenticated actor context remain an explicit rollout gate. Streaming gzip
limits bound input bytes, not the heap or execution time of synchronous Yjs
decoding; worker isolation and hard resource limits also remain deployment gates.
The private foundation is now implemented locally in
`annotationGenerationAggregateAdmission.js` and migration `20260909110000`.
The admission module owns its input bytes before waiting, probes accepted
receipts first, reads a fixed and scope-checked checkpoint/tail, rejects missing
Yjs dependencies, validates recovery state and measures the final encoding.
Worker input/page ceilings have a distinct maintenance-needed error; they do not
become a false logical-capacity error. Historical accepted rows retain their
previous retry and read rules instead of being reclassified by the new row cap.

Cross-review found and corrected two multi-user assumptions: historical WAL rows
may belong to a peer even though the enclosing read is bound to the caller, and
receipt identity includes the actor as well as writer ID and client sequence.
Tests now preserve peer and caller changes when actors reuse the same writer key,
while rejecting duplicate keys within one actor's history.

Review also found a receipt race: the initial probe could miss an edit that a
concurrent request then commits before the fixed-tail read. The module now
tracks that actor/writer/sequence tuple, checks the complete tail for gaps and
duplicate keys, and probes the trusted receipt again before applying the proposed
update or checking final logical capacity. Its sequence must match the observed
row. Exact bytes return the accepted receipt; different bytes fail with `23505`;
missing, malformed or mismatched receipts fail closed. This raced path still
requires valid, bounded checkpoint/tail reads; only an initial receipt hit skips
reconstruction entirely. The SQL commit retains its own receipt-first check for
races after the fixed read.

Focused Node checks pass 27/27, including 22 independent cases. A real disposable
PostgreSQL flow now reads
a model-2 checkpoint/tail into the actual admission module, commits through the
new private function and reopens through the existing checked reader. It proves
ordinary append with no checkpoint write and explicit maintenance compaction.
Automatic reader-limit compaction is covered separately by real-Yjs module tests;
do not describe the PostgreSQL composed case as testing that automatic trigger.
SQL tests also cover exact retired/revoked retries, collisions, same-head snapshot
changes, head races, overflow rollback, unchanged signals on rejection and denied
access for all runtime roles.

The shared validator imports `yjs` and indirectly imports geometry validation.
Two Deno import mappings now pin those already-installed dependencies to
`yjs@13.6.30` and `martinez-polygon-clipping@0.7.4`. No duplicate state validator or
viewer refactor was introduced. Deno checking and an actual ordinary/maintenance
execution both passed using manual node-module resolution; no package versions
or shared dependency directory were changed. The app build also passed.

Final frozen-source checks on 2026-09-10 passed: `npm test` ran 7,048 tests
(6,952 passed, 96 skipped, zero failed or cancelled), compared with the prior
committed baseline's 7,021 tests and the same 96 skips. The final 27-test focused
run, disposable PostgreSQL flow, Deno check, Deno runtime smoke and Vite build
also passed after the receipt-race fix. The build retains its existing large-chunk
warning. These are local module/runtime/database checks: no user-facing route
was enabled by this batch, and this is not live two-user or deployed proof.

This is not a measured latency or bill reduction. New admission still reconstructs
and encodes the complete state. One representative fixture read 77,043 bytes to
produce a 12,910-byte final state and a 496-byte gzip checkpoint; those are local
fixture bytes, not production traffic. A trusted actor-bound caller, verified
cache reuse or suitable co-location, hard worker resource limits and app routing
still need implementation and proof. No live grants, database changes or rollout
flags were changed by this private foundation.

The next caller must verify the bearer token with the existing auth service and
keep checkpoint and tail reads bound to that verified user. Never accept an actor
from the request body or an admission plan. A narrow, service-only broker can
bind the verified actor for the private receipt and commit calls; both private
functions must remain ungranted to app users. Prove role rejection and actor
binding before adding that broker or enabling a route. This is a design boundary,
not an implemented or deployed endpoint.

Verified-prefix reuse can first be limited to a single request and its head-race
retries. Reuse only owned, server-verified bytes after the conditional checkpoint
identity matches; a changed identity requires a fresh checked snapshot. Browser
cache bytes are not server proof. A stateless first request still needs the full
checkpoint. Cross-request reuse needs a bounded, actor-scoped trusted cache and
separate tests; do not rely on an Edge instance staying alive.

### Authenticated admission integration constraints

The caller audit at `9c7e01eb` found that the conditional checkpoint RPC from
migration `20260909108000` is ungranted to every runtime role. The v3 snapshot,
tail and open RPCs have different grants. Do not assume that a signed-in caller
can use the conditional RPC, or silently grant it while adding the write handler.
The aggregate input also needs the real generation base sequence; do not invent
one when mapping a checkpoint response that omits it.

The narrow broker must check the actual invoking database role, not an unverified
JWT role field or `current_user` after entering `SECURITY DEFINER`. PostgREST sets
the database role and request claims separately within each transaction. Actor
claims bound by the broker must be restored on both success and error, including
when the same connection serves a later request. See the
[PostgREST transaction contract](https://postgrest.org/en/stable/references/transactions.html).

The request handler must stay portable. The hosted Supabase limits checked on
2026-09-10 are 256 MB memory and two seconds of CPU per request. A 64 MiB Yjs
state, its in-memory representation and a hex-encoded transport response cannot
be assumed to fit. A successful small Deno fixture does not establish production
suitability. Hard worker isolation, measured peak memory and CPU, and data
co-location remain required before enablement. See
[Supabase function limits](https://supabase.com/docs/guides/functions/limits).

Finally, adding a handler does not enforce aggregate admission while the direct
model-2 append and snapshot RPCs remain callable. Rollout must close those bypasses
without breaking model-1 callers. This integration work must not silently change
those existing routes or grants before the replacement and recovery paths pass.

The agreed handler interface is one Fetch-compatible request handler with a raw
`application/octet-stream` body. Strict, unique query fields identify the
document, generation, model, writer and client sequence; no request field can
supply an actor, checkpoint, final-size claim or maintenance policy. Binary input
avoids doubling request bytes as hexadecimal JSON. The absolute request bound is
64 MiB, distinct from the 16 MiB new-write limit: an exact accepted historical
update above the new-write limit must still reach receipt reconciliation when
it fits the transport bound.

Three typed service-only broker functions handle the receipt probe, full checked
checkpoint and commit. The checkpoint adds the real generation base sequence
under the existing conditional-read lock, without granting the private read RPC
to app users. It checks editor permission and document lock state before returning
large state; commit still repeats the authoritative checks. Tail reads use the
existing v3 RPC with the verified caller's bearer token. Only a verified auth
result supplies the actor passed to the broker. Bound actor claims use the
authenticated role in both legacy and modern claim settings, while the actual
database invoker remains `service_role` and all previous claim values are restored.

Head races allow at most three attempts with fresh receipt/checkpoint/tail reads.
No prior admission plan may be reused against changed state. Transport, capacity,
maintenance and unconfirmed-write errors remain distinct. A lost response is not
proof that no write occurred; the next exact retry must reconcile its receipt.
The handler and broker remain disabled for app traffic pending the rollout gates.

Integration review found another receipt race at the final commit: an accepted
retry may have a different sequence from the current plan, and its response does
not claim that this request stored a checkpoint. The handler must not reject that
canonical receipt solely because the stale plan expected another sequence or
compaction. Reconcile such a no-checkpoint response with a fresh trusted receipt
probe, checking its exact actor, key, bytes digest and observed sequence. Never
report that the current compaction plan ran merely because the edit was accepted.

Authentication failure and provider failure also differ. A null or explicit
invalid-user result cannot authorize work; a network outage is not proof that
credentials are invalid. The installed auth SDK can return retryable errors in
its result object as well as throw. Both failure forms must be checked before
any broker or tail call, without exposing provider diagnostics to the client.

The local handler, production RPC adapter and service-only migration
`20260909112000` now implement this interface. Cross-review fixed the raced
commit receipt check, noncanonical model/sequence input, returned auth-outage
errors, and tail bounds before allocating decoded row bytes. The handler no
longer makes a redundant full input copy before the aggregate module's own
synchronous ownership capture. Shared app routing and direct-write grants are
unchanged, so this remains a disabled integration, not enforced app admission.

Native byte conversion replaced a per-byte string array in the new adapter and
per-byte parsing in the handler. A local 1 MiB fixture with five samples measured
median encoding at 59.38 ms for the draft loop versus 0.59 ms for the native
conversion, and decoding at 31.01 ms versus 0.65 ms. These compare two encoders
and decoders, not the old production app; no timing assertion was added. Exact
bytes, nonzero source offsets and invalid hex remain checked. This removes the
draft's large per-byte allocation pattern but does not measure worker peak heap,
full-document admission latency or provider cost.

The combined disposable-PostgreSQL test runs an actual Request through the
handler and production adapter into the real service broker and private commit.
Caller-scoped tail reads use the real v3 SQL function. Ordinary and raced accepted
writes retain the expected marker state. Reopen uses the real checked reader
with real SQL snapshot/tail bytes, but a synthetic publication/PDF descriptor
and local download fixture. Auth verification is also synthetic; this does not
prove live Auth, the actual publication/open RPC, storage download or real users.

The pinned Deno entrypoint now type-checks. Shared local dependencies did not
match its pinned SDK or Deno's Node types, so verification used Deno's separate
dependency cache with `--node-modules-dir=none`; no project package, lockfile,
shared node-module directory or install script changed. A Deno runtime smoke
also executed real Yjs admission through the handler and production adapter with
synthetic RPCs, proving ordinary acceptance and exact-receipt short-circuiting.
The entrypoint remains guarded by an explicit tested-worker runtime contract.

Final checks for this handler/broker slice on 2026-09-10 passed: `npm test`
ran 7,068 tests (6,972 passed, 96 skipped, zero failed or cancelled), compared
with the prior committed baseline's 7,048 tests and the same skips. The combined
focused admission/handler/adapter set passed 47/47. The disposable PostgreSQL
harness passed 12 checks, including a rollback-only grant test that reaches
each broker's internal role guard independently of its normal ACL. Temporary
test grants rolled back and WAL/head state stayed unchanged. Pinned Deno
type-checking, actual Deno runtime execution and the Vite build passed; the
build retains its existing large-chunk warning. All source and tests were frozen
for the final checks. No live database, account, Microsoft or deployment action
occurred.

### Client admission and runtime integration gates

The client audit found that the aggregate handler's v1 receipt proves exact
acceptance, but does not prove that its PDF generation is still current. The
existing sync append path uses both facts separately: it keeps an accepted old
receipt without applying its bytes or publishing erase effects into a new
generation. Never turn every aggregate HTTP 200 into `isCurrent: true`.

`annotationGenerationAggregateTransport.js` now implements the standalone binary
transport prerequisite, not an enabled sync route. Its request adapter owns the captured actor's JWT and request
lifecycle. The transport owns update bytes before any await, validates the exact
receipt identity and digest, bounds response reads, and keeps capacity,
maintenance and unconfirmed outcomes distinct. Its native Blob body preserves
the byte snapshot across the adapter's awaits without a special synchronous-copy
rule. The adapter remains trusted to send those bytes under the captured actor;
an immutable body does not constrain an adapter that sends a different request.
It returns acceptance proof and, with version 2, a current-generation observation;
it must not confer current access, retry automatically, or call a legacy write.

Before wiring it into sync, trusted receipt/commit results must include the
current generation identity observed under the document lock. Preserve historical
exact-receipt success after retirement or revocation; do not insert a new access
check into that policy. Validate that identity through the handler before the
client can use it. A separate current-access read is not an atomic replacement
for this contract and must never erase acceptance evidence when the read fails.

The local implementation now adds receipt version 2. Service-only v2 probe
and commit wrappers reuse the existing guarded v1 brokers under the same document
advisory lock; they do not duplicate actor-claim delegation or change v1 output.
An accepted v2 receipt adds a nullable `current_generation_id` and an `is_current`
flag equal to comparison with the requested generation. A missing receipt gets
no current-generation fields and does not read the head: knowing a document ID
and guessing an unowned receipt key must not disclose that metadata.

The handler opts in only through one unique `receipt_version=2` query field.
The client factory selects it explicitly with `receiptVersion: 2`; default and
explicit version 1 keep the old request and proof shapes. Version 2 never falls
back to v1. Fixed checkpoint and tail reads keep their existing interfaces. If
a raced commit requires a new exact-receipt probe, match the immutable actor,
key, bytes digest and sequence, then return that probe's newer generation
observation. Do not retain an earlier `is_current: true` after that probe observes
a replacement. A revoked actor's exact receipt can still be current; none of
these fields grant present access or make later cloud actions exempt from their
own permission checks. The contract now has the explicit sync opt-in below;
application wiring and the runtime gates remain incomplete.

Local verification composes the actual v2 client transport, native Request,
handler, production Supabase adapter, service brokers and disposable PostgreSQL.
It checks a new current write and checked reopen, an exact retry after access
revocation with no reconstruction or commit, and refusal of that actor's new
write. A controlled race accepts the exact row at sequence 2, then replaces the
head before the canonical re-probe; the client receives that replacement and
`isCurrent: false`, not the commit's earlier observation. PDF/publication
descriptors and authentication are fixtures: this is not a live publication,
real-account collaboration or UI claim. The SQL matrix also checks both broker
migration replays, service-only ACLs and actual-invoker guards, claim restoration,
missing-receipt privacy, retired receipts, digest collisions and document-lock
contention. V1 behavior and its prior checks remain in place.

Verification for this v2 slice on 2026-09-10 passed: 53/53 focused client,
handler and adapter checks; 14/14 disposable PostgreSQL checks; and the full
`npm test` run with 7,101 tests, 7,005 passed, 96 skipped, zero failed or
cancelled (previous baseline: 7,090 tests with the same 96 skips). Two extra
invalid-option cases were added to an existing independent test after the full
run began; the final 53-check rerun covers that exact test revision. Production
source stayed frozen throughout. The pinned Deno entry check and Vite build
passed; the build retains its existing large-chunk warning. No live migration,
deploy, application wiring or Microsoft test is part of this slice.

Opt-in model-2 sync must also stop every direct snapshot write, including repair,
debounce, append-failure, close and page-hide paths. Trusted admission and
maintenance own its cloud checkpoints; local staged bytes and the durable outbox
remain available. Server-side fencing must close new model-2 public append and
snapshot writes before rollout, while preserving model-1 behavior and exact old
append receipts. A client flag alone cannot enforce the rule.

The local write-fence migration is per PDF generation, not a blanket change for all model-2
documents. A private, initially empty fence table records explicit enablement.
Enablement takes the publication/WAL document lock, checks the exact current
model-2 generation and inserts once. It grants no client or service-role direct
table writes. A later publication must enable its replacement generation within
that same publication transaction; fence inheritance must not be inferred from
the old generation. Do not insert any fence until its clients, aggregate runtime
and recovery paths meet the rollout gates.

For a fenced generation, public append keeps its exact-receipt-first policy,
then rejects a new write with `SG005`. Public snapshot keeps its current access
policy and exact stored/stale-CAS results, but rejects an otherwise eligible new
write. Trusted aggregate private commit keeps its existing transaction and
checks. Old/null-generation entry points and direct table access must not offer
an alternate write path.

The matching sync interface is an optional `aggregateRequest` native request
callback in `openAnnotationDoc`, not a new application flag or route. Sync owns
the strict v2 transport, the original actor's request-local bearer header and
the existing checked outbox scope. Only a checked modern model-2 document can
select it. Reads keep the existing generation transport. Saves use exact
aggregate receipts; they must not invent a stored checkpoint or snapshot
frontier. Generic failure retries the exact durable outbox bytes. Capacity,
maintenance and admission-required responses pause that handle with distinct
errors, keep unsent bytes and stop automatic write retries until cold reopen.
In particular, an older model-2 client receiving `SG005` must not attempt a
snapshot fallback. No live client wiring or database enablement follows from
this interface alone.

`useAnnotationDoc` now exposes the same explicit nullable `aggregateRequest`
interface. Omission and null retain the existing write path. The hook passes
the exact callback to sync, which still validates a privately checked modern
model-2 bundle before acquiring a document or starting storage work. Invalid
opt-in reports `ANNOTATION_AGGREGATE_INPUT`; it does not silently choose direct
writes. No callback is inferred from a bundle field, URL or Supabase client.

Callback identity belongs to the writer's scope. Adding, replacing or removing
it replaces the scope during render, so retained methods stop being current
before passive cleanup closes the old writer. An unchanged callback keeps the
writer. Callers must keep a stable adapter identity and forward sync's supplied
request-local actor headers; a latest-function ref or a fresh auth lookup would
let an old request use a new account or destination. Queued pre-close work can
still finish under its original actor. The early exact-revision local-close
receipt does not wait for that cloud result. Viewer and application route wiring
remain separate rollout work; this hook interface enables no live service.

Mounted tests exercise the real React hook, sync module, strict binary transport
and aggregate handler with a real checked reader and IndexedDB-backed outbox.
Authentication and server persistence remain synthetic fixtures. The opt-in edit
uses no direct client append or snapshot call; omitted and null options retain
those existing paths. Invalid callback, unchecked document and a reader-issued
model-1 bundle fail closed. Callback-only replacement invalidates a previously
valid local receipt and its retained save method, without reopening unchanged
callbacks. Adding and removing the adapter also retire their old handles.

The account test holds A's request while a checked B handle opens. B's manually
triggered realtime refresh executes a head-0 read and holds its response. After
A's request settles in its original scope, B's view and local revision remain
unchanged; delivering that old head-0 response also leaves them unchanged. A
second checked B read covering A's accepted sequence then legitimately projects
A's edit. B can add its own edit, and a new A handle preserves B's accepted edit.
The test verifies original request-local bearer headers, exact adapter call
counts and saved content, without promising cancellation of accepted old work.
An earlier timing-dependent assertion incorrectly rejected valid B catch-up;
the final test instead waits for the actual realtime refresh promise and checks
the old and new responses separately. No production change was needed for that
test failure. This does not prove live multi-user authentication or rollout.

The default-path full-viewer regression on frozen hook code used the local
model-2 fixture with conditional reads in the in-app browser at 1280 by 720.
Offline erase left one marker and one pending edit; Undo restored both markers
and left two pending edits. Reconnect and Flush cleared the queue at WAL head 4.
Reopen retained both colored markers, the panel count of two, left x=72 and
local revision 0. The page was not blank, showed no framework overlay and logged
no console errors. Missing live configuration and deliberate offline failures
produced warnings. The exact cleanup route confirmed `cleaned` before its tab
closed. This is regression proof for the unchanged default route, not browser
proof of aggregate admission or live collaboration. Repeated default-path
snapshot retry cycles during the forced outage remain an audit lead, not a
measured production regression or evidence of billing impact.

Verification for this hook interface on 2026-09-10: the 82-check existing focused
set passed before and after the source edit. The full `npm test` run on frozen
production source passed across 715 files with 7,137 tests (7,041 passed,
96 skipped, zero failed or cancelled), against the prior checkpoint's 7,129
tests and the same skips. The mounted test was refined after that run to replace
the timing-dependent assertion described above; the exact final mounted file
and existing focused set then passed 90/90 together. Its eight cases also
passed in three fresh processes, and the held-account case passed five repeated
runs. Final repeated and independent-review runs emitted no React `act`
warnings. The disposable PostgreSQL write-fence harness passed nine checks and
the Vite build passed with its existing large-chunk warning. No viewer, sync
implementation, SQL, live database, role grant or Microsoft integration changed.
The AST-only code graph refresh completed with 29,185 nodes and 48,272 edges;
generated graph files remain unstaged.

The local sync implementation now uses that interface. One deadline spans
hashing, actor-session lookup, request dispatch and response-body reads. A late
session cannot start a request after that deadline; a late response body is
canceled. The request captures its own bearer header without changing the shared
client. An exact retired receipt remains in the original generation's outbox,
but cannot run its external effects or project its bytes into the replacement.

Explicit Save drains pending work, retries exact receipts and performs a final
checked catch-up. It returns success only when the accepted state has no known
gap or pending recovery, and its contiguous covered sequence equals the observed
head. This matters when a peer commits sequence 1 after the caller read head 0,
then the caller receives sequence 2: its own receipt alone does not prove that
the peer's update is present. Aggregate mode never substitutes a direct snapshot
for that missing state, including on reconnect, page hide or close.

Admission pause checks run before each external erase effect, not just once for
an outbox entry. A held first effect may finish and retain its acknowledgment;
the next effect stays pending without reaching its destination after a pause or
generation retirement. The regression uses two real queued effect descriptions
and an explicit first-effect barrier. The next lifecycle pass found that direct
consumers could still start the second effect after close began. The per-effect
check now also rejects deleted, closing and destroyed handles. It leaves internal
queued annotation writes and the completed first effect's acknowledgment intact.

Direct lifecycle tests prove normal two-effect execution, close after a held
effect succeeds or fails, deletion while an effect runs, and deletion after close
has already started. Close preserves the exact acknowledgment and pending state
in an IndexedDB-backed outbox. The test removes the retained registry document
before reopening, so recovery must come from persisted bytes; only unacknowledged
effects run. A successful first effect is not repeated on that cold recovery.
Deletion does not recreate the journal or erased maps when a late effect returns.
These are local tests with synthetic cloud responses, not live deletion proof.

The early local-close receipt remains separate from full teardown. It describes
the exact captured revision and can reject when that revision changes. Do not
wait for external effects or cloud completion before starting that receipt, or
relax its revision check. The lifecycle tests prove final recoverability by
opening persisted bytes after full teardown, not by assuming that every early
receipt succeeds.

The mounted lifecycle tests use the real React hook, sync module, Yjs and
IndexedDB-backed outbox. Disable, unmount and selection of an unavailable next
document preserve the old effect's acknowledgment without starting its next
effect. A live same-scope callback replacement still handles the next effect.
The account test obtains a checked B bundle from the real reader with synthetic
auth/access responses, waits for B hydration, then returns to a ready A handle.
B does not execute A's work or write A's state during hydration. A's new handle
may recover pending work using the same effect keys; after the old held effect
finishes and its full close resolves, that old drain makes no further calls.
The final checked cloud fixture still contains the completed acknowledgment.
This is not a global exactly-once promise: a new same-actor handle can retry an
effect before an older in-flight attempt settles, so destinations must continue
to enforce their idempotency keys. No hook implementation change was needed.

These tests also exposed delayed snapshot work after teardown. A completed
effect could schedule a new debounce timer after close had cleared its timers.
Both scheduling and the callback now reject closing or destroyed handles, while
normal close keeps its explicit final checkpoint. Closing an already-deleted
handle also skips that checkpoint. The direct test checks both zero backend
snapshot calls and zero snapshot retry warnings after purge; counting calls
alone would miss attempts rejected before network dispatch. A captured canceled
timer is also invoked to prove it cannot start a post-close snapshot.

The final 1280-by-720 in-app browser pass used the complete viewer and the local
model-2 fixture with conditional checkpoint reads. Offline full-stroke erase
left one marker and one queued edit with the fixture server unchanged; Undo
restored two markers and left two queued edits. Reconnect and Flush cleared the
queue. Checked Reopen retained two markers, left x=72, local revision 0 and WAL
head 4. Both colored markers and the panel count were visually checked. No
framework overlay or console error appeared; warnings came from missing live
Supabase configuration and deliberately offline append/snapshot attempts.
Fixture cleanup reported `cleaned`, then the tab closed. This checks the normal
viewer path, not a rendered held-effect race, a live account switch, Microsoft
sync, mobile behavior, deployment, latency or billing savings.

Final verification for this erase-lifecycle checkpoint on 2026-09-10:
`npm test` passed across 714 files with 7,129 tests (7,033 passed, 96 skipped,
zero failed or cancelled), compared with the prior checkpoint's 7,119 tests
(7,023 passed, the same 96 skipped). The focused lifecycle, close, aggregate,
durability and checked-generation set passed 97/97. The disposable PostgreSQL
aggregate write-fence harness passed all nine checks, including the actual
sync-to-handler path and lost-reply recovery. The final Vite build passed with
its existing large-chunk warning. The AST-only code graph refresh completed
with 29,170 nodes and 48,235 edges; generated graph files remain unstaged.
This checkpoint changes no hook source, SQL,
live data, role grants, app rollout flags or Microsoft integration.

The composed disposable-PostgreSQL proof now starts with the actual sync handle.
It explicitly observes head 0, commits a peer update at sequence 1, then commits
the local update at sequence 2 through the native request, handler and production
adapter under the write fence. It drops that local response, retries the exact
receipt without repeating the commit, catches up and checks both edits after a
fresh reopen. Public append and snapshot call counts remain zero. Authentication
and PDF/open descriptors remain local fixtures; this is not live account,
publication, UI, cross-device or deployed proof.

Final frozen-source verification for this sync/write-fence slice on 2026-09-10:
122/122 focused sync and transport checks, 9/9 disposable PostgreSQL fence and
composed-sync checks, and 14/14 existing service-broker PostgreSQL checks passed.
The full `npm test` rerun passed across 712 files: 7,119 tests, 7,023 passed,
96 skipped, zero failed or cancelled. The prior committed baseline had 7,101
tests with the same 96 skips. An earlier full pass was repeated after review
found and fixed the mid-entry external-effect pause gap; only the final run is
the evidence for the frozen source. The Vite build passed with its existing
large-chunk warning, and the AST-only code graph refresh completed. No live
migration, fence insertion, client
flag, application route, deploy or Microsoft integration changed.

A read-only host audit on 2026-09-10 found Node 26.5.1 and Deno 2.9.4, but no
available Docker, Podman, Colima or VM runtime. The local Darwin resource-limit
documentation does not establish a hard bound for all memory: RSS is a pressure
preference, and data-segment limits do not cover all mapped buffers. Neither a
Node worker heap limit nor an AbortController bounds synchronous Yjs work and
all ArrayBuffer memory. Do not describe this host as proving safe execution of
the maximum accepted document.

The required production design separates compute from commit. The parent owns
auth, immutable input and broker credentials. An isolated compute process gets
only fixed checkpoint/tail/update bytes and no network or commit capability.
The parent validates its returned plan and starts no commit after the compute
deadline. Production enablement still needs a tested runtime with hard total
memory, swap, CPU, process-count and wall-time limits. Local process-kill tests
alone cannot prove that memory limit. A database call already sent before an
overall request timeout may still commit; keep that result unconfirmed and
reconcile through its exact receipt on retry.

Local transport tests compose the real handler and real model-2 Yjs baseline
and delta with synthetic auth and broker calls. They prove a first commit before
a deliberately lost response and a receipt-only retry with no repeated commit
or reconstruction. The byte body has exactly the raw update size, without hex
or JSON expansion. Tests also cover input mutation, immutable body ownership,
strict receipt and status checks, both forms of maintenance error, and aborts
before dispatch, during a hanging request and during a stalled response body.
Invalid and late response bodies are canceled. Only privately branded internal
errors survive error handling; a provider stream cannot expose its diagnostics
by spoofing an internal error code. These are local module checks, not a live
auth, database, UI, multi-user or billing improvement claim.

The frozen transport passed 22 new focused tests and 85 checks when combined
with the existing generation transport suite. The final full `npm test` run on
2026-09-10 ran 7,090 tests: 6,994 passed, 96 skipped, zero failed or cancelled
(the previous committed baseline was 7,068 tests with the same 96 skips).
The Vite build passed with its existing large-chunk warning; graph refresh also
completed. An earlier overlapping full run failed an unchanged upload-cancellation
test and reached that file's timeout. The final full run passed that same file;
keep the earlier failure recorded rather than calling it a fixed product bug.

Read-only follow-up reproduced that fixture race in 6 of 20 whole-file runs.
Two event-loop ticks sometimes ended before either upload request started; the
early request-count assertion then left a deferred response unresolved. The
test now waits for the observed request count with a deadline and always aborts,
resolves its deferred response and observes the pending request in `finally`.
The changed upload test file passed 31/31 locally and in 20 consecutive runs
without forced process exit (620 test-case executions, no hangs). Root
also reran the file successfully. This test-only follow-up came after the full
suite result above; neither upload production code nor the frozen transport
changed.

### Row-level write-limit implementation

Inspection at checkpoint `80c7173c` confirmed that the model-2 append and
snapshot functions accepted unbounded input bytes. Adding SQL size checks
alone was not a complete fix: the sync append catch treated a program
limit like a transient failure and forced a full checkpoint, while snapshot
failure ran through the ordinary retry loop. A deterministic size rejection
must retain the exact pending edits and staged checkpoint without repeatedly
sending the same oversized bytes or treating them as a permission rejection.

Preserve the two existing retry rules. Append looks up an exact accepted receipt
before checking whether a new write is allowed; historical matching receipts
must remain available under that contract. Snapshot checks write scope first,
then checks its exact stored tuple and compare-and-swap conditions. A new limit
must not grant retired or revoked snapshot access, change a stale comparison
into a successful write, or invalidate an otherwise authorized exact retry.
Enforce limits on new writes without rewriting or deleting historical rows.

Disposable PostgreSQL characterization confirmed that current model 1 and model
2 each accept a new 16,777,217-byte WAL row and a 67,108,865-byte snapshot. These
are synthetic bytea storage-admission checks, not valid Yjs-state or reopen
proof. The client red test also reproduces the forced-snapshot fallback and
continued mutation after an admission failure while retaining the pending row.

Use SQLSTATE `SG004` exclusively for the new explicit byte-admission checks,
mapped to `ANNOTATION_GENERATION_CAPACITY` in model-2 generated write calls.
Do not classify a generic `54000` as a proven admission failure: PostgreSQL can
report other program limits with that code. Capacity is not generation
retirement or loss of permission. The status must retain a typed code through
the hook and show paused backup instead of the existing automatic-retry copy.
Do not claim a local save unless the durable local write actually succeeded.

Migration `20260909109000_annotation_model2_capacity.sql` now limits new model-2
WAL rows to 16 MiB and stored snapshots to 64 MiB. Exact boundaries remain valid.
Matching historical receipts and stale snapshot CAS keep their existing access
and return rules; rejected writes change no row, head or notification signal.
Model 1 and null-generation legacy paths retain their previous behavior.

The client holds a distinct capacity error for that handle. It retains the exact
outbox and staged checkpoint, stops automatic upload and snapshot retries, and
rejects supported new edits before invoking their updater. A fresh explicit open
may try once again. Capacity does not stop the local persistence observer: direct
or raced Yjs writes must remain journaled, including after a cold reopen restores
the pending writer sequence. This is not a hard global freeze of mutable Yjs.
Local save and close use an exact read-only projection check and durable receipt;
they do not call a blocked edit method. Hook status keeps the typed pause through
manual flush and cold hydration without reporting automatic backup or an
unproved save. Full browser and combined verification are still in progress.

The frozen browser capacity flow now preserves the pending erase across reopen,
keeps the pause sticky without repeated uploads, and recovers after the synthetic
fault is cleared and the document is explicitly reopened. That check exposed and
led to fixes for blocked writes from hydration and erase-consumer mount effects,
plus a model-2-only projection rule that no longer treats erased markers as
unfinished drafts. Explicit draft workflows and legacy model 1 are preserved.

The first browser pass was not a completed checkpoint. A follow-on normal
erase/Undo after recovery rendered the restored marker locally but failed the
local revision receipt; checked reopen then rejected the fixture's document
version. Passing the isolated capacity flow or the combined 7,010-test run
(6,914 passed, 96 skipped) did not override that failure.

A fresh browser diagnostic moved the first failure earlier: before the second
erase or Undo, the snapshot stored at sequence 2 after capacity recovery already
has unresolved Yjs structs and delete-set dependencies when decoded by itself.
It is a 1,450-byte gzip checkpoint with no later WAL rows at inspection. The
expected remaining marker is present, so semantic appearance alone cannot prove
checkpoint completeness. The direct handle-only recovery at sequence 1 passes;
the browser's extra acknowledgement/projection step must be included in the
regression. Fixture summary counters can be stale after a failed flush and its
in-memory document does not ingest stored snapshots; inspect actual snapshot
bytes and the fixed tail before attributing a failure to an individual update.

The real registry-document reproduction identifies the missing range: the erase
row records client clocks 0 through 2, recovery projection consumes clocks 3
through 5 before the observer is attached, and the real erase acknowledgement
starts at clock 6. The fix detects actual projection writes and starts
later observed writes with a fresh client identity and rebased staging. Rotation
alone is insufficient when an acknowledgement replaces a hidden projection item.
No-op projection must retain its current behavior. Verification must include the
real trash/history and acknowledgement lifecycle, not a substitute metadata row.

The canonical recovery test also found that the erase consumer could run during
open before the update observer was attached. Its side effects ran, but their
acknowledgements never entered the journal. Later drains correctly refused the
mismatch between live and accepted entries. The fix must defer consumption until
the observer is ready and then wake the existing drain. More polling cannot repair
an acknowledgement that was never recorded.

Checked open also needs a recovery validator separate from publication capture.
A complete checkpoint may contain valid pending erase effects after a crash.
Collaborators may read that state, but only the entry's actor may execute its
effects, after checking the exact accepted entry again. Malformed or ambiguous
entries still fail closed. The checked recovery validator admits only the five
production effect types, with required payload, target identity, actor and
acknowledgement checks. Publication and accepted-state capture keep their
settled-outbox requirement. The generic local consumer remains extensible.

The expanded recovery test now passes five cases. It exercises the real shared
registry and trash/history consumer, both orders of disjoint peer note/name edits
around recovery rebase, accepted partial and final acknowledgements, standalone
checkpoint completeness, later erase/Undo, cached reopen and fresh-reader reopen.
It also proves a pure offline model-2 field edit survives cold local recovery,
active deletion clears every model-2 root without later append or snapshot calls,
and Undo survives a held consumer. The recovery-open validator and final sync
source passed independent cross-review and 65 focused checks.

The frozen native-browser retest on 2026-09-10 now passes the previously failing
flow. A blocked erase kept one pending edit and made one failed append attempt;
cold reopen preserved it and made one further attempt. A blocked second erase,
Flush, and clearing the fault made no additional attempts. Explicit reopen after
clearing the fault recovered the erase plus both real acknowledgements at head 3.
The actual stored gzip snapshot was 1,299 bytes with no unresolved structs,
delete-set dependencies or later WAL rows. A normal erase, immediate Undo, Flush
and checked reopen preserved the right marker, an empty queue and local revision
zero. The stored head-7 gzip snapshot was 1,486 bytes and independently complete.
The real SVG marker and rendered viewer were checked. The fixture's exact data
was removed through its cleanup control (`cleaned`) and the tab was closed.
This uses the full local viewer with real Yjs and IndexedDB plus a synthetic
backend; it is not live multi-user, Microsoft, deployment or quota-bill proof.

The full suite also exposed a timing race in the earlier conditional-checkpoint
test. Subscription catch-up could still emit its second notification after the
test recorded its event baseline. The test now waits for the public `idle` state
before recording that baseline; the sealed-document and no-late-mutation checks
are unchanged. The delayed-close case passed in 20 fresh processes and the full
conditional test file passed 9/9. No source change was needed for this test fix.
The teardown test also needed a valid pending trash envelope: its earlier stub
omitted the commit time, target and payload, so the new validator correctly never
entered the consumer. The replacement uses the real production shape and retains
the same timeout and close/receipt/final-snapshot assertions. The teardown file
passed 4/4 and the related cloud-consumer group passed 18/18.
The realtime fixture test used an unsupported combined `trash-history` action;
it now sends the real `trash` and `history` actions and waits for their accepted
receipts before checking reopen. Its realtime and stale-publication assertions
remain intact. The related reader/materializer/fixture group passed 31/31.

Final frozen-source verification on 2026-09-10: `npm test` passed with 7,021
tests (6,925 passed, 96 skipped, zero failed or cancelled). The committed
baseline had 6,996 tests (6,900 passed and the same 96 skipped). The final Vite
build passed with its existing large-chunk warning. A fresh disposable PostgreSQL
run passed the row boundaries, rejection atomicity, historical retries,
collisions, access checks and model-1 compatibility. The native result above
uses those same unchanged source files. Nothing was pushed, deployed, or applied
to a live database, and no Microsoft session or account was used.
The final AST-only graph refresh passed; its generated files are not part of the
checkpoint. Large-graph HTML output was skipped by the tool's existing size cap.

The limits on individual stored rows still
cannot prove the size of merged Yjs state, decompressed snapshots, retained Undo
history or publication source bodies. The trusted aggregate validation and
recovery gates above remain required; no live migration is approved here.

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
The private conditional contract is now implemented in
`read_annotation_checkpoint_conditional_v3` and the generation transport's
`conditionalCheckpoint` method. The SQL function remains ungranted to PUBLIC,
anon, authenticated and service_role. An absent token requests full bytes;
only all five exact identity fields can produce a matched response. Generated
documents must have a valid baseline or checkpoint within their generation's
base and the fixed WAL head. Invalid scope, partial tokens, malformed stored
state and future checkpoint claims fail closed.

The frozen protocol tests passed 21/21 and a fresh disposable PostgreSQL harness
passed 9/9, including migration replay, role privileges, revoked access,
same-head snapshot changes, a later WAL head, malformed stored rows and a
concurrent snapshot writer. A 128 KiB checkpoint produced 427 UTF-8 JSON response
bytes on an exact match versus 262,573 bytes with the full payload. These are
executed protocol response data, excluding headers and transport framing, not
measured app traffic, latency or a Supabase bill reduction. PostgreSQL still
reads and hashes the stored snapshot under the shared document lock; omission
does not eliminate server CPU or lock contention. Reader/sync integration and
its default-off rollout gate are a separate step.

The reader/sync opt-in is now connected through a strict
`conditionalAnnotationCheckpoint` acquisition option, default false. It reaches
the reader as input and then the sync handle through the reader's private
WeakMap capture, not a public bundle field. The capture owns a verified
checkpoint identity, combined update and covered WAL position. An exact match
reuses that private prefix and reads only the remaining fixed tail. A changed
identity requires full verified bytes. The detached candidate must pass decode,
dependency completeness, scope and 64 MiB checks before installation; a failed
candidate cannot replace the prior prefix.

Optimistic edits, outbox receipts, realtime updates and local snapshot-write
acknowledgments never create or promote this prefix. They can remain pending
beside the verified cloud state. The prefix reuses its detached encoded update,
without a second full-array copy inside sync. Holding the old and new prefix
while a refresh is checked still has a bounded peak memory cost. Close, delete
and retirement clear the prefix and reject late work.

Focused proof covers private-byte ownership despite public bundle mutation,
default-off behavior, changed snapshots at the same head, fixed-tail reuse,
pending-data retention, failed candidates and a digest finishing after close.
Acquisition separately tests A-to-B-to-A rejection. A composed delayed A-read,
account cleanup and B-open test is still absent: sync relies on the existing
user-scoped hook calling `destroy()`, not on detecting a bare auth-session
change while an old handle stays live. Keep live account-switch and multi-user
proof as release gates.

The full-suite check caught a fixture-only regression: adding read counters to
`inspect()` changed an existing unchanged-state assertion after a failed read.
Transport counters now have a separate `inspectTransport()` method. The prior
assertion remains intact. Offline fault tests explicitly expect four snapshot
retry warnings; the normal conditional lifecycle tests emit none.

The final native-browser pass used the full viewer with real Yjs and IndexedDB
and only the synthetic backend. A clean opted-in open plus first join reported
two conditional matches, zero conditional full responses and zero old snapshot
RPC reads. Publishing a newer snapshot at head 0 moved the left marker from
x=72 to x=132; the handle fetched that changed snapshot and matched it on join.
The normal full-stroke eraser removed one marker while offline, leaving one
queued edit and the server unchanged. Undo restored two local markers and left
two queued edits. Reconnect and Flush cleared the queue; checked reopen retained
two markers, left x=132, zero local revision and WAL head 3. Both marker bounds,
paint styles and the rendered survey view were checked, including a zoom change.

A second same-head publication moved the marker back to x=72 with zero queued
edits. The complete run reported eight conditional reads: six matched responses
and two changed/full responses, with zero old snapshot RPC reads. Acquisition
still reads its initial complete bundle; these counters do not imply zero full
downloads overall. Fixture data was removed through its cleanup control, which
reported `cleaned`, and the tab was closed. This is local browser proof of the
opt-in path, not live account, multi-user, Microsoft, deployment or bill proof.

Final verification for this conditional-read checkpoint on 2026-09-10:
`npm test` passed across 699 files with 6,996 tests (6,900 passed, 96 skipped,
zero failed or cancelled). The baseline before this slice had 6,965 tests
(6,869 passed, the same 96 skipped). The focused stale-open, conditional and
acquisition set passed 37/37; the integration/acquisition pair passed in five
fresh runs after replacing a fixed-delay test with an observed sync-event gate.
The final Vite build passed with its existing large-chunk warning. The AST-only
code graph refresh completed. No migration was applied to a live database and
no default app flag, role grant, deployment or Microsoft integration changed.

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
