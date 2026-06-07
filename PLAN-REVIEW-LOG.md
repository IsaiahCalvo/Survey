# Plan Review Log: Excel ↔ Survey Marker sync redesign

Act 1 (grill) complete — plan locked with the user 2026-06-07. MAX_ROUNDS=5.

Decisions settled in the grill:
- Goal order: data safety first, then renderer feel, then unification cleanup.
- Excel file lives both local and OneDrive/SharePoint → build/test both lock strategies.
- Excel is attribute-only; app owns marker existence + geometry. Excel may introduce an unplaced marker, never place/destroy a placed one.
- Conflicts: pure last-writer-wins per field + value kept in history; no inline conflict prompt.
- Anyone on the job can edit/remove; ownership is soft attribution only.
- Deletes are quiet + Undo + recoverable trash (30d, per-project configurable); no broadcast popups; "while away" pill.

---

## Round 1 — Codex

Findings (VERDICT: REVISE):
- origin='excel-import' guard not actually plumbed: useAnnotationDoc passes no origin; annotationDocSync hardcodes origin:'local'. Add an explicit import transaction API; imports apply attribute patches only, never whole-map reconciliation.
- Guard cannot know "app-created and not yet exported": records carry no durable export ack. Persist createdByApp, exportAckEtag/exportedAt, pending op ids.
- Import deletion also mutates annotationsByPage (PDFViewer.jsx:13319), captured to Y.Doc via applyByPage. Import must never delete geometry/canvas objects regardless of origin.
- syncSurveyMarkersToDoc deletes missing keys before setting changed ones (annotationDocStore.js:101) → partial durable deletion on crash. Make import reconciliation additive/patch-only.
- Gating on hasPendingExcelSyncChanges too weak (baseline in memory; missing-after-reload = "dirty" for everything). Load durable baseline first; fail closed to "review required" when none.
- Startup anchor still bad: selectedTemplate.updatedAt is not an Excel watermark. Use workbook eTag + content hash stored with baseline.
- 500ms delayed import races with Y.Doc hydration/local state. Block auto-import until hydration + baseline + queue loaded; cancel on local edit.
- Stage 1 name-match fallback reintroduces rename-destroys-geometry for legacy sheets. No auto name fallback for placed markers; quarantine.
- Hidden ID robustness still open (users delete/paste/duplicate/sort/copy IDs). Owned ID column + very-hidden metadata sheet; detect missing/dup/moved; quarantine.
- Hidden status/tombstone column wrong for Excel-side deletion (deleting the row deletes the status cell). Missing row = "absent upstream," not a tombstone; only app-origin deletes write tombstones.
- Hidden ID/status columns will look like schema changes unless parser skips them (skips only Changed By/Changed Date/Item/Entity/Notes). Define reserved sync columns + metadata sheet in parser first.
- Marker IDs don't solve checklist schema identity (columns matched by header text). Store checklist item IDs in column metadata; quarantine dup/unknown headers.
- Entity sync name-based, can drop unknown entity edits. Import entity by stable id; surface unknown names as validation.
- Per-field LWW defines no clock/revision/author; Excel Changed Date is a formatted date. Use per-field revisions from app store; treat Excel edits as observed-at-import.
- "Pure LWW with no prompt even for unsaved edits" contradicts the playbook's interrupt-affected-author rule. LWW only for committed values; active drafts need keep/take/compare or draft preservation.
- History recovery promised before append-only history exists. Ship field-level history before enabling silent overwrites.
- Whole-workbook rebuild (PDFViewer.jsx:11777) is a major data-loss window (formatting, extra sheets, comments, filters, concurrent edits). Patch only owned tables/ranges with eTag guard.
- Two clients can both export stale whole-workbook snapshots; last upload wins across the file. Per-workbook sync lease + read-latest, merge, If-Match upload.
- excelGraphService.js:238 claims upload-by-id works while Excel is open, while plan assumes lock failure. Don't assume; test Drive upload, workbook API, OneDrive Business, SharePoint, local separately.
- Graph error handling too narrow: also accessConflict, invalidSessionAccessConflict, Retry-After throttling — not just 423/412. Normalize all.
- 412 only protects if If-Match actually sent; current paths don't. Every cloud write sends last-read eTag and re-merges on mismatch.
- Excel REST API is for OneDrive Business/SharePoint/Group drive, not consumer OneDrive. Treat consumer OneDrive as content mirror only.
- Local file locking hand-waved: Electron writeFile may overwrite an open file on POSIX. Add a main-process platform-specific lock/write contract + tests with Excel open.
- Offline/reconnect underspecified: queue must survive quit, token expiry, network loss, rename, multi-device. Durable per-doc queue with idempotency keys, base eTag/hash, op order, retry state, visible depth.
- Flushing queued writes without first importing latest Excel overwrites offline Excel edits. On reconnect: read latest → merge against queued op base → write If-Match.
- Excel-created rows becoming markers pollutes canonical store with ghosts. Keep unmatched rows in an import inbox until accepted/placed.
- "Anyone can remove any marker" conflicts with the ownership gate (PDFViewer.jsx:22443). Remove that gate in the same stage as trash/audit, or revise.
- Recoverable trash conflicts with hard delete paths (deleteAnnotations). Replace marker deletes with tombstones first.
- Migration too dismissive: ignores recovery from legacy Supabase rows, local caches, app PDF metadata, Excel rows. Add a migration preflight: snapshot all sources, restore unambiguous, quarantine rest.
- Observability not a stage. Add a sync journal (attempt id, origin, workbook id/eTag, baseline hash, rows changed/missing/quarantined, prevented deletions, queue depth, retry cause, recovery action).
- Over-engineered on live feel/presence before the safety contract is testable; under-engineered on ID recovery, first-run baseline, lock semantics, conflict clocks, migration, audit (promote to Stage 0/1 acceptance criteria).
- Stage ordering: Stage 0 still allows data loss (no stable ids/baseline/pending-export/geometry protection); name fallback corruption survives to Stage 1; trash arrives after deletion behavior changes; queue arrives too late. Reorder so safety lands first.

Docs cited: Graph Excel resource scope/sessions, workbook-error-handling, throttling Retry-After, createUploadSession If-Match.

### Claude's response
Accepted nearly all of it — the critique is code-grounded and correct. Major revision of PLAN.md:
- Added six **core safety invariants** that hold from the first commit (no Excel-origin delete of a placed marker; import is patch-only/additive and never touches geometry; deletes are app-origin tombstones only; no name-matching of placed markers; patch-only eTag-guarded owned-range writes; sync journal from day one).
- Reordered stages so the **entire safety contract lands before any collaboration UX**: Stage 0 (import transaction + real origin plumbing + additive reconcile + disable all Excel-origin deletes/auto-create + durable per-marker export metadata + eTag/hash watermark + durable baseline fail-closed + hydration/queue gating + journal); Stage 1 (reserved columns + very-hidden metadata sheet + marker/checklist/entity ids + quarantine, no name fallback); Stage 2 (tombstones + trash + field history before any silent overwrite; ownership gate relaxed with audit); Stage 3 (patch-only If-Match writes, sync lease, durable per-doc outbound queue, read-latest→merge→write, full Graph error normalization, per-surface product gating incl. consumer-OneDrive-as-mirror and a main-process local lock contract); Stage 4 (per-field revision clock); Stage 5 (quiet UX); Stage 6 (cadence spike).
- Added a **migration preflight** (snapshot all sources, restore unambiguous, quarantine rest).
- Added per-stage acceptance criteria.

Rejected / overruled (1, with reason):
- Codex wants a keep/take/compare **prompt** on same-field conflicts. The product owner explicitly chose **no prompt** ("keep newest, save the old"). Resolution: keep last-writer-wins-no-prompt on *committed* values, but adopt Codex's underlying valid concern by **never clobbering an actively-open edit field mid-edit** (remote applies on commit/blur; both values in history). This fixes the real data-loss-while-typing risk without adding the prompt the owner declined.

Scoped-down (1):
- Migration: accepted the preflight snapshot + restore-unambiguous/quarantine, but not a heavy full reconciliation — owner has said residual data loss on already-corrupted docs is acceptable (re-upload).

---

## Round 2 — Codex

Most prior blockers confirmed addressed (patch-only import, no geometry delete, no name fallback, durable baseline, journaling, stable IDs, trash-before-overwrite, eTag/lease/queue, broader Graph errors, local-file uncertainty, migration preflight). Remaining material issues (VERDICT: REVISE):
- Stage 0/Stage 1 identity gap: invariants forbid name-matching from commit 1, but IDs arrive in Stage 1 — Stage 0 has no safe match key. Fix: Stage 0 fails closed / review-only for placed markers on any sheet without trusted IDs.
- Consumer OneDrive contradicts "no whole-workbook rebuild": without the workbook API, content mirror = download/edit/upload full file, which can lose features. Fix: consumer OneDrive read/import-only or export-copy-only until a preserving OpenXML patch path is proven.
- ID backfill underspecified: how existing sheets get first-stamped without unsafe name matching. Fix: one-time controlled ID-stamping migration — auto-map only unambiguous rows vs baseline, quarantine the rest.
- Stripped-ID recovery too central to leave in Risks. Fix: move it into Stage 1 acceptance.
- Stage 0 acceptance only covers reopen auto-import; destructive paths also exist in manual import, auto import, file-watch/live polling, workbook session sync. Fix: Stage 0 acceptance requires every inbound path through the patch-only API (executeExcelImport, executeAutoExcelImport, live/file-watch).
- Import inbox durability unspecified. Fix: store proposals durably with source eTag/hash + row identity.
- Local-file lock contract is a material feasibility risk Stage 3 depends on. Fix: add a spike gate — if reliable lock detection isn't achievable, local .xlsx = manual export/import only.

### Claude's response
Accepted all 7 (no rejections — each tightens a real gap). PLAN.md edits:
- Invariant 4 + Stage 0 acceptance: inbound import is **review-only for placed markers until Stage 1 IDs exist** (closes the identity-ordering gap), and **every** inbound path (manual/auto/file-watch/session sync) must route through the patch-only import transaction API.
- Stage 1: added the **one-time controlled ID-stamping migration** (auto-map unambiguous-vs-baseline only, else quarantine), a **durable import inbox** (persists across reload with source eTag/hash + row identity), and moved the **stripped/duplicated-ID recovery rule into Stage 1 acceptance**.
- Stage 3: consumer OneDrive is now **read/import-only** (writeback only export-to-a-copy until a feature-preserving OpenXML patch path is proven); added a **local-file lock spike gate** (fall back to manual export/import if lock detection isn't achievable).
- Risks trimmed accordingly (metadata-sheet durability → Stage 1 acceptance; local lock → Stage 3 spike gate).

---

## Round 3 — Codex

All round-2 findings confirmed addressed. One new material flaw + one minor correction (VERDICT: REVISE):
- NEW: plan assumed range/table PATCH writes can be guarded with `If-Match` eTags, but Graph's range-update endpoint documents only Authorization / Content-Type / optional Workbook-Session-Id — NOT If-Match (If-Match is for driveItem/upload-session file writes). Fix: spike-gate proving If-Match on the exact workbook PATCH endpoints, OR redesign concurrency to app-side lease + read/merge/write without claiming eTag-preconditioned range writes.
- Minor: wording — Excel range update IS supported on delegated personal accounts; it's createSession (persistent sessions) that's unsupported on personal accounts. No data-loss risk (plan already degrades consumer OneDrive) but correct the wording.

### Claude's response
Accepted both — Codex is right on the Graph API specifics.
- Invariant 5 + Stage 3: concurrency for range/table writes is now an **app-side per-workbook sync lease + a persisted workbook session + read-latest→merge→write**, explicitly NOT `If-Match` on range PATCH (eTag/If-Match reserved for file-content-level ops). Added a Stage 3 **spike gate** to prove on the exact endpoints which of session-id / lease / eTag each honors before relying on it. Queue-flush wording updated to "write under the workbook session + lease."
- Corrected the personal-account wording: consumer/personal OneDrive supports sessionless range ops but not persistent sessions (createSession), so it stays read/import-only until a session-safe patch path is proven; safe two-way sync with sessions needs OneDrive-for-Business/SharePoint or a local file.

---

## Round 4 — Codex

Round-3 fixes confirmed in the detailed design. Two remaining consistency issues (VERDICT: REVISE):
- The **Goal paragraph still carried the old wrong claims** (workbook API "not supported on consumer OneDrive"; "eTag-guarded writes to owned ranges"), contradicting corrected Stage 3. Fix: update the Goal sentence to match.
- **"Persisted workbook session" is ambiguous**: Graph's persistChanges:true means changes are saved, not that the session ID is durable; invalid sessions shouldn't be reused. Fix: the QUEUE is the durable thing; sessions are created/refreshed per flush and discarded/recreated per Graph error codes.

### Claude's response
Accepted both (pure consistency fixes). Rewrote the Goal sentence to match Stage 3 (per-flush session + lease + read/merge/write, not range eTag; personal OneDrive weaker). Clarified everywhere that the **outbound queue is the only durable artifact**; workbook sessions are per-flush, recreated when Graph reports them invalid. Updated the product-gate and key-decisions wording to "per-flush workbook session" / "workbook sessions."

---

## Round 5 — Codex — VERDICT: APPROVED

All round-4 findings addressed. One non-blocking nit: Goal said sessions are available on "OneDrive-for-Business/SharePoint (and local files)" — local files don't have Graph workbook sessions. Applied: removed "(and local files)" and pointed local to the Stage 3 lock/write contract. No new material data-loss or concurrency flaw found.

## Round 6 — Codex (fresh session: harness review + one more plan pass)

Requested after installing the openai/codex-plugin-cc plugin; run via the same Codex engine. VERDICT: REVISE.

JOB 1 — harness: confirmed `agent-cli/excel-corruption-e2e.mjs` is a VALID engine-layer proof (real engine + real Supabase, CONTROL genuinely exercises the old Y.Map deletion path) — but it OVER-CLAIMS at the app level: the live PDFViewer import still captures markers with the default local origin, so the result line "Excel imports can no longer destroy..." is false as an app claim. Smaller: `batchSize<=0` could stall the loop; import-origin can still overwrite geometry/`bounds` or same-ID protected markers (delete-protection only); no journal assertion; no app-level Stage-0 tests yet.
JOB 2 — plan, 5 new flaws: (1) Preserve says builder "extracted unchanged" but Stage 1 must add hidden ID/metadata columns — contradiction; (2) builder snapshot gate is "before Stage 3" but Stage 1 already changes schema — too late; (3) Preserve's 3-min session refresh vs Stage 3 "per-flush, not durable" reads as a contradiction; (4) Stage 3 is "before re-enabling automatic writes" but Stage 0 never explicitly disables today's full-file/live writeback — a data-loss window; (5) invariant "tombstoned deletes from first commit" but tombstones aren't built until Stage 2.

### Claude's response
Accepted all (no rejections; all real). Fixes applied:
- Harness: rewrote the result output to say PASS (ENGINE LAYER) with an explicit SCOPE note that the live app is NOT fixed until the Stage 0 viewer wiring lands. Store: clamped `batchSize` to a positive int so 0/NaN can't stall.
- Plan: invariant 3 reworded (Excel can never delete; app-origin deletes become tombstones in Stage 2; gap meanwhile closed by invariant 1 + the kill-switch). Invariant 8 reworded to "visible workbook contract frozen; Stage 1 may add hidden metadata as snapshot-approved additive drift." Stage 0 gains a **writeback kill-switch** (disable automatic full-file/live writeback until Stage 3; manual export-copy only) and an **import field whitelist** (imports may write answers/name/note/entity only — never geometry/new placed markers; protectedIds are write-protected for imports). Builder-output snapshot gate moved to **before any Stage 1** builder/parser change. Session-refresh Preserve wording clarified (refresh only sustains an active long flush — no contradiction with per-flush sessions). Approach heading softened from "leaves no data-loss gap" to "never widens the data-loss risk."
- Deferred (not gold-plated into the low-level reconcile now; captured as Stage 0 import-transaction work): the field whitelist, write-protected protectedIds, and the journal prevented-deletion assertion — these belong in the import transaction API + app-level Stage 0 tests, per the plan.

### Round 6 follow-ups → APPROVED
Two confirm passes on the same Codex thread closed two remaining wording leaks: (a) the harness file header still said "END-TO-END proof" → reworded to ENGINE-LAYER proof with the live-app scope warning; (b) a Stage 0 line still implied tombstone-only deletes → reworded so Excel imports never delete while app-origin hard deletes stay unchanged until Stage 2. Codex then returned **VERDICT: APPROVED** — harness honesty, the writeback kill-switch, visible-contract builder wording, the pre-Stage-1 snapshot gate, the import field whitelist, and the session-lifecycle wording are all internally consistent.

## Resolution: CONVERGED — APPROVED (5 plan rounds + a round-6 harness/plan hardening pass via the openai/codex-plugin-cc engine)
Plan grilled with the owner (Act 1) then survived 5 adversarial Codex rounds (Act 2). Codex hardened it from a "safety floor" that still lost data into a real safety contract: patch-only imports that never touch geometry, app-origin-only tombstoned deletes, stable-ID identity with quarantine (no name-guessing), a durable baseline + durable outbound queue, correct Graph concurrency (lease + per-flush session, not range eTag), per-surface product gating, and a migration preflight — with the collaboration UX deferred until the safety contract is testable. Awaiting owner sign-off before any code.
