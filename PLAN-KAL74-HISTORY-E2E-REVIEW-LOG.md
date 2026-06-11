# Plan Review Log: KAL-74 version-history e2e harness
Started 2026-06-11 ~02:40 (loop session). MAX_ROUNDS=5. PLAN_FILE=PLAN-KAL74-HISTORY-E2E.md.

## Round 1 — Codex (thread 019eb565-5be7-78c0-bbd6-8490ef5b054e)

Findings:
- regress-idle-disappearance.mjs:207 — marker "bounds compared" accepts bounds:null via !r.bounds; explicit null-bounds upsert could pass. Fix: require bounds present+matching.
- supabaseMock.mjs:286 — mutation representation responses ignore select; annotation_updates.insert().select('seq') gets seq even if projection drifts. Fix: apply select projection to POST return bodies.
- "No REST/storage forward path found."

VERDICT: REVISE

### Claude's response
Both findings audit EXISTING harness files, not this plan. Disposition:
- regress-idle-disappearance.mjs bounds check: REJECTED for this task — KAL-92's harness, out of KAL-74 scope; filed as a note on the plan's residuals instead (worth a future tightening pass, not this slice).
- POST-response select projection: PARTIALLY ACCEPTED — won't change the shared representation path mid-task (KAL-75/92 depend on current behavior; risk without benefit for a test-only slice), but the plan now pins a hard rule: the KAL-74 harness must never assert on POST/upsert RESPONSE bodies (only on ledger entries + subsequent GET reads), so the projection gap cannot create false-greens here. Added explicitly to plan §Changes.
Re-submitting with explicit instruction to review the PLAN document itself.

## Round 2 — Codex

12 findings (full text in /tmp preserved): (1) owner-check embedded select documents→projects! unserved by mock → S6 dead [VERIFIED RevisionsPanel.jsx:157-169]; (2) pin exact p_* RPC request keys; (3) get returns snapshot_json not snapshot; (4) history store must assign stable ids or panel renders event-undefined; (5) S2 false-green via localStorage fallback — clear it + assert primary GET; (6) alignment must compare inner glow path vs target annotation path, not outer svg vs host; (7) "3 rects present" by count weak — assert kal75-fab-01..03 identity+geometry; (8) kal75 rects are WAL-seeded not annotationRows [VERIFIED kal75Fixtures.mjs:110] — counts from rendered state; (9) History button is open-only; teardown = sidebar collapse; (10) named-version flow false-green without divergence — second edit between save and restore; (11) read-only open proves banner only, not snapshot render — declare scope; (12) no RPC failure cases — add one or declare residual.

VERDICT: REVISE

### Claude's response
Accepted 1–10 and 12 in full (plan rewritten, round-2 revision): mock gets exact-match embedded-select support gated by re-running KAL-75/92 harnesses; store assigns hist-<n> ids; S2 clears survey_document_history_events_v1 and asserts the primary GET; alignment metric switched to inner-path-vs-annotation-path with center+ratio tolerances; case-17 asserts fixture identity+geometry; counts computed from rendered state; case 19 uses sidebar collapse; S6 redesigned divergence-first (draw second stroke between save and restore); one create-failure case via failNext. (11) accepted as SCOPE PIN, not new asserts: dossier shows the snapshot is never rendered on read-only open, so the truthful contract is banner + body attr + state-not-lost; snapshot-rendering left to KAL-48 scope and logged as residual.

## Round 3 — Codex

6 findings: (1) embedded-select must be consumed/flagged BEFORE the generic projection/unmatched path at supabaseMock.mjs:284-286; (2) visible badge text is 'auto' (originBadge mapping), not raw 'auto-pre-restore' — assert DOM 'auto' + raw origin via store; (3) divergence not verified captured — assert the auto-pre-restore row has annotation_count 5 (the diverged state); (4) snapshot_json shape unpinned — banner reads snapshot_json.annotations.length; pin {version, annotations, survey_items, meta} count-faithful; (5) bbox size-ratio distorted by glow stroke width — strict centers + stroke-allowance size check; (6) RPC ledger gate must allow only exact kal48 call counts/bodies.

VERDICT: REVISE

### Claude's response
All 6 ACCEPTED verbatim — plan round-3 revision applied: handled-flag/select-rewrite before generic projection; DOM badge 'auto' + store-side raw origin; setLiveCount hook also feeds the restore handler so the auto row is count-faithful (===5); snapshot_json shape pinned; alignment = strict centers (≤3px) + stroke-allowance size deltas; RPC gate = exact counts (create ×2 incl. armed failure, get ×1, restore ×1, list ≥1) with exact p_* bodies, extras fail the run.

## Round 4 — Codex

"No remaining blockers found. The plan now pins the Supabase mock contracts, KAL48 RPC shapes, primary history readback, spotlight metrics, restore payload checks, and scoped residuals clearly enough to implement without known false-green gaps."

VERDICT: APPROVED

### Resolution
Converged in 4 rounds (1 misdirected, 2 substantive with 18 total findings, 1 approval). Proceeding to build per loop rules (Isaiah away; baton mandates build-on-approval).

## Result review round 1 — Codex

Build evidence reviewed (strict ×2 green 70 PASS, sibling harnesses green, build clean, 1438/1432/0/6). Both declared product bugs CONFIRMED plausible from source (spotlight pixel-viewBox fallback RevisionsPanel.jsx:302; embedded return before banner JSX :955). 6 findings: (H1) doc-scoped whitelist too permissive — exact per-window table/method/count expectations; (H2) RPC body gate incomplete — full p_* values on both creates + lists; (M3) alignment KNOWN-BUG path could swallow unmeasurable glow/target — hard-fail unmeasurable; (M4) Yjs-dup check UI-only — ledger-gate document_history_events POST event_type set; (M5) KNOWN-BUG channel needs label allowlist; (L6) undeclared POST representation projection change in mock.

VERDICT: REVISE

### Claude's response
All 6 sent to the builder agent verbatim (no src changes; fix in harness/fixtures; L6 revert-preferred). Full gate battery re-run required before next review round.

## Result review round 2 — builder response

H1: blanket whitelist → per-window WRITE_EXPECTATIONS (count ranges) + BODY_VALIDATORS (schemas pinned to the app's real upsert shapes); action-coupled writes exact; doc_yjs_*/document_annotations/activity_log/storage no longer pass anywhere. H2: full p_* bodies pinned on both creates, get/restore ids, all 13 list calls. M3: unmeasurable glow/target now hard-fails; only measured numeric misalignment rides KNOWN-BUG. M4: write-side gate — exactly 4 history POSTs, event_type multiset all local_annotation_history_added, zero yjs_*, summary multiset pinned. M5: fixed 8-label allowlist; unlisted knownBug = hard fail. L6: FALSE POSITIVE — POST representation block byte-identical to committed baseline (pre-existing from KAL-75/92); diff hunks enumerated, nothing reverted.
Gates: strict ×2 = 75 PASS / 0 FAIL / 8 KNOWN-BUG each; lock-document green; regress-idle green; build clean; tests 1438/1432/0 fail/6 skip.

## Result review round 2 — Codex

Confirmed: false-positive on the POST projection; write gate rejects unexpected doc_yjs_*/document_annotations/activity_log/storage; RPC bodies fully pinned; unmeasurable hard-fails; history write ledger catches hidden yjs_* rows; KNOWN-BUG fixed to 8-label allowlist. Residual: debounced snapshot ranges — declared and scoped.

VERDICT: APPROVED

### Final
Plan review: 4 rounds (18 findings). Result review: 2 rounds (6 findings, 1 false positive). Harness: 75 PASS / 0 FAIL / 8 KNOWN-BUG (two real product bugs, fail-closed ledger). Committing.
