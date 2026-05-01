# Phase 31 Deferred Items

User-approved scope reductions for the LEAN VARIANT of Phase 31 (locked
2026-04-30). These items are tracked here so the plan-checker and
gsd-verifier do NOT flag them as missing requirements; they are
intentionally deferred to Phase 31.5 / Phase 32 / future work.

Pattern reference: `.planning/phases/14-unified-svg-callout-render-shared-tool-foundation/deferred-items.md`
(scope-boundary deferrals during phase planning).

---

## MIGRATE-02 — "please update the app" gate for v2.3 clients

- **Roadmap mapping:** `.planning/REQUIREMENTS.md` line 60: "A user still
  on v2.3 opening a document already migrated to v2.4 sees a 'please
  update the app' gate rather than corrupted data."
- **Requirement table mapping:** `.planning/REQUIREMENTS.md` line 121:
  `MIGRATE-02 -> Phase 31 -> Pending`.
- **Phase 31 CONTEXT.md status:** Out of Scope (Lean Variant), section
  "Out of Scope (Deferred to Phase 31.5 / Phase 32)", bullet 1.
- **Reason for deferral:** No v2.3 clients exist in the wild for this
  app. The user is the only end user today, runs only the latest build,
  and the test devices all auto-update. A "please update" gate gates
  zero real-world traffic and would consume Phase 31 implementation
  time on a guard rail that has nothing to guard.
- **Risk accepted by user (2026-04-30):** if a v2.3 client materializes
  before Phase 31.5 ships, that client will see corrupted data on a
  cutover-complete document because the legacy `document_annotations`
  table will be partially-populated relative to the Y.Doc snapshot. The
  user has explicitly accepted this risk because no such client exists.
- **Where it ships next:** Phase 31.5 (post-launch when v2.3 clients
  exist) — gate keys off the documents row's `cutover_completed_at`
  timestamp + a client-version header. Implementation surface: the
  document-open path in App.jsx, with a new `<UpdateRequiredGate>`
  component sibling to `<ReadOnlyGate>` and `<ReSignInModal>` (Phase 28
  precedent).
- **Plan 01 frontmatter signal:** `requirements: [MIGRATE-02-DEFERRED]`
  with `deferred_to: "Phase 31.5 (post-launch when v2.3 clients exist)"`.
  The `-DEFERRED` suffix tells the plan-checker the requirement is
  intentionally not implemented this phase; the `deferred_to` field
  records the unblocking condition.

## Other items NOT scoped this phase (per CONTEXT.md "Out of Scope")

The following are documented in CONTEXT.md "Out of Scope (Deferred to
Phase 31.5 / Phase 32)" and are NOT requirements being deferred (they
are not in REQUIREMENTS.md at all); they are listed here for executor
clarity so no plan accidentally pulls them in:

- **Parallel-write parity verification window** — Phase 31.5 / Phase 32
  hardening. Lean variant uses the kill switch as the verification.
- **Automatic backfill for ALL docs at cutover time** — Phase 32. Lean
  variant uses per-doc lazy backfill on first post-cutover open.
- **Deletion of `document_annotations` rows** — Phase 32 hardening. The
  table is preserved for read-back during the transition and as the
  source for cold-doc backfill on first post-cutover open.
- **Highlights migration to CRDT** — v2.5 milestone. Highlights ride
  the legacy sync path through v2.4 by design (Phase 30 architectural
  decision; see `30-CONTEXT.md` "Highlights skipped").

---

_Written: 2026-04-30 22:30_
_Phase 31 plan author: gsd-planner via /gsd:plan-phase 31_
