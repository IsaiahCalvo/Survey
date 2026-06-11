# KAL-287 — Dead-table disposition + the empty op-updates table (read-only audit)

**Date:** 2026-06-11 · **Session:** autonomous loop · **Method:** GET-only PostgREST
(service role, `count=exact`), full migration replay (63 files), 4 parallel adversarial
code-trace lanes + Codex plan review. **Zero writes were made to production.**
Supersedes the table inventory in SUPABASE-DATA-AUDIT.md §2 (2026-06-05), which predates
the 2026-06-06 rebuild migration.

---

## 1. Bottom line

- **`doc_yjs_updates` = 0 rows is SUPERSEDED, not silent data loss.** No writer was
  ever shipped: Phase 27 created schema only; Phase 28 added real RLS + an insert
  trigger but the client writer was deferred; the dual-write era (Phases 29–31) wrote
  `doc_yjs_state` snapshots instead; and the 2026-06-06 rebuild created
  **`annotation_updates`** as the real op log. That table is **live and actively
  written**: 339 rows across 4 documents, first row 2026-06-07, latest 2026-06-11
  15:54 UTC (minutes before this audit), in the realtime publication. The rebuild does
  NOT rely on `doc_yjs_updates` — the ticket's risk question is answered: collaborative
  updates are persisted durably, just in a different table than the audit assumed.
- **5 tables are confirmed droppable** (human-gated): `survey_presence`,
  `survey_sync_log`, `excel_schema_mapping`, `doc_yjs_updates`, legacy `annotations`.
- **2 tables LOOK dead but are load-bearing**: `survey_sessions` + `survey_items` are
  read/written **unconditionally** by the live version-history RPCs
  (`kal48_create_revision` / `kal48_restore_revision`, called from
  `documentRevisionService.js` → `RevisionsPanel.jsx` in the sidebar). Dropping either
  breaks Save-/Restore-version at runtime. Drop only together with a kal48 rewrite.
- **1 decision for Isaiah**: `activity_log` (0 rows, no writer anywhere, service-role
  insert only) was the planned Phase-33 audit-trail reader. Phase 33 was never started
  and the rebuild replaced its foundation. Keep only if the future activity-log feature
  will be built on the OLD schema; otherwise drop with `doc_yjs_updates`.
- **Found in passing:** (a) `excel_schema_mapping` has **4 rows**, not 0 — the ticket's
  "confirm 0 rows" precondition is false; rows preserved in §6. (b) Migration
  `20260611120000_kal307` (`excel_workbook_registrations`) is committed but **NOT
  deployed** to production (REST probe under the exact name: table absent) — same for
  kal313's trigger/index/function (alters `document_history_events`; not REST-verifiable).
  (c) Two real hazards on the NEW op-log path, reported in §5 for ticketing.

## 2. Live production counts (2026-06-11, GET-only, exact)

| Table | Rows | vs audit (06-05) | Status |
|---|---:|---|---|
| `annotation_updates` | **339** | not in audit | LIVE — rebuild WAL, in publication |
| `annotation_snapshots` | **4** | not in audit | LIVE — rebuild snapshots |
| `doc_yjs_state` | 113 | 114 (−1 = doc-delete cascade) | frozen — writer disabled, KEEP for now |
| `doc_yjs_updates` | 0 | 0 | superseded — DROP candidate |
| `activity_log` | 0 | 0 | never activated — DECISION |
| `document_revisions` | 0 | 0 | live feature, unused — KEEP |
| `survey_sessions` | 1 | 1 | stale (2025-12-31) but kal48-coupled — DEFER |
| `survey_items` | 0 | 0 | kal48-coupled + in publication — DEFER |
| `survey_presence` | 1 | n/a | stale (last_seen 2026-01-06) — DROP |
| `survey_sync_log` | 0 | n/a | DROP |
| `excel_schema_mapping` | **4** | n/a (audit had no count) | stale 2026-01-06 rows — DROP after preserving §6 |
| `annotations` (legacy) | 0 | "likely dropped" — wrong, it exists | DROP |
| `excel_workbook_registrations` | absent | n/a | migration NOT deployed (KAL-307) |
| `documents` / `document_annotations` | 121 / 53,229 | 119 / 53,216 | out of scope here |

WAL recency per document (`annotation_updates`): b120352b… 49 ops (latest 06-11 15:54Z),
43c92ebc… 233 ops (06-07→06-10), 6ba9b74d… 28 ops (06-09), ff4e2bbc… 29 ops (06-07→06-08).
Max seq 451 vs 339 rows: nothing in the current code prunes the WAL (snapshots are
upserted alongside, never followed by op deletion), so the gaps come from deleted-doc
cascades (earliest surviving seq is 38) and burned identity values — `GENERATED ALWAYS
AS IDENTITY` consumes a seq on every failed/conflicted insert, so the gap count is also
a rough ceiling on how often the §5.1 append-failure path has fired. Not loss by
itself, but worth a look during the §5.1 follow-up.

## 3. Why `doc_yjs_updates` is empty — the full timeline (evidence-backed)

1. `20260428000000` (Phase 27): table created **schema-only**, deny-all RLS stubs.
   Migration header: "Phase 28 wires the server-side update listener that writes rows."
2. `20260504000000` (Phase 28): deny-all stubs **replaced with real RLS** (select
   viewer / insert editor) + `doc_yjs_updates_validate_origin` BEFORE INSERT trigger.
   So RLS does NOT explain the zero — writes were possible from 05-04 onward.
3. No writer was ever shipped. `grep -rn doc_yjs_updates src/` → exactly 2 hits, both
   **comments** in `crdtUndoManager.js` (lines 29, 323) describing a planned Phase-33
   feature. No edge function touches it. The dual-write era persisted via
   `snapshotStore.writeByPageSnapshot` → `doc_yjs_state` (113 rows) instead.
4. `20260606120000` (rebuild): `annotation_updates` created as the append-only op log
   "written before broadcast", added to the realtime publication. PDFViewer now runs
   `useAnnotationDoc` (enabled: `isActive && cloudSyncEnabled && …`, PDFViewer.jsx
   ~16833) writing exclusively to `annotation_updates`/`annotation_snapshots`, while
   the legacy `useAnnotationCloudSync` is hard-disabled (`enabled:false,
   hydrateEnabled:false`, ~16814–16823; every effect early-returns).

**Verdict: (b) superseded.** Nothing writes it, nothing will, the rebuild's durable
foundation is `annotation_updates`. Drop alongside its trigger function
(`doc_yjs_updates_validate_origin`) and 2 RLS policies; it is NOT in the publication.

## 4. Per-table disposition matrix

| Table | Code refs (adversarially re-grepped, incl. aliases/camelCase/dynamic `.from()`/SQL bodies) | DB-side dependents | Publication | Disposition |
|---|---|---|---|---|
| `survey_presence` | ZERO (confirmed) | FK→survey_sessions CASCADE | **YES** (20241230000001:271) | **DROP** — publication removal first |
| `survey_sync_log` | ZERO (confirmed) | FKs→sessions/items/users | no | **DROP** |
| `excel_schema_mapping` | ZERO (confirmed; `schemaMappings` in PDFViewer is an unrelated local var) | updated_at trigger; FK→sessions CASCADE | no | **DROP** — preserve §6 rows first |
| `annotations` (legacy) | ZERO (no `.from('annotations')` anywhere) | pre-migration-history table; 4 own-user RLS policies (20260211043514) | no | **DROP** |
| `doc_yjs_updates` | comments only | validate_origin trigger+fn, 2 RLS policies | no | **DROP** (with trigger fn + policies) |
| `activity_log` | src: ZERO; agent-cli/tests: mock-schema strings only; edge functions: ZERO | select-viewer RLS; insert = service-role only (never used) | no | **DECISION** — Phase 33 never started (no `.planning/phases/33-*`); rebuild superseded the old CRDT roadmap. If the future activity-log builds on `annotation_updates`, drop with `doc_yjs_updates` |
| `survey_sessions` | **REFUTED as dead** — kal48_create/restore_revision JOIN + subquery it unconditionally; those RPCs are called by live RevisionsPanel | 4 FK children ALL `ON DELETE CASCADE` (items, presence, sync_log, excel_schema_mapping) | no | **DEFER** — drop only in a kal48-rewrite slice |
| `survey_items` | kal48 RPCs DELETE+INSERT it unconditionally on every restore; 2 fixture strings in agent-cli | rename history (entity_*, annotation_id); updated_at trigger | **YES** (20241230000001:270) | **DEFER** — same slice as survey_sessions |
| `document_revisions` | LIVE (documentRevisionService → RevisionsPanel → PDFSidebar) | 3 kal48 RPCs | no | **KEEP** (deployed-unused; revisit if version history is rebuilt on annotation_snapshots) |
| `doc_yjs_state` | only writer (`writeByPageSnapshot`) is inside the disabled legacy hook; reads likewise | Phase-28 RLS | no | **KEEP** — rebuild migration explicitly defers its removal "once the new path is proven"; KAL-261/262 zero-loss checkpoints verify against it |
| `excel_workbook_registrations` | KAL-307, migration dated TODAY (2026-06-11), current Excel-sync rebuild work — not yet deployed | new RPC kal307_register_workbook | n/a | **KEEP** (out of scope; deploy pending) |
| `document_history_events` | LIVE (KAL-313 trash/restore) | kal313 trigger + sweep fn | YES | **KEEP** (out of scope) |

Realtime publication final expected membership (static replay of all 63 migrations —
verify live with §7 Q1): `survey_items`, `survey_presence`, `document_annotations`,
`document_presence`, `document_history_events`, `annotation_updates`.
Note: the old audit's claim that `survey_sessions` is in the publication is **wrong** —
only `survey_items` + `survey_presence` were ever added from the survey group.

## 5. Hazards found in passing on the NEW op-log path (not KAL-287 scope — ticket these)

1. **Append failure is console-only.** `annotationDocSync.js:228–232`: a failed
   `annotation_updates` INSERT (network, RLS, anything but duplicate-key 23505) is
   caught, `console.warn`'d, and discarded — no dead-letter, no retry of those bytes
   (the "will retry on next op" comment is misleading; the next op gets a fresh
   client_seq). Partial backstop: every edit also schedules a snapshot write
   (1200 ms debounce, 4 retries with backoff) which captures the full Y.Doc — loss
   requires append AND all 4 snapshot attempts to fail, but on a flaky network at
   tab-close that window is real. Recommend: small dead-letter queue or blocking flush
   on unload. (Candidate for the last code-change cap slot or a new KAL ticket.)
2. **No size guard on realtime delivery** (`annotationDocSync.js:307–328`): oversized
   `postgres_changes` payloads can be dropped by the Realtime broker (~256 KB), so a
   second device may miss a large op live — recoverable on reopen (durable WAL replay),
   so this is staleness, not loss; same class as KAL-272.
3. **Legacy localStorage queues are pinned forever**: with `enabled:false`, the old
   `cloudSyncQueue_<docId>` / `crdt_dual_write_queue:<userId>` entries are never
   drained or cleared (drain paths require `enabled:true`). Matches the known
   dual-write-queue-jam memory; cleanup belongs to the legacy-path deletion slice.

## 6. Pre-drop data preservation (no row contents in this committed report)

What exists: `excel_schema_mapping` 4 rows + `survey_sessions` 1 row +
`survey_presence` 1 row — all belonging to one abandoned Excel-path session from
2025-12-31→2026-01-06, all under Isaiah's own user. Row CONTENTS are deliberately not
reproduced here (committed repo ≠ place for production data). The KAL-260 backup does
NOT cover these tables. Before Slice A, export them off-repo the same way KAL-260 did:
run §7 Q0 and save the output under `~/SurveyBackups/kal287/` (or any off-repo path).

## 7. Human-gated drop slice plan (Isaiah runs in the Supabase SQL editor)

**Rules for every slice:** plain `DROP TABLE <name>;` — **never `CASCADE`** (it could
silently take live kal48 functions or other dependents with it). A dependency error on
drop = STOP and reassess. Run the Q1+Q2 checks immediately before each slice.

**Reading Q2 results — expected vs unexpected dependents.** Every candidate will show
its OWN objects: its RLS policies, its own triggers/indexes/constraints, and FKs *from*
other tables being dropped in the same slice. Those are expected and drop automatically
with the table — they are NOT stop signals. The expected set per table is exactly what
§4's "DB-side dependents" column lists (e.g. `excel_schema_mapping`: its updated_at
trigger + its FK to survey_sessions + its RLS policies; `annotations`: its 4 own-user
policies). **STOP only on an UNEXPECTED dependent**: any function whose body mentions
the table and isn't already named in §4, any view, any FK from a table that is NOT in
the current slice, or publication membership not already accounted for in §4.

**Q0 (required before Slice A):** preserve the 6 stale rows off-DB (save output under
`~/SurveyBackups/kal287/`, NOT in the repo):
`SELECT * FROM excel_schema_mapping; SELECT * FROM survey_sessions; SELECT * FROM survey_presence;`
…and capture the legacy `annotations` schema (it has NO CREATE TABLE in migration
history — created via Studio pre-history — so a drop is otherwise unreconstructable):
```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='annotations' ORDER BY ordinal_position;
SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='annotations';
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.annotations'::regclass;
```

**Q1 (once):** live publication membership —
`SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1;`

**Q2 (per table, replace `<T>`):** full dependency sweep —
```sql
SELECT classid::regclass, objid, refobjid::regclass, deptype
  FROM pg_depend WHERE refobjid = 'public.<T>'::regclass AND deptype <> 'i';
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosrc ILIKE '%<T>%';
SELECT polname, polrelid::regclass FROM pg_policy WHERE polrelid='public.<T>'::regclass;
SELECT tgname FROM pg_trigger WHERE tgrelid='public.<T>'::regclass AND NOT tgisinternal;
```

**Slice A — zero-risk drops** (no live coupling, confirmed this audit):
```sql
ALTER PUBLICATION supabase_realtime DROP TABLE survey_presence;  -- member per ledger
DROP TABLE survey_presence;
DROP TABLE survey_sync_log;
DROP TABLE excel_schema_mapping;   -- after Q0
DROP TABLE public.annotations;     -- legacy, 0 rows, zero refs — ONLY after Q0 schema capture
```
Rollback note: survey/excel schemas reconstructable from `20241230000001`; the legacy
`annotations` schema exists ONLY in the Q0 capture (no migration creates it).

**Slice B — superseded CRDT leftovers** (after the activity_log decision):
```sql
DROP TRIGGER doc_yjs_updates_validate_origin_trigger ON doc_yjs_updates;
DROP FUNCTION doc_yjs_updates_validate_origin();
DROP TABLE doc_yjs_updates;
-- if decided: DROP TABLE activity_log;
```

**Slice C — DEFERRED, do NOT run now:** `survey_sessions` + `survey_items` require a
kal48 rewrite first (functions DML them unconditionally; survey_items is in the
publication; 4 CASCADE FK children hang off survey_sessions). Bundle with the
version-history-on-rebuild decision. `doc_yjs_state` stays until the rebuild's
"later step" gate + KAL-261/262 checkpoint retirement.

**Also queued for Isaiah:** deploy state — `supabase db push` pending for
`20260611120000_kal307` + `20260611130000_kal313` (committed ≠ deployed; verify with
`SELECT to_regclass('public.excel_workbook_registrations');`).

## 8. Evidence trail

Plan + adversarial review: `PLAN-KAL287.md`, `PLAN-KAL287-REVIEW-LOG.md` (Codex r1:
10 findings, all accepted/verified). Lane transcripts: workflow `wf_3b4387dc-43c`
(legacy-provider trace, silent-drop analysis, alias re-grep verify, migrations ledger —
all claims carry file:line citations). Live counts: PostgREST HEAD `count=exact` +
row GETs, 2026-06-11 ~16:15–16:40 EDT.
