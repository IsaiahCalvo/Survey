# PLAN — KAL-287: Disposition dead DB tables + investigate empty op-updates table (r1)

**Type:** read-only audit (cap-free). **No code changes. No DB writes. No drops.**
Deliverable is a written report + human-gated slice plan; actual `DROP TABLE` /
publication changes are production-DB work and are queued for Isaiah per loop rules.

## Why now

SUPABASE-DATA-AUDIT.md §5 #17–18 (2026-06-05 era) flagged dead tables and the empty
`doc_yjs_updates`. The audit's inventory is stale: migration
`20260606120000_rebuild_yjs_source_of_truth.sql` created **new** op-log tables
(`annotation_updates`, `annotation_snapshots`) and the live viewer now runs the rebuild
path (`useAnnotationDoc` enabled at PDFViewer.jsx ~16833) while the legacy per-row sync
hook is hard-disabled (`enabled:false, hydrateEnabled:false` ~16814–16823). The
disposition matrix must be re-derived against the current tree + current production
counts before the rebuild relies on any of this.

## Live production evidence already gathered (GET-only, service role, count=exact)

| Table | Rows now (audit said) | Note |
|---|---|---|
| `survey_sessions` | 1 (1) | single session 2025-12-31, Isaiah's own |
| `survey_items` | 0 (0) | — |
| `survey_presence` | 1 (n/a) | last_seen 2026-01-06 |
| `survey_sync_log` | 0 (n/a) | — |
| `excel_schema_mapping` | **4** (n/a) | rows created 2026-01-06 — ticket's "confirm 0 rows" precondition is FALSE; rows are stale Excel-era mappings tied to the single dead session |
| `activity_log` | 0 (0) | — |
| `doc_yjs_updates` | 0 (0) | the ticket's investigation target |
| `document_revisions` | 0 (0) | feature live in UI (RevisionsPanel), unused so far |
| `doc_yjs_state` | 113 (114) | decreased → consistent with no writer + a doc-delete cascade |
| `annotation_updates` | **339** (n/a) | first row 2026-06-07, latest 2026-06-11 15:54 UTC (minutes before this session); max seq 451 — gaps come from deleted-doc cascades + identity values burned by failed/conflicted inserts (nothing prunes the WAL). **The rebuild WAL is live and actively written.** Per-document recency breakdown goes in the report — no safety inference from the aggregate count alone. |
| `annotation_snapshots` | 4 (n/a) | rebuild snapshot per doc |
| `annotations` (legacy) | 0 — **exists** | audit said "likely dropped"; it exists and is empty → new drop candidate |
| `excel_workbook_registrations` | **absent in prod** | created by `20260611120000_kal307` — committed but NOT deployed (correct name; not "workbook_registrations") |
| `document_history_events` | (not recounted) | `20260611130000_kal313` alters it (index/trigger/sweep fn) — no new table; deployment state to be verified by Isaiah's SQL, not REST |

## Scope — disposition candidates and the already-known couplings

- `survey_sessions`, `survey_items`: **coupled to a LIVE feature** — `kal48_create_revision`
  / `kal48_get_revision` / `kal48_restore_revision` / `kal48_list_revisions` (migrations
  `20260522120000`, `20260522170000`) read/insert/delete `survey_items` and join
  `survey_sessions`, and are called from `src/services/documentRevisionService.js`, used
  by `RevisionsPanel.jsx`, mounted in `PDFSidebar.jsx`/`PDFViewer.jsx`. Zero rows / zero
  direct src refs do **not** make these safe to drop. Disposition options to present:
  (a) keep until the kal48 revision feature is migrated/rewritten without survey tables,
  or (b) drop together with a kal48 function rewrite in one human-reviewed slice.
- `survey_presence`, `survey_sync_log`, `excel_schema_mapping`: candidate true-dead;
  must survive the widened alias sweep (below) + DB-function sweep.
- `activity_log`: no src refs, but two extra gates: (1) sweep `supabase/functions/`
  (edge functions) and all migration function bodies for server-side writers;
  (2) check Phase-33 planning docs — it is the planned reader of `activity_log`
  (`crdtUndoManager.js` references it in **comments only**, lines 29/323 — comment-only,
  not live usage). If Phase 33 is still on the roadmap, disposition = DEFER not DROP.
- `doc_yjs_updates`: investigation target (below).
- `document_revisions`: live UI, empty — KEEP (note "deployed-unused" status).
- `doc_yjs_state`: live legacy snapshot store — NOT a drop candidate here (the rebuild
  migration header explicitly defers its removal to a later proven step).
- `annotations` (legacy, empty): add to candidates; same evidence bar.
- Explicit KEEP / out of scope: `excel_workbook_registrations` (KAL-307, migration
  dated 2026-06-11, current Excel-sync rebuild work, deploy pending),
  `document_history_events` (live, KAL-313).

## Method (all read-only)

1. **Code-reference classification** — every reference in `src/`, `supabase/functions/`,
   `supabase/migrations/`, `scripts/`, `agent-cli/`, `tests/` classified LIVE /
   TEST-ONLY / DB-FUNCTION / MIGRATION-HISTORY / COMMENT-ONLY.
2. **Widened alias sweep** (rename-exhaustive-grep): exact names; singular/camelCase
   variants; dynamic `.from(variable)` / template-string construction; JSON keys
   (e.g. `'survey_items'` inside `snapshot_json`); rename-era tokens that touched these
   tables — `highlight_id`→`annotation_id`, `ball_in_court_*`→`entity_*`; mocks and
   fixtures; and **SQL function bodies across all migrations** (functions are reachable
   via `supabase.rpc()` even with zero table-name refs in JS).
3. **DB-function dependency map** — for each candidate: every FUNCTION/TRIGGER/VIEW/FK/
   POLICY in migration history that touches it, and whether each function is callable
   from live code. FK chains noted (`survey_items → survey_sessions CASCADE`,
   `survey_sessions.document_id → documents SET NULL`).
4. **Realtime publication ledger** — replay every `ALTER PUBLICATION` across migrations
   (adds AND drops) to a final expected membership. Known correction: `20241230000001`
   adds only `survey_items` + `survey_presence` (NOT `survey_sessions`) — the audit's
   "survey_sessions still in publication" claim is treated as unverified. Live
   `pg_publication_tables` cannot be read via PostgREST → the report ships verification
   SQL for Isaiah and labels the static ledger as static.
5. **`doc_yjs_updates` = 0 investigation** (ticket's second half):
   - Timeline: Phase 27 (`20260428000000`) shipped schema + deny-all stubs; Phase 28
     (`20260504000000`) **replaced the stubs with real RLS** (select viewer / insert
     editor) **and installed the `doc_yjs_updates_validate_origin` BEFORE INSERT
     trigger** — so RLS does not explain zero rows; the explanation must be the absence
     of any client/server writer. Confirm NO writer exists in src/ (current grep: none;
     `crdtUndoManager.js` mentions are comment-only).
   - Establish where collaborative updates actually persist today: `annotation_updates`
     (live, evidence above) vs `doc_yjs_state` (legacy, writer status traced via
     YDocProvider/SupabaseYjsProvider mount + enable conditions).
   - Answer the ticket's risk question: are updates silently dropped? Examine
     `annotationDocSync.js` failure handling (insert failure → queued/retried/blocked
     vs console-only), KAL-272 large-update realtime drop (does it apply to the new
     path?), and the legacy localStorage quarantine queue (active or dead given
     `enabled:false`?).
   - Verdict with evidence: awaiting-activation / superseded-by-`annotation_updates` /
     silent-loss-hole.
6. **Report + slice plan** — `.planning/optimization/KAL-287-DEAD-TABLES-REPORT.md`:
   per-table verdict (DROP / KEEP / DEFER + evidence trail), the yjs-updates answer,
   and an ordered **human-gated** drop plan in which every slice:
   - starts with a **mandatory pre-drop dependency check Isaiah runs in the SQL editor**
     (pg_depend-based: functions, views, triggers, policies, FKs, publication
     membership, grants touching the table) — read-only REST counts are necessary but
     NOT sufficient for "safe to drop";
   - removes the table from `supabase_realtime` (if member) before dropping;
   - uses plain `DROP TABLE <name>;` — **`CASCADE` is explicitly forbidden** (it could
     silently remove live kal48 functions or other dependents); a dependency error on
     drop = stop and reassess, never escalate to CASCADE;
   - has a rollback note (what a restore would need — schema from migration history;
     for the legacy `annotations` table, which has NO CREATE TABLE in migration history,
     a live schema capture via information_schema/pg_indexes/pg_constraint is a
     required pre-drop step);
   - keeps production row contents OUT of the committed report — stale-row exports go
     off-repo (`~/SurveyBackups/kal287/`, KAL-260 pattern).

Evidence-correction (r2): the annotation_updates seq-gap explanation must not claim
snapshot-compaction pruning — no code prunes the WAL (snapshots are upserts only);
gaps = deleted-doc cascades + identity values burned by failed/conflicted inserts.

## Execution shape

Parallel read-only sub-agent lanes (already dispatched): legacy-provider trace,
silent-drop analysis, adversarial alias re-grep, migrations ledger. Orchestrator
synthesizes; every "zero refs" claim must carry the lane's adversarial CONFIRMED
verdict, not just the first grep.

## Gates

- `npx vite build` + `node scripts/run-node-tests.mjs` once before commit as a
  tree-health regression check (no code changes expected; uncommitted WIP exists in the
  tree; I commit ONLY my new files).
- Codex result review of the report until converged.
- Ticket + board status logs updated; local commit only; Linear flip noted as pending.

## Out of scope / refuse

- Any `DROP`, `ALTER PUBLICATION`, RLS change, or row deletion — production DB work,
  human-gated.
- `doc_yjs_state` cleanup (later rebuild step) and KAL-258 (standing instruction).
