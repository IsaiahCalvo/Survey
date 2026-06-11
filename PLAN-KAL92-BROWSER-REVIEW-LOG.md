# Plan Review Log: KAL-92 browser-repro arm (mounted-app idle-disappearance regression)

Started 2026-06-10 ~18:30 (scheduled loop session). MAX_ROUNDS=5. Plan file: PLAN-KAL92-BROWSER.md.

## Round 1 — Codex (REVISE)

Material flaws:

- Plan seeds `document_annotations`, but current render hydrate uses `useAnnotationDoc` from `annotation_snapshots`/`annotation_updates`; fix: seed flat Y.Doc snapshot/tail.
- Survey marker “cloud rows” won’t render; legacy marker hydrate is no-op and fabric-carrying marker rows get dropped; fix: seed `surveyMarkers` Y.Map.
- “CRDT tables empty => phase30 Y.Map empty” is false if backfill runs from `document_annotations`; fix: set `cutover_completed_at` or avoid backfill.
- S2 is vacuous: `useAnnotationCloudSync` focus/realtime path is disabled (`enabled:false`); fix: target `useAnnotationDoc` behavior or remove S2.
- Survey marker DOM count needs `selectedModuleId`; fix: fixture/select template+module before asserting markers.
- S1 accepting `startup-shrink` after S0 hides a race; fix: require hydrated/startup=false before firing S1.
- S3 can append an empty-state op/snapshot through `useAnnotationDoc`; fix: run S3 in isolated doc/context and expect those mutations.
- “Zero DELETE” is too narrow; Yjs updates/snapshots can encode destructive clears without DELETE; fix: decode/inspect mutation bodies and table targets.
- REST interception misses realtime broadcasts and auth writes; fix: mock/block websocket/realtime too, or narrow claim to DB REST only.
- PostgREST mock must mimic `.single()`, `.maybeSingle()`, HEAD/count, `Content-Range`, `Accept` object responses; fix: implement table/query/status-accurate router.
- Returning `200 []` for unmatched requests makes app take fake-success paths; fix: fail immediately on unmatched critical reads/writes.
- DOM selector counts only rendered/visible pages; fix: put all fixtures on page 1 or expose app-state counters.
- Storage mock returning a PDF for every object breaks JSON sidecar reads; fix: serve PDF only for `file_path`, 404/JSON for sidecars.
- `user_subscriptions` intercepted empty can change feature gates; fix: fixture tier row or assert under known free-tier behavior.
- Presence upsert/delete are expected mutations; fix: whitelist presence separately from annotation durability assertions.
- Simpler: build one mounted dev harness that opens a local fixture and preloads flat Y.Doc state; skip Dashboard/Supabase auth for this regression.

VERDICT: REVISE
### Claude's response (round 1 → round 2)

Every Codex claim was independently verified by a 4-agent evidence pass before revising. Outcome per finding:

- ACCEPTED (verified CONFIRMED): render path is useAnnotationDoc ← annotation_snapshots/annotation_updates (document_annotations renders nothing); survey markers hydrate only from the durable Y.Doc surveyMarkers map and require showSurveyPanel + selectedModuleId to render; user_subscriptions read on boot with maybeSingle/single semantics; PostgREST mock must honor .single()/.maybeSingle()/Content-Range/{seq} returns; unmatched 200-empty was a fake-success hazard (now PostgREST-shaped error + run failure); storage mock must discriminate PDF vs sidecar paths; presence/documents-update mutations whitelisted separately; all-fixtures-on-page-1 adopted (DOM counts only rendered pages).
- ACCEPTED with sharpening (verified PARTIAL): "S2 vacuous" — the legacy focus/online/realtime paths are indeed dead (enabled:false), BUT the crdt:dedupe-resync listener has no enabled gate and is live in production (useAnnotationCloudSync.js:2666-2722) — S1/S3 stand; S2 reframed as an honest sentinel invariant. "Backfill fills the Y.Map" — true with gates verified clear for fresh docs; exploited deliberately: document_annotations fixture content now CONTROLS Y.Map size (survey-marker-only rows ⇒ stale-smaller Y.Map for the guard case; 12 backfillable rows ⇒ larger Y.Map for the growth control).
- KEY DERIVED FACT (beyond Codex's framing): with hydrateEnabled:false the hydrate effect early-returns before touching hydratedRef ⇒ hydrated is permanently false in the live app ⇒ every shrink refuses deterministically with reason "startup-shrink", and the expected-dedupe-shrink apply branch is UNREACHABLE in production. S1 now asserts the exact reason (no either-or), and the falsification control switched from allowed-shrink to GROWTH (not-a-shrink applies) on a second fixture doc — Codex's "S1 accepting startup-shrink hides a race" is resolved by determinism, not by waiting for a hydrated state that cannot occur.
- REJECTED (verified REFUTED): "S3 appends an empty-state op/snapshot via useAnnotationDoc" — useAnnotationDoc does not listen to crdt:dedupe-resync; the legacy push is ref-guarded in the updater and targets document_annotations anyway. Residual uncertainty (does useAnnotationDoc's change-push react to the setState?) handled with an expected-window whitelist + empirical discovery run.
- REJECTED with reason: "simpler: skip Dashboard/Supabase auth, preload local fixture" — the entire value of this arm over the existing unit slice is the real open path (real auth, dashboard, YDocProvider backfill, mounted listeners); auth+dashboard driving is daily-proven agent-cli practice.
- ACCEPTED narrowed claim: no-write guarantee scoped explicitly to DB REST + storage; realtime passes through (ephemeral broadcast on fabricated-UUID channels; Playwright cannot meaningfully mock the Phoenix protocol), stated in the plan instead of implied away.

Plan rewritten (round 2): two fixture docs (DOC-A stale-smaller guard case; DOC-B growth control), WAL-based renderable fixtures built with the app's own store modules, full verified REST inventory in the mock, tightened idle-window whitelist (zero WAL/snapshot/state writes — subsumes "destructive clears without DELETE"), record-only discovery run as implementation step 1.

## Round 2 — Codex (REVISE)

Derived fact checks out: `hydrateEnabled:false` leaves `hydratedRef` false, so shrink is deterministically refused as `startup-shrink`.

Remaining flaws:

- `user_subscriptions` as `maybeSingle null` makes `features.advancedSurvey=false`; Survey panel/module assertions can’t run. Fix: fixture active pro/developer subscription.

- Survey marker projection sync can still upsert `document_annotations` after `useAnnotationDoc` hydrates markers. Fix: whitelist idempotent marker upserts and assert no DELETE/missing IDs, or disable that sync path.

- Embedded PDF import is not disabled; `se011.pdf` native annotations can contaminate counts/WAL. Fix: set `embedded_import_completed_at` non-null or use proven annotation-free PDF.

- S3 `setAnnotationsByPage` is captured by `useAnnotationDoc`, causing `annotation_updates` plus debounced/teardown `annotation_snapshots`. Fix: allow and decode expected snapshot writes, or cut ledger before teardown.

- Mock inventory misses the `annotation_updates.select('client_seq')` seed query before tail reads. Fix: add exact route/shape for that read.

- DOC-B late snapshot debounce can leak into idle/global “zero snapshot writes” assertions. Fix: use scenario-scoped ledgers and wait/drain before each assertion window.

- Template/module click path underspecified; doc/template relation may not select the fixture module. Fix: seed `documents.template_id` and script explicit template then module selection.

- DOC-A marker rows must not include `annotation_data.fabricObject`; otherwise legacy all-types reads may confuse fixture intent. Fix: use marker-only mapper shape.

VERDICT: REVISE
### Claude's response (round 2 → round 3)

All eight findings ACCEPTED — each verified or directly absorbed:
1. user_subscriptions pro fixture — VERIFIED (AuthContext.jsx:551-553: cloudSync unconditional, advancedSurvey gated to pro/enterprise/developer; PDFViewer.jsx:4698 alerts and bails on free tier). Fixture now returns an active pro row via maybeSingle; storage probe single() returns {storage_used_bytes:0}.
2. Marker projection upserts — whitelist now allows idempotent document_annotations marker UPSERTs whose annotation_ids ⊆ seeded ids; DELETE or missing-id batches remain violations.
3. Embedded import — documents fixture sets embedded_import_completed_at non-null (also removes that UPDATE from the expected set).
4 + 6. S3 WAL/snapshot writes + late debounce leakage — scenario-scoped ledgers with settle/drain before each window closes; teardown writes recorded, not asserted.
5. client_seq seed query — explicitly routed in the mock inventory.
7. Template/module path — verified the actual flow is the template-selection modal (PDFViewer.jsx:4703/31548); harness scripts rail-toggle → modal → fixture template → module click explicitly (no reliance on a documents.template_id binding).
8. DOC-A marker rows — marker-only mapper shape, no annotation_data.fabricObject, stated in fixtures.

## Round 3 — Codex (REVISE)

Still material issue:

- S0/S1 assert 12 fabric DOM nodes and 5 marker DOM nodes together after module selection. Live visibility hides canvas-scoped fabric annotations when `showSurveyPanel && selectedModuleId`, so `data-annotation-index` drops. Fix: assert 12 with survey panel closed, assert 5 with module open, then close/reopen around S1/S2 as needed.

- “Record-only discovery run, no fixtures” conflicts with no-forwarding: either it can’t reach open/idle, or it hits prod REST. Fix: discovery uses same synthetic router/minimal fixtures; unmatched = fail.

- DOC-B whitelist allows `doc_yjs_state` upserts though that path should be dead with hydrate disabled. Fix: disallow it or decode/assert 12 entries.

VERDICT: REVISE
### Claude's response (round 3 → round 4)

All three ACCEPTED:
1. Visibility interplay — S0 now sequences: 12 fabric asserted with survey panel CLOSED, 5 markers with module selected, panel closed + 12 re-asserted before S1 (exact hide behavior confirmed empirically at implementation; sequencing is safe under either behavior).
2. Discovery-run contradiction — discovery now runs the SAME no-forwarding router with minimal best-guess fixtures and iterates on logged unmatched failures until open→idle completes clean.
3. doc_yjs_state over-permissive — disallowed everywhere (its only writer is the disabled legacy snapshot path; any appearance = regression signal). DOC-B window keeps annotation_updates + annotation_snapshots only.

## Round 4 — Codex (REVISE)

Round-4 fixes mostly land. Remaining material flaw:

- S0 closes survey panel before S1, but S1 still says DOM counts stay `12/5`. With panel closed marker DOM is `0`; with module open canvas fabric DOM hides. Fix: S1/S2 must use sequenced assertions too: panel closed assert fabric `12`, reopen template/module assert markers `5`, then close again before fabric checks.

VERDICT: REVISE
### Claude's response (round 4 → round 5)

ACCEPTED — S1 and S2 now use the same sequenced visibility pattern as S0 (panel closed → 12 fabric; module open → 5 markers; close before fabric checks). No other changes.

## Round 5 — Codex (APPROVED)

No material blockers found. The round-5 consistency fix lands: S0/S1/S2 all avoid mixed DOM visibility assumptions, discovery stays inside the synthetic router, and `doc_yjs_state` is correctly treated as a regression signal.

Only nit: plan header still says “Round 3,” but that is cosmetic.

VERDICT: APPROVED
### Resolution

Converged in 5 rounds. Header nit fixed. Proceeding to implementation under the loop charter (Codex plan approval = the baton's gate; result review follows the build).

---

# RESULT REVIEW (implementation) — same Codex session

## Result round 1 — REVISE (5 findings, all accepted)
documents PATCH whitelist too broad (→ exact body-key allowlist); storage POST to the PDF path treated as a read (→ GET-only reads, all storage writes ledgered); permissive filter parsing masks wrong query shapes (→ unmodeled or=/and=/not.* recorded as unmatched and failing the verdict; the ONE real or= shape — annotationCloudSync.js:125-126 two-branch annotation read — modeled exactly via strict regex, which the very next run validated by catching the real query); marker upsert subset rule weaker than plan (→ batches require the full seeded id set); S3's allowed WAL/snapshot writes not decoded (→ recorded inserts replayed over the fixture WAL in a fresh Y.Doc must yield exactly 12 entries; final snapshot gunzipped + decoded must hold 12).

## Result round 2 — REVISE (5 findings, all accepted)
documents PATCH must target a fixture doc id; mutations also get unmodeled-filter-syntax unmatched recording; strict column matching with generalized user-id capture (stamped fixture rows incl. a real user_subscriptions row); S2 pins the unsafe-shrink count unchanged across the idle window; marker upserts validate document_id/type/no-fabric-payload.

## Result round 3 — REVISE (3 findings, all accepted)
Storage handler records every non-GET/HEAD before special-casing; marker batch full-set check is id-set equality; per-table TABLE_COLUMNS schemas validate filter columns independent of fixture rows — immediately proved by catching a wrong column guess (connected_services.service_name, corrected from the app's real query).

## Result round 4 — REVISE (3 findings, all accepted)
Select projection applied to GET responses (embedded selects flagged unmatched); document_history_events/activity_log restricted to POST upserts (audit-table DELETE = destructive); marker re-upserts field-compared against seeded fixture rows (geometry epsilon 0.01, volatile fields ignored).

## Result round 5 — REVISE (2 nits, both accepted)
bounds must be present and matching (null-bounds corruption can't pass); POST representation bodies projected through the request's select.

## Result round 6 — APPROVED (no material findings)

(The 18:07 session died ~14s after sending round 6; the 20:07 resume session re-ran all gates green — vite build clean, node tests 1432/0 fail/6 skip, harness exit 0 with unmatched[] empty and zero destructive mutations — then re-sent round 6 to the SAME Codex session, which confirmed both r5 fixes present: marker rows require real matching bounds; POST representation bodies projected through simple select; REST/storage still has no forward path.)

VERDICT: APPROVED

### Resolution

Result review converged in 6 rounds. Harness final state: S0 (12 fabric + 5 markers, sequenced visibility), S1 (startup-shrink refusal, exact signature, zero mutations), S2 (idle sentinel — zero annotation-content writes), S3 (growth 4→12 applied, WAL replay + snapshot both decode to exactly 12), S4 SKIPPED-with-note (delete propagation unit-pinned), unmatched[] = 0. Committed locally per loop charter.
